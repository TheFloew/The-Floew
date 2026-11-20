/* Offline parity tests for combined Analytics v2 stage 5.
 * Uses synthetic events, local in-memory SQLite, and NO network or live D1.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {dirname,join} from 'node:path';
import {storeBatch} from './ad-delta-store.mjs';
import {storeReachBatch} from './ad-reach-store.mjs';
import {getUnifiedAdReport} from './ad-unified-report.mjs';
const H=3600000,NOW=Date.UTC(2026,10,20,15,37,42);
const secret=Buffer.alloc(32,84),keyId='offline-test-v1';
const folder=dirname(fileURLToPath(import.meta.url));
const event=(id,at,ad,event_type,visitor_id,extra={})=>({
  event_id:id,occurred_at:at,ad_id:ad,event_type,visitor_id,
  device_type:extra.device||'mobile',orientation:extra.orientation||'ver',
  local_hour:extra.hour??14,dwell_ms:extra.dwell??0
});
const E=[
  event('1',NOW-9*24*H,'A','ad_view','old'),
  event('2',NOW-7*24*H-1,'A','ad_view','before7d'),
  event('3',NOW-7*24*H,'A','ad_view','same'),
  event('4',NOW-24*H-1,'A','ad_view','before24h'),
  event('5',NOW-24*H,'A','ad_view','same',{device:'desktop',orientation:'hor',hour:9}),
  event('6',NOW-24*H+1,'A','ad_view','other',{device:'desktop',orientation:'hor',hour:9}),
  event('7',NOW-23*H,'A','ad_complete','same',{dwell:6000}),
  event('8',NOW-6*H,'B','ad_view','same',{device:'tv',orientation:'hor',hour:3}),
  event('9',NOW-4*H,'B','ad_skip','same',{dwell:2000}),
  event('10',NOW-3*H,'A','ad_return','same'),
  event('11',NOW-2*H,'A','ad_repeat_view','same'),
  event('12',NOW-58*60000,'A','ad_view','lastHour',{device:'desktop',orientation:'hor',hour:11}),
  event('13',NOW-5*60000,'B','ad_view','lastHour',{device:'desktop',orientation:'hor'}),
  event('14',NOW-4*60000,'A','ad_skip','lastHour',{dwell:4000}),
  event('15',NOW-3*60000,'A','ad_view',null),
  event('16',NOW,'A','ad_view','futureExcluded')
];
function makeDb(events=E){
  const db=new DatabaseSync(':memory:');
  db.exec(readFileSync(join(folder,'ad-hourly-deltas.sql'),'utf8'));
  db.exec(readFileSync(join(folder,'ad-reach-hourly.sql'),'utf8'));
  const first=events.filter((_,i)=>i%2===0),second=events.filter((_,i)=>i%2===1);
  storeBatch(db,'batch1',first);storeBatch(db,'batch2',second);
  storeReachBatch(db,{batchId:'batch1',events:first,secret,keyId});
  storeReachBatch(db,{batchId:'batch2',events:second,secret,keyId});
  return db;
}
function source(events=E,calls=[]){return async ({since,until})=>{
  calls.push({since,until});
  return events.filter(e=>e.occurred_at>=since&&e.occurred_at<until);
};}
async function report(db,range,events=E,now=NOW,calls=[]){
  return getUnifiedAdReport({db,range,now,secret,keyId,boundarySource:source(events,calls)});
}
function expected(events,range,now=NOW){
  const since=range==='all'?0:now-(range==='24h'?24:168)*H;
  const inRange=events.filter(x=>x.occurred_at>=since&&x.occurred_at<now);
  const count=kind=>inRange.filter(x=>x.event_type===kind).length;
  const unique=kind=>new Set(inRange.filter(x=>x.event_type===kind&&x.visitor_id!=null).map(x=>x.visitor_id)).size;
  const dwell=inRange.filter(x=>['ad_skip','ad_complete'].includes(x.event_type)&&x.dwell_ms>0);
  return {views:count('ad_view'),skips:count('ad_skip'),completes:count('ad_complete'),
    returns:count('ad_return'),repeat_views:count('ad_repeat_view'),
    viewers:unique('ad_view'),returners:unique('ad_return'),
    dwell_sum_ms:dwell.reduce((s,x)=>s+x.dwell_ms,0),dwell_count:dwell.length};
}
for(const range of ['24h','7d','all']){
  test(`${range} exact window sums match independent raw reference`,async()=>{
    const db=makeDb(),calls=[];try{
      const r=await report(db,range,E,NOW,calls),want=expected(E,range);
      for(const [k,value] of Object.entries(want))assert.equal(r.totals[k],value,k);
      assert.equal(r.totals.viewers_exact,true);
      assert.equal(r.diagnostic.fullRawEventTableScanned,false);
      assert.ok(calls.length<=2);
      assert.ok(calls.every(x=>x.until-x.since<H));
    }finally{db.close();}
  });
}
test('faceted device/orientation counts are deduplicated across hours',async()=>{
  const db=makeDb();try{
    const r=await report(db,'24h'),ad=r.details['A'];
    const hor=ad.orientationDevice.find(x=>x.orientation==='hor'&&x.device==='desktop');
    assert.equal(hor.views,3);
    assert.equal(hor.viewers,3);
    assert.equal(ad.summary.viewers,3);
    assert.ok(ad.hours.some(x=>x.label==='11:00'));
  }finally{db.close();}
});
test('all-time excludes future and includes only one partial current hour',async()=>{
  const db=makeDb(),calls=[];try{
    const r=await report(db,'all',E,NOW,calls);
    assert.equal(calls.length,1);
    assert.equal(r.totals.views,expected(E,'all').views);
    assert.equal(r.totals.viewers,expected(E,'all').viewers);
  }finally{db.close();}
});
test('missing boundary source or invalid boundary timestamp fails closed',async()=>{
  const db=makeDb();try{
    await assert.rejects(()=>getUnifiedAdReport({db,range:'24h',now:NOW,secret,keyId}),/boundarySource/);
    await assert.rejects(()=>getUnifiedAdReport({db,range:'24h',now:NOW,secret,keyId,
      boundarySource:async q=>[{...E[0],occurred_at:q.until}]}),/out-of-range/);
  }finally{db.close();}
});
test('mismatched HMAC version refuses to merge reach sketches',async()=>{
  const db=makeDb();try{
    await assert.rejects(()=>getUnifiedAdReport({db,range:'all',now:NOW,secret,
      keyId:'another-version',boundarySource:source()}),/Incompatible/);
  }finally{db.close();}
});
test('HLL groups are explicitly marked as approximate',async()=>{
  const events=Array.from({length:1300},(_,i)=>event('id-'+i,NOW-2*H,'A','ad_view','visitor-'+i));
  const db=makeDb(events);try{
    const r=await report(db,'24h',events);
    assert.equal(r.totals.views,1300);
    assert.equal(r.totals.viewers_exact,false);
    assert.equal(r.totals.frequency_estimated,true);
    assert.ok(Math.abs(r.totals.viewers-1300)<65);
  }finally{db.close();}
});
