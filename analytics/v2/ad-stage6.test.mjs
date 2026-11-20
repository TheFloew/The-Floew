import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {dirname,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {ingestAcceptedBatch,sealDays,sealMonths,STAGE6_TIME} from './ad-stage6-pipeline.mjs';
import {getStage6AdReport} from './ad-stage6-report.mjs';
const {H,D}=STAGE6_TIME,secret=Buffer.alloc(32,77),keyId='stage6-test-key';
const base=dirname(fileURLToPath(import.meta.url));
const open=()=>{const db=new DatabaseSync(':memory:');db.exec(readFileSync(join(base,'ad-stage6.sql'),'utf8'));return db;};
const NOW=Date.UTC(2026,10,20,18,55),DAY=Date.UTC(2026,10,1),MONTH=Date.UTC(2026,10,1);
const ad=(id,at,ad_id='A',event_type='ad_view',visitor_id='v',extra={})=>({event_id:id,occurred_at:at,ad_id,event_type,visitor_id,
  device_type:extra.device??'mobile',orientation:extra.orientation??'ver',local_hour:extra.localHour??14,dwell_ms:extra.dwell??0});
const ingest=(db,batchId,events)=>ingestAcceptedBatch(db,{batchId,events,secret,keyId});
const source=(events, override)=>async ({since,until})=>override??events.filter(e=>e.occurred_at>=since&&e.occurred_at<until);
const report=(db,range,events,now=NOW,override)=>getStage6AdReport({db,range,now,secret,keyId,boundarySource:source(events,override)});
const sum=(db,field)=>db.prepare(`SELECT COALESCE(SUM(${field}),0) AS n FROM v2_counters`).get().n;
test('event replay across different batches is not counted twice, including dwell and reach',async()=>{
  const db=open(),e=ad('a',NOW-5*H),s=ad('b',NOW-4*H,'A','ad_skip','v',{dwell:6000});
  assert.equal(ingest(db,'x',[e,s]).accepted,2);
  const r=ingest(db,'y',[e,s]);assert.equal(r.accepted,0);assert.equal(r.rejectedDuplicates,2);
  assert.equal(sum(db,'views'),1);assert.equal(sum(db,'skips'),1);assert.equal(sum(db,'dwell_sum_ms'),6000);
  const o=await report(db,'24h',[e,s]);assert.equal(o.totals.views,1);assert.equal(o.totals.viewers,1);db.close();
});
test('same batch exact replay no-op and altered batch is rejected',()=>{
  const db=open(),e=ad('x',NOW-H);ingest(db,'batch',[e]);assert.equal(ingest(db,'batch',[e]).replayed,true);
  assert.throws(()=>ingest(db,'batch',[ad('y',NOW-H)]),/changed contents/);assert.equal(sum(db,'views'),1);db.close();
});
test('conflicting event ID in a different batch fails and leaves all derived rows unchanged',()=>{
  const db=open(),e=ad('x',NOW-H),other=ad('y',NOW-H);
  ingest(db,'one',[e]);
  assert.throws(()=>ingest(db,'two',[other,{...e,ad_id:'B'}]),/conflicting payload/);
  assert.equal(sum(db,'views'),1);assert.equal(db.prepare('SELECT COUNT(*) AS n FROM v2_event_ledger').get().n,1);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM v2_batch_manifest').get().n,1);db.close();
});
test('atomic ledger, counters and reach transaction rolls back on secret key mismatch',()=>{
  const db=open(),first=ad('a',NOW-H),second=ad('b',NOW-H);
  ingest(db,'initial',[first]);assert.throws(()=>ingestAcceptedBatch(db,{batchId:'second',events:[second],secret,keyId:'wrong'}),/HMAC key changed/);
  assert.equal(sum(db,'views'),1);assert.equal(db.prepare('SELECT COUNT(*) AS n FROM v2_event_ledger').get().n,1);db.close();
});
test('1000 accepted view events in same facet write a single hourly counter row',()=>{
  const db=open(),events=Array.from({length:1000},(_,i)=>ad('z'+i,NOW-2*H));
  const r=ingest(db,'big',events);assert.equal(r.accepted,1000);assert.equal(r.counterGroups,1);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM v2_counters').get().n,1);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM v2_event_ledger').get().n,1000);db.close();
});
test('24h, 7d and all preserve exact rolling bounds for a non-aligned clock',async()=>{
  const db=open();const e=[ad('older',NOW-8*D),ad('outside7',NOW-7*D-1),ad('start7',NOW-7*D),
    ad('outside24',NOW-D-1),ad('start24',NOW-D),ad('middle',NOW-10*H,'A','ad_complete','v',{dwell:5000}),
    ad('now',NOW-2*60_000,'B','ad_view','another'),ad('end',NOW,'B','ad_view','at-end')];
  ingest(db,'range',e);
  for(const [range,views] of [['24h',2],['7d',4],['all',6]]){
    const o=await report(db,range,e);assert.equal(o.totals.views,views,range);
  }
  db.close();
});
test('incomplete or forged boundary source fails closed',async()=>{
  const db=open(),e=[ad('edge',NOW-30000)];ingest(db,'valid',e);
  await assert.rejects(()=>report(db,'all',e,NOW,[]),/Boundary incomplete/);
  await assert.rejects(()=>report(db,'all',e,NOW,[{...e[0],ad_id:'fake'}]),/unaccepted or modified/);
  await assert.rejects(()=>report(db,'all',e,NOW,[ad('fake',NOW-20000)]),/unaccepted or modified/);db.close();
});
test('daily compaction + monthly compaction preserve all-time total and distinct reach',async()=>{
  const db=open();const events=[
    ad('oct1',Date.UTC(2026,9,5,12), 'A','ad_view','same'),
    ad('oct2',Date.UTC(2026,9,8,12), 'A','ad_view','same'),
    ad('oct3',Date.UTC(2026,9,13,12), 'B','ad_view','other'),
    ad('oct4',Date.UTC(2026,9,15,12), 'B','ad_return','other'),
    ad('nov1',Date.UTC(2026,10,2,12), 'A','ad_view','same'),
    ad('nov2',Date.UTC(2026,10,8,12), 'A','ad_view','third'),
    ad('recent',NOW-2*H,'B','ad_view','same'),
    ad('current',NOW-10000,'A','ad_view','latest')];
  ingest(db,'history',events);
  const before=await report(db,'all',events),want={views:before.totals.views,viewers:before.totals.viewers,returners:before.totals.returners};
  const cutDay=Date.UTC(2026,10,10),cutMonth=Date.UTC(2026,10,1);
  const daily=sealDays(db,{cutoffDay:cutDay,now:NOW,verifiedThroughMs:cutDay,secret,keyId});
  assert.ok(daily.changed);assert.ok(daily.counterSourceRows>0);
  const monthly=sealMonths(db,{cutoffMonth:cutMonth,secret,keyId});assert.ok(monthly.changed);
  const after=await report(db,'all',events);
  for(const [k,v] of Object.entries(want))assert.equal(after.totals[k],v,k);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM v2_counters WHERE grain='hour' AND bucket_start<?").get(cutDay).n,0);
  assert.ok(db.prepare("SELECT COUNT(*) AS n FROM v2_counters WHERE grain='month'").get().n>0);
  assert.ok(db.prepare("SELECT COUNT(*) AS n FROM v2_counters WHERE grain='day'").get().n>0);
  const last7=await report(db,'7d',events);assert.equal(last7.totals.views,2);db.close();
});
test('sealed period rejects NEW late events but allows replay of previously accepted event',()=>{
  const db=open(),old=ad('old',Date.UTC(2026,9,5,12));ingest(db,'first',[old]);
  const cutDay=Date.UTC(2026,9,10);sealDays(db,{cutoffDay:cutDay,now:NOW,verifiedThroughMs:cutDay,secret,keyId});
  assert.equal(ingest(db,'again',[old]).accepted,0);
  assert.throws(()=>ingest(db,'late',[ad('late',Date.UTC(2026,9,6,12))]),/late event crosses sealed/);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM v2_event_ledger').get().n,1);db.close();
});
test('sealing requires external watermark, 8 day retention and complete month',()=>{
  const db=open(),cut=Date.UTC(2026,10,18);
  assert.throws(()=>sealDays(db,{cutoffDay:cut,now:NOW,verifiedThroughMs:cut,secret,keyId}),/eight days/);
  const older=Date.UTC(2026,10,2);
  assert.throws(()=>sealDays(db,{cutoffDay:older,now:NOW,verifiedThroughMs:older-1,secret,keyId}),/watermark/);
  assert.throws(()=>sealMonths(db,{cutoffMonth:Date.UTC(2026,11,1),secret,keyId}),/not.*sealed/);
  db.close();
});
test('monthly rollup is idempotent and rollup source rows do not overlap',async()=>{
  const db=open();const events=[ad('a',Date.UTC(2026,9,2,12)),ad('b',Date.UTC(2026,9,21,12))];ingest(db,'x',events);
  const day=Date.UTC(2026,10,1),month=day;
  sealDays(db,{cutoffDay:day,now:NOW,verifiedThroughMs:day,secret,keyId});
  sealMonths(db,{cutoffMonth:month,secret,keyId});
  assert.equal(sealMonths(db,{cutoffMonth:month,secret,keyId}).changed,false);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM v2_counters WHERE grain='day' AND bucket_start<?").get(month).n,0);
  const r=await report(db,'all',events);assert.equal(r.totals.views,2);db.close();
});
test('same key ID with different secret is rejected before incrementing data',async()=>{
  const db=open(),e=ad('a',NOW-H);ingest(db,'initial',[e]);
  assert.throws(()=>ingestAcceptedBatch(db,{batchId:'changed',events:[ad('b',NOW-H)],secret:Buffer.alloc(32,4),keyId}),/HMAC key changed/);
  assert.equal(sum(db,'views'),1);
  await assert.rejects(()=>getStage6AdReport({db,range:'all',now:NOW,secret:Buffer.alloc(32,4),keyId,boundarySource:source([e])}),/HMAC key changed/);
  db.close();
});
test('read cost for partial-hour verification is bounded by indexed ledger interval',()=>{
  const db=open(),p=db.prepare('EXPLAIN QUERY PLAN SELECT COUNT(*) FROM v2_event_ledger WHERE occurred_at>=? AND occurred_at<?').all(NOW-H,NOW);
  assert.ok(p.some(row=>String(row.detail).includes('idx_v2_event_time')),JSON.stringify(p));db.close();
});
test('randomized multi-month batches, retries and rollups agree with independent raw count',async()=>{
  const db=open(),events=[],dedup=new Map();
  let s=192837465;const rand=()=>{s=(s*1664525+1013904223)>>>0;return s/4294967296;};
  const start=Date.UTC(2026,8,5),period=76*D;
  for(let i=0;i<600;i++){
    const type=['ad_view','ad_view','ad_skip','ad_complete','ad_return','ad_repeat_view'][Math.floor(rand()*6)];
    const e=ad('evt'+i,start+Math.floor(rand()*period),'A'+Math.floor(rand()*4),type,'v'+Math.floor(rand()*120),
      {device:rand()<0.4?'desktop':'mobile',orientation:rand()<0.4?'hor':'ver',localHour:Math.floor(rand()*24),dwell:type==='ad_skip'||type==='ad_complete'?Math.floor(rand()*12000):0});
    events.push(e);dedup.set(e.event_id,e);
  }
  for(let i=0;i<20;i++)events.push(events[Math.floor(rand()*600)]);
  const size=77;
  for(let i=0;i<events.length;i+=size){ingest(db,'b'+i,events.slice(i,i+size));}
  // Same events in totally different packages still do not inflate the ledger.
  ingest(db,'duplicates',events.filter((_,i)=>i%4===0));
  const reference=[...dedup.values()].filter(e=>e.occurred_at<NOW);
  const before=await report(db,'all',reference);
  const count=type=>reference.filter(e=>e.event_type===type).length;
  for(const [type,col] of [['ad_view','views'],['ad_skip','skips'],['ad_complete','completes'],['ad_return','returns'],['ad_repeat_view','repeat_views']])assert.equal(before.totals[col],count(type),col);
  assert.equal(before.totals.viewers,new Set(reference.filter(e=>e.event_type==='ad_view').map(e=>e.visitor_id)).size);
  const cut=Date.UTC(2026,10,10);
  sealDays(db,{cutoffDay:cut,now:NOW,verifiedThroughMs:cut,secret,keyId});
  sealMonths(db,{cutoffMonth:Date.UTC(2026,10,1),secret,keyId});
  const after=await report(db,'all',reference);
  for(const name of ['views','skips','completes','returns','repeat_views','viewers','returners','dwell_sum_ms','dwell_count'])assert.equal(after.totals[name],before.totals[name],name);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM v2_event_ledger').get().n,600);
  db.close();
});
