/* Offline SQLite prototype: batch-transactional HMAC + exact/HLL merged reach.
 * Requires private stable 32+ byte secret. Does not run in Cloudflare Workers.
 * Event IDs deduplicated within a batch; unique reach naturally deduplicates
 * across different batches, but ordinary event counters DO NOT.
 */
import {createHmac} from 'node:crypto';
import {ReachSketch} from './ad-reach-sketch.mjs';
const HOUR_MS=3_600_000;
const hourStart=ms=>Math.floor(ms/HOUR_MS)*HOUR_MS;
function validKey(secret,keyId){
  if(!(secret instanceof Uint8Array)||secret.length<32)throw new Error('HMAC secret must contain at least 32 bytes');
  if(typeof keyId!=='string'||!keyId||keyId.length>128)throw new Error('HMAC key version ID required');
}
function mac(secret,text){return createHmac('sha256',secret).update(text,'utf8').digest();}
function normalize(event){
  if(!event||!['ad_view','ad_return'].includes(event.event_type))return null;
  if(typeof event.event_id!=='string'||!event.event_id)throw new Error('Stable event_id required');
  if(!Number.isSafeInteger(event.occurred_at)||event.occurred_at<0)throw new Error('Valid UTC millisecond timestamp required');
  if(event.visitor_id===null||event.visitor_id===undefined)return null;
  return {event_id:event.event_id,event_type:event.event_type,occurred_at:event.occurred_at,
    visitor_id:String(event.visitor_id),ad_id:String(event.ad_id||''),
    device_type:event.device_type==null?'':String(event.device_type),
    orientation:event.orientation==null?'':String(event.orientation),
    local_hour:Number.isInteger(event.local_hour)&&event.local_hour>=0&&event.local_hour<=23?event.local_hour:-1};
}
function groupKeys(row){
  const base=[hourStart(row.occurred_at),row.event_type==='ad_view'?'view':'return'];
  const keys=[[base[0],'global','',base[1],'all','']];
  if(!row.ad_id)return keys;
  keys.push([base[0],'ad',row.ad_id,base[1],'all','']);
  keys.push([base[0],'facet',row.ad_id,base[1],'device',row.device_type]);
  keys.push([base[0],'facet',row.ad_id,base[1],'orientation',row.orientation]);
  keys.push([base[0],'facet',row.ad_id,base[1],'orientationDevice',JSON.stringify([row.orientation,row.device_type])]);
  if(row.local_hour>=0)keys.push([base[0],'facet',row.ad_id,base[1],'hour',String(row.local_hour)]);
  return keys;
}
/** Batch contains keyed digests, never raw IDs in stored sketch rows. */
export function prepareReachBatch(events,{secret,keyId}){
  validKey(secret,keyId);
  const normalized=[],seen=new Set();
  for(const event of events){
    const row=normalize(event);
    if(!row||seen.has(row.event_id))continue;
    seen.add(row.event_id);normalized.push(row);
  }
  const payloadMac=mac(secret,JSON.stringify(normalized)).toString('hex');
  const groups=new Map(),digests=new Map();
  for(const row of normalized){
    if(!digests.has(row.visitor_id))digests.set(row.visitor_id,mac(secret,row.visitor_id));
    const digest=digests.get(row.visitor_id);
    for(const key of groupKeys(row)){
      const id=JSON.stringify(key);
      if(!groups.has(id))groups.set(id,{key,sketch:new ReachSketch(keyId)});
      groups.get(id).sketch.addDigest(digest);
    }
  }
  return {payloadMac,groups:[...groups.values()],acceptedEvents:normalized.length};
}
/** Offline SQLite transaction; no per-event SQL writes.
 * Not a Cloudflare D1 transaction implementation. */
export function storeReachBatch(db,{batchId,events,secret,keyId}){
  if(typeof batchId!=='string'||!batchId||batchId.length>200)throw new Error('Stable batchId required');
  const prepared=prepareReachBatch(events,{secret,keyId});
  const existingBatch=db.prepare('SELECT payload_mac FROM ad_reach_batches WHERE batch_id=?');
  const insertBatch=db.prepare('INSERT INTO ad_reach_batches(batch_id,payload_mac) VALUES (?,?)');
  const select=db.prepare('SELECT key_id,reach FROM ad_reach_hourly '+
    'WHERE hour_start=? AND scope=? AND ad_id=? AND kind=? AND dimension=? AND dimension_value=?');
  const upsert=db.prepare('INSERT INTO ad_reach_hourly(hour_start,scope,ad_id,kind,dimension,dimension_value,key_id,reach) '+
    'VALUES (?,?,?,?,?,?,?,?) ON CONFLICT(hour_start,scope,ad_id,kind,dimension,dimension_value) '+
    'DO UPDATE SET key_id=excluded.key_id,reach=excluded.reach');
  db.exec('BEGIN IMMEDIATE');
  try{
    const prior=existingBatch.get(batchId);
    if(prior){
      if(prior.payload_mac!==prepared.payloadMac)throw new Error('Batch ID reused with different payload');
      db.exec('COMMIT');
      return {applied:false,groups:0,acceptedEvents:prepared.acceptedEvents};
    }
    insertBatch.run(batchId,prepared.payloadMac);
    for(const group of prepared.groups){
      const previous=select.get(...group.key);
      const sketch=previous?ReachSketch.fromBytes(previous.reach,previous.key_id):new ReachSketch(keyId);
      sketch.merge(group.sketch);
      upsert.run(...group.key,keyId,Buffer.from(sketch.toBytes()));
    }
    db.exec('COMMIT');
    return {applied:true,groups:prepared.groups.length,acceptedEvents:prepared.acceptedEvents};
  }catch(error){db.exec('ROLLBACK');throw error;}
}
/** Exact for <=128 visitors, otherwise HLL estimate. HOUR-ALIGNED windows only.
 * For rolling windows implement partial-hour logic, don't silently round.
 */
export function queryStoredReach(db,{sinceHour=0,untilHour=null,scope='global',adId='',kind='view',dimension='all',dimensionValue=''}={}){
  if(!Number.isSafeInteger(sinceHour)||sinceHour<0||hourStart(sinceHour)!==sinceHour||
    untilHour!==null&&(!Number.isSafeInteger(untilHour)||hourStart(untilHour)!==untilHour))
    throw new Error('Reach report requires hour-aligned bounds');
  const rows=db.prepare('SELECT key_id,reach FROM ad_reach_hourly '+
    'WHERE hour_start>=? AND (? IS NULL OR hour_start<?) '+
    'AND scope=? AND ad_id=? AND kind=? AND dimension=? AND dimension_value=?')
    .all(sinceHour,untilHour,untilHour,scope,adId,kind,dimension,dimensionValue);
  let combined=null;
  for(const row of rows){
    const current=ReachSketch.fromBytes(row.reach,row.key_id);
    if(!combined)combined=current;
    else combined.merge(current);
  }
  return combined?{...combined.estimate(),bucketsRead:rows.length,keyId:combined.keyId}
    :{count:0,exact:true,relativeError:0,bucketsRead:0,keyId:null};
}
