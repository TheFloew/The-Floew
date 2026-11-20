/* OFFLINE SQLite stage 6: globally idempotent ad ingestion and UTC rollups.
 * Deliberately not a Cloudflare D1 transaction implementation. Each accepted
 * event needs a persistent exact keyed ID: the ledger itself grows O(events).
 */
import {createHmac} from 'node:crypto';
import {ReachSketch} from './ad-reach-sketch.mjs';
const H=3_600_000,D=24*H;
const TYPES=new Set(['ad_view','ad_skip','ad_complete','ad_return','ad_repeat_view']);
const COUNTERS=['views','skips','completes','returns','repeat_views','dwell_sum_ms','dwell_count'];
const floor=(t,unit)=>Math.floor(t/unit)*unit;
const YMD=t=>new Date(t).toISOString().slice(0,10);
const monthStart=t=>Date.UTC(new Date(t).getUTCFullYear(),new Date(t).getUTCMonth(),1);
const sha=(key,msg)=>createHmac('sha256',key).update(msg).digest('hex');
function assertStableKey(db,secret,keyId){
  const fingerprint=sha(secret,'flöw-analytics-v2-key-proof'),prior=db.prepare('SELECT key_id,fingerprint FROM v2_key_config WHERE id=1').get();
  if(prior){if(prior.key_id!==keyId||prior.fingerprint!==fingerprint)throw Error('HMAC key changed; a controlled migration is required');}
  else db.prepare('INSERT INTO v2_key_config(id,key_id,fingerprint) VALUES (1,?,?)').run(keyId,fingerprint);
}
function requireKey(secret,keyId){
  if(!(secret instanceof Uint8Array)||secret.length<32||typeof keyId!=='string'||!keyId)throw Error('Private HMAC secret/keyId required');
}
function validate(event){
  if(!event||!TYPES.has(event.event_type))throw Error('Unsupported event type');
  if(typeof event.event_id!=='string'||!event.event_id)throw Error('Stable event_id required');
  if(typeof event.ad_id!=='string'||!event.ad_id)throw Error('Nonempty ad_id required');
  if(!Number.isSafeInteger(event.occurred_at)||event.occurred_at<0)throw Error('Valid occurred_at milliseconds required');
  if(event.visitor_id!=null&&typeof event.visitor_id!=='string')throw Error('Visitor identifier must be string or null');
  if(event.dwell_ms!=null&&(!Number.isSafeInteger(event.dwell_ms)||event.dwell_ms<0))throw Error('Invalid dwell_ms');
  return {event_id:event.event_id,occurred_at:event.occurred_at,event_type:event.event_type,ad_id:event.ad_id,
    visitor_id:event.visitor_id??null,device_type:String(event.device_type??''),
    orientation:String(event.orientation??''),local_hour:Number.isInteger(event.local_hour)?event.local_hour:-1,
    dwell_ms:event.dwell_ms??0};
}
function counter(event){const c=[0,0,0,0,0,0,0];
  c[['ad_view','ad_skip','ad_complete','ad_return','ad_repeat_view'].indexOf(event.event_type)]++;
  if(['ad_skip','ad_complete'].includes(event.event_type)&&event.dwell_ms>0){c[5]+=event.dwell_ms;c[6]++;}
  return c;
}
const reachId=(key)=>JSON.stringify(key);
function reachKeys(e){const bucket=floor(e.occurred_at,H),kind=e.event_type==='ad_view'?'view':'return';
  const list=[['hour',bucket,'global','',kind,'all',''],['hour',bucket,'ad',e.ad_id,kind,'all',''],
    ['hour',bucket,'facet',e.ad_id,kind,'device',e.device_type],
    ['hour',bucket,'facet',e.ad_id,kind,'orientation',e.orientation],
    ['hour',bucket,'facet',e.ad_id,kind,'orientationDevice',JSON.stringify([e.orientation,e.device_type])]];
  if(e.local_hour>=0&&e.local_hour<=23)list.push(['hour',bucket,'facet',e.ad_id,kind,'hour',String(e.local_hour)]);
  return list;
}
function transaction(db,fn){db.exec('BEGIN IMMEDIATE');try{const r=fn();db.exec('COMMIT');return r;}catch(e){db.exec('ROLLBACK');throw e;}}
const UPSERT_COUNTER=`INSERT INTO v2_counters
 (grain,bucket_start,ad_id,device_type,orientation,local_hour,views,skips,completes,returns,repeat_views,dwell_sum_ms,dwell_count)
 VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)
 ON CONFLICT(grain,bucket_start,ad_id,device_type,orientation,local_hour) DO UPDATE SET
 views=views+excluded.views,skips=skips+excluded.skips,completes=completes+excluded.completes,
 returns=returns+excluded.returns,repeat_views=repeat_views+excluded.repeat_views,
 dwell_sum_ms=dwell_sum_ms+excluded.dwell_sum_ms,dwell_count=dwell_count+excluded.dwell_count`;
