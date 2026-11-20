/* Offline integration adapter: expose mutually exclusive hour/day/month rollups
 * through the stage-5 report contract. Verified partial-hour source enforces
 * that the source contains ALL AND ONLY accepted ledger events for the interval.
 * This verification makes full boundary-hour reads unavoidable: not scalable.
 */
import {createHmac} from 'node:crypto';
import {getUnifiedAdReport} from './ad-unified-report.mjs';
import {STAGE6_TIME} from './ad-stage6-pipeline.mjs';
const {H,D}=STAGE6_TIME;
const MAC=(secret,txt)=>createHmac('sha256',secret).update(txt).digest('hex');
export function installStage6ReportViews(db){
  db.exec(`CREATE TEMP VIEW IF NOT EXISTS ad_hourly_deltas AS
    SELECT bucket_start AS hour_start,ad_id,device_type,orientation,local_hour,
      views,skips,completes,returns,repeat_views,dwell_sum_ms,dwell_count
    FROM v2_counters;
    CREATE TEMP VIEW IF NOT EXISTS ad_reach_hourly AS
    SELECT bucket_start AS hour_start,scope,ad_id,kind,dimension,dimension_value,key_id,reach
    FROM v2_reach;`);
}
const normalize=e=>({
  event_id:e.event_id,occurred_at:e.occurred_at,event_type:e.event_type,ad_id:e.ad_id,
  visitor_id:e.visitor_id??null,device_type:String(e.device_type??''),orientation:String(e.orientation??''),
  local_hour:Number.isInteger(e.local_hour)?e.local_hour:-1,dwell_ms:e.dwell_ms??0
});
export async function getStage6AdReport({db,range='all',now=Date.now(),boundarySource,secret,keyId}){
  if(typeof boundarySource!=='function')throw Error('Trusted accepted-event boundarySource is required');
  if(!(secret instanceof Uint8Array)||secret.length<32)throw Error('Private secret required');
  const keyConfig=db.prepare('SELECT key_id,fingerprint FROM v2_key_config WHERE id=1').get();
  if(keyConfig&&(keyConfig.key_id!==keyId||keyConfig.fingerprint!==MAC(secret,'flöw-analytics-v2-key-proof')))throw Error('HMAC key changed; report disabled');
  const watermark=db.prepare('SELECT day_sealed_before FROM v2_watermark WHERE id=1').get().day_sealed_before;
  if((range==='24h'||range==='7d')&&now-(range==='24h'?24*H:7*D)<watermark)
    throw Error('Rolling interval overlaps compacted days; hourly records unavailable');
  installStage6ReportViews(db);
  const query=db.prepare('SELECT payload_mac FROM v2_event_ledger WHERE event_mac=? AND occurred_at>=? AND occurred_at<?');
  const count=db.prepare('SELECT COUNT(*) AS n FROM v2_event_ledger WHERE occurred_at>=? AND occurred_at<?');
  const verifiedSource=async ({since,until})=>{
    const found=await boundarySource({since,until});
    if(!Array.isArray(found))throw Error('Expected boundary event list');
    const seen=new Set(),accepted=[];
    for(const event of found){
      if(!Number.isSafeInteger(event.occurred_at)||event.occurred_at<since||event.occurred_at>=until)throw Error('Invalid boundary timestamp');
      if(typeof event.event_id!=='string'||!event.event_id)throw Error('Boundary event must have event_id');
      const key=MAC(secret,'event:'+event.event_id),payload=MAC(secret,'payload:'+JSON.stringify(normalize(event)));
      const record=query.get(key,since,until);
      if(!record||record.payload_mac!==payload)throw Error('Boundary contains unaccepted or modified event');
      if(!seen.has(key)){seen.add(key);accepted.push(event);}
    }
    if(seen.size!==count.get(since,until).n)throw Error('Boundary incomplete: not all accepted events supplied');
    return accepted;
  };
  const result=await getUnifiedAdReport({db,range,now,boundarySource:verifiedSource,secret,keyId});
  result.diagnostic={...result.diagnostic,rollups:['hour','day','month'],boundaryCompletenessChecked:true,globalEventDedupNotImplemented:false};
  return result;
}
