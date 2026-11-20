/* Offline Analytics v2 PoC. No D1/Cloudflare access and no persistent storage.
 * Mirrors adSummary() and adDetail() event-counting semantics in v31.22.2.
 * Identity Sets and partial-hour event arrays are NOT production-scale designs.
 */
const HOUR_MS = 3_600_000;
const AD_EVENTS = new Set(['ad_view','ad_skip','ad_complete','ad_return','ad_repeat_view']);
const num = value => Number.isFinite(Number(value)) ? Number(value) : 0;
const str = value => value == null ? '' : String(value);
const hourStart = ms => Math.floor(ms / HOUR_MS) * HOUR_MS;
const roundPercent = (n,d) => d>0 ? Math.round(n / d * 1000)/10 : 0;
const lexMax = (left,right) => right && right > (left || '') ? right : left;

function emptyFact() {
  return {views:0,skips:0,completes:0,returns:0,repeat_views:0,
    dwell_sum_ms:0,dwell_count:0,viewers:new Set(),returners:new Set(),
    title:'',category:'',brand:'',campaign:'',creative:'',filename:'',media_type:''};
}
function apply(fact,row) {
  const type=row.event_type;
  if (type==='ad_view') {fact.views++;if(row.visitor_id!==null&&row.visitor_id!==undefined)fact.viewers.add(str(row.visitor_id));}
  if (type==='ad_skip')fact.skips++;
  if (type==='ad_complete')fact.completes++;
  if (type==='ad_return') {fact.returns++;if(row.visitor_id!==null&&row.visitor_id!==undefined)fact.returners.add(str(row.visitor_id));}
  if (type==='ad_repeat_view')fact.repeat_views++;
  if ((type==='ad_skip'||type==='ad_complete')&&num(row.dwell_ms)>0) {
    fact.dwell_sum_ms+=num(row.dwell_ms);fact.dwell_count++;
  }
  let extra={};
  try {extra=typeof row.extra_json==='string'?JSON.parse(row.extra_json):(row.extra_json||{});}catch{}
  extra=extra&&typeof extra==='object'?extra:{};
  for(const [key,value] of Object.entries({
    title:str(extra.ad_title||extra.title||''),category:str(extra.ad_category||extra.category||''),
    brand:str(row.brand),campaign:str(row.campaign),creative:str(row.creative),
    filename:str(row.filename),media_type:str(row.media_type)
  }))fact[key]=lexMax(fact[key],value);
}
function merge(target,src) {
  for(const key of ['views','skips','completes','returns','repeat_views','dwell_sum_ms','dwell_count'])target[key]+=src[key];
  for(const key of ['title','category','brand','campaign','creative','filename','media_type'])target[key]=lexMax(target[key],src[key]);
  for(const id of src.viewers)target.viewers.add(id);
  for(const id of src.returners)target.returners.add(id);
}
function finish(fact) {
  const values=Object.fromEntries(['title','category','brand','campaign','creative','filename','media_type'].map(k=>[k,fact[k]]));
  const viewers=fact.viewers.size,returners=fact.returners.size;
  return {...values,views:fact.views,viewers,skips:fact.skips,completes:fact.completes,
    returns:fact.returns,returners,repeat_views:fact.repeat_views,
    avg_dwell_ms:Math.round(fact.dwell_count?fact.dwell_sum_ms/fact.dwell_count:0),
    skip_rate:roundPercent(fact.skips,fact.views),
    completion_rate:roundPercent(fact.completes,fact.views),
    return_rate:roundPercent(returners,viewers),
    repeat_rate:roundPercent(fact.repeat_views,fact.views)};
}
function rangeSince(range,now) {
  if(range==='all')return 0;
  if(range==='24h')return now-24*HOUR_MS;
  if(range==='7d')return now-7*24*HOUR_MS;
  throw new Error(\`Unsupported range: \${range}\`);
}
const facetKey = row => JSON.stringify([
  row.ad_id,row.orientation??null,row.device_type??null,row.local_hour??null
]);
const keyFor = values => JSON.stringify(values);
function addFact(map,key,fact) {
  if(!map.has(key))map.set(key,emptyFact());
  merge(map.get(key),fact);
}

/** In-memory model of hourly rollups. Exact visitor IDs and boundary-hour raw events
 * are retained here ONLY to check correctness on small synthetic datasets. */
export function buildHourlyPrototype(events) {
  const hours=new Map(),seen=new Set();
  for(const event of events) {
    if(!AD_EVENTS.has(event.event_type))continue;
    if(event.event_id!=null){if(seen.has(String(event.event_id)))continue;seen.add(String(event.event_id));}
    const row={...event,occurred_at:num(event.occurred_at)};
    const hour=hourStart(row.occurred_at);
    if(!hours.has(hour))hours.set(hour,{facets:new Map(),overall:emptyFact(),events:[]});
    const bucket=hours.get(hour);
    apply(bucket.overall,row);
    if(str(row.ad_id)) {
      const key=facetKey(row);
      if(!bucket.facets.has(key))bucket.facets.set(key,{keys:[str(row.ad_id),row.orientation??null,row.device_type??null,row.local_hour??null],fact:emptyFact()});
      apply(bucket.facets.get(key).fact,row);
    }
    bucket.events.push(row);
  }
  return {hours};
}
function aggregate(index,{range='7d',now=Date.now()}={}) {
  const since=rangeSince(range,now),startHour=hourStart(since);
  const byAd=new Map(),facets=new Map(),overall=emptyFact();
  let hourlyFactsRead=0,boundaryEventsRead=0;
  function ingest(row) {
    apply(overall,row);
    if(!str(row.ad_id))return;
    const f=emptyFact();apply(f,row);
    addFact(byAd,str(row.ad_id),f);
    const key=facetKey(row);
    if(!facets.has(key))facets.set(key,{keys:[str(row.ad_id),row.orientation??null,row.device_type??null,row.local_hour??null],fact:emptyFact()});
    merge(facets.get(key).fact,f);
  }
  for(const [hour,bucket] of index.hours) {
    if(hour<startHour)continue;
    if(hour===startHour&&since!==hour){
      for(const row of bucket.events){boundaryEventsRead++;if(row.occurred_at>=since)ingest(row);}
    }else{
      merge(overall,bucket.overall);
      for(const [key,entry] of bucket.facets){
        hourlyFactsRead++;
        addFact(byAd,entry.keys[0],entry.fact);
        if(!facets.has(key))facets.set(key,{keys:entry.keys,fact:emptyFact()});
        merge(facets.get(key).fact,entry.fact);
      }
    }
  }
  return {byAd,facets,overall,diagnostic:{hourlyFactsRead,boundaryEventsRead,rawTableScanned:false}};
}
/** Result mirrors the JSON metrics in /admin/ads before Ad Center enrichment. */
export function queryHourlyPrototype(index,options={}) {
  const {byAd,overall,diagnostic}=aggregate(index,options);
  const ads=[...byAd].map(([ad_id,f])=>({ad_id,...finish(f)}))
    .filter(x=>x.views>0).sort((a,b)=>b.views-a.views||a.ad_id.localeCompare(b.ad_id)).slice(0,1000);
  const sum=field=>ads.reduce((total,a)=>total+a[field],0),o=finish(overall),views=sum('views');
  return {range:options.range||'7d',ads,totals:{ads:ads.length,views,viewers:o.viewers,
    skips:sum('skips'),completes:sum('completes'),returns:sum('returns'),returners:o.returners,
    repeat_views:sum('repeat_views'),avg_dwell_ms:o.avg_dwell_ms,
    skip_rate:roundPercent(sum('skips'),views),completion_rate:roundPercent(sum('completes'),views),
    return_rate:roundPercent(o.returners,o.viewers),repeat_rate:roundPercent(sum('repeat_views'),views)},diagnostic};
}
const display = value => value==null||value===''?'Bilinmiyor':String(value);
function detailBreakdown(aggregated,adId,dimension,denominator) {
  const grouped=new Map();
  for(const entry of aggregated.facets.values()){
    const [id,orientation,device,hour]=entry.keys;
    if(id!==adId)continue;
    const raw=dimension==='orientation'?[orientation]:dimension==='device'?[device]:dimension==='hour'?[hour]:[orientation,device];
    if(dimension==='hour'&&!(Number.isInteger(hour)&&hour>=0&&hour<=23))continue;
    const key=keyFor(raw);
    if(!grouped.has(key))grouped.set(key,{raw,fact:emptyFact()});
    merge(grouped.get(key).fact,entry.fact);
  }
  const rows=[...grouped.values()].map(({raw,fact})=>{
    const f=finish(fact),rest={views:f.views,viewers:f.viewers,skips:f.skips,
      completes:f.completes,returns:f.returns,returners:f.returners,
      repeat_views:f.repeat_views,avg_dwell_ms:f.avg_dwell_ms,
      percent:roundPercent(f.views,denominator),skip_rate:f.skip_rate,
      completion_rate:f.completion_rate,return_rate:f.return_rate,repeat_rate:f.repeat_rate};
    if(dimension==='orientationDevice')return {...rest,orientation:display(raw[0]),device:display(raw[1]),label:\`\${display(raw[0])} · \${display(raw[1])}\`};
    return {label:dimension==='hour'?\`\${String(raw[0]).padStart(2,'0')}:00\`:display(raw[0]),...rest};
  }).filter(row=>row.views>0);
  if(dimension==='hour')return rows.sort((a,b)=>a.label.localeCompare(b.label));
  if(dimension==='orientationDevice')return rows.sort((a,b)=>b.views-a.views||a.orientation.localeCompare(b.orientation)||a.device.localeCompare(b.device));
  return rows.sort((a,b)=>b.views-a.views||a.label.localeCompare(b.label));
}
/** Result mirrors /admin/ad summary and four D1 breakdowns (no GA4 or metadata service). */
export function queryHourlyAdDetail(index,{adId,range='7d',now=Date.now()}={}) {
  const data=aggregate(index,{range,now});
  const fact=data.byAd.get(str(adId));
  if(!fact||!fact.views)throw new Error('Reklam için istatistik bulunamadı');
  const summary={ad_id:str(adId),...finish(fact)};
  return {range,summary,
    orientation:detailBreakdown(data,str(adId),'orientation',summary.views),
    devices:detailBreakdown(data,str(adId),'device',summary.views),
    hours:detailBreakdown(data,str(adId),'hour',summary.views),
    orientationDevice:detailBreakdown(data,str(adId),'orientationDevice',summary.views),
    diagnostic:data.diagnostic};
}
