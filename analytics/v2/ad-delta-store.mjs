/* OFFLINE prototype: operates on Node DatabaseSync, not the Cloudflare D1 runtime.
 * Storage is batch-idempotent, not globally event-idempotent. All-time counters are exact;
 * unique reach and rolling partial hours are intentionally not implemented.
 */
const HOURS = 3_600_000;
const EVENTS = new Set(['ad_view','ad_skip','ad_complete','ad_return','ad_repeat_view']);
const integer = n => Number.isFinite(Number(n)) ? Math.trunc(Number(n)) : 0;
const floorHour = ms => Math.floor(ms/HOURS)*HOURS;
const sqlInsert = `INSERT OR IGNORE INTO ad_hourly_deltas
(batch_id,hour_start,ad_id,device_type,orientation,local_hour,views,skips,completes,returns,repeat_views,dwell_sum_ms,dwell_count)
VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`;

export function aggregateBatch(batchId, events) {
  if (typeof batchId !== 'string' || !batchId || batchId.length > 200) throw new Error('Stable batch ID required');
  const groups = new Map(), seen = new Set();
  for (const event of events) {
    if (!EVENTS.has(event?.event_type) || !String(event?.ad_id || '')) continue;
    const id = String(event.event_id || '');
    if (!id) throw new Error('Stable event_id required for within-batch deduplication');
    if (seen.has(id)) continue;
    seen.add(id);
    const at = integer(event.occurred_at);
    if (at < 0) throw new Error('Invalid event timestamp');
    const group = [batchId,floorHour(at),String(event.ad_id),String(event.device_type||''),String(event.orientation||''),Number.isInteger(event.local_hour)?event.local_hour:-1];
    const key=JSON.stringify(group);
    if (!groups.has(key)) groups.set(key, {key:group, counters:[0,0,0,0,0,0,0]});
    const f=groups.get(key).counters;
    switch (event.event_type) {
      case 'ad_view':f[0]++;break;
      case 'ad_skip':f[1]++;break;
      case 'ad_complete':f[2]++;break;
      case 'ad_return':f[3]++;break;
      case 'ad_repeat_view':f[4]++;break;
    }
    const dwell = integer(event.dwell_ms);
    if ((event.event_type==='ad_skip'||event.event_type==='ad_complete') && dwell>0) {f[5]+=dwell; f[6]++;}
  }
  return [...groups.values()].map(({key,counters})=>[...key,...counters]);
}

/** SQLite transaction demonstrates durable batch retries. In D1, use atomic batch()
 * on the delta rows, not one write per event. No network or live database involved.
 */
export function storeBatch(db, batchId, events) {
  const rows=aggregateBatch(batchId,events);
  const statement=db.prepare(sqlInsert);
  let inserted=0;
  db.exec('BEGIN IMMEDIATE');
  try {
    for(const row of rows) inserted+=Number(statement.run(...row).changes||0);
    db.exec('COMMIT');
  }catch(error){db.exec('ROLLBACK');throw error;}
  return {events:events.length, groups:rows.length, inserted};
}

/** Exact all-time and HOUR-ALIGNED period reports. Refuse false precision at boundaries.
 * For true sliding 24h/7d, a bounded boundary-hour lookup or finer bucket is required.
 */
export function queryStoredCounters(db, {sinceHour=0, untilHour=null, adId=''}={}) {
  if (sinceHour !== floorHour(sinceHour) || (untilHour !== null && untilHour !== floorHour(untilHour))) {
    throw new Error('Hourly prototype requires hour-aligned time window');
  }
  const query = `SELECT ad_id, SUM(views) AS views, SUM(skips) AS skips,
    SUM(completes) AS completes, SUM(returns) AS returns,
    SUM(repeat_views) AS repeat_views, SUM(dwell_sum_ms) AS dwell_sum_ms,
    SUM(dwell_count) AS dwell_count
    FROM ad_hourly_deltas WHERE hour_start >= ? AND (? IS NULL OR hour_start < ?)
    AND (? = '' OR ad_id = ?) GROUP BY ad_id ORDER BY views DESC, ad_id ASC`;
  return db.prepare(query).all(sinceHour,untilHour,untilHour,adId,adId).map(row=>({
    ...row, avg_dwell_ms:row.dwell_count ? Math.round(row.dwell_sum_ms/row.dwell_count):0,
    skip_rate:row.views ? Math.round(row.skips/row.views*1000)/10:0,
    completion_rate:row.views ? Math.round(row.completes/row.views*1000)/10:0
  }));
}
