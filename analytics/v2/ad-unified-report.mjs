/* Analytics v2 stage 5, OFFLINE exact-window composition only.
 * Combines persisted hourly ad counters and private HMAC/HLL reach sketches.
 * Raw events are requested only for TWO incomplete boundary hours.
 * IMPORTANT: a trusted complete boundary source, global event-ID deduplication,
 * safe concurrent writes and long-range rollup compaction are NOT provided.
 * Do not deploy this Node/SQLite implementation to Cloudflare.
 */
import {createHmac} from 'node:crypto';
import {ReachSketch} from './ad-reach-sketch.mjs';
const H=3_600_000;
const TYPES=['ad_view','ad_skip','ad_complete','ad_return','ad_repeat_view'];
const FIELDS=['views','skips','completes','returns','repeat_views','dwell_sum_ms','dwell_count'];
const HOUR_START=at=>Math.floor(at/H)*H;
const CEIL_HOUR=at=>Math.ceil(at/H)*H;
const PCT=(a,b)=>b>0?Math.round(a/b*1000)/10:0;
const counter=()=>Object.fromEntries(FIELDS.map(f=>[f,0]));
const addCounter=(a,b)=>{for(const key of FIELDS)a[key]+=b[key];};
const reachKey=(scope,ad,kind,dimension='all',value='')=>JSON.stringify([scope,ad,kind,dimension,value]);
const facetKey=(ad,dim,val)=>JSON.stringify([ad,dim,val]);
function normalizeFacet(row){return {ad:String(row.ad_id||''),device:String(row.device_type||''),orientation:String(row.orientation||''),localHour:Number.isInteger(row.local_hour)?row.local_hour:-1};}
function eventCounter(e){
  const c=counter();
  if(e.event_type==='ad_view')c.views=1;
  if(e.event_type==='ad_skip')c.skips=1;
  if(e.event_type==='ad_complete')c.completes=1;
  if(e.event_type==='ad_return')c.returns=1;
  if(e.event_type==='ad_repeat_view')c.repeat_views=1;
  if((e.event_type==='ad_skip'||e.event_type==='ad_complete')&&Number(e.dwell_ms)>0){c.dwell_sum_ms=Number(e.dwell_ms);c.dwell_count=1;}
  return c;
}
const faceted=(f)=>[
  ['device',f.device],['orientation',f.orientation],['orientationDevice',JSON.stringify([f.orientation,f.device])],
  ...(f.localHour>=0&&f.localHour<=23?[['hour',String(f.localHour)]]:[])
];
function periodBounds(range,now){
  if(!Number.isSafeInteger(now)||now<=0)throw Error('Invalid report clock');
  const since=range==='all'?0:range==='24h'?now-24*H:range==='7d'?now-7*24*H:NaN;
  if(!Number.isSafeInteger(since)||since<0)throw Error('Invalid range');
  const fullStart=CEIL_HOUR(since),fullEnd=HOUR_START(now);
  const edges=[];
  const leftEnd=Math.min(now,CEIL_HOUR(since));
  if(since<leftEnd)edges.push({since,until:leftEnd});
  const rightStart=Math.max(since,fullEnd);
  if(rightStart<now&&rightStart>=(edges.at(-1)?.until??-1))edges.push({since:rightStart,until:now});
  return {since,until:now,fullStart,fullEnd,edges};
}
function addReach(map,key,part,keyId){
  if(!map.has(key))map.set(key,new ReachSketch(keyId));
  map.get(key).merge(part);
}
function updateReach(map,key,digest,keyId){
  if(!map.has(key))map.set(key,new ReachSketch(keyId));
  map.get(key).addDigest(digest);
}
function decorate(count,viewer,returner){
  const viewers=viewer?.estimate()||{count:0,exact:true,relativeError:0};
  const returners=returner?.estimate()||{count:0,exact:true,relativeError:0};
  const v=viewers.count,r=returners.count;
  return {...count,viewers:v,returners:r,viewers_exact:viewers.exact,returners_exact:returners.exact,
    reach_relative_error:viewers.relativeError,returners_relative_error:returners.relativeError,
    avg_dwell_ms:count.dwell_count?Math.round(count.dwell_sum_ms/count.dwell_count):0,
    skip_rate:PCT(count.skips,count.views),completion_rate:PCT(count.completes,count.views),
    return_rate:PCT(r,v),repeat_rate:PCT(count.repeat_views,count.views),
    frequency:v>0?Math.round(count.views/v*100)/100:null,frequency_estimated:!viewers.exact};
}
const display=v=>v===''?'Bilinmiyor':String(v);
function detailRows(ad,dimension,counters,reaches,denominator){
  const result=[];
  for(const [key,values] of counters){
    const [id,dim,value]=JSON.parse(key);
    if(id!==ad||dim!==dimension||values.views<1)continue;
    const k=reachKey('facet',ad,'view',dimension,value),ret=reachKey('facet',ad,'return',dimension,value);
    const o=decorate(values,reaches.get(k),reaches.get(ret));
    let label=display(value),extra={};
    if(dimension==='hour')label=`${String(value).padStart(2,'0')}:00`;
    if(dimension==='orientationDevice'){
      const [orientation,device]=JSON.parse(value);extra={orientation:display(orientation),device:display(device)};
      label=`${extra.orientation} · ${extra.device}`;
    }
    result.push({label,...extra,...o,percent:PCT(values.views,denominator)});
  }
  return result.sort((a,b)=>dimension==='hour'?a.label.localeCompare(b.label):b.views-a.views||a.label.localeCompare(b.label));
}
/**
 * @param {object} params
 * @param {DatabaseSync} params.db Same *offline* SQLite db containing both prototype tables.
 * @param {string} params.range '24h'|'7d'|'all'
 * @param {number} params.now UTC timestamp ms, exclusive report end
 * @param {Function} params.boundarySource async ({since,until}) => complete events for [since,until).
 * @param {Uint8Array} params.secret stable private HMAC secret
 * @param {string} params.keyId identifies secret/version; all rows must share it
 */