const SELECT_REACH=`SELECT key_id,reach FROM v2_reach WHERE grain=? AND bucket_start=? AND scope=? AND ad_id=? AND kind=? AND dimension=? AND dimension_value=?`;
const UPSERT_REACH=`INSERT INTO v2_reach (grain,bucket_start,scope,ad_id,kind,dimension,dimension_value,key_id,reach)
 VALUES (?,?,?,?,?,?,?,?,?) ON CONFLICT(grain,bucket_start,scope,ad_id,kind,dimension,dimension_value)
 DO UPDATE SET key_id=excluded.key_id,reach=excluded.reach`;
function commitSketch(db,select,upsert,key,partial,keyId){
  const old=select.get(...key);const merged=old?ReachSketch.fromBytes(old.reach,old.key_id):new ReachSketch(keyId);
  merged.merge(partial);upsert.run(...key,keyId,Buffer.from(merged.toBytes()));
}
function accumulate(groups,key,values){const id=JSON.stringify(key);if(!groups.has(id))groups.set(id,{key,values:Array(7).fill(0)});
  const sum=groups.get(id).values;for(let i=0;i<7;i++)sum[i]+=values[i];}
function accumulateReach(groups,key,digest,keyId){const id=reachId(key);if(!groups.has(id))groups.set(id,{key,sketch:new ReachSketch(keyId)});
  groups.get(id).sketch.addDigest(digest);}
/** Exactly-once materialization *per event_id* for the modeled, single SQLite database.
 * All stages are in one transaction: ledger + counters + reach + batch manifest.
 * Same event_id but modified payload is rejected, not silently ignored.
 */
export function ingestAcceptedBatch(db,{batchId,events,secret,keyId}){
  requireKey(secret,keyId);
  if(typeof batchId!=='string'||!batchId||batchId.length>200||!Array.isArray(events))throw Error('Stable batchId and events array required');
  const normalized=events.map(validate),payloadMac=sha(secret,JSON.stringify(normalized));
  const priorBatch=db.prepare('SELECT payload_mac,newly_accepted FROM v2_batch_manifest WHERE batch_id=?');
  const ledgerLookup=db.prepare('SELECT payload_mac FROM v2_event_ledger WHERE event_mac=?');
  const ledgerInsert=db.prepare('INSERT INTO v2_event_ledger(event_mac,payload_mac,occurred_at) VALUES (?,?,?)');
  const upsertCounter=db.prepare(UPSERT_COUNTER),reachLookup=db.prepare(SELECT_REACH),reachUpsert=db.prepare(UPSERT_REACH);
  return transaction(db,()=>{
    assertStableKey(db,secret,keyId);
    const old=priorBatch.get(batchId);if(old){if(old.payload_mac!==payloadMac)throw Error('Batch ID reused with changed contents');return {replayed:true,accepted:0,rejectedDuplicates:normalized.length,counterGroups:0,reachGroups:0};}
    const watermark=db.prepare('SELECT day_sealed_before FROM v2_watermark WHERE id=1').get().day_sealed_before;
    const counters=new Map(),reaches=new Map();let accepted=0,rejectedDuplicates=0;
    for(const e of normalized){
      const eventMac=sha(secret,'event:'+e.event_id),fingerprint=sha(secret,'payload:'+JSON.stringify(e));
      const found=ledgerLookup.get(eventMac);
      if(found){if(found.payload_mac!==fingerprint)throw Error('Same event_id with conflicting payload');rejectedDuplicates++;continue;}
      if(e.occurred_at<watermark)throw Error('New late event crosses sealed watermark; quarantine and rebuild required');
      ledgerInsert.run(eventMac,fingerprint,e.occurred_at);accepted++;
      const group=['hour',floor(e.occurred_at,H),e.ad_id,e.device_type,e.orientation,e.local_hour];
      accumulate(counters,group,counter(e));
      if((e.event_type==='ad_view'||e.event_type==='ad_return')&&e.visitor_id!=null){
        const digest=createHmac('sha256',secret).update(e.visitor_id).digest();
        for(const key of reachKeys(e))accumulateReach(reaches,key,digest,keyId);
      }
    }
    for(const {key,values} of counters.values())upsertCounter.run(...key,...values);
    for(const {key,sketch} of reaches.values())commitSketch(db,reachLookup,reachUpsert,key,sketch,keyId);
    db.prepare('INSERT INTO v2_batch_manifest VALUES (?,?,?)').run(batchId,payloadMac,accepted);
    return {replayed:false,accepted,rejectedDuplicates,counterGroups:counters.size,reachGroups:reaches.size};
  });
}
function rollup(db,{fromGrain,toGrain,lower,upper,bucketFn,secret,keyId}){
  const existing=db.prepare('SELECT DISTINCT bucket_start FROM v2_counters WHERE grain=? AND bucket_start>=? AND bucket_start<? ORDER BY bucket_start')
    .all(fromGrain,lower,upper);
  const reachExisting=db.prepare('SELECT DISTINCT bucket_start FROM v2_reach WHERE grain=? AND bucket_start>=? AND bucket_start<? ORDER BY bucket_start')
    .all(fromGrain,lower,upper);
  // Limit source scan to physical summarized rows in the requested sealed interval.
  const ctr=db.prepare(`SELECT bucket_start,ad_id,device_type,orientation,local_hour,views,skips,completes,returns,repeat_views,dwell_sum_ms,dwell_count FROM v2_counters WHERE grain=? AND bucket_start>=? AND bucket_start<?`)
    .all(fromGrain,lower,upper);
  const reach=db.prepare(`SELECT bucket_start,scope,ad_id,kind,dimension,dimension_value,key_id,reach FROM v2_reach WHERE grain=? AND bucket_start>=? AND bucket_start<?`)
    .all(fromGrain,lower,upper);
  const upsertCounter=db.prepare(UPSERT_COUNTER),reachLookup=db.prepare(SELECT_REACH),reachUpsert=db.prepare(UPSERT_REACH);
  const counts=new Map(),sketches=new Map();
  for(const r of ctr){accumulate(counts,[toGrain,bucketFn(r.bucket_start),r.ad_id,r.device_type,r.orientation,r.local_hour],COUNTERS.map(f=>r[f]));}
  for(const r of reach){
    const key=[toGrain,bucketFn(r.bucket_start),r.scope,r.ad_id,r.kind,r.dimension,r.dimension_value];
    const id=reachId(key),sketch=ReachSketch.fromBytes(r.reach,r.key_id);
    if(!sketches.has(id))sketches.set(id,{key,sketch:new ReachSketch(keyId)});
    sketches.get(id).sketch.merge(sketch);
  }
  for(const {key,values} of counts.values())upsertCounter.run(...key,...values);
  for(const {key,sketch} of sketches.values())commitSketch(db,reachLookup,reachUpsert,key,sketch,keyId);
  db.prepare('DELETE FROM v2_counters WHERE grain=? AND bucket_start>=? AND bucket_start<?').run(fromGrain,lower,upper);
  db.prepare('DELETE FROM v2_reach WHERE grain=? AND bucket_start>=? AND bucket_start<?').run(fromGrain,lower,upper);
  return {counterSourceRows:ctr.length,reachSourceRows:reach.length,counterRows:counts.size,reachRows:sketches.size,sourceBuckets:new Set([...existing,...reachExisting].map(x=>x.bucket_start)).size};
}
/** Permanently closes whole UTC days before cutoffDay, after the caller's
 * externally-verified source watermark and an 8-day safe hourly retention.
 * A late unseen event is rejected so rollups cannot silently diverge.
 */
