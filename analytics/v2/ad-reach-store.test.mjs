import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {createHmac} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {dirname,join} from 'node:path';
import {ReachSketch,REACH_SKETCH_CONFIG} from './ad-reach-sketch.mjs';
import {storeReachBatch,queryStoredReach,prepareReachBatch} from './ad-reach-store.mjs';
const H=3600000,SECRET=Buffer.alloc(32,42),SECRET2=Buffer.alloc(32,24),keyId='test-reach-key-v1';
const mkDb=()=>{const db=new DatabaseSync(':memory:');db.exec(readFileSync(join(dirname(fileURLToPath(import.meta.url)),'ad-reach-hourly.sql'),'utf8'));return db;};
const ev=(id,visitor,ad='A',at=H,type='ad_view',opts={})=>({event_id:id,visitor_id:visitor,ad_id:ad,occurred_at:at,event_type:type,
  device_type:opts.device||'mobile',orientation:opts.orientation||'ver',local_hour:opts.localHour??14});
const digest=visitor=>createHmac('sha256',SECRET).update(visitor).digest();
const context={secret:SECRET,keyId};
const save=(db,batchId,events,settings=context)=>storeReachBatch(db,{batchId,events,...settings});
test('small groups exact; shared visitors across hours and ads',()=>{
  const db=mkDb();save(db,'b1',[ev('1','same','A',H),ev('2','other','A',H),ev('3','same','B',H*2),ev('4','same','A',H*3)]);
  assert.deepEqual([queryStoredReach(db).count,queryStoredReach(db,{scope:'ad',adId:'A'}).count,queryStoredReach(db,{scope:'ad',adId:'B'}).count],[2,2,1]);
  assert.equal(queryStoredReach(db).exact,true);db.close();
});
test('same batch retry no-op; mismatching payload rejected',()=>{
  const db=mkDb(),events=[ev('1','one')];
  assert.equal(save(db,'same',events).applied,true);
  assert.equal(save(db,'same',events).applied,false);
  assert.throws(()=>save(db,'same',[ev('2','two')]),/different payload/);
  assert.equal(queryStoredReach(db).count,1);db.close();
});
test('same event across batches never inflates reach',()=>{
  const db=mkDb();save(db,'x',[ev('1','one'),ev('2','one')]);save(db,'y',[ev('1','one'),ev('3','one'),ev('4','two')]);
  assert.equal(queryStoredReach(db).count,2);db.close();
});
test('device, orientation, hour, orientation-device, returner facets',()=>{
  const db=mkDb();save(db,'facets',[
    ev('1','same','A',H,'ad_view',{device:'mobile',orientation:'ver',localHour:1}),
    ev('2','same','A',H*2,'ad_view',{device:'desktop',orientation:'hor',localHour:9}),
    ev('3','other','A',H*2,'ad_view',{device:'desktop',orientation:'hor',localHour:9}),
    ev('4','same','A',H*3,'ad_return',{device:'desktop',orientation:'hor',localHour:9})
  ]);
  assert.equal(queryStoredReach(db,{scope:'ad',adId:'A'}).count,2);
  assert.equal(queryStoredReach(db,{scope:'facet',adId:'A',dimension:'device',dimensionValue:'desktop'}).count,2);
  assert.equal(queryStoredReach(db,{scope:'facet',adId:'A',dimension:'device',dimensionValue:'mobile'}).count,1);
  assert.equal(queryStoredReach(db,{scope:'facet',adId:'A',dimension:'orientationDevice',dimensionValue:JSON.stringify(['hor','desktop'])}).count,2);
  assert.equal(queryStoredReach(db,{scope:'facet',adId:'A',dimension:'hour',dimensionValue:'9'}).count,2);
  assert.equal(queryStoredReach(db,{scope:'ad',adId:'A',kind:'return'}).count,1);db.close();
});
test('hour-aligned windows respected; partial hours rejected',()=>{
  const db=mkDb();save(db,'hours',[ev('1','first','A',H),ev('2','second','A',H*3)]);
  assert.equal(queryStoredReach(db,{sinceHour:H*2,untilHour:H*4}).count,1);
  assert.throws(()=>queryStoredReach(db,{sinceHour:H+1000}),/hour-aligned/);db.close();
});
test('key rotation fails safely, rolling back batch manifest',()=>{
  const db=mkDb();save(db,'old',[ev('1','a')]);
  assert.throws(()=>save(db,'new',[ev('2','b')],{secret:SECRET2,keyId:'test-reach-key-v2'}),/Incompatible reach hash keys/);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM ad_reach_batches').get().n,1);
  assert.equal(queryStoredReach(db).count,1);db.close();
});
test('sketch serialization roundtrip; merge order independence',()=>{
  const a=new ReachSketch(keyId),b=new ReachSketch(keyId);
  for(let i=0;i<85;i++)a.addDigest(digest('u'+i));
  for(let i=45;i<160;i++)b.addDigest(digest('u'+i));
  const left=ReachSketch.fromBytes(a.toBytes(),keyId).merge(b);
  const right=ReachSketch.fromBytes(b.toBytes(),keyId).merge(a);
  assert.equal(left.estimate().exact,false);
  assert.equal(left.estimate().count,right.estimate().count);
  assert.deepEqual(left.toBytes(),right.toBytes());
});
test('100k distinct identifiers: within 3 percent error, 16KB dense sketch',()=>{
  const s=new ReachSketch(keyId);
  for(let i=0;i<100000;i++)s.addDigest(digest('visitor-'+i));
  const estimate=s.estimate();
  assert.equal(estimate.exact,false);
  assert.equal(s.mode,'dense');
  assert.equal(s.toBytes().length,REACH_SKETCH_CONFIG.denseBytes);
  assert.ok(Math.abs(estimate.count-100000)/100000<0.03,JSON.stringify(estimate));
});
test('<=128 unique identifiers: exact and compact',()=>{
  const s=new ReachSketch(keyId);for(let i=0;i<128;i++)s.addDigest(digest('u'+i));
  assert.deepEqual(s.estimate(),{count:128,exact:true,relativeError:0});
  assert.equal(s.toBytes().length,5+128*16);
});
test('invalid encoding and incompatible key rejected',()=>{
  const s=new ReachSketch(keyId);s.addDigest(digest('abc'));
  const invalid=s.toBytes();invalid[1]=9;
  assert.throws(()=>ReachSketch.fromBytes(invalid,keyId),/Unsupported/);
  assert.throws(()=>s.merge(new ReachSketch('other')),/Incompatible/);
});
test('no raw visitor ID/event ID stored in sketches',()=>{
  const db=mkDb();save(db,'b',[ev('secret-event','private-user-123')]);
  const row=db.prepare('SELECT reach FROM ad_reach_hourly LIMIT 1').get();
  const stored=Buffer.from(row.reach).toString('utf8');
  assert.equal(stored.includes('private-user-123'),false);
  assert.equal(stored.includes('secret-event'),false);
  assert.ok(db.prepare('SELECT COUNT(*) AS n FROM ad_reach_hourly').get().n>0);db.close();
});
test('invalid HMAC secret and absent event_id rejected',()=>{
  assert.throws(()=>prepareReachBatch([ev('1','u')],{secret:Buffer.alloc(4),keyId}),/32 bytes/);
  assert.throws(()=>prepareReachBatch([ev('','u')],context),/event_id/);
});
test('null/undefined visitor ID omitted from unique reach',()=>{
  const db=mkDb();save(db,'b',[ev('1',null),ev('2',undefined),ev('3','u')]);
  assert.equal(queryStoredReach(db).count,1);db.close();
});