export async function getUnifiedAdReport({db,range='7d',now=Date.now(),boundarySource,secret,keyId}){
  if(!(secret instanceof Uint8Array)||secret.length<32||!keyId)throw Error('Private HMAC secret/keyId required');
  if(typeof boundarySource!=='function')throw Error('Complete trusted boundarySource required');
  const window=periodBounds(range,now),adCounts=new Map(),facetCounts=new Map(),reaches=new Map();
  let factRowsRead=0,reachRowsRead=0,boundaryEventsRead=0;
  function ingestFact(f,c){
    if(!f.ad)return;
    if(!adCounts.has(f.ad))adCounts.set(f.ad,counter());
    addCounter(adCounts.get(f.ad),c);
    for(const [dim,value] of faceted(f)){
      const key=facetKey(f.ad,dim,value);
      if(!facetCounts.has(key))facetCounts.set(key,counter());
      addCounter(facetCounts.get(key),c);
    }
  }
  if(window.fullStart<window.fullEnd){
    const rows=db.prepare(`SELECT ad_id,device_type,orientation,local_hour,
      SUM(views) AS views,SUM(skips) AS skips,SUM(completes) AS completes,
      SUM(returns) AS returns,SUM(repeat_views) AS repeat_views,
      SUM(dwell_sum_ms) AS dwell_sum_ms,SUM(dwell_count) AS dwell_count
      FROM ad_hourly_deltas WHERE hour_start>=? AND hour_start<?
      GROUP BY ad_id,device_type,orientation,local_hour`).all(window.fullStart,window.fullEnd);
    for(const row of rows){factRowsRead++;ingestFact(normalizeFacet(row),row);}
    const reachRows=db.prepare(`SELECT scope,ad_id,kind,dimension,dimension_value,key_id,reach
      FROM ad_reach_hourly WHERE hour_start>=? AND hour_start<?`).all(window.fullStart,window.fullEnd);
    for(const row of reachRows){
      reachRowsRead++;
      const sketch=ReachSketch.fromBytes(row.reach,row.key_id);
      addReach(reaches,reachKey(row.scope,row.ad_id,row.kind,row.dimension,row.dimension_value),sketch,keyId);
    }
  }
  const boundaryIds=new Set();
  for(const edge of window.edges){
    const events=await boundarySource({...edge});
    if(!Array.isArray(events))throw Error('boundarySource must return a complete event array');
    for(const e of events){
      if(!Number.isSafeInteger(e.occurred_at)||e.occurred_at<edge.since||e.occurred_at>=edge.until)
        throw Error('Boundary source returned out-of-range event');
      if(typeof e.event_id!=='string'||!e.event_id)throw Error('Boundary source must contain stable event_id');
      boundaryEventsRead++;
      if(boundaryIds.has(e.event_id))continue;
      boundaryIds.add(e.event_id);
      if(!TYPES.includes(e.event_type))continue;
      const f=normalizeFacet(e),c=eventCounter(e);
      ingestFact(f,c);
      if((e.event_type==='ad_view'||e.event_type==='ad_return')&&e.visitor_id!=null){
        const digest=createHmac('sha256',secret).update(String(e.visitor_id),'utf8').digest();
        const kind=e.event_type==='ad_view'?'view':'return';
        updateReach(reaches,reachKey('global','',kind),digest,keyId);
        if(f.ad){
          updateReach(reaches,reachKey('ad',f.ad,kind),digest,keyId);
          for(const [dim,value] of faceted(f))updateReach(reaches,reachKey('facet',f.ad,kind,dim,value),digest,keyId);
        }
      }
    }
  }
  const ads=[...adCounts].filter(([,c])=>c.views>0).map(([ad_id,c])=>({ad_id,...decorate(c,reaches.get(reachKey('ad',ad_id,'view')),reaches.get(reachKey('ad',ad_id,'return')))}))
    .sort((a,b)=>b.views-a.views||a.ad_id.localeCompare(b.ad_id));
  const displayed=ads.slice(0,1000);
  const totalCount=counter();
  for(const row of displayed)addCounter(totalCount,row);
  const global=decorate(totalCount,reaches.get(reachKey('global','','view')),reaches.get(reachKey('global','','return')));
  const totals={...global,ads:displayed.length};
  const details={};
  for(const ad of displayed){
    details[ad.ad_id]={summary:ad,
      orientation:detailRows(ad.ad_id,'orientation',facetCounts,reaches,ad.views),
      devices:detailRows(ad.ad_id,'device',facetCounts,reaches,ad.views),
      hours:detailRows(ad.ad_id,'hour',facetCounts,reaches,ad.views),
      orientationDevice:detailRows(ad.ad_id,'orientationDevice',facetCounts,reaches,ad.views)};
  }
  return {range,since:window.since,until:window.until,totals,ads:displayed,details,
    diagnostic:{fullHourStart:window.fullStart,fullHourEnd:window.fullEnd,
      edgeIntervals:window.edges,factRowsRead,reachRowsRead,boundaryEventsRead,
      fullRawEventTableScanned:false,globalEventDedupNotImplemented:true}};
}