export function sealDays(db,{cutoffDay,now,verifiedThroughMs,secret,keyId}){
  requireKey(secret,keyId);
  if(!Number.isSafeInteger(cutoffDay)||cutoffDay<0||cutoffDay%D!==0||!Number.isSafeInteger(now)||!Number.isSafeInteger(verifiedThroughMs))throw Error('Invalid UTC day boundary/watermark');
  if(cutoffDay>now-8*D)throw Error('Keep at least eight days of hourly data for rolling reports');
  if(verifiedThroughMs<cutoffDay)throw Error('External source watermark has not reached cutoff');
  return transaction(db,()=>{
    assertStableKey(db,secret,keyId);
    const state=db.prepare('SELECT * FROM v2_watermark WHERE id=1').get();
    if(cutoffDay<=state.day_sealed_before)return {changed:false};
    const summary=rollup(db,{fromGrain:'hour',toGrain:'day',lower:state.day_sealed_before,upper:cutoffDay,bucketFn:t=>floor(t,D),secret,keyId});
    db.prepare('UPDATE v2_watermark SET day_sealed_before=? WHERE id=1').run(cutoffDay);
    return {changed:true,cutoffDay,...summary};
  });
}
/** Roll full UTC months (the monthEnd must be the first of a month) from day summaries;
 * called only after every day in that month has been sealed. */
export function sealMonths(db,{cutoffMonth,secret,keyId}){
  requireKey(secret,keyId);
  if(!Number.isSafeInteger(cutoffMonth)||cutoffMonth<0||monthStart(cutoffMonth)!==cutoffMonth)throw Error('First day of UTC month required');
  return transaction(db,()=>{
    assertStableKey(db,secret,keyId);
    const state=db.prepare('SELECT * FROM v2_watermark WHERE id=1').get();
    if(cutoffMonth>state.day_sealed_before)throw Error('Cannot seal month before all its days are sealed');
    if(cutoffMonth<=state.month_sealed_before)return {changed:false};
    const summary=rollup(db,{fromGrain:'day',toGrain:'month',lower:state.month_sealed_before,upper:cutoffMonth,bucketFn:monthStart,secret,keyId});
    db.prepare('UPDATE v2_watermark SET month_sealed_before=? WHERE id=1').run(cutoffMonth);
    return {changed:true,cutoffMonth,...summary};
  });
}
export const STAGE6_TIME={H,D,monthStart};
