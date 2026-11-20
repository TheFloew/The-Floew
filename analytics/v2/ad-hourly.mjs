/* Offline proof of concept, NOT a production Worker or data store.
 * Models the current v31.22.2 ad_events counting semantics.
 */
const HOUR_MS = 3_600_000;
const AD_EVENTS = new Set(['ad_view', 'ad_skip', 'ad_complete', 'ad_return', 'ad_repeat_view']);
const hourStart = ms => Math.floor(ms / HOUR_MS) * HOUR_MS;
const str = value => value == null ? '' : String(value);
const number = value => Number.isFinite(Number(value)) ? Number(value) : 0;
const nonemptyMax = (left, right) => right && right > (left || '') ? right : left;
const percent = (n, d) => d ? Math.round(n / d * 1_000) / 10 : 0;

function emptyFact() {
  return {views: 0, skips: 0, completes: 0, returns: 0, repeat_views: 0,
    dwell_sum_ms: 0, dwell_count: 0, viewers: new Set(), returners: new Set(),
    title: '', category: '', brand: '', campaign: '', creative: '', filename: '', media_type: ''};
}
function incorporateEvent(fact, row) {
  const kind = row.event_type;
  if (kind === 'ad_view') { fact.views++; if (row.visitor_id != null) fact.viewers.add(str(row.visitor_id)); }
  if (kind === 'ad_skip') fact.skips++;
  if (kind === 'ad_complete') fact.completes++;
  if (kind === 'ad_return') { fact.returns++; if (row.visitor_id != null) fact.returners.add(str(row.visitor_id)); }
  if (kind === 'ad_repeat_view') fact.repeat_views++;
  if ((kind === 'ad_skip' || kind === 'ad_complete') && number(row.dwell_ms) > 0) {
    fact.dwell_sum_ms += number(row.dwell_ms);
    fact.dwell_count++;
  }
  let extra = {};
  try { extra = typeof row.extra_json === 'string' ? JSON.parse(row.extra_json) : (row.extra_json || {}); } catch { /* invalid metadata */ }
  const fields = {
    title: str(extra.ad_title || extra.title || ''),
    category: str(extra.ad_category || extra.category || ''),
    brand: str(row.brand), campaign: str(row.campaign), creative: str(row.creative),
    filename: str(row.filename), media_type: str(row.media_type)
  };
  for (const [key, value] of Object.entries(fields)) fact[key] = nonemptyMax(fact[key], value);
}
function merge(target, incoming) {
  for (const field of ['views','skips','completes','returns','repeat_views','dwell_sum_ms','dwell_count']) target[field] += incoming[field];
  for (const field of ['title','category','brand','campaign','creative','filename','media_type']) target[field] = nonemptyMax(target[field], incoming[field]);
  for (const id of incoming.viewers) target.viewers.add(id);
  for (const id of incoming.returners) target.returners.add(id);
}
function finalize(fact) {
  return {...Object.fromEntries(['title','category','brand','campaign','creative','filename','media_type'].map(k => [k,fact[k]])),
    views:fact.views, viewers:fact.viewers.size, skips:fact.skips, completes:fact.completes,
    returns:fact.returns, returners:fact.returners.size, repeat_views:fact.repeat_views,
    avg_dwell_ms:Math.round(fact.dwell_count ? fact.dwell_sum_ms / fact.dwell_count : 0),
    skip_rate:percent(fact.skips, fact.views), completion_rate:percent(fact.completes, fact.views),
    return_rate:percent(fact.returners.size, fact.viewers.size), repeat_rate:percent(fact.repeat_views, fact.views)};
}
function rangeSince(range, now) {
  if (range === 'all') return 0;
  if (range === '24h') return now - 24 * HOUR_MS;
  if (range === '7d') return now - 7 * 24 * HOUR_MS;
  throw new Error(`Unsupported range: ${range}`);
}

/** Accepts illustrative ad_events records; IDs are deduplicated like INSERT OR IGNORE.
 *  exact visitor sets + hourly boundary raw rows are ONLY an offline reference design.
 *  Neither technique is a safe large-scale production storage solution as written.
 */
export function buildHourlyPrototype(events) {
  const hours = new Map(), hourEvents = new Map(), seen = new Set();
  for (const raw of events) {
    if (!AD_EVENTS.has(raw.event_type) || !str(raw.ad_id)) continue;
    if (raw.event_id != null) { if (seen.has(str(raw.event_id))) continue; seen.add(str(raw.event_id)); }
    const row = {...raw, occurred_at:number(raw.occurred_at)};
    const hour = hourStart(row.occurred_at);
    if (!hours.has(hour)) { hours.set(hour, new Map()); hourEvents.set(hour, []); }
    const key = JSON.stringify([str(row.ad_id), str(row.device_type), str(row.orientation), number(row.local_hour)]);
    const byFacet = hours.get(hour);
    if (!byFacet.has(key)) byFacet.set(key, {ad_id:str(row.ad_id), device_type:str(row.device_type), orientation:str(row.orientation), local_hour:number(row.local_hour), fact:emptyFact()});
    incorporateEvent(byFacet.get(key).fact, row);
    hourEvents.get(hour).push(row);
  }
  return {hours, hourEvents};
}

/** Produces the existing adSummary totals + per-ad metrics from the small hourly index.
 *  For exact rolling ranges it replays ONLY the partially intersecting boundary hour.
 */
export function queryHourlyPrototype(index, {range = '7d', now = Date.now()} = {}) {
  const since = rangeSince(range, now), startHour = hourStart(since);
  const byAd = new Map();
  const overall = emptyFact();
  let hourlyFactsRead = 0, boundaryEventsRead = 0;
  const add = (adId, fact) => {
    if (!byAd.has(adId)) byAd.set(adId, emptyFact());
    merge(byAd.get(adId), fact);
    merge(overall, fact);
  };
  for (const [hour, facets] of index.hours) {
    if (hour < startHour) continue;
    if (hour === startHour && since !== hour) {
      for (const row of index.hourEvents.get(hour) || []) {
        boundaryEventsRead++;
        if (row.occurred_at < since) continue;
        const fact = emptyFact(); incorporateEvent(fact, row); add(str(row.ad_id), fact);
      }
    } else {
      for (const row of facets.values()) { hourlyFactsRead++; add(row.ad_id, row.fact); }
    }
  }
  const ads = [...byAd].map(([ad_id, fact]) => ({ad_id, ...finalize(fact)}))
    .filter(row => row.views > 0)
    .sort((a,b) => b.views - a.views || a.ad_id.localeCompare(b.ad_id))
    .slice(0,1_000);
  const total = (field) => ads.reduce((s,row)=>s+row[field],0);
  const o = finalize(overall);
  return {range, ads, totals: {ads:ads.length, views:total('views'), viewers:o.viewers,
    skips:total('skips'), completes:total('completes'), returns:total('returns'),
    returners:o.returners, repeat_views:total('repeat_views'), avg_dwell_ms:o.avg_dwell_ms,
    skip_rate:percent(total('skips'),total('views')),
    completion_rate:percent(total('completes'),total('views')),
    return_rate:percent(o.returners,o.viewers), repeat_rate:percent(total('repeat_views'),total('views'))},
    diagnostic:{hourlyFactsRead,boundaryEventsRead,rawTableScanned:false}};
}
