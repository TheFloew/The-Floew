import test from 'node:test';
import assert from 'node:assert/strict';
import {buildHourlyPrototype, queryHourlyPrototype} from './ad-hourly.mjs';

const H = 3_600_000, NOW=Date.UTC(2026,10,20,14,37);
const row=(id, offset, ad_id, event_type, visitor_id, dwell_ms=0, device_type='mobile',orientation='ver')=>({
  event_id:id, occurred_at:NOW+offset*H, ad_id,event_type,visitor_id,dwell_ms,device_type,orientation,
  local_hour:14, extra_json:JSON.stringify({ad_title:ad_id==='A'?'Campaign A':'Campaign B'}),brand:'Test'});
const input=[
  row('1',-200,'A','ad_view','same'),
  row('2',-169,'A','ad_view','same'), // just outside 7d
  row('3',-167.8,'A','ad_view','same'),
  row('4',-26,'A','ad_view','same'),
  row('5',-23.7,'A','ad_view','same'),
  row('6',-23.6,'A','ad_view','other'),
  row('7',-23.5,'A','ad_skip','other',2200),
  row('8',-23.4,'A','ad_complete','same',12000),
  row('9',-23.3,'A','ad_return','same'),
  row('10',-23.2,'A','ad_repeat_view','same'),
  row('11',-3,'B','ad_view','same',0,'desktop','hor'),
  row('12',-2,'B','ad_complete','same',4000,'desktop','hor'),
  row('12',-2,'B','ad_complete','same',4000,'desktop','hor'), // duplicate event_id
];
function rawReference(events,range) {
  const since=range==='all'?0:NOW-(range==='24h'?24:168)*H;
  const selected=new Map();
  for(const e of events)if(e.occurred_at>=since&&!selected.has(e.event_id))selected.set(e.event_id,e);
  const all=[...selected.values()], ads=[...new Set(all.map(e=>e.ad_id))].map(ad_id=>{
    const ev=all.filter(e=>e.ad_id===ad_id);
    const count=t=>ev.filter(e=>e.event_type===t).length;
    const views=count('ad_view'),v=new Set(ev.filter(e=>e.event_type==='ad_view').map(e=>e.visitor_id)).size;
    const ret=new Set(ev.filter(e=>e.event_type==='ad_return').map(e=>e.visitor_id)).size;
    const dwell=ev.filter(e=>['ad_skip','ad_complete'].includes(e.event_type)&&e.dwell_ms>0);
    const pct=(n,d)=>d?Math.round(n/d*1000)/10:0;
    return {ad_id,views,viewers:v,skips:count('ad_skip'),completes:count('ad_complete'),returns:count('ad_return'),
      returners:ret,repeat_views:count('ad_repeat_view'),avg_dwell_ms:Math.round(dwell.length?dwell.reduce((s,e)=>s+e.dwell_ms,0)/dwell.length:0),
      skip_rate:pct(count('ad_skip'),views),completion_rate:pct(count('ad_complete'),views),return_rate:pct(ret,v),repeat_rate:pct(count('ad_repeat_view'),views)};
  }).filter(a=>a.views).sort((a,b)=>b.views-a.views||a.ad_id.localeCompare(b.ad_id));
  const count=(type)=>all.filter(e=>e.event_type===type).length;
  const views=ads.reduce((s,a)=>s+a.views,0), viewers=new Set(all.filter(e=>e.event_type==='ad_view').map(e=>e.visitor_id)).size;
  const returners=new Set(all.filter(e=>e.event_type==='ad_return').map(e=>e.visitor_id)).size;
  const dwell=all.filter(e=>['ad_skip','ad_complete'].includes(e.event_type)&&e.dwell_ms>0);
  const pct=(n,d)=>d?Math.round(n/d*1000)/10:0;
  return {ads,totals:{ads:ads.length,views,viewers,skips:count('ad_skip'),completes:count('ad_complete'),returns:count('ad_return'),
    returners,repeat_views:count('ad_repeat_view'),avg_dwell_ms:Math.round(dwell.length?dwell.reduce((s,e)=>s+e.dwell_ms,0)/dwell.length:0),
    skip_rate:pct(count('ad_skip'),views),completion_rate:pct(count('ad_complete'),views),return_rate:pct(returners,viewers),repeat_rate:pct(count('ad_repeat_view'),views)}};
}
const idx=buildHourlyPrototype(input);
for(const range of ['24h','7d','all']) {
  test(`hourly ${range} matches independent raw-reference counts`,()=>{
    const got=queryHourlyPrototype(idx,{range,now:NOW}), want=rawReference(input,range);
    assert.deepEqual(got.totals,want.totals);
    for(const ad of got.ads) {
      const expected=want.ads.find(x=>x.ad_id===ad.ad_id);
      for(const [key,value] of Object.entries(expected))assert.deepEqual(ad[key],value,`ad ${ad.ad_id} metric ${key}`);
    }
  });
}
test('all-time does not read any raw rows',()=>{
  const r=queryHourlyPrototype(idx,{range:'all',now:NOW});
  assert.equal(r.diagnostic.boundaryEventsRead,0);
  assert.ok(r.diagnostic.hourlyFactsRead>0);
});
test('rolling ranges read at most the boundary hour raw events',()=>{
  for(const range of ['24h','7d']){
    const r=queryHourlyPrototype(idx,{range,now:NOW});
    assert.ok(r.diagnostic.boundaryEventsRead<=input.length);
    assert.equal(r.diagnostic.rawTableScanned,false);
  }
});
test('repeated event_id does not double-count',()=>{
  const r=queryHourlyPrototype(idx,{range:'all',now:NOW});
  assert.equal(r.totals.completes,2);
});
test('daily distinct cannot be added across days',()=>{
  const r=queryHourlyPrototype(idx,{range:'all',now:NOW});
  assert.equal(r.totals.viewers,2); // same visitor saw both ads across days
});
