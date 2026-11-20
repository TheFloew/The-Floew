/* Offline integration parity against the user's v31.22.2 Analytics Worker.
 * Pass FLOEW_ANALYTICS_WORKER_PATH=/absolute/path/worker.mjs to enable.
 * No network, Cloudflare binding, production secrets, or live D1 required.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {pathToFileURL} from 'node:url';
import {buildHourlyPrototype,queryHourlyPrototype,queryHourlyAdDetail} from './ad-hourly.mjs';

const workerPath=process.env.FLOEW_ANALYTICS_WORKER_PATH;
const worker=workerPath?(await import(pathToFileURL(workerPath).href)).default:null;
const t=worker?test:test.skip;
const NOW=Date.now(),H=3_600_000;
const METRICS=['views','viewers','skips','completes','returns','returners','repeat_views','avg_dwell_ms','skip_rate','completion_rate','return_rate','repeat_rate'];
// The Worker converts category code W into a localized label at the API layer.
// Numeric parity is checked before this separate presentation/enrichment step.
const AD_FIELDS=['ad_id','title','brand','campaign','creative','filename','media_type',...METRICS];
const BREAK_FIELDS=['label','percent',...METRICS];
const mockEvents=[];
let seq=0;
function ev(delta,ad_id,event_type,visitor_id,options={}){
  return {event_id:`ev-${++seq}`,occurred_at:NOW+delta*H,ad_id,event_type,visitor_id,
    dwell_ms:options.dwell_ms??0,device_type:options.device_type??'mobile',
    orientation:options.orientation??'ver',local_hour:options.local_hour??14,
    brand:options.brand??'Brand',campaign:options.campaign??'Campaign',
    creative:options.creative??'Creative',filename:options.filename??'ad.mp4',
    media_type:options.media_type??'video',
    extra_json:JSON.stringify({ad_title:options.ad_title||ad_id,ad_category:options.ad_category||'W'})};
}
mockEvents.push(
  ev(-210,'A','ad_view','returning'),
  ev(-160,'A','ad_view','returning'),
  ev(-149,'A','ad_view','returning'),
  ev(-33,'A','ad_view','returning'),
  ev(-23.6,'A','ad_view','returning',{orientation:'hor',device_type:'desktop',local_hour:5,ad_title:'ZZZ'}),
  ev(-23.5,'A','ad_view','other',{orientation:'hor',device_type:'desktop',local_hour:5}),
  ev(-23.4,'A','ad_complete','returning',{dwell_ms:12000,orientation:'hor',device_type:'desktop',local_hour:5}),
  ev(-23.3,'A','ad_skip','other',{dwell_ms:2200,orientation:'hor',device_type:'desktop',local_hour:5}),
  ev(-23.2,'A','ad_return','returning'),
  ev(-23.1,'A','ad_repeat_view','returning'),
  ev(-17,'A','ad_view','third',{orientation:'hor',device_type:'tv',local_hour:-1}),
  ev(-12,'A','ad_view',null,{orientation:'ver',device_type:'mobile',local_hour:13}),
  ev(-10,'A','ad_return',null),
  ev(-3,'B','ad_view','returning',{orientation:'ver',device_type:'mobile',local_hour:22}),
  ev(-2.9,'B','ad_view','new',{orientation:'hor',device_type:'desktop',local_hour:23}),
  ev(-2.8,'B','ad_complete','returning',{dwell_ms:3000,orientation:'ver',device_type:'mobile',local_hour:22}),
  ev(-2.7,'B','ad_return','new',{orientation:'hor',device_type:'desktop',local_hour:23}),
  ev(-2.6,'B','ad_repeat_view','new',{orientation:'hor',device_type:'desktop',local_hour:23}),
  ev(-2.5,'B','ad_skip','new',{dwell_ms:300,orientation:'hor',device_type:'desktop',local_hour:23}),
  ev(-2.4,'C','ad_return','new'), // ad with no ad_view, omitted by summary
  ev(-2.3,'','ad_view','ghost') // SQL overall includes this, ad list excludes blank id
);
// A repeated event ID is ignored by SQLite's INSERT OR IGNORE and by the PoC.
mockEvents.push({...mockEvents[6]});
// A group with zero ad_view must be excluded from detail breakdowns.
mockEvents.push(ev(-2.2,'A','ad_skip','other',{dwell_ms:0,orientation:'hor',device_type:'console',local_hour:17}));
// Visitor IDs that appear in multiple ad/hour groups remain a single viewer in overall.
mockEvents.push(ev(-1.3,'A','ad_view','returning',{orientation:'ver',device_type:'mobile',local_hour:14}));

function sqliteDb(){
  const db=new DatabaseSync(':memory:');
  db.exec(`CREATE TABLE ad_events (
   event_id TEXT PRIMARY KEY, occurred_at INTEGER NOT NULL, visitor_id TEXT,
   session_id TEXT, event_type TEXT NOT NULL, ad_id TEXT NOT NULL, brand TEXT,
   campaign TEXT, creative TEXT, filename TEXT, media_type TEXT, orientation TEXT,
   device_type TEXT, local_hour INTEGER DEFAULT -1, timezone TEXT, dwell_ms INTEGER DEFAULT 0,
   skipped INTEGER DEFAULT 0, completed INTEGER DEFAULT 0, returned INTEGER DEFAULT 0,
   repeat_view INTEGER DEFAULT 0, extra_json TEXT);
   CREATE INDEX idx_ads_time ON ad_events(occurred_at);
   CREATE INDEX idx_ads_id_time ON ad_events(ad_id,occurred_at);`);
  const insert=db.prepare(`INSERT OR IGNORE INTO ad_events
    (event_id,occurred_at,visitor_id,event_type,ad_id,brand,campaign,creative,filename,media_type,
     orientation,device_type,local_hour,dwell_ms,extra_json) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
  for(const e of mockEvents)insert.run(e.event_id,e.occurred_at,e.visitor_id,e.event_type,e.ad_id,
    e.brand,e.campaign,e.creative,e.filename,e.media_type,e.orientation,e.device_type,
    e.local_hour,e.dwell_ms,e.extra_json);
  return db;
}
function d1FromSqlite(db){
  return {prepare(sql){
    let bindings=[];
    return {bind(...args){bindings=args;return this;},
      async all(){return {results:db.prepare(sql).all(...bindings)};},
      async first(){return db.prepare(sql).get(...bindings)||null;},
      async run(){const info=db.prepare(sql).run(...bindings);return {meta:{changes:info.changes}};}};
  }};
}
async function callWorker(db,path){
  const req=new Request('https://example.invalid'+path,{headers:{Authorization:'Bearer local-test'}});
  const res=await worker.fetch(req,{ADMIN_TOKEN:'local-test',BEHAVIOR_DB:d1FromSqlite(db)},{});
  const data=await res.json();
  assert.equal(res.status,200,JSON.stringify(data));
  return data;
}
const subset=(obj,fields)=>Object.fromEntries(fields.map(key=>[key,obj[key]]));
function compareRows(actual,expected,fields,key){
  const canonical=items=>items.map(row=>subset(row,fields)).sort((a,b)=>JSON.stringify(a[key]).localeCompare(JSON.stringify(b[key])));
  assert.deepEqual(canonical(actual),canonical(expected));
}
for(const range of ['24h','7d','all']){
  t(`real v31.22.2 /admin/ads SQL equals hourly model (${range})`,async()=>{
    const db=sqliteDb();
    try{
      const actual=await callWorker(db,`/admin/ads?range=${range}`);
      const expected=queryHourlyPrototype(buildHourlyPrototype(mockEvents),{range,now:Date.now()});
      assert.deepEqual(subset(actual.totals,Object.keys(expected.totals)),expected.totals);
      compareRows(actual.ads,expected.ads,AD_FIELDS,'ad_id');
    }finally{db.close();}
  });
  for(const adId of ['A','B']){
    t(`real v31.22.2 /admin/ad SQL equals hourly model for ${adId} (${range})`,async()=>{
      const db=sqliteDb();
      try{
        const actual=await callWorker(db,`/admin/ad?range=${range}&id=${adId}`);
        const expected=queryHourlyAdDetail(buildHourlyPrototype(mockEvents),{range,adId,now:Date.now()});
        assert.deepEqual(subset(actual.summary,AD_FIELDS),subset(expected.summary,AD_FIELDS));
        for(const field of ['orientation','devices','hours']) {
          compareRows(actual[field],expected[field],BREAK_FIELDS,'label');
        }
        const combos=['orientation','device',...BREAK_FIELDS];
        // label is combined from orientation and device in both implementations.
        compareRows(actual.orientationDevice,expected.orientationDevice,combos,'label');
      }finally{db.close();}
    });
  }
}
