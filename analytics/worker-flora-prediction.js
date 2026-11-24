/* Flöra başlangıç tahmini. Yalnız başlıktan anonim, yerel hesaplama. */
(function(root){
  "use strict";
  const STOP=new Set([
    "bir","bu","şu","ve","veya","ile","için","gibi","göre","daha",
    "çok","son","dakika","yeni","ilk","tüm","her","artık","olan",
    "olarak","oldu","olacak","olduğu","olduğunu","olabilir",
    "hakkında","sonra","önce","kadar","ancak","işte","neden",
    "nasıl","hangi","kim","ne","nerede","zaman","gün","bugün",
    "yarın","dün","haber","haberi","haberleri","açıklama",
    "açıkladı","açıklandı","belli","ortaya","çıktı","geldi",
    "devam","ediyor","etti","eden","ettiği","iddia","iddiası",
    "şimdi","tarih","tarihi","olay","içinde","üzerine","büyük",
    "küçük","var","yok","the","and","for","with","from","this",
    "that","after","before","about","over","into","says","said",
    "will","are","was","were","has","have","its","you"
  ]);
  const round=value=>Math.round(value*10)/10;

  function headlineTerms(text){
    const words=String(text||"")
      .toLocaleLowerCase("tr-TR")
      .match(/[\p{L}]+/gu)||[];
    const filtered=words
      .filter(word=>word.length>=3 && word.length<=30 && !STOP.has(word))
      .slice(0,20);
    const terms=[];
    for(let i=0;i<filtered.length;i++){
      terms.push(filtered[i]);
      if(i+1<filtered.length){
        terms.push(filtered[i]+" "+filtered[i+1]);
      }
    }
    return [...new Set(terms)];
  }

  /* Recurring title-form features provide a modest evidence-based fallback. */
  function headlineFeatures(title){
    const text=String(title||"");
    const words=text.match(/[\p{L}\p{N}]+/gu)||[];
    const features=[
      "length:"+(words.length<=6?"short":words.length>=15?"long":"medium")
    ];
    if(/[?？]/u.test(text))features.push("question");
    if(/[0-9]/u.test(text))features.push("number");
    if(/[!！]/u.test(text))features.push("exclamation");
    return features;
  }

  function build(rows,{minViews=3,maxTerms=1800}={}){
    const clean=(Array.isArray(rows)?rows:[])
      .filter(row=>row && String(row.title||"").trim())
      .map(row=>({
        title:String(row.title),
        views:Number(row.views),
        score:Number(row.flora)
      }))
      .filter(row=>Number.isFinite(row.views) && row.views>=minViews
        && Number.isFinite(row.score) && row.score>=0 && row.score<=100);

    let weightSum=0, scoreSum=0;
    for(const row of clean){
      const weight=Math.min(4,Math.max(1,Math.log2(row.views+1)));
      weightSum+=weight;
      scoreSum+=weight*row.score;
    }
    const baseline=weightSum?scoreSum/weightSum:0;
    const counts=new Map();
    const featureCounts=new Map();
    function add(map,key,row,weight){
      const entry=map.get(key)||{n:0,sum:0,weight:0};
      entry.n++;
      entry.sum+=weight*row.score;
      entry.weight+=weight;
      map.set(key,entry);
    }
    for(const row of clean){
      const weight=Math.min(4,Math.max(1,Math.log2(row.views+1)));
      for(const term of headlineTerms(row.title))add(counts,term,row,weight);
      for(const key of headlineFeatures(row.title))add(featureCounts,key,row,weight);
    }
    const terms=[...counts.entries()]
      .filter(([term,data])=>data.n>=2)
      .sort((a,b)=>b[1].n-a[1].n || a[0].localeCompare(b[0],"tr"))
      .slice(0,maxTerms)
      .map(([term,data])=>[
        term,
        round(baseline+(data.sum/data.weight-baseline)*data.n/(data.n+4)),
        data.n
      ]);
    const features=[...featureCounts.entries()]
      .filter(([key,data])=>data.n>=10)
      .sort((a,b)=>a[0].localeCompare(b[0]))
      .map(([key,data])=>[
        key,
        round(baseline+(data.sum/data.weight-baseline)*data.n/(data.n+18)),
        data.n
      ]);
    return {
      version:1,generatedAt:Date.now(),
      sampleStories:clean.length,baseline:round(baseline),terms,features
    };
  }

  const indexed=new WeakMap();
  function estimate(title,model){
    if(!model || model.version!==1
      || !Number.isFinite(Number(model.baseline))
      || Number(model.sampleStories)<12
      || !Array.isArray(model.terms))return null;

    let dictionary=indexed.get(model);
    if(!dictionary){
      const toMap=rows=>new Map(rows
        .filter(row=>Array.isArray(row) && row.length>=3)
        .map(row=>[row[0],{score:Number(row[1]),count:Number(row[2])}]));
      dictionary={
        words:toMap(model.terms),
        features:toMap(Array.isArray(model.features)?model.features:[])
      };
      indexed.set(model,dictionary);
    }
    const baseline=Number(model.baseline);
    let wordTotal=0,wordDelta=0,matched=0;
    for(const term of headlineTerms(title)){
      const entry=dictionary.words.get(term);
      if(!entry || !Number.isFinite(entry.score) || entry.count<2)continue;
      const weight=(term.includes(" ")?1.5:1)
        *Math.min(1,Math.sqrt(entry.count)/3);
      wordDelta+=(entry.score-baseline)*weight;
      wordTotal+=weight;
      matched++;
    }
    /* Restore contrast previously shrunk in both training and estimation.
       Keep low-evidence titles near the learned baseline. */
    const wordEffect=wordTotal
      ? (wordDelta/wordTotal)*(wordTotal/(wordTotal+0.7))*2
      : 0;
    let featureTotal=0,featureDelta=0;
    for(const key of headlineFeatures(title)){
      const entry=dictionary.features.get(key);
      if(!entry || !Number.isFinite(entry.score) || entry.count<10)continue;
      const weight=key.startsWith("length:")?0.6:1;
      featureDelta+=(entry.score-baseline)*weight;
      featureTotal+=weight;
    }
    const featureEffect=featureTotal
      ? (featureDelta/featureTotal)*(featureTotal/(featureTotal+1.4))
      : 0;
    /* A single shared word cannot drive an extreme prediction. */
    const limit=Math.min(16,8+2*matched);
    const displacement=Math.max(-limit,Math.min(limit,wordEffect+featureEffect));
    const score=Math.max(0,Math.min(100,baseline+displacement));
    return {score:round(score),estimated:true,matchedTerms:matched};
  }

  root.FloewFloraPredictor=Object.freeze({headlineTerms,build,estimate});
})(typeof globalThis!=="undefined"?globalThis:this);



/* ========================================================================
   FLÖW ANALYTICS / FLÖRA — V31.23.0 + model fallback 1 (hourly Behavior rollups + durable cache + ad shadow)
   ======================================================================== */

const CONTENT_SCHEMA = `
CREATE TABLE IF NOT EXISTS content_events (
  event_id TEXT PRIMARY KEY,
  event_type TEXT NOT NULL,
  occurred_at INTEGER NOT NULL,
  story_key TEXT,
  title TEXT,
  source TEXT,
  category TEXT,
  link TEXT,
  published_at TEXT,
  feed_mode TEXT,
  dwell_ms INTEGER DEFAULT 0,
  target_ms INTEGER DEFAULT 0,
  origin TEXT,
  direction INTEGER DEFAULT 0,
  completed INTEGER DEFAULT 0,
  manual_skip INTEGER DEFAULT 0,
  value_num REAL DEFAULT 0,
  value_text TEXT,
  extra_json TEXT
);
CREATE INDEX IF NOT EXISTS idx_content_time ON content_events(occurred_at);
CREATE INDEX IF NOT EXISTS idx_content_story_time ON content_events(story_key, occurred_at);
CREATE INDEX IF NOT EXISTS idx_content_source_time ON content_events(source, occurred_at);
CREATE INDEX IF NOT EXISTS idx_content_category_time ON content_events(category, occurred_at);
CREATE INDEX IF NOT EXISTS idx_content_type_time ON content_events(event_type, occurred_at);

CREATE TABLE IF NOT EXISTS content_daily (
  day INTEGER NOT NULL,
  stream TEXT NOT NULL,
  story_key TEXT NOT NULL,
  title TEXT,
  source TEXT,
  category TEXT,
  link TEXT,
  published_at TEXT,
  views INTEGER NOT NULL DEFAULT 0,
  dwell_sum_ms INTEGER NOT NULL DEFAULT 0,
  dwell_count INTEGER NOT NULL DEFAULT 0,
  target_sum_ms INTEGER NOT NULL DEFAULT 0,
  target_count INTEGER NOT NULL DEFAULT 0,
  completes INTEGER NOT NULL DEFAULT 0,
  skips INTEGER NOT NULL DEFAULT 0,
  backs INTEGER NOT NULL DEFAULT 0,
  source_opens INTEGER NOT NULL DEFAULT 0,
  video_starts INTEGER NOT NULL DEFAULT 0,
  video_completes INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (day, stream, story_key)
);
CREATE INDEX IF NOT EXISTS idx_content_daily_stream_day
  ON content_daily(stream, day);
CREATE INDEX IF NOT EXISTS idx_content_daily_story_stream_day
  ON content_daily(story_key, stream, day);

CREATE TABLE IF NOT EXISTS analytics_meta (
  key TEXT PRIMARY KEY,
  value TEXT
);

CREATE TABLE IF NOT EXISTS analytics_public_cache (
  cache_key TEXT NOT NULL,
  part INTEGER NOT NULL,
  fresh_until INTEGER NOT NULL,
  stale_until INTEGER NOT NULL,
  payload TEXT NOT NULL,
  PRIMARY KEY (cache_key, part)
);

CREATE INDEX IF NOT EXISTS idx_analytics_public_cache_stale
  ON analytics_public_cache(stale_until);

CREATE TABLE IF NOT EXISTS analytics_public_cache_lock (
  cache_key TEXT PRIMARY KEY,
  lease_until INTEGER NOT NULL
);
`;

const AUDIENCE_SCHEMA = `
CREATE TABLE IF NOT EXISTS visitors (
  visitor_id TEXT PRIMARY KEY,
  first_seen INTEGER NOT NULL,
  last_seen INTEGER NOT NULL,
  session_count INTEGER NOT NULL DEFAULT 0,
  last_ip TEXT,
  last_country TEXT,
  last_city TEXT,
  last_region TEXT,
  last_asn INTEGER DEFAULT 0,
  last_as_org TEXT,
  last_device_type TEXT,
  last_browser TEXT,
  last_os TEXT,
  last_language TEXT,
  last_timezone TEXT,
  last_user_agent TEXT
);
CREATE INDEX IF NOT EXISTS idx_visitors_first ON visitors(first_seen);
CREATE INDEX IF NOT EXISTS idx_visitors_last ON visitors(last_seen);
CREATE INDEX IF NOT EXISTS idx_visitors_country ON visitors(last_country);

CREATE TABLE IF NOT EXISTS sessions (
  session_id TEXT PRIMARY KEY,
  visitor_id TEXT NOT NULL,
  started_at INTEGER NOT NULL,
  last_seen INTEGER NOT NULL,
  ended_at INTEGER DEFAULT 0,
  duration_ms INTEGER DEFAULT 0,
  event_count INTEGER DEFAULT 0,
  story_views INTEGER DEFAULT 0,
  referrer TEXT,
  page TEXT,
  language TEXT,
  languages_json TEXT,
  timezone TEXT,
  user_agent TEXT,
  platform TEXT,
  browser TEXT,
  os TEXT,
  device_type TEXT,
  screen_w INTEGER DEFAULT 0,
  screen_h INTEGER DEFAULT 0,
  viewport_w INTEGER DEFAULT 0,
  viewport_h INTEGER DEFAULT 0,
  dpr REAL DEFAULT 1,
  color_depth INTEGER DEFAULT 0,
  hardware_concurrency INTEGER DEFAULT 0,
  device_memory REAL DEFAULT 0,
  touch_points INTEGER DEFAULT 0,
  connection_type TEXT,
  downlink REAL DEFAULT 0,
  rtt REAL DEFAULT 0,
  save_data INTEGER DEFAULT 0,
  cookies_enabled INTEGER DEFAULT 0,
  ip TEXT,
  country TEXT,
  city TEXT,
  region TEXT,
  region_code TEXT,
  continent TEXT,
  latitude TEXT,
  longitude TEXT,
  postal_code TEXT,
  timezone_cf TEXT,
  colo TEXT,
  asn INTEGER DEFAULT 0,
  as_org TEXT,
  tls_version TEXT,
  http_protocol TEXT
);
CREATE INDEX IF NOT EXISTS idx_sessions_started ON sessions(started_at);
CREATE INDEX IF NOT EXISTS idx_sessions_last ON sessions(last_seen);
CREATE INDEX IF NOT EXISTS idx_sessions_visitor ON sessions(visitor_id);
CREATE INDEX IF NOT EXISTS idx_sessions_country ON sessions(country);
CREATE INDEX IF NOT EXISTS idx_sessions_device ON sessions(device_type);
`;

const BEHAVIOR_SCHEMA = `
CREATE TABLE IF NOT EXISTS behavior_events (
  event_id TEXT PRIMARY KEY,
  occurred_at INTEGER NOT NULL,
  visitor_id TEXT,
  session_id TEXT,
  event_type TEXT NOT NULL,
  story_key TEXT,
  source TEXT,
  category TEXT,
  feed_mode TEXT,
  keyword_text TEXT,
  keyword_count INTEGER DEFAULT 0,
  mode TEXT,
  value_num REAL DEFAULT 0,
  value_text TEXT,
  meta_json TEXT
);
CREATE INDEX IF NOT EXISTS idx_behavior_time ON behavior_events(occurred_at);
CREATE INDEX IF NOT EXISTS idx_behavior_type_time ON behavior_events(event_type, occurred_at);
CREATE INDEX IF NOT EXISTS idx_behavior_session_time ON behavior_events(session_id, occurred_at);
CREATE INDEX IF NOT EXISTS idx_behavior_visitor_time ON behavior_events(visitor_id, occurred_at);
CREATE INDEX IF NOT EXISTS idx_behavior_keyword_time ON behavior_events(keyword_text, occurred_at);

CREATE TABLE IF NOT EXISTS ad_events (
  event_id TEXT PRIMARY KEY,
  occurred_at INTEGER NOT NULL,
  visitor_id TEXT,
  session_id TEXT,
  event_type TEXT NOT NULL,
  ad_id TEXT NOT NULL,
  brand TEXT,
  campaign TEXT,
  creative TEXT,
  filename TEXT,
  media_type TEXT,
  orientation TEXT,
  device_type TEXT,
  local_hour INTEGER DEFAULT -1,
  timezone TEXT,
  dwell_ms INTEGER DEFAULT 0,
  skipped INTEGER DEFAULT 0,
  completed INTEGER DEFAULT 0,
  returned INTEGER DEFAULT 0,
  repeat_view INTEGER DEFAULT 0,
  extra_json TEXT
);
CREATE INDEX IF NOT EXISTS idx_ads_time ON ad_events(occurred_at);
CREATE INDEX IF NOT EXISTS idx_ads_id_time ON ad_events(ad_id, occurred_at);
CREATE INDEX IF NOT EXISTS idx_ads_type_time ON ad_events(event_type, occurred_at);
CREATE INDEX IF NOT EXISTS idx_ads_device_time ON ad_events(device_type, occurred_at);
CREATE INDEX IF NOT EXISTS idx_ads_orientation_time ON ad_events(orientation, occurred_at);
CREATE INDEX IF NOT EXISTS idx_ads_hour_time ON ad_events(local_hour, occurred_at);
`;

/*
  V31.22.3: optional shadow-only ad hourly counters in the EXISTING BEHAVIOR_DB.
  No ad raw records or current report endpoints are replaced. The schema is
  created only via authenticated POST /admin/v2/setup. Nothing writes unless
  ANALYTICS_V2_AD_SHADOW=on is configured after setup.
*/
const ANALYTICS_V2_AD_SCHEMA = `
CREATE TABLE IF NOT EXISTS analytics_ad_hourly_v2 (
  hour_start INTEGER NOT NULL,
  ad_id TEXT NOT NULL,
  device_type TEXT NOT NULL DEFAULT '',
  orientation TEXT NOT NULL DEFAULT '',
  local_hour INTEGER NOT NULL DEFAULT -1,
  views INTEGER NOT NULL DEFAULT 0,
  skips INTEGER NOT NULL DEFAULT 0,
  completes INTEGER NOT NULL DEFAULT 0,
  returns INTEGER NOT NULL DEFAULT 0,
  repeat_views INTEGER NOT NULL DEFAULT 0,
  dwell_sum_ms INTEGER NOT NULL DEFAULT 0,
  dwell_count INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (hour_start, ad_id, device_type, orientation, local_hour)
);
CREATE INDEX IF NOT EXISTS idx_analytics_ad_hourly_v2_ad
  ON analytics_ad_hourly_v2(ad_id, hour_start);
CREATE TABLE IF NOT EXISTS analytics_ad_hourly_v2_ledger (
  event_id TEXT PRIMARY KEY,
  occurred_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_analytics_ad_hourly_v2_ledger_time
  ON analytics_ad_hourly_v2_ledger(occurred_at);
`;

function analyticsV2AdShadowEnabled(env) {
  return String(env.ANALYTICS_V2_AD_SHADOW || '').toLowerCase() === 'on';
}

/*
  Reads only the accepted ad_events rows not yet reflected in the v2 ledger.
  The summary upsert and ledger insert share one D1.batch transaction. Raw
  ad_events writes have already committed in the legacy path, so failure in
  the OPTIONAL shadow path never drops historical analytics events.

  A single incoming /track packet has <=60 events; the existing event_id PK
  and the v2 ledger PK give idempotent cross-packet replay. No personal visitor
  identifiers are stored in the hourly summary or ledger.
*/
function analyticsV2AdShadowStatements(env, eventIds) {
  const ids = [...new Set((eventIds || []).map(id => String(id || '')).filter(Boolean))];
  if (!ids.length) return [];
  if (ids.length > 60) throw new Error('v2 shadow batch exceeds 60 event ids');
  const marks = ids.map(() => '?').join(',');
  const freshPredicate = `e.event_id IN (${marks})
    AND NOT EXISTS (
      SELECT 1 FROM analytics_ad_hourly_v2_ledger l
      WHERE l.event_id = e.event_id
    )`;

  const aggregate = env.BEHAVIOR_DB.prepare(`
    INSERT INTO analytics_ad_hourly_v2 (
      hour_start, ad_id, device_type, orientation, local_hour,
      views, skips, completes, returns, repeat_views,
      dwell_sum_ms, dwell_count
    )
    SELECT
      CAST(e.occurred_at / 3600000 AS INTEGER) * 3600000,
      e.ad_id,
      COALESCE(e.device_type,''),
      COALESCE(e.orientation,''),
      COALESCE(e.local_hour,-1),
      SUM(CASE WHEN e.event_type='ad_view' THEN 1 ELSE 0 END),
      SUM(CASE WHEN e.event_type='ad_skip' THEN 1 ELSE 0 END),
      SUM(CASE WHEN e.event_type='ad_complete' THEN 1 ELSE 0 END),
      SUM(CASE WHEN e.event_type='ad_return' THEN 1 ELSE 0 END),
      SUM(CASE WHEN e.event_type='ad_repeat_view' THEN 1 ELSE 0 END),
      SUM(CASE WHEN e.event_type IN ('ad_skip','ad_complete') AND e.dwell_ms > 0 THEN e.dwell_ms ELSE 0 END),
      SUM(CASE WHEN e.event_type IN ('ad_skip','ad_complete') AND e.dwell_ms > 0 THEN 1 ELSE 0 END)
    FROM ad_events e
    WHERE ${freshPredicate} AND e.ad_id <> ''
    GROUP BY 1,2,3,4,5
    ON CONFLICT (hour_start, ad_id, device_type, orientation, local_hour)
    DO UPDATE SET
      views=views+excluded.views,
      skips=skips+excluded.skips,
      completes=completes+excluded.completes,
      returns=returns+excluded.returns,
      repeat_views=repeat_views+excluded.repeat_views,
      dwell_sum_ms=dwell_sum_ms+excluded.dwell_sum_ms,
      dwell_count=dwell_count+excluded.dwell_count
  `).bind(...ids);

  const ledger = env.BEHAVIOR_DB.prepare(`
    INSERT OR IGNORE INTO analytics_ad_hourly_v2_ledger(event_id, occurred_at)
    SELECT e.event_id, e.occurred_at
    FROM ad_events e
    WHERE e.event_id IN (${marks}) AND e.ad_id <> ''
  `).bind(...ids);

  return [aggregate, ledger];
}

async function analyticsV2AdShadowStatus(env) {
  const status = {
    enabled: analyticsV2AdShadowEnabled(env),
    mode: 'shadow-only',
    changesExistingReports: false,
    tableReady: false,
    ledgerReady: false,
    startedAt: null,
    completeHistoricalCoverage: false
  };
  if (!env.BEHAVIOR_DB) return status;
  try {
    const names = await analyticsAll(env.BEHAVIOR_DB.prepare(`
      SELECT name FROM sqlite_master
      WHERE type='table'
        AND name IN ('analytics_ad_hourly_v2','analytics_ad_hourly_v2_ledger')
    `));
    const tables = new Set(names.map(row => row.name));
    status.tableReady = tables.has('analytics_ad_hourly_v2');
    status.ledgerReady = tables.has('analytics_ad_hourly_v2_ledger');
    if (status.ledgerReady) {
      const first = await env.BEHAVIOR_DB.prepare(
        'SELECT MIN(occurred_at) AS first_at FROM analytics_ad_hourly_v2_ledger'
      ).first();
      status.startedAt = first?.first_at ?? null;
    }
  } catch (error) {
    status.error = String(error?.message || error);
  }
  return status;
}

async function analyticsV2AdShadowReport(env, rangeKey = '7d') {
  const status = await analyticsV2AdShadowStatus(env);
  if (!status.tableReady || !status.ledgerReady) {
    return {ok:false, error:'Run POST /admin/v2/setup first', status};
  }
  const range = analyticsRange(rangeKey);
  const now = Date.now();
  const start = Math.ceil(range.since / 3600000) * 3600000;
  const end = Math.floor(now / 3600000) * 3600000;
  const ads = await analyticsAll(env.BEHAVIOR_DB.prepare(`
    SELECT ad_id,
      SUM(views) AS views,
      SUM(skips) AS skips,
      SUM(completes) AS completes,
      SUM(returns) AS returns,
      SUM(repeat_views) AS repeat_views,
      SUM(dwell_sum_ms) AS dwell_sum_ms,
      SUM(dwell_count) AS dwell_count
    FROM analytics_ad_hourly_v2
    WHERE hour_start >= ? AND hour_start < ?
    GROUP BY ad_id
    ORDER BY views DESC, ad_id ASC
    LIMIT 1000
  `).bind(start, end));
  const normalized = ads.map(row => ({
    ad_id: String(row.ad_id),
    views:analyticsNumber(row.views),
    skips:analyticsNumber(row.skips),
    completes:analyticsNumber(row.completes),
    returns:analyticsNumber(row.returns),
    repeat_views:analyticsNumber(row.repeat_views),
    dwell_sum_ms:analyticsNumber(row.dwell_sum_ms),
    dwell_count:analyticsNumber(row.dwell_count),
    avg_dwell_ms:Math.round(analyticsNumber(row.dwell_sum_ms) / Math.max(1,analyticsNumber(row.dwell_count)))
  }));
  return {
    ok:true,
    mode:'shadow-only',
    range:range.key,
    generatedAt: now,
    status,
    coverage: {
      type:'completed-UTC-hours-only',
      from: start,
      untilExclusive: end,
      historicalBackfillComplete: false,
      warning:'Only events ingested while the shadow flag was ON. No backfill or exact rolling 24h/7d boundaries. Not for advertiser reports.'
    },
    totals: {
      views:normalized.reduce((n,r) => n+r.views,0),
      skips:normalized.reduce((n,r) => n+r.skips,0),
      completes:normalized.reduce((n,r) => n+r.completes,0),
      returns:normalized.reduce((n,r) => n+r.returns,0),
      repeat_views:normalized.reduce((n,r) => n+r.repeat_views,0)
    },
    ads: normalized
  };
}

const CONTENT_EVENT_TYPES = new Set([
  "story_view",
  "story_leave",
  "story_back",
  "source_open",
  "video_start",
  "video_complete",
  "video_error"
]);

const AD_EVENT_TYPES = new Set([
  "ad_view",
  "ad_skip",
  "ad_complete",
  "ad_return",
  "ad_repeat_view"
]);

function clipAnalytics(value, max = 1000) {
  return String(value ?? "").slice(0, max);
}

function analyticsJson(value) {
  try {
    return JSON.stringify(value ?? {});
  } catch {
    return "{}";
  }
}

function analyticsNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function analyticsBool(value) {
  return value ? 1 : 0;
}

function analyticsRange(value = "7d") {
  const now = Date.now();
  if (value === "all") return { key: "all", since: 0, label: "Tüm zamanlar" };
  if (value === "24h") return { key: "24h", since: now - 86400000, label: "Son 24 saat" };
  return { key: "7d", since: now - 7 * 86400000, label: "Son 7 gün" };
}

function analyticsMissingBindings(env) {
  const missing = [];
  if (!env.CONTENT_DB) missing.push("CONTENT_DB");
  if (!env.AUDIENCE_DB) missing.push("AUDIENCE_DB");
  if (!env.BEHAVIOR_DB) missing.push("BEHAVIOR_DB");
  return missing;
}

function analyticsAuthorized(request, env) {
  const expected = clipAnalytics(env.ADMIN_TOKEN || "", 500);
  if (!expected) return false;
  const auth = request.headers.get("Authorization") || "";
  return auth === `Bearer ${expected}`;
}

function analyticsJsonResponse(data, corsHeaders, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      ...extraHeaders
    }
  });
}

/*
  v31.20 intentionally reuses the 31.19 public cache namespace so deploying
  this quota-protection release does not invalidate already-built snapshots
  and force an immediate D1 rebuild after the daily reset.
*/
const ANALYTICS_PUBLIC_CACHE_VERSION = "31.19.0";
const ANALYTICS_PUBLIC_CACHE_CHUNK_CHARS = 350_000;
const ANALYTICS_PUBLIC_INFLIGHT = new Map();
let ANALYTICS_DAILY_READY_CACHE = null;
let ANALYTICS_PUBLIC_CACHE_CLEANED_AT = 0;

function analyticsBackground(ctx, promise, label = "background") {
  if (!ctx || typeof ctx.waitUntil !== "function") return;

  try {
    ctx.waitUntil(
      Promise.resolve(promise).catch(error => {
        console.warn(`Analytics background task failed: ${label}`, error);
      })
    );
  } catch (error) {
    console.warn(`Analytics background registration failed: ${label}`, error);
  }
}

function analyticsPublicCacheKey(scope, parts = {}) {
  const suffix = Object.entries(parts)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}=${encodeURIComponent(String(value ?? ""))}`)
    .join("&");

  return `${ANALYTICS_PUBLIC_CACHE_VERSION}:${scope}${suffix ? `?${suffix}` : ""}`;
}

function analyticsFastCacheHash(value = "") {
  const input = String(value || "");
  let a = 2166136261;
  let b = 2246822519;

  for (let i = 0; i < input.length; i++) {
    const code = input.charCodeAt(i);
    a ^= code;
    a = Math.imul(a, 16777619);
    b ^= code + i;
    b = Math.imul(b, 3266489917);
  }

  return `${(a >>> 0).toString(16).padStart(8, "0")}${(b >>> 0).toString(16).padStart(8, "0")}`;
}

function analyticsEdgeCacheRequest(request, cacheKey) {
  const url = new URL(request.url);
  url.pathname = `/__floew_analytics_cache__/${analyticsFastCacheHash(cacheKey)}`;
  url.search = "";
  url.hash = "";

  /*
    Build a fresh GET Request deliberately. The frontend currently uses
    fetch(..., {cache:"no-store"}) for Flöra endpoints; copying those request
    headers would defeat the shared Worker cache.
  */
  return new Request(url.href, { method: "GET" });
}

function analyticsSchedulePublicCacheCleanup(
  db,
  ctx
) {
  const now = Date.now();

  if (
    !db ||
    now - ANALYTICS_PUBLIC_CACHE_CLEANED_AT <
      60 * 60 * 1000
  ) {
    return;
  }

  ANALYTICS_PUBLIC_CACHE_CLEANED_AT = now;

  analyticsBackground(
    ctx,
    db.batch([
      db.prepare(`
        DELETE FROM analytics_public_cache
        WHERE stale_until < ?
      `).bind(now),
      db.prepare(`
        DELETE FROM analytics_public_cache_lock
        WHERE lease_until < ?
      `).bind(now - 5 * 60 * 1000)
    ]),
    "public-cache-cleanup"
  );
}

function analyticsJsonWithCacheState(
  data,
  corsHeaders,
  state,
  maxAge = 60
) {
  return analyticsJsonResponse(
    data,
    corsHeaders,
    200,
    {
      "Cache-Control": `public, max-age=${Math.max(0, Math.round(maxAge))}`,
      "X-Floew-Analytics-Cache": state
    }
  );
}

async function analyticsEdgeCacheMatch(request, cacheKey) {
  try {
    if (typeof caches === "undefined" || !caches.default) return null;
    const cached = await caches.default.match(
      analyticsEdgeCacheRequest(request, cacheKey)
    );
    return cached || null;
  } catch {
    return null;
  }
}

async function analyticsEdgeCachePut(
  request,
  cacheKey,
  response,
  ctx
) {
  try {
    if (typeof caches === "undefined" || !caches.default) return;
    const key = analyticsEdgeCacheRequest(request, cacheKey);
    analyticsBackground(
      ctx,
      caches.default.put(key, response.clone()),
      `edge-cache:${cacheKey}`
    );
  } catch {}
}

async function analyticsD1CacheRead(db, cacheKey) {
  if (!db) return null;

  try {
    const result = await db.prepare(`
      SELECT part, fresh_until, stale_until, payload
      FROM analytics_public_cache
      WHERE cache_key = ?
      ORDER BY part ASC
    `).bind(cacheKey).all();

    const rows = Array.isArray(result?.results)
      ? result.results
      : [];

    if (!rows.length) return null;

    const first = rows[0] || {};
    const now = Date.now();
    const freshUntil = analyticsNumber(first.fresh_until);
    const staleUntil = analyticsNumber(first.stale_until);

    if (!staleUntil || staleUntil < now) {
      return null;
    }

    const payload = rows
      .map(row => String(row?.payload || ""))
      .join("");

    if (!payload) return null;

    return {
      data: JSON.parse(payload),
      fresh: freshUntil >= now,
      stale: staleUntil >= now,
      freshUntil,
      staleUntil
    };
  } catch (error) {
    /*
      Fresh deployments can briefly run before /admin/setup creates the
      cache table. Public statistics must keep working in that window.
    */
    console.warn("Analytics D1 cache read skipped:", error);
    return null;
  }
}

async function analyticsD1CacheWrite(
  db,
  cacheKey,
  data,
  freshMs,
  staleMs
) {
  if (!db) return false;

  const payload = JSON.stringify(data);
  const chunks = [];

  for (
    let offset = 0;
    offset < payload.length;
    offset += ANALYTICS_PUBLIC_CACHE_CHUNK_CHARS
  ) {
    chunks.push(
      payload.slice(
        offset,
        offset + ANALYTICS_PUBLIC_CACHE_CHUNK_CHARS
      )
    );
  }

  const now = Date.now();
  const freshUntil = now + Math.max(1_000, freshMs);
  const staleUntil = now + Math.max(freshMs, staleMs);

  try {
    const statements = [
      db.prepare(`
        DELETE FROM analytics_public_cache
        WHERE cache_key = ?
      `).bind(cacheKey)
    ];

    chunks.forEach((chunk, part) => {
      statements.push(
        db.prepare(`
          INSERT INTO analytics_public_cache (
            cache_key, part, fresh_until, stale_until, payload
          ) VALUES (?, ?, ?, ?, ?)
        `).bind(
          cacheKey,
          part,
          freshUntil,
          staleUntil,
          chunk
        )
      );
    });

    await db.batch(statements);
    return true;
  } catch (error) {
    console.warn("Analytics D1 cache write skipped:", error);
    return false;
  }
}

async function analyticsTryRefreshLock(
  db,
  cacheKey,
  leaseMs = 45_000
) {
  if (!db) return true;

  const now = Date.now();

  try {
    const result = await db.prepare(`
      INSERT INTO analytics_public_cache_lock (
        cache_key, lease_until
      ) VALUES (?, ?)
      ON CONFLICT(cache_key) DO UPDATE SET
        lease_until = excluded.lease_until
      WHERE analytics_public_cache_lock.lease_until < ?
    `).bind(
      cacheKey,
      now + Math.max(5_000, leaseMs),
      now
    ).run();

    return analyticsNumber(result?.meta?.changes) > 0;
  } catch {
    /*
      If the schema has not been upgraded yet, fall back to local coalescing
      instead of failing the public endpoint.
    */
    return true;
  }
}

async function analyticsReleaseRefreshLock(db, cacheKey) {
  if (!db) return;

  try {
    await db.prepare(`
      DELETE FROM analytics_public_cache_lock
      WHERE cache_key = ?
    `).bind(cacheKey).run();
  } catch {}
}

async function analyticsComputeWithLocalCoalescing(
  cacheKey,
  producer
) {
  const existing = ANALYTICS_PUBLIC_INFLIGHT.get(cacheKey);
  if (existing) return existing;

  const promise = Promise.resolve()
    .then(producer)
    .finally(() => {
      ANALYTICS_PUBLIC_INFLIGHT.delete(cacheKey);
    });

  ANALYTICS_PUBLIC_INFLIGHT.set(cacheKey, promise);
  return promise;
}

async function analyticsRefreshPublicCache({
  db,
  cacheKey,
  producer,
  freshMs,
  staleMs
}) {
  const locked = await analyticsTryRefreshLock(
    db,
    cacheKey
  );

  if (!locked) {
    return null;
  }

  try {
    const data = await analyticsComputeWithLocalCoalescing(
      cacheKey,
      producer
    );

    await analyticsD1CacheWrite(
      db,
      cacheKey,
      data,
      freshMs,
      staleMs
    );

    return data;
  } finally {
    await analyticsReleaseRefreshLock(
      db,
      cacheKey
    );
  }
}

async function analyticsServePublicCachedJson({
  request,
  env,
  ctx,
  corsHeaders,
  scope,
  parts,
  producer,
  freshMs,
  staleMs,
  edgeMaxAge = 60
}) {
  analyticsSchedulePublicCacheCleanup(
    env.CONTENT_DB,
    ctx
  );

  const cacheKey = analyticsPublicCacheKey(
    scope,
    parts
  );

  const edge = await analyticsEdgeCacheMatch(
    request,
    cacheKey
  );

  if (edge) {
    const headers = new Headers(edge.headers);
    headers.set("X-Floew-Analytics-Cache", "EDGE-HIT");
    return new Response(edge.body, {
      status: edge.status,
      statusText: edge.statusText,
      headers
    });
  }

  const d1 = await analyticsD1CacheRead(
    env.CONTENT_DB,
    cacheKey
  );

  if (d1?.fresh) {
    const response = analyticsJsonWithCacheState(
      d1.data,
      corsHeaders,
      "D1-HIT",
      edgeMaxAge
    );

    await analyticsEdgeCachePut(
      request,
      cacheKey,
      response,
      ctx
    );

    return response;
  }

  if (d1?.stale) {
    /*
      Stale-while-revalidate is intentional: public Flöra should never cause
      dozens of simultaneous full-table GROUP BY scans when a cache expires.
      A distributed D1 lease lets one request refresh while everyone else gets
      the last good snapshot immediately.
    */
    analyticsBackground(
      ctx,
      analyticsRefreshPublicCache({
        db: env.CONTENT_DB,
        cacheKey,
        producer,
        freshMs,
        staleMs
      }),
      `public-refresh:${cacheKey}`
    );

    const response = analyticsJsonWithCacheState(
      d1.data,
      corsHeaders,
      "D1-STALE",
      Math.min(edgeMaxAge, 30)
    );

    await analyticsEdgeCachePut(
      request,
      cacheKey,
      response,
      ctx
    );

    return response;
  }

  const locked = await analyticsTryRefreshLock(
    env.CONTENT_DB,
    cacheKey
  );

  /*
    Another PoP may already be calculating the same snapshot. Give it a short
    chance to populate the shared cache before doing an identical D1 scan.
  */
  if (!locked) {
    for (const delay of [120, 240, 480, 900]) {
      await new Promise(resolve => setTimeout(resolve, delay));
      const shared = await analyticsD1CacheRead(
        env.CONTENT_DB,
        cacheKey
      );

      if (shared?.stale) {
        const response = analyticsJsonWithCacheState(
          shared.data,
          corsHeaders,
          shared.fresh ? "D1-HIT" : "D1-STALE",
          edgeMaxAge
        );

        await analyticsEdgeCachePut(
          request,
          cacheKey,
          response,
          ctx
        );

        return response;
      }
    }
  }

  let data;

  try {
    data = await analyticsComputeWithLocalCoalescing(
      cacheKey,
      producer
    );

    await analyticsD1CacheWrite(
      env.CONTENT_DB,
      cacheKey,
      data,
      freshMs,
      staleMs
    );
  } finally {
    if (locked) {
      await analyticsReleaseRefreshLock(
        env.CONTENT_DB,
        cacheKey
      );
    }
  }

  const response = analyticsJsonWithCacheState(
    data,
    corsHeaders,
    "MISS",
    edgeMaxAge
  );

  await analyticsEdgeCachePut(
    request,
    cacheKey,
    response,
    ctx
  );

  return response;
}

function analyticsUtcDayStart(value) {
  const n = Math.max(0, analyticsNumber(value));
  return Math.floor(n / 86_400_000) * 86_400_000;
}

function analyticsStreamKey(feedMode = "") {
  return String(feedMode || "") === "foreign"
    ? "foreign"
    : "main";
}

async function analyticsDailyReady(db) {
  if (ANALYTICS_DAILY_READY_CACHE === true) {
    return true;
  }

  if (!db) return false;

  try {
    const row = await db.prepare(`
      SELECT value
      FROM analytics_meta
      WHERE key = 'content_daily_7d_ready'
      LIMIT 1
    `).first();

    const ready = String(row?.value || "") === "1";

    if (ready) {
      ANALYTICS_DAILY_READY_CACHE = true;
    }

    return ready;
  } catch {
    return false;
  }
}

async function backfillContentDaily(env) {
  if (!env.CONTENT_DB) {
    throw new Error("CONTENT_DB is not configured");
  }

  const since = Date.now() - 8 * 86_400_000;

  /*
    One bounded historical scan converts the last eight days of raw events to
    daily story aggregates. After that, /track maintains this table
    incrementally, so public 7-day Flöra queries no longer rescan every event.
  */
  const result = await env.CONTENT_DB.prepare(`
    INSERT INTO content_daily (
      day, stream, story_key, title, source, category, link, published_at,
      views, dwell_sum_ms, dwell_count, target_sum_ms, target_count,
      completes, skips, backs, source_opens, video_starts, video_completes
    )
    SELECT
      CAST(occurred_at / 86400000 AS INTEGER) * 86400000 AS day,
      CASE WHEN feed_mode = 'foreign' THEN 'foreign' ELSE 'main' END AS stream,
      story_key,
      MAX(title) AS title,
      MAX(source) AS source,
      MAX(category) AS category,
      MAX(link) AS link,
      MAX(published_at) AS published_at,
      SUM(CASE WHEN event_type='story_view' THEN 1 ELSE 0 END) AS views,
      SUM(CASE WHEN event_type='story_leave' AND dwell_ms>0 THEN dwell_ms ELSE 0 END) AS dwell_sum_ms,
      SUM(CASE WHEN event_type='story_leave' AND dwell_ms>0 THEN 1 ELSE 0 END) AS dwell_count,
      SUM(CASE WHEN event_type='story_leave' AND target_ms>0 THEN target_ms ELSE 0 END) AS target_sum_ms,
      SUM(CASE WHEN event_type='story_leave' AND target_ms>0 THEN 1 ELSE 0 END) AS target_count,
      SUM(CASE WHEN event_type='story_leave' AND completed=1 THEN 1 ELSE 0 END) AS completes,
      SUM(CASE WHEN event_type='story_leave' AND manual_skip=1 THEN 1 ELSE 0 END) AS skips,
      SUM(CASE WHEN event_type='story_back' THEN 1 ELSE 0 END) AS backs,
      SUM(CASE WHEN event_type='source_open' THEN 1 ELSE 0 END) AS source_opens,
      SUM(CASE WHEN event_type='video_start' THEN 1 ELSE 0 END) AS video_starts,
      SUM(CASE WHEN event_type='video_complete' THEN 1 ELSE 0 END) AS video_completes
    FROM content_events
    WHERE occurred_at >= ?
      AND story_key <> ''
    GROUP BY
      CAST(occurred_at / 86400000 AS INTEGER),
      CASE WHEN feed_mode = 'foreign' THEN 'foreign' ELSE 'main' END,
      story_key
    ON CONFLICT(day, stream, story_key) DO UPDATE SET
      title = excluded.title,
      source = excluded.source,
      category = excluded.category,
      link = excluded.link,
      published_at = excluded.published_at,
      views = excluded.views,
      dwell_sum_ms = excluded.dwell_sum_ms,
      dwell_count = excluded.dwell_count,
      target_sum_ms = excluded.target_sum_ms,
      target_count = excluded.target_count,
      completes = excluded.completes,
      skips = excluded.skips,
      backs = excluded.backs,
      source_opens = excluded.source_opens,
      video_starts = excluded.video_starts,
      video_completes = excluded.video_completes
  `).bind(since).run();

  await env.CONTENT_DB.prepare(`
    INSERT INTO analytics_meta (key, value)
    VALUES ('content_daily_7d_ready', '1')
    ON CONFLICT(key) DO UPDATE SET value = excluded.value
  `).run();

  ANALYTICS_DAILY_READY_CACHE = true;

  return {
    ok: true,
    since,
    changes: analyticsNumber(result?.meta?.changes)
  };
}

async function ensureContentDailyBackfill(env) {
  if (await analyticsDailyReady(env.CONTENT_DB)) {
    return {
      ok: true,
      alreadyReady: true
    };
  }

  return backfillContentDaily(env);
}

function analyticsSchemaStatements(schema) {
  return String(schema || "")
    .split(";")
    .map(statement => statement.trim())
    .filter(Boolean);
}

async function runAnalyticsSchema(db, schema) {
  const statements = analyticsSchemaStatements(schema);

  if (!statements.length) {
    return [];
  }

  /*
    D1Database.exec() treats newlines as query separators. Our CREATE TABLE
    statements are deliberately formatted across multiple lines, so using
    exec() would split a single CREATE TABLE into incomplete fragments.

    Each complete semicolon-delimited SQL statement is therefore prepared
    separately and sent through D1Database.batch().
  */
  return db.batch(
    statements.map(sql => db.prepare(sql))
  );
}

async function ensureAnalyticsSchema(env) {
  const missing = analyticsMissingBindings(env);
  if (missing.length) {
    throw new Error(`Missing D1 bindings: ${missing.join(", ")}`);
  }

  const [content, audience, behavior] = await Promise.all([
    runAnalyticsSchema(env.CONTENT_DB, CONTENT_SCHEMA),
    runAnalyticsSchema(env.AUDIENCE_DB, AUDIENCE_SCHEMA),
    runAnalyticsSchema(env.BEHAVIOR_DB, BEHAVIOR_SCHEMA)
  ]);

  return {
    content: {
      statements: content.length,
      results: content
    },
    audience: {
      statements: audience.length,
      results: audience
    },
    behavior: {
      statements: behavior.length,
      results: behavior
    }
  };
}

async function analyticsDatabaseStatus(env) {
  const missing = analyticsMissingBindings(env);

  const status = {
    CONTENT_DB: {
      bound: Boolean(env.CONTENT_DB),
      ready: false,
      table: "content_events"
    },
    AUDIENCE_DB: {
      bound: Boolean(env.AUDIENCE_DB),
      ready: false,
      table: "sessions"
    },
    BEHAVIOR_DB: {
      bound: Boolean(env.BEHAVIOR_DB),
      ready: false,
      table: "behavior_events"
    }
  };

  if (env.CONTENT_DB) {
    try {
      const row = await env.CONTENT_DB.prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='content_events' LIMIT 1"
      ).first();
      status.CONTENT_DB.ready = Boolean(row?.name);
    } catch {}
  }

  if (env.AUDIENCE_DB) {
    try {
      const sessionRow = await env.AUDIENCE_DB.prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='sessions' LIMIT 1"
      ).first();
      const visitorRow = await env.AUDIENCE_DB.prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='visitors' LIMIT 1"
      ).first();
      status.AUDIENCE_DB.ready = Boolean(sessionRow?.name && visitorRow?.name);
    } catch {}
  }

  if (env.BEHAVIOR_DB) {
    try {
      const row = await env.BEHAVIOR_DB.prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='behavior_events' LIMIT 1"
      ).first();
      const adRow = await env.BEHAVIOR_DB.prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='ad_events' LIMIT 1"
      ).first();
      status.BEHAVIOR_DB.ready = Boolean(row?.name && adRow?.name);
      status.BEHAVIOR_DB.adTableReady = Boolean(adRow?.name);
    } catch {}
  }

  return {
    missing,
    databases: status,
    allReady:
      !missing.length &&
      status.CONTENT_DB.ready &&
      status.AUDIENCE_DB.ready &&
      status.BEHAVIOR_DB.ready
  };
}

function analyticsCfSnapshot(request) {
  const cf = request.cf || {};
  return {
    ip: clipAnalytics(request.headers.get("CF-Connecting-IP") || "", 80),
    country: clipAnalytics(cf.country || "", 80),
    city: clipAnalytics(cf.city || "", 160),
    region: clipAnalytics(cf.region || "", 160),
    region_code: clipAnalytics(cf.regionCode || "", 40),
    continent: clipAnalytics(cf.continent || "", 20),
    latitude: clipAnalytics(cf.latitude || "", 40),
    longitude: clipAnalytics(cf.longitude || "", 40),
    postal_code: clipAnalytics(cf.postalCode || "", 40),
    timezone_cf: clipAnalytics(cf.timezone || "", 120),
    colo: clipAnalytics(cf.colo || "", 40),
    asn: analyticsNumber(cf.asn),
    as_org: clipAnalytics(cf.asOrganization || "", 240),
    tls_version: clipAnalytics(cf.tlsVersion || "", 80),
    http_protocol: clipAnalytics(cf.httpProtocol || "", 80)
  };
}

function analyticsEventStory(event) {
  const story = event?.story || {};
  return {
    key: clipAnalytics(story.key || "", 1000),
    title: clipAnalytics(story.title || "", 2000),
    source: clipAnalytics(story.source || "", 240),
    category: clipAnalytics(story.category || "", 120),
    link: clipAnalytics(story.link || "", 3000),
    published: clipAnalytics(story.published || "", 160)
  };
}

async function trackAnalytics(request, env, corsHeaders, ctx) {
  const missing = analyticsMissingBindings(env);
  if (missing.length) {
    return analyticsJsonResponse({
      ok: false,
      error: "Analytics storage is not configured",
      missing
    }, corsHeaders, 503);
  }

  const length = Number(request.headers.get("Content-Length") || 0);
  if (length > 512000) {
    return analyticsJsonResponse({
      ok: false,
      error: "Payload too large"
    }, corsHeaders, 413);
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return analyticsJsonResponse({
      ok: false,
      error: "Invalid JSON"
    }, corsHeaders, 400);
  }

  const client = body?.client || {};
  const incoming = Array.isArray(body?.events) ? body.events.slice(0, 60) : [];

  if (!incoming.length) {
    return analyticsJsonResponse({ ok: true, stored: 0 }, corsHeaders, 202);
  }

  const now = Date.now();
  const visitorId = clipAnalytics(
    client.visitor_id || incoming[0]?.visitor_id || "",
    160
  );
  const sessionId = clipAnalytics(
    client.session_id || incoming[0]?.session_id || "",
    160
  );

  if (!visitorId || !sessionId) {
    return analyticsJsonResponse({
      ok: false,
      error: "Missing visitor/session id"
    }, corsHeaders, 400);
  }

  const cf = analyticsCfSnapshot(request);
  const startedAt = Math.max(
    0,
    analyticsNumber(client.session_started_at, now)
  );

  const normalized = incoming.map((raw, index) => {
    const rawStory = analyticsEventStory(raw);
    const incomingMeta = raw?.meta && typeof raw.meta === "object" ? raw.meta : {};
    const meta = {
      ...incomingMeta,
      ad_title: clipAnalytics(
        incomingMeta.ad_title || incomingMeta.title || raw?.ad_title || "",
        500
      ),
      ad_category: clipAnalytics(
        incomingMeta.ad_category || incomingMeta.category || raw?.ad_category || "",
        120
      )
    };
    const eventType = clipAnalytics(raw?.event || "unknown", 100);
    const isCustomRss =
      Boolean(meta.custom_rss) ||
      eventType.startsWith("custom_rss_");

    /*
      Özel RSS kullanıcıya ait bir tercih olabilir. Bu olayların başlık, link,
      kaynak adı veya story_key gibi içerik kimliklerini D1'e taşımıyoruz.
      Sadece anonim kullanım sayıları/durations saklanır.
    */
    const story = isCustomRss
      ? { key:"", title:"", source:"", category:"", link:"", published:"" }
      : rawStory;

    if(eventType==="story_view" && !isCustomRss){
      meta.analytics_device_type=clipAnalytics(client.device_type||"",80);
      meta.analytics_browser=clipAnalytics(client.browser||"",120);
    }

    return {
      id: clipAnalytics(raw?.id || crypto.randomUUID(), 180),
      eventType,
      isCustomRss,
      occurredAt: Math.max(0, analyticsNumber(raw?.ts, now)),
      visitorId,
      sessionId,
      feedMode: clipAnalytics(raw?.feed_mode || "", 40),
      story,
      keywordText: clipAnalytics(raw?.keyword_text || "", 2000),
      keywordCount: Math.max(0, Math.round(analyticsNumber(raw?.keyword_count))),
      mode: clipAnalytics(raw?.mode || "", 120),
      valueNum: analyticsNumber(raw?.value_num),
      valueText: isCustomRss ? "" : clipAnalytics(raw?.value_text || "", 2000),
      dwellMs: Math.max(0, Math.round(analyticsNumber(raw?.dwell_ms))),
      targetMs: Math.max(0, Math.round(analyticsNumber(raw?.target_ms))),
      origin: clipAnalytics(raw?.origin || raw?.reason || "", 120),
      direction: Math.round(analyticsNumber(raw?.direction)),
      completed: analyticsBool(raw?.completed),
      manualSkip: analyticsBool(raw?.manual_skip),
      meta,
      ad: {
        id: clipAnalytics(
          meta.ad_id || meta.id || raw?.ad_id || raw?.value_text || "",
          120
        ),
        title: clipAnalytics(meta.ad_title || meta.title || "", 500),
        category: clipAnalytics(meta.ad_category || meta.category || "", 120),
        brand: clipAnalytics(meta.brand || "", 240),
        campaign: clipAnalytics(meta.campaign || "", 300),
        creative: clipAnalytics(meta.creative || raw?.value_text || "", 500),
        filename: clipAnalytics(meta.filename || raw?.value_text || "", 500),
        mediaType: clipAnalytics(meta.type || raw?.mode || "", 40),
        orientation: clipAnalytics(
          meta.orientation || meta.layout || "",
          20
        ),
        deviceType: clipAnalytics(
          meta.device_type || client.device_type || "",
          80
        ),
        localHour: Math.max(
          -1,
          Math.min(
            23,
            Math.round(
              analyticsNumber(meta.local_hour, -1)
            )
          )
        ),
        timezone: clipAnalytics(
          meta.timezone || client.timezone || "",
          120
        ),
        dwellMs: Math.max(
          0,
          Math.round(
            analyticsNumber(
              meta.duration_ms,
              raw?.value_num
            )
          )
        )
      }
    };
  });

  const behaviorStatements = normalized.map(e =>
    env.BEHAVIOR_DB.prepare(`
      INSERT OR IGNORE INTO behavior_events (
        event_id, occurred_at, visitor_id, session_id, event_type,
        story_key, source, category, feed_mode,
        keyword_text, keyword_count, mode, value_num, value_text, meta_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      e.id, e.occurredAt, e.visitorId, e.sessionId, e.eventType,
      e.story.key, e.story.source, e.story.category, e.feedMode,
      e.keywordText, e.keywordCount, e.mode, e.valueNum, e.valueText,
      analyticsJson(e.meta)
    )
  );

  const contentStatements = normalized
    .filter(e => CONTENT_EVENT_TYPES.has(e.eventType) && !e.isCustomRss)
    .map(e =>
      env.CONTENT_DB.prepare(`
        INSERT OR IGNORE INTO content_events (
          event_id, event_type, occurred_at, story_key, title, source,
          category, link, published_at, feed_mode, dwell_ms, target_ms,
          origin, direction, completed, manual_skip, value_num, value_text,
          extra_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(
        e.id, e.eventType, e.occurredAt, e.story.key, e.story.title,
        e.story.source, e.story.category, e.story.link, e.story.published,
        e.feedMode, e.dwellMs, e.targetMs, e.origin, e.direction,
        e.completed, e.manualSkip, e.valueNum, e.valueText,
        analyticsJson(e.meta)
      )
    );

  /*
    Public Flöra queries used to rescan every raw content_events row. Keep a
    compact UTC-day/story aggregate alongside the raw log so 7-day public
    statistics can read thousands of aggregate rows instead of millions of
    event rows. This write is best-effort; the raw analytics log remains the
    source of truth.
  */
  const contentDailyBuckets = new Map();

  for (const e of normalized) {
    if (
      !CONTENT_EVENT_TYPES.has(e.eventType) ||
      e.isCustomRss ||
      !e.story.key
    ) {
      continue;
    }

    const day = analyticsUtcDayStart(e.occurredAt);
    const stream = analyticsStreamKey(e.feedMode);
    const bucketKey = `${day}\u0000${stream}\u0000${e.story.key}`;

    let bucket = contentDailyBuckets.get(bucketKey);

    if (!bucket) {
      bucket = {
        day,
        stream,
        storyKey: e.story.key,
        title: e.story.title,
        source: e.story.source,
        category: e.story.category,
        link: e.story.link,
        published: e.story.published,
        views: 0,
        dwellSumMs: 0,
        dwellCount: 0,
        targetSumMs: 0,
        targetCount: 0,
        completes: 0,
        skips: 0,
        backs: 0,
        sourceOpens: 0,
        videoStarts: 0,
        videoCompletes: 0
      };

      contentDailyBuckets.set(
        bucketKey,
        bucket
      );
    }

    /*
      Prefer any non-empty metadata carried by later events in the same
      tracking batch.
    */
    if (e.story.title) bucket.title = e.story.title;
    if (e.story.source) bucket.source = e.story.source;
    if (e.story.category) bucket.category = e.story.category;
    if (e.story.link) bucket.link = e.story.link;
    if (e.story.published) bucket.published = e.story.published;

    if (e.eventType === "story_view") {
      bucket.views++;
    }

    if (e.eventType === "story_leave") {
      if (e.dwellMs > 0) {
        bucket.dwellSumMs += e.dwellMs;
        bucket.dwellCount++;
      }

      if (e.targetMs > 0) {
        bucket.targetSumMs += e.targetMs;
        bucket.targetCount++;
      }

      if (e.completed) bucket.completes++;
      if (e.manualSkip) bucket.skips++;
    }

    if (e.eventType === "story_back") {
      bucket.backs++;
    }

    if (e.eventType === "source_open") {
      bucket.sourceOpens++;
    }

    if (e.eventType === "video_start") {
      bucket.videoStarts++;
    }

    if (e.eventType === "video_complete") {
      bucket.videoCompletes++;
    }
  }

  const contentDailyStatements =
    [...contentDailyBuckets.values()]
      .map(bucket =>
        env.CONTENT_DB.prepare(`
          INSERT INTO content_daily (
            day, stream, story_key, title, source, category, link, published_at,
            views, dwell_sum_ms, dwell_count, target_sum_ms, target_count,
            completes, skips, backs, source_opens, video_starts, video_completes
          ) VALUES (
            ?, ?, ?, ?, ?, ?, ?, ?,
            ?, ?, ?, ?, ?,
            ?, ?, ?, ?, ?, ?
          )
          ON CONFLICT(day, stream, story_key) DO UPDATE SET
            title = CASE WHEN excluded.title <> '' THEN excluded.title ELSE content_daily.title END,
            source = CASE WHEN excluded.source <> '' THEN excluded.source ELSE content_daily.source END,
            category = CASE WHEN excluded.category <> '' THEN excluded.category ELSE content_daily.category END,
            link = CASE WHEN excluded.link <> '' THEN excluded.link ELSE content_daily.link END,
            published_at = CASE WHEN excluded.published_at <> '' THEN excluded.published_at ELSE content_daily.published_at END,
            views = content_daily.views + excluded.views,
            dwell_sum_ms = content_daily.dwell_sum_ms + excluded.dwell_sum_ms,
            dwell_count = content_daily.dwell_count + excluded.dwell_count,
            target_sum_ms = content_daily.target_sum_ms + excluded.target_sum_ms,
            target_count = content_daily.target_count + excluded.target_count,
            completes = content_daily.completes + excluded.completes,
            skips = content_daily.skips + excluded.skips,
            backs = content_daily.backs + excluded.backs,
            source_opens = content_daily.source_opens + excluded.source_opens,
            video_starts = content_daily.video_starts + excluded.video_starts,
            video_completes = content_daily.video_completes + excluded.video_completes
        `).bind(
          bucket.day,
          bucket.stream,
          bucket.storyKey,
          bucket.title,
          bucket.source,
          bucket.category,
          bucket.link,
          bucket.published,
          bucket.views,
          bucket.dwellSumMs,
          bucket.dwellCount,
          bucket.targetSumMs,
          bucket.targetCount,
          bucket.completes,
          bucket.skips,
          bucket.backs,
          bucket.sourceOpens,
          bucket.videoStarts,
          bucket.videoCompletes
        )
      );

  const adStatements = normalized
    .filter(e => AD_EVENT_TYPES.has(e.eventType) && e.ad.id)
    .map(e =>
      env.BEHAVIOR_DB.prepare(`
        INSERT OR IGNORE INTO ad_events (
          event_id, occurred_at, visitor_id, session_id, event_type,
          ad_id, brand, campaign, creative, filename, media_type,
          orientation, device_type, local_hour, timezone, dwell_ms,
          skipped, completed, returned, repeat_view, extra_json
        ) VALUES (
          ?, ?, ?, ?, ?,
          ?, ?, ?, ?, ?, ?,
          ?, ?, ?, ?, ?,
          ?, ?, ?, ?, ?
        )
      `).bind(
        e.id, e.occurredAt, e.visitorId, e.sessionId, e.eventType,
        e.ad.id, e.ad.brand, e.ad.campaign, e.ad.creative,
        e.ad.filename, e.ad.mediaType,
        e.ad.orientation, e.ad.deviceType, e.ad.localHour, e.ad.timezone,
        e.ad.dwellMs,
        e.eventType === "ad_skip" ? 1 : 0,
        e.eventType === "ad_complete" ? 1 : 0,
        e.eventType === "ad_return" ? 1 : 0,
        e.eventType === "ad_repeat_view" ? 1 : 0,
        analyticsJson(e.meta)
      )
    );

  const storyViews = normalized.filter(e =>
    e.eventType === "story_view" ||
    e.eventType === "custom_rss_story_view"
  ).length;
  const hasSessionStart = normalized.some(e => e.eventType === "session_start");
  const hasSessionEnd = normalized.some(e => e.eventType === "session_end");
  const sessionEndEvent = normalized.findLast
    ? normalized.findLast(e => e.eventType === "session_end")
    : [...normalized].reverse().find(e => e.eventType === "session_end");

  const durationMs = hasSessionEnd
    ? Math.max(0, Math.round(analyticsNumber(sessionEndEvent?.valueNum, now - startedAt)))
    : Math.max(0, now - startedAt);

  const audienceStatements = [
    env.AUDIENCE_DB.prepare(`
      INSERT INTO visitors (
        visitor_id, first_seen, last_seen, session_count,
        last_ip, last_country, last_city, last_region, last_asn, last_as_org,
        last_device_type, last_browser, last_os, last_language, last_timezone,
        last_user_agent
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(visitor_id) DO UPDATE SET
        last_seen = excluded.last_seen,
        session_count = visitors.session_count + excluded.session_count,
        last_ip = excluded.last_ip,
        last_country = excluded.last_country,
        last_city = excluded.last_city,
        last_region = excluded.last_region,
        last_asn = excluded.last_asn,
        last_as_org = excluded.last_as_org,
        last_device_type = excluded.last_device_type,
        last_browser = excluded.last_browser,
        last_os = excluded.last_os,
        last_language = excluded.last_language,
        last_timezone = excluded.last_timezone,
        last_user_agent = excluded.last_user_agent
    `).bind(
      visitorId, startedAt, now, hasSessionStart ? 1 : 0,
      cf.ip, cf.country, cf.city, cf.region, cf.asn, cf.as_org,
      clipAnalytics(client.device_type || "", 80),
      clipAnalytics(client.browser || "", 120),
      clipAnalytics(client.os || "", 120),
      clipAnalytics(client.language || "", 80),
      clipAnalytics(client.timezone || "", 120),
      clipAnalytics(client.user_agent || "", 1600)
    ),

    env.AUDIENCE_DB.prepare(`
      INSERT INTO sessions (
        session_id, visitor_id, started_at, last_seen, ended_at, duration_ms,
        event_count, story_views, referrer, page, language, languages_json,
        timezone, user_agent, platform, browser, os, device_type,
        screen_w, screen_h, viewport_w, viewport_h, dpr, color_depth,
        hardware_concurrency, device_memory, touch_points, connection_type,
        downlink, rtt, save_data, cookies_enabled,
        ip, country, city, region, region_code, continent, latitude, longitude,
        postal_code, timezone_cf, colo, asn, as_org, tls_version, http_protocol
      ) VALUES (
        ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
        ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
        ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
      )
      ON CONFLICT(session_id) DO UPDATE SET
        last_seen = excluded.last_seen,
        ended_at = CASE WHEN excluded.ended_at > 0 THEN excluded.ended_at ELSE sessions.ended_at END,
        duration_ms = MAX(sessions.duration_ms, excluded.duration_ms),
        event_count = sessions.event_count + excluded.event_count,
        story_views = sessions.story_views + excluded.story_views,
        viewport_w = excluded.viewport_w,
        viewport_h = excluded.viewport_h,
        connection_type = excluded.connection_type,
        downlink = excluded.downlink,
        rtt = excluded.rtt,
        ip = excluded.ip,
        country = excluded.country,
        city = excluded.city,
        region = excluded.region,
        colo = excluded.colo,
        asn = excluded.asn,
        as_org = excluded.as_org,
        tls_version = excluded.tls_version,
        http_protocol = excluded.http_protocol
    `).bind(
      sessionId, visitorId, startedAt, now, hasSessionEnd ? now : 0, durationMs,
      normalized.length, storyViews,
      clipAnalytics(client.referrer || "", 3000),
      clipAnalytics(client.page || "", 1000),
      clipAnalytics(client.language || "", 80),
      analyticsJson(client.languages || []),
      clipAnalytics(client.timezone || "", 120),
      clipAnalytics(client.user_agent || "", 1600),
      clipAnalytics(client.platform || "", 200),
      clipAnalytics(client.browser || "", 120),
      clipAnalytics(client.os || "", 120),
      clipAnalytics(client.device_type || "", 80),
      Math.round(analyticsNumber(client.screen_w)),
      Math.round(analyticsNumber(client.screen_h)),
      Math.round(analyticsNumber(client.viewport_w)),
      Math.round(analyticsNumber(client.viewport_h)),
      analyticsNumber(client.dpr, 1),
      Math.round(analyticsNumber(client.color_depth)),
      Math.round(analyticsNumber(client.hardware_concurrency)),
      analyticsNumber(client.device_memory),
      Math.round(analyticsNumber(client.touch_points)),
      clipAnalytics(client.connection_type || "", 80),
      analyticsNumber(client.downlink),
      analyticsNumber(client.rtt),
      analyticsBool(client.save_data),
      analyticsBool(client.cookies_enabled),
      cf.ip, cf.country, cf.city, cf.region, cf.region_code, cf.continent,
      cf.latitude, cf.longitude, cf.postal_code, cf.timezone_cf, cf.colo,
      cf.asn, cf.as_org, cf.tls_version, cf.http_protocol
    )
  ];

  let adStored = 0;

  try {
    await Promise.all([
      behaviorStatements.length
        ? env.BEHAVIOR_DB.batch(behaviorStatements)
        : Promise.resolve([]),
      contentStatements.length
        ? env.CONTENT_DB.batch(contentStatements)
        : Promise.resolve([]),
      env.AUDIENCE_DB.batch(audienceStatements)
    ]);
  } catch (error) {
    console.error("Analytics write error:", error);
    return analyticsJsonResponse({
      ok: false,
      error: "Analytics write failed"
    }, corsHeaders, 500);
  }

  if (contentDailyStatements.length) {
    try {
      await env.CONTENT_DB.batch(
        contentDailyStatements
      );
    } catch (error) {
      /*
        A Worker-first deployment can receive /track before /admin/setup has
        created content_daily. Raw content_events have already been stored, so
        never fail the tracking request because the aggregate table is not
        ready yet.
      */
      console.warn(
        "Content daily aggregate skipped:",
        error
      );
    }
  }

  if (adStatements.length) {
    try {
      await env.BEHAVIOR_DB.batch(adStatements);
      adStored = adStatements.length;
      // V31.22.3 opt-in: only AFTER legacy ad_events has committed.
      if (analyticsV2AdShadowEnabled(env)) {
        try {
          const adIds = normalized
            .filter(e => AD_EVENT_TYPES.has(e.eventType) && e.ad.id)
            .map(e => e.id);
          const v2Statements = analyticsV2AdShadowStatements(env, adIds);
          if (v2Statements.length) {
            await env.BEHAVIOR_DB.batch(v2Statements);
          }
        } catch (shadowError) {
          console.warn('Analytics v2 shadow skipped (legacy stored safely):',
            String(shadowError?.message || shadowError));
        }
      }
    } catch (error) {
      /*
        During a Worker-first deployment the new ad_events table might not
        exist until the admin setup button is pressed. Do not sacrifice the
        existing audience/content analytics in that short migration window.
      */
      console.warn("Ad analytics write skipped:", error);
    }
  }

  behaviorV3Schedule(ctx,env);

  return analyticsJsonResponse({
    ok: true,
    stored: normalized.length,
    contentStored: contentStatements.length,
    adStored
  }, corsHeaders, 202);
}

async function analyticsAll(statement) {
  const result = await statement.all();
  return Array.isArray(result?.results) ? result.results : [];
}

function calculateFlora(row) {
  const views = Math.max(1, analyticsNumber(row.views, 1));
  const avgDwell = Math.max(0, analyticsNumber(row.avg_dwell_ms));
  const avgTarget = Math.max(1000, analyticsNumber(row.avg_target_ms, 10000));
  const completes = Math.max(0, analyticsNumber(row.completes));
  const skips = Math.max(0, analyticsNumber(row.skips));
  const backs = Math.max(0, analyticsNumber(row.backs));
  const opens = Math.max(0, analyticsNumber(row.source_opens));

  const dwellScore = Math.min(1, avgDwell / avgTarget) * 100;
  const completionRate = Math.min(1, completes / views);
  const skipRate = Math.min(1, skips / views);
  const revisitStrength = Math.min(1, (backs / views) * 2.5);
  const sourceOpenStrength = Math.min(1, (opens / views) * 4);

  const raw =
    dwellScore * 0.35 +
    completionRate * 25 +
    revisitStrength * 20 +
    sourceOpenStrength * 20 -
    skipRate * 10;

  const confidence = Math.min(1, Math.log10(views + 1) / 1.3);
  const score = Math.max(0, Math.min(100, raw * (0.65 + confidence * 0.35)));

  return Math.round(score * 10) / 10;
}

function publicFloraStatsPayload(row) {
  if (!row) return null;

  return {
    story_key: String(row.story_key || ""),
    flora: calculateFlora(row),
    views: analyticsNumber(row.views),
    avg_dwell_ms: analyticsNumber(row.avg_dwell_ms),
    avg_target_ms: analyticsNumber(row.avg_target_ms),
    completes: analyticsNumber(row.completes),
    skips: analyticsNumber(row.skips),
    backs: analyticsNumber(row.backs),
    source_opens: analyticsNumber(row.source_opens),
    video_starts: analyticsNumber(row.video_starts),
    video_completes: analyticsNumber(row.video_completes)
  };
}


/*
  Flöra tahmini için anonim kelime/ifade sözlüğü. Bir kez üretildiğinde
  24 saat cache'den okunur; yeni haber/kullanıcı başına D1 taraması yapılmaz.
  Geçmiş başlıklar istemciye GÖNDERİLMEZ, sadece özet kelime puanları gider.
*/
async function publicFloraVocabulary(env,streamKey="main"){
  if(!env.CONTENT_DB)throw new Error("CONTENT_DB is not configured");
  const stream=streamKey==="foreign"?"foreign":"main";
  const since=Date.now()-30*86400000;
  const dailyReady=await analyticsDailyReady(env.CONTENT_DB);
  let rows=[];
  let aggregate="content_daily";

  if(dailyReady){
    rows=await analyticsAll(env.CONTENT_DB.prepare(`
      SELECT
        story_key, MAX(title) AS title, SUM(views) AS views,
        CASE WHEN SUM(dwell_count)>0
          THEN CAST(SUM(dwell_sum_ms) AS REAL)/SUM(dwell_count)
        END AS avg_dwell_ms,
        CASE WHEN SUM(target_count)>0
          THEN CAST(SUM(target_sum_ms) AS REAL)/SUM(target_count)
        END AS avg_target_ms,
        SUM(completes) AS completes,
        SUM(skips) AS skips,
        SUM(backs) AS backs,
        SUM(source_opens) AS source_opens
      FROM content_daily
      WHERE day>=? AND stream=? AND story_key<>''
      GROUP BY story_key
      HAVING SUM(views)>=3 AND MAX(title)<>''
      ORDER BY SUM(views) DESC
      LIMIT 2400
    `).bind(analyticsUtcDayStart(since),stream));
  }

  /*
    Daily rollups are optional and need admin backfill/setup. Historic Flöra
    already exists in content_events even before that setup. When the daily
    snapshot has too few eligible stories, train from this bounded 30-day
    historical path rather than returning a permanently empty model.

    This producer runs behind the EXISTING distributed D1 lock plus the
    24-hour shared public cache, never once per story or per visitor.
  */
  if(rows.length<12){
    aggregate="content_events";
    const streamWhere=stream==="foreign"
      ? "AND feed_mode = 'foreign'"
      : "AND COALESCE(feed_mode,'') <> 'foreign'";
    rows=await analyticsAll(env.CONTENT_DB.prepare(`
      SELECT
        story_key,
        MAX(title) AS title,
        SUM(CASE WHEN event_type='story_view' THEN 1 ELSE 0 END) AS views,
        AVG(CASE WHEN event_type='story_leave' AND dwell_ms>0
          THEN dwell_ms END) AS avg_dwell_ms,
        AVG(CASE WHEN event_type='story_leave' AND target_ms>0
          THEN target_ms END) AS avg_target_ms,
        SUM(CASE WHEN event_type='story_leave' AND completed=1 THEN 1 ELSE 0 END) AS completes,
        SUM(CASE WHEN event_type='story_leave' AND manual_skip=1 THEN 1 ELSE 0 END) AS skips,
        SUM(CASE WHEN event_type='story_back' THEN 1 ELSE 0 END) AS backs,
        SUM(CASE WHEN event_type='source_open' THEN 1 ELSE 0 END) AS source_opens
      FROM content_events
      WHERE occurred_at>=? AND story_key<>'' ${streamWhere}
      GROUP BY story_key
      HAVING views>=3 AND MAX(title)<>''
      ORDER BY views DESC
      LIMIT 2400
    `).bind(since));
  }

  const scored=rows.map(row=>({
    title:row.title,
    views:analyticsNumber(row.views),
    flora:calculateFlora(row)
  }));
  return {
    ok:true,stream,aggregate,
    model:globalThis.FloewFloraPredictor.build(scored)
  };
}

async function publicFloraScores(
  env,
  rangeKey = "7d",
  streamKey = "main"
) {
  const range = analyticsRange(rangeKey);

  if (!env.CONTENT_DB) {
    throw new Error("CONTENT_DB is not configured");
  }

  const stream =
    streamKey === "foreign"
      ? "foreign"
      : "main";

  const useDaily =
    range.key === "7d" &&
    await analyticsDailyReady(
      env.CONTENT_DB
    );

  let rows;

  if (useDaily) {
    const daySince =
      analyticsUtcDayStart(
        range.since
      );

    rows = await analyticsAll(
      env.CONTENT_DB.prepare(`
        SELECT
          story_key,
          SUM(views) AS views,
          CASE
            WHEN SUM(dwell_count) > 0
            THEN CAST(SUM(dwell_sum_ms) AS REAL) / SUM(dwell_count)
          END AS avg_dwell_ms,
          CASE
            WHEN SUM(target_count) > 0
            THEN CAST(SUM(target_sum_ms) AS REAL) / SUM(target_count)
          END AS avg_target_ms,
          SUM(completes) AS completes,
          SUM(skips) AS skips,
          SUM(backs) AS backs,
          SUM(source_opens) AS source_opens,
          SUM(video_starts) AS video_starts,
          SUM(video_completes) AS video_completes
        FROM content_daily
        WHERE day >= ?
          AND stream = ?
        GROUP BY story_key
        HAVING views > 0
        ORDER BY views DESC
        LIMIT 2000
      `).bind(
        daySince,
        stream
      )
    );
  } else {
    const streamWhere =
      stream === "foreign"
        ? "AND feed_mode = 'foreign'"
        : "AND COALESCE(feed_mode, '') <> 'foreign'";

    rows = await analyticsAll(
      env.CONTENT_DB.prepare(`
        SELECT
          story_key,
          SUM(CASE WHEN event_type='story_view' THEN 1 ELSE 0 END) AS views,
          AVG(CASE WHEN event_type='story_leave' AND dwell_ms>0 THEN dwell_ms END) AS avg_dwell_ms,
          AVG(CASE WHEN event_type='story_leave' AND target_ms>0 THEN target_ms END) AS avg_target_ms,
          SUM(CASE WHEN event_type='story_leave' AND completed=1 THEN 1 ELSE 0 END) AS completes,
          SUM(CASE WHEN event_type='story_leave' AND manual_skip=1 THEN 1 ELSE 0 END) AS skips,
          SUM(CASE WHEN event_type='story_back' THEN 1 ELSE 0 END) AS backs,
          SUM(CASE WHEN event_type='source_open' THEN 1 ELSE 0 END) AS source_opens,
          SUM(CASE WHEN event_type='video_start' THEN 1 ELSE 0 END) AS video_starts,
          SUM(CASE WHEN event_type='video_complete' THEN 1 ELSE 0 END) AS video_completes
        FROM content_events
        WHERE occurred_at >= ?
          AND story_key <> ''
          ${streamWhere}
        GROUP BY story_key
        HAVING views > 0
        ORDER BY views DESC
        LIMIT 2000
      `).bind(range.since)
    );
  }

  return {
    ok: true,
    range: range.key,
    stream,
    generatedAt: Date.now(),
    aggregate: useDaily
      ? "content_daily"
      : "content_events",
    scores: rows.map(
      publicFloraStatsPayload
    )
  };
}

async function publicFloraStory(
  env,
  rangeKey = "7d",
  streamKey = "main",
  storyKey = ""
) {
  const range = analyticsRange(rangeKey);

  if (!env.CONTENT_DB) {
    throw new Error("CONTENT_DB is not configured");
  }

  const key = String(storyKey || "")
    .trim()
    .slice(0, 3000);

  const stream =
    streamKey === "foreign"
      ? "foreign"
      : "main";

  if (!key) {
    return {
      ok: true,
      range: range.key,
      stream,
      generatedAt: Date.now(),
      stats: null
    };
  }

  const useDaily =
    range.key === "7d" &&
    await analyticsDailyReady(
      env.CONTENT_DB
    );

  let row;

  if (useDaily) {
    const daySince =
      analyticsUtcDayStart(
        range.since
      );

    row = await env.CONTENT_DB.prepare(`
      SELECT
        story_key,
        SUM(views) AS views,
        CASE
          WHEN SUM(dwell_count) > 0
          THEN CAST(SUM(dwell_sum_ms) AS REAL) / SUM(dwell_count)
        END AS avg_dwell_ms,
        CASE
          WHEN SUM(target_count) > 0
          THEN CAST(SUM(target_sum_ms) AS REAL) / SUM(target_count)
        END AS avg_target_ms,
        SUM(completes) AS completes,
        SUM(skips) AS skips,
        SUM(backs) AS backs,
        SUM(source_opens) AS source_opens,
        SUM(video_starts) AS video_starts,
        SUM(video_completes) AS video_completes
      FROM content_daily
      WHERE day >= ?
        AND stream = ?
        AND story_key = ?
      GROUP BY story_key
      HAVING views > 0
      LIMIT 1
    `).bind(
      daySince,
      stream,
      key
    ).first();
  } else {
    const streamWhere =
      stream === "foreign"
        ? "AND feed_mode = 'foreign'"
        : "AND COALESCE(feed_mode, '') <> 'foreign'";

    row = await env.CONTENT_DB.prepare(`
      SELECT
        story_key,
        SUM(CASE WHEN event_type='story_view' THEN 1 ELSE 0 END) AS views,
        AVG(CASE WHEN event_type='story_leave' AND dwell_ms>0 THEN dwell_ms END) AS avg_dwell_ms,
        AVG(CASE WHEN event_type='story_leave' AND target_ms>0 THEN target_ms END) AS avg_target_ms,
        SUM(CASE WHEN event_type='story_leave' AND completed=1 THEN 1 ELSE 0 END) AS completes,
        SUM(CASE WHEN event_type='story_leave' AND manual_skip=1 THEN 1 ELSE 0 END) AS skips,
        SUM(CASE WHEN event_type='story_back' THEN 1 ELSE 0 END) AS backs,
        SUM(CASE WHEN event_type='source_open' THEN 1 ELSE 0 END) AS source_opens,
        SUM(CASE WHEN event_type='video_start' THEN 1 ELSE 0 END) AS video_starts,
        SUM(CASE WHEN event_type='video_complete' THEN 1 ELSE 0 END) AS video_completes
      FROM content_events
      WHERE occurred_at >= ?
        AND story_key = ?
        ${streamWhere}
      GROUP BY story_key
      HAVING views > 0
      LIMIT 1
    `).bind(
      range.since,
      key
    ).first();
  }

  return {
    ok: true,
    range: range.key,
    stream,
    generatedAt: Date.now(),
    aggregate: useDaily
      ? "content_daily"
      : "content_events",
    stats: row
      ? publicFloraStatsPayload(row)
      : null
  };
}

async function publicContentStats(
  env,
  rangeKey = "7d",
  streamKey = "main"
) {
  const range = analyticsRange(rangeKey);

  if (!env.CONTENT_DB) {
    throw new Error("CONTENT_DB is not configured");
  }

  const stream =
    streamKey === "foreign"
      ? "foreign"
      : "main";

  const useDaily =
    range.key === "7d" &&
    await analyticsDailyReady(
      env.CONTENT_DB
    );

  let overview;
  let storyRows;
  let sources;
  let categories;
  let timeline;

  if (useDaily) {
    const daySince =
      analyticsUtcDayStart(
        range.since
      );

    overview = await env.CONTENT_DB.prepare(`
      SELECT
        SUM(views) AS views,
        COUNT(DISTINCT CASE WHEN views > 0 THEN story_key END) AS stories,
        SUM(source_opens) AS source_opens,
        SUM(completes) AS completes,
        SUM(skips) AS skips,
        CASE
          WHEN SUM(dwell_count) > 0
          THEN CAST(SUM(dwell_sum_ms) AS REAL) / SUM(dwell_count)
        END AS avg_dwell_ms
      FROM content_daily
      WHERE day >= ?
        AND stream = ?
    `).bind(
      daySince,
      stream
    ).first();

    storyRows = await analyticsAll(
      env.CONTENT_DB.prepare(`
        SELECT
          story_key,
          MAX(title) AS title,
          MAX(source) AS source,
          MAX(category) AS category,
          MAX(link) AS link,
          MAX(published_at) AS published_at,
          SUM(views) AS views,
          CASE
            WHEN SUM(dwell_count) > 0
            THEN CAST(SUM(dwell_sum_ms) AS REAL) / SUM(dwell_count)
          END AS avg_dwell_ms,
          CASE
            WHEN SUM(target_count) > 0
            THEN CAST(SUM(target_sum_ms) AS REAL) / SUM(target_count)
          END AS avg_target_ms,
          SUM(completes) AS completes,
          SUM(skips) AS skips,
          SUM(backs) AS backs,
          SUM(source_opens) AS source_opens,
          SUM(video_starts) AS video_starts,
          SUM(video_completes) AS video_completes
        FROM content_daily
        WHERE day >= ?
          AND stream = ?
          AND story_key <> ''
        GROUP BY story_key
        HAVING views > 0
        ORDER BY views DESC
        LIMIT 500
      `).bind(
        daySince,
        stream
      )
    );

    sources = await analyticsAll(
      env.CONTENT_DB.prepare(`
        SELECT
          source,
          SUM(views) AS views
        FROM content_daily
        WHERE day >= ?
          AND stream = ?
          AND source <> ''
          AND views > 0
        GROUP BY source
        ORDER BY views DESC
        LIMIT 40
      `).bind(
        daySince,
        stream
      )
    );

    categories = await analyticsAll(
      env.CONTENT_DB.prepare(`
        SELECT
          category,
          SUM(views) AS views
        FROM content_daily
        WHERE day >= ?
          AND stream = ?
          AND category <> ''
          AND views > 0
        GROUP BY category
        ORDER BY views DESC
        LIMIT 40
      `).bind(
        daySince,
        stream
      )
    );

    timeline = await analyticsAll(
      env.CONTENT_DB.prepare(`
        SELECT
          date(day/1000, 'unixepoch') AS day,
          SUM(views) AS views
        FROM content_daily
        WHERE day >= ?
          AND stream = ?
          AND views > 0
        GROUP BY day
        ORDER BY day ASC
      `).bind(
        daySince,
        stream
      )
    );
  } else {
    /*
      "all" and exact 24h keep the raw historical path. The high-frequency
      public 7-day path used by Flöra is served from content_daily after
      setup/backfill; daily buckets are intentionally not used for exact 24h.
    */
    const streamWhere =
      stream === "foreign"
        ? "AND feed_mode = 'foreign'"
        : "AND COALESCE(feed_mode, '') <> 'foreign'";

    overview = await env.CONTENT_DB.prepare(`
      SELECT
        SUM(CASE WHEN event_type='story_view' THEN 1 ELSE 0 END) AS views,
        COUNT(DISTINCT CASE WHEN event_type='story_view' THEN story_key END) AS stories,
        SUM(CASE WHEN event_type='source_open' THEN 1 ELSE 0 END) AS source_opens,
        SUM(CASE WHEN event_type='story_leave' AND completed=1 THEN 1 ELSE 0 END) AS completes,
        SUM(CASE WHEN event_type='story_leave' AND manual_skip=1 THEN 1 ELSE 0 END) AS skips,
        AVG(CASE WHEN event_type='story_leave' AND dwell_ms>0 THEN dwell_ms END) AS avg_dwell_ms
      FROM content_events
      WHERE occurred_at >= ?
        ${streamWhere}
    `).bind(range.since).first();

    storyRows = await analyticsAll(
      env.CONTENT_DB.prepare(`
        SELECT
          story_key,
          MAX(title) AS title,
          MAX(source) AS source,
          MAX(category) AS category,
          MAX(link) AS link,
          MAX(published_at) AS published_at,
          SUM(CASE WHEN event_type='story_view' THEN 1 ELSE 0 END) AS views,
          AVG(CASE WHEN event_type='story_leave' AND dwell_ms>0 THEN dwell_ms END) AS avg_dwell_ms,
          AVG(CASE WHEN event_type='story_leave' AND target_ms>0 THEN target_ms END) AS avg_target_ms,
          SUM(CASE WHEN event_type='story_leave' AND completed=1 THEN 1 ELSE 0 END) AS completes,
          SUM(CASE WHEN event_type='story_leave' AND manual_skip=1 THEN 1 ELSE 0 END) AS skips,
          SUM(CASE WHEN event_type='story_back' THEN 1 ELSE 0 END) AS backs,
          SUM(CASE WHEN event_type='source_open' THEN 1 ELSE 0 END) AS source_opens,
          SUM(CASE WHEN event_type='video_start' THEN 1 ELSE 0 END) AS video_starts,
          SUM(CASE WHEN event_type='video_complete' THEN 1 ELSE 0 END) AS video_completes
        FROM content_events
        WHERE occurred_at >= ?
          AND story_key <> ''
          ${streamWhere}
        GROUP BY story_key
        HAVING views > 0
        ORDER BY views DESC
        LIMIT 500
      `).bind(range.since)
    );

    sources = await analyticsAll(
      env.CONTENT_DB.prepare(`
        SELECT source, COUNT(*) AS views
        FROM content_events
        WHERE occurred_at >= ?
          AND event_type='story_view'
          AND source <> ''
          ${streamWhere}
        GROUP BY source
        ORDER BY views DESC
        LIMIT 40
      `).bind(range.since)
    );

    categories = await analyticsAll(
      env.CONTENT_DB.prepare(`
        SELECT category, COUNT(*) AS views
        FROM content_events
        WHERE occurred_at >= ?
          AND event_type='story_view'
          AND category <> ''
          ${streamWhere}
        GROUP BY category
        ORDER BY views DESC
        LIMIT 40
      `).bind(range.since)
    );

    timeline = await analyticsAll(
      env.CONTENT_DB.prepare(`
        SELECT
          date(occurred_at/1000, 'unixepoch') AS day,
          COUNT(*) AS views
        FROM content_events
        WHERE occurred_at >= ?
          AND event_type='story_view'
          ${streamWhere}
        GROUP BY day
        ORDER BY day ASC
      `).bind(range.since)
    );
  }

  const stories = storyRows.map(row => ({
    ...row,
    flora: calculateFlora(row),
    avg_dwell_ms: Math.round(
      analyticsNumber(row.avg_dwell_ms)
    ),
    avg_target_ms: Math.round(
      analyticsNumber(row.avg_target_ms)
    )
  }));

  return {
    ok: true,
    range: range.key,
    label: range.label,
    stream,
    generatedAt: Date.now(),
    aggregate: useDaily
      ? "content_daily"
      : "content_events",
    overview: {
      views: analyticsNumber(overview?.views),
      stories: analyticsNumber(overview?.stories),
      source_opens: analyticsNumber(overview?.source_opens),
      completes: analyticsNumber(overview?.completes),
      skips: analyticsNumber(overview?.skips),
      avg_dwell_ms: Math.round(
        analyticsNumber(
          overview?.avg_dwell_ms
        )
      )
    },
    flora: [...stories]
      .sort(
        (a, b) =>
          b.flora - a.flora ||
          b.views - a.views
      )
      .slice(0, 40),
    mostViewed: [...stories]
      .sort(
        (a, b) =>
          b.views - a.views ||
          b.flora - a.flora
      )
      .slice(0, 40),
    sources,
    categories,
    timeline
  };
}

async function audienceSummary(env, rangeKey = "7d") {
  const range = analyticsRange(rangeKey);
  if (!env.AUDIENCE_DB) throw new Error("AUDIENCE_DB is not configured");

  const totals = await env.AUDIENCE_DB.prepare(`
    SELECT
      COUNT(*) AS sessions,
      COUNT(DISTINCT visitor_id) AS visitors,
      AVG(duration_ms) AS avg_duration_ms,
      SUM(duration_ms) AS total_duration_ms,
      SUM(story_views) AS story_views,
      SUM(event_count) AS event_count
    FROM sessions
    WHERE last_seen >= ?
  `).bind(range.since).first();

  const newVisitors = await env.AUDIENCE_DB.prepare(`
    SELECT COUNT(*) AS count
    FROM visitors
    WHERE first_seen >= ?
  `).bind(range.since).first();

  const returningVisitors = await env.AUDIENCE_DB.prepare(`
    SELECT COUNT(*) AS count
    FROM visitors
    WHERE last_seen >= ? AND session_count > 1
  `).bind(range.since).first();

  const byCountry = await analyticsAll(
    env.AUDIENCE_DB.prepare(`
      SELECT COALESCE(NULLIF(country,''),'Bilinmiyor') AS label, COUNT(*) AS count
      FROM sessions
      WHERE last_seen >= ?
      GROUP BY label
      ORDER BY count DESC
      LIMIT 30
    `).bind(range.since)
  );

  const byCity = await analyticsAll(
    env.AUDIENCE_DB.prepare(`
      SELECT COALESCE(NULLIF(city,''),'Bilinmiyor') AS label, COUNT(*) AS count
      FROM sessions
      WHERE last_seen >= ?
      GROUP BY label
      ORDER BY count DESC
      LIMIT 30
    `).bind(range.since)
  );

  const byDevice = await analyticsAll(
    env.AUDIENCE_DB.prepare(`
      SELECT COALESCE(NULLIF(device_type,''),'Bilinmiyor') AS label, COUNT(*) AS count
      FROM sessions
      WHERE last_seen >= ?
      GROUP BY label
      ORDER BY count DESC
    `).bind(range.since)
  );

  const byBrowser = await analyticsAll(
    env.AUDIENCE_DB.prepare(`
      SELECT COALESCE(NULLIF(browser,''),'Bilinmiyor') AS label, COUNT(*) AS count
      FROM sessions
      WHERE last_seen >= ?
      GROUP BY label
      ORDER BY count DESC
      LIMIT 20
    `).bind(range.since)
  );

  const byOS = await analyticsAll(
    env.AUDIENCE_DB.prepare(`
      SELECT COALESCE(NULLIF(os,''),'Bilinmiyor') AS label, COUNT(*) AS count
      FROM sessions
      WHERE last_seen >= ?
      GROUP BY label
      ORDER BY count DESC
      LIMIT 20
    `).bind(range.since)
  );

  const referrers = await analyticsAll(
    env.AUDIENCE_DB.prepare(`
      SELECT
        CASE WHEN referrer='' THEN 'Doğrudan' ELSE referrer END AS label,
        COUNT(*) AS count
      FROM sessions
      WHERE last_seen >= ?
      GROUP BY label
      ORDER BY count DESC
      LIMIT 25
    `).bind(range.since)
  );

  const daily = await analyticsAll(
    env.AUDIENCE_DB.prepare(`
      SELECT
        date(started_at/1000, 'unixepoch') AS day,
        COUNT(*) AS sessions,
        COUNT(DISTINCT visitor_id) AS visitors
      FROM sessions
      WHERE last_seen >= ?
      GROUP BY day
      ORDER BY day ASC
    `).bind(range.since)
  );

  const latest = await analyticsAll(
    env.AUDIENCE_DB.prepare(`
      SELECT
        session_id, visitor_id, started_at, last_seen, ended_at, duration_ms,
        story_views, event_count, device_type, browser, os, language, timezone,
        ip, country, city, region, colo, asn, as_org, referrer
      FROM sessions
      WHERE last_seen >= ?
      ORDER BY last_seen DESC
      LIMIT 100
    `).bind(range.since)
  );

  return {
    ok: true,
    range: range.key,
    label: range.label,
    generatedAt: Date.now(),
    totals: {
      sessions: analyticsNumber(totals?.sessions),
      visitors: analyticsNumber(totals?.visitors),
      new_visitors: analyticsNumber(newVisitors?.count),
      returning_visitors: analyticsNumber(returningVisitors?.count),
      avg_duration_ms: Math.round(analyticsNumber(totals?.avg_duration_ms)),
      total_duration_ms: analyticsNumber(totals?.total_duration_ms),
      story_views: analyticsNumber(totals?.story_views),
      event_count: analyticsNumber(totals?.event_count)
    },
    byCountry,
    byCity,
    byDevice,
    byBrowser,
    byOS,
    referrers,
    daily,
    latest
  };
}

/*
  The Behavior dashboard runs twelve aggregation / timeline queries per load.
  Repeating those large scans on every refresh can exhaust the shared D1 free
  plan read quota (including the independent login D1 database).

  Only callers already authorized by /admin/behavior's Bearer-token check may
  access this cache. No public endpoint exposes it. Since v31.22.4 the report
  snapshot itself MAY also be stored in a private D1 cache table, after that
  table is installed. No auth credentials or session cookies are cached.
  Raw /track events and feedback edits remain immediate and uncached.
*/
const ANALYTICS_ADMIN_BEHAVIOR_CACHE_VERSION = "31.23.0";
const ANALYTICS_ADMIN_BEHAVIOR_MEMORY = new Map();
const ANALYTICS_ADMIN_BEHAVIOR_INFLIGHT = new Map();

function analyticsAdminBehaviorCacheTtl(rangeKey) {
  if (rangeKey === "24h") return 10 * 60 * 1000;
  if (rangeKey === "all") return 2 * 60 * 60 * 1000;
  return 30 * 60 * 1000;
}

/*
  V31.22.4: durable, private, precomputed Behavior report snapshots in D1.
  The region-local Cache API and isolate memory remain the first two layers.
  On a regional cold start we read ONE indexed snapshot row, not twelve large
  event aggregations. A snapshot is created only after an authorized request
  finishes its existing behaviorSummary() calculations.

  This improves cache-miss cost across isolates and Cloudflare regions; it
  does NOT make the first/expired calculation cheap and is NOT a replacement
  for per-event rollups at very high traffic. One write per *new report*, not
  per tracked event. Raw events, Flüsh's JSON shape, ad shadow and feedback
  CRUD are untouched.
*/
const ANALYTICS_BEHAVIOR_REPORT_SNAPSHOT_SCHEMA = `
CREATE TABLE IF NOT EXISTS analytics_behavior_report_cache_v2 (
  cache_key TEXT PRIMARY KEY,
  generated_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  snapshot_json TEXT NOT NULL
);
`;

function analyticsBehaviorSnapshotEnabled(env) {
  return String(env.ANALYTICS_V2_BEHAVIOR_REPORT_CACHE || "").toLowerCase() !== "off";
}

async function analyticsBehaviorSnapshotRead(env, key, range, ttlMs) {
  if (!analyticsBehaviorSnapshotEnabled(env) || !env.BEHAVIOR_DB) return null;
  const now = Date.now();
  try {
    const row = await env.BEHAVIOR_DB.prepare(`
      SELECT generated_at, expires_at, snapshot_json
      FROM analytics_behavior_report_cache_v2
      WHERE cache_key=? AND expires_at>?
    `).bind(key, now).first();
    if (!row) return null;
    const generatedAt = Number(row.generated_at), expiresAt = Number(row.expires_at);
    // Reject invalid/old/future snapshots and never extend their TTL.
    if (!Number.isFinite(generatedAt) || !Number.isFinite(expiresAt) ||
        generatedAt > now + 60000 || generatedAt + ttlMs < now ||
        expiresAt > generatedAt + ttlMs || expiresAt <= now) return null;
    const data = JSON.parse(row.snapshot_json);
    if (data?.ok !== true || data.range !== range ||
        Number(data.generatedAt) !== generatedAt) return null;
    return {data, expiresAt};
  } catch (error) {
    // Worker-first deployment: missing table must never break old Behavior.
    console.warn("Analytics Behavior durable snapshot read unavailable:",
      String(error?.message || error));
    return null;
  }
}

async function analyticsBehaviorSnapshotWrite(env, key, data, ttlMs) {
  if (!analyticsBehaviorSnapshotEnabled(env) || !env.BEHAVIOR_DB) return;
  try {
    const payload = JSON.stringify(data);
    // Keep an excessively large report out of a single SQLite TEXT cell.
    if (payload.length > 900000) {
      console.warn("Analytics Behavior snapshot exceeds durable cache size limit");
      return;
    }
    const generatedAt = Number(data.generatedAt);
    if (!Number.isSafeInteger(generatedAt)) return;
    await env.BEHAVIOR_DB.prepare(`
      INSERT INTO analytics_behavior_report_cache_v2
        (cache_key, generated_at, expires_at, snapshot_json)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(cache_key) DO UPDATE SET
        generated_at=excluded.generated_at,
        expires_at=excluded.expires_at,
        snapshot_json=excluded.snapshot_json
      WHERE analytics_behavior_report_cache_v2.generated_at <= excluded.generated_at
    `).bind(key, generatedAt, generatedAt + ttlMs, payload).run();
  } catch (error) {
    console.warn("Analytics Behavior durable snapshot write unavailable:",
      String(error?.message || error));
  }
}

/* ========================================================================
   FLÖW Behavior v3, resumable immutable hourly rollups.
   Raw behavior_events stays authoritative. The interval planner never mixes
   incomplete summaries with raw data; it falls back on v31.22.4 otherwise.
   ======================================================================== */
const BEHAVIOR_V3_HOUR = 3600000;
const BEHAVIOR_V3_BATCH = 1000;
const BEHAVIOR_V3_MAX_EVENTS_PER_HOUR = 12000;
const BEHAVIOR_V3_MAX_JSON_SIZE = 950000;
const BEHAVIOR_V3_RECENT_RAW_HOURS = 2;
let behaviorV3SetupPromise = null;
let behaviorV3SetupRetryAt = 0;
let behaviorV3LastMaintenanceAttempt = 0;

function behaviorV3Enabled(env) {
  return String(env.ANALYTICS_V3_BEHAVIOR_ROLLUP || "").toLowerCase() !== "off";
}

async function behaviorV3Setup(env) {
  if (!behaviorV3Enabled(env) || !env.BEHAVIOR_DB) return false;
  if (behaviorV3SetupRetryAt > Date.now()) return false;
  if (!behaviorV3SetupPromise) {
    behaviorV3SetupPromise = (async () => {
      await env.BEHAVIOR_DB.prepare(`
        CREATE TABLE IF NOT EXISTS analytics_behavior_hourly_v3 (
          hour_start INTEGER PRIMARY KEY,
          built_at INTEGER NOT NULL,
          event_count INTEGER NOT NULL,
          summary_json TEXT NOT NULL
        )
      `).run();
      await env.BEHAVIOR_DB.prepare(`
        CREATE TABLE IF NOT EXISTS analytics_behavior_v3_maintenance (
          id INTEGER PRIMARY KEY CHECK (id=1),
          lease_until INTEGER NOT NULL,
          lease_owner TEXT NOT NULL
        )
      `).run();
      // SQLite trigger fires only on LATE arrivals. On-time /track events
      // retain the exact previous write count: no per-event summary UPSERT.
      await env.BEHAVIOR_DB.prepare(`
        CREATE TRIGGER IF NOT EXISTS analytics_behavior_v3_late_event
        AFTER INSERT ON behavior_events
        WHEN NEW.occurred_at < CAST((unixepoch('now') * 1000 - 2 * 3600000) / 3600000 AS INTEGER) * 3600000
        BEGIN
          DELETE FROM analytics_behavior_hourly_v3
          WHERE hour_start = CAST(NEW.occurred_at / 3600000 AS INTEGER) * 3600000;
        END
      `).run();
      // Administrative retention/pruning must not leave phantom counts.
      await env.BEHAVIOR_DB.prepare(`
        CREATE TRIGGER IF NOT EXISTS analytics_behavior_v3_deleted_event
        AFTER DELETE ON behavior_events
        BEGIN
          DELETE FROM analytics_behavior_hourly_v3
          WHERE hour_start = CAST(OLD.occurred_at / 3600000 AS INTEGER) * 3600000;
        END
      `).run();
      return true;
    })().catch(error => {
      behaviorV3SetupPromise = null;
      behaviorV3SetupRetryAt = Date.now() + 120000;
      console.warn('Behavior v3 setup unavailable:', String(error?.message || error));
      return false;
    });
  }
  return behaviorV3SetupPromise;
}

function behaviorV3Empty() {
  return {
    events: 0, types: Object.create(null), visitors: [], sessions: [],
    keywords: Object.create(null), sources: Object.create(null), categories: Object.create(null), filters: Object.create(null),
    auto: {pauses:0,resumes:0,total:0,avgSum:0,avgCount:0,users:[]},
    rss: {adds:0,addFailures:0,removes:0,storyViews:0,dwellSum:0,dwellCount:0,failures:Object.create(null),states:Object.create(null)},
    daily:Object.create(null)
  };
}
function behaviorV3Increment(dict, key, amount=1) {
  const k = String(key ?? '');
  dict[k] = (dict[k] || 0) + amount;
}
function behaviorV3AddEvent(a, e) {
  a.events++;
  behaviorV3Increment(a.types, e.event_type);
  if (e.visitor_id != null) a.visitors.push(String(e.visitor_id));
  if (e.session_id != null) a.sessions.push(String(e.session_id));
  const keyword = String(e.keyword_text || '');
  if (keyword) behaviorV3Increment(a.keywords, JSON.stringify([keyword, e.mode ?? null]));
  if (e.source != null && e.source !== '') behaviorV3Increment(a.sources, e.source);
  if (e.category != null && e.category !== '') behaviorV3Increment(a.categories, e.category);
  const type = String(e.event_type);
  const visitor = String(e.visitor_id ?? '');
  const value = Number(e.value_num) || 0;
  const label = String(e.value_text || '');
  if ((type === 'source_filter_open' || type === 'source_filter_close') && label) {
    const f = a.filters[label] ||= {opens:0,users:[],durationSum:0,durationCount:0,storyViews:0};
    if (type === 'source_filter_open') {f.opens++; if(e.visitor_id != null)f.users.push(visitor);}
    if (type === 'source_filter_close') {
      if (value > 0) {f.durationSum += value;f.durationCount++;}
      try {
        const stories = JSON.parse(e.meta_json || '{}')?.stories_viewed;
        const val = Number(stories);
        if (Number.isFinite(val)) f.storyViews += Math.trunc(val);
      } catch {}
    }
  }
  if (type === 'auto_advance_pause') {a.auto.pauses++;if(e.visitor_id != null)a.auto.users.push(visitor);}
  if (type === 'auto_advance_resume') a.auto.resumes++;
  if (type === 'auto_advance_resume' || type === 'auto_advance_pause_end') {
    a.auto.total += value;
    if (value > 0) {a.auto.avgSum += value;a.auto.avgCount++;}
  }
  if (type === 'custom_rss_add') a.rss.adds++;
  if (type === 'custom_rss_add_failed') {a.rss.addFailures++;behaviorV3Increment(a.rss.failures,e.mode);}
  if (type === 'custom_rss_remove') a.rss.removes++;
  if (type === 'custom_rss_story_view') a.rss.storyViews++;
  if (type === 'custom_rss_story_leave' && value > 0) {a.rss.dwellSum+=value;a.rss.dwellCount++;}
  if (['custom_rss_state','custom_rss_add','custom_rss_remove'].includes(type)) {
    const at = Number(e.occurred_at), id = String(e.event_id);
    const prior = a.rss.states[visitor];
    if (!prior || at > prior[0] || (at === prior[0] && id > prior[1])) {
      a.rss.states[visitor] = [at, id, value];
    }
  }
  const day = new Date(Number(e.occurred_at)).toISOString().slice(0,10);
  behaviorV3Increment(a.daily,day);
}
function behaviorV3Unique(arr) {return [...new Set(arr)];}
function behaviorV3Seal(a) {
  a.visitors = behaviorV3Unique(a.visitors);
  a.sessions = behaviorV3Unique(a.sessions);
  a.auto.users = behaviorV3Unique(a.auto.users);
  for (const f of Object.values(a.filters)) f.users = behaviorV3Unique(f.users);
  return a;
}
function behaviorV3Merge(to, from) {
  to.events += from.events;
  for (const field of ['types','keywords','sources','categories','daily']) {
    for (const [key,n] of Object.entries(from[field])) behaviorV3Increment(to[field],key,n);
  }
  to.visitors.push(...from.visitors);
  to.sessions.push(...from.sessions);
  const a=to.auto,b=from.auto;
  for(const k of ['pauses','resumes','total','avgSum','avgCount']) a[k]+=b[k];
  a.users.push(...b.users);
  for(const [label,f] of Object.entries(from.filters)) {
    const dst=to.filters[label] ||= {opens:0,users:[],durationSum:0,durationCount:0,storyViews:0};
    dst.opens+=f.opens;dst.users.push(...f.users);dst.durationSum+=f.durationSum;
    dst.durationCount+=f.durationCount;dst.storyViews+=f.storyViews;
  }
  const r=to.rss,s=from.rss;
  for(const k of ['adds','addFailures','removes','storyViews','dwellSum','dwellCount'])r[k]+=s[k];
  for(const [key,n] of Object.entries(s.failures))behaviorV3Increment(r.failures,key,n);
  for(const [key,state] of Object.entries(s.states)) {
    const prior=r.states[key];
    if(!prior || state[0]>prior[0] || (state[0]===prior[0] && state[1]>prior[1]))r.states[key]=state;
  }
  return to;
}
function behaviorV3Top(dict,limit,labelKey='label') {
  return Object.entries(dict).map(([label,count])=>({[labelKey]:label,count}))
    .sort((a,b)=>b.count-a.count || String(a[labelKey]).localeCompare(String(b[labelKey])))
    .slice(0,limit);
}
function behaviorV3Report(a, rangeKey, now) {
  const range=analyticsRange(rangeKey);
  const eventTypes=behaviorV3Top(a.types,80);
  const keywords=Object.entries(a.keywords).map(([key,count])=>{
    const [keyword,mode]=JSON.parse(key);return {keyword,mode,count};
  }).sort((x,y)=>y.count-x.count || x.keyword.localeCompare(y.keyword)).slice(0,100);
  const sourceFilters=Object.entries(a.filters).map(([label,f])=>({
    label,opens:f.opens,visitors:new Set(f.users).size,
    avg_duration_ms:Math.round(f.durationCount?f.durationSum/f.durationCount:0),story_views:f.storyViews
  })).sort((x,y)=>y.opens-x.opens || y.story_views-x.story_views || x.label.localeCompare(y.label)).slice(0,40);
  const states=Object.values(a.rss.states).filter(v=>v[2]>0);
  const attempts=a.rss.adds+a.rss.addFailures;
  return {
    ok:true,range:range.key,label:range.label,generatedAt:now,
    totals:{events:a.events,sessions:new Set(a.sessions).size,visitors:new Set(a.visitors).size},
    eventTypes,keywords,sources:behaviorV3Top(a.sources,40),categories:behaviorV3Top(a.categories,40),
    sourceFilters,
    autoAdvance:{pauses:a.auto.pauses,resumes:a.auto.resumes,users:new Set(a.auto.users).size,
      total_pause_ms:Math.round(a.auto.total),avg_pause_ms:Math.round(a.auto.avgCount?a.auto.avgSum/a.auto.avgCount:0)},
    customRss:{configured_visitors:states.length,
      avg_feed_count:Math.round((states.length?states.reduce((s,v)=>s+v[2],0)/states.length:0)*10)/10,
      adds:a.rss.adds,add_failures:a.rss.addFailures,
      add_success_rate:attempts?Math.round(a.rss.adds/attempts*1000)/10:0,
      removes:a.rss.removes,story_views:a.rss.storyViews,
      avg_dwell_ms:Math.round(a.rss.dwellCount?a.rss.dwellSum/a.rss.dwellCount:0),
      failures:behaviorV3Top(a.rss.failures,20)},
    daily:Object.entries(a.daily).sort(([x],[y])=>x.localeCompare(y)).map(([day,events])=>({day,events})),
    latest:[]
  };
}

async function behaviorV3Scan(env,start,end,cap=BEHAVIOR_V3_MAX_EVENTS_PER_HOUR) {
  const acc=behaviorV3Empty();
  let cursorTime=start-1,cursorRowid=0, highestRowid=0;
  while(true) {
    const rows=await analyticsAll(env.BEHAVIOR_DB.prepare(`
      SELECT rowid, event_id, occurred_at, visitor_id, session_id, event_type,
        source, category, keyword_text, mode, value_num, value_text, meta_json
      FROM behavior_events
      WHERE occurred_at>=? AND occurred_at<?
        AND (occurred_at>? OR (occurred_at=? AND rowid>?))
      ORDER BY occurred_at, rowid
      LIMIT ${BEHAVIOR_V3_BATCH}
    `).bind(start,end,cursorTime,cursorTime,cursorRowid));
    if(!rows.length) break;
    for(const e of rows) {
      behaviorV3AddEvent(acc,e);
      cursorTime=Number(e.occurred_at);cursorRowid=Number(e.rowid);
      highestRowid=Math.max(highestRowid,cursorRowid);
    }
    if(acc.events>cap) throw new Error('v3 scan exceeded safe bounded event count');
    if(rows.length<BEHAVIOR_V3_BATCH)break;
  }
  acc._highestRowid=highestRowid;
  return behaviorV3Seal(acc);
}
async function behaviorV3FirstHour(env) {
  const row=await env.BEHAVIOR_DB.prepare(`
    SELECT occurred_at FROM behavior_events ORDER BY occurred_at ASC LIMIT 1
  `).first();
  return row ? Math.floor(Number(row.occurred_at)/BEHAVIOR_V3_HOUR)*BEHAVIOR_V3_HOUR : null;
}

async function behaviorV3Summary(env, rangeKey) {
  if(!await behaviorV3Setup(env)) return null;
  const range=analyticsRange(rangeKey), now=Date.now(), H=BEHAVIOR_V3_HOUR;
  let first=range.key==='all' ? await behaviorV3FirstHour(env) : range.since;
  if(first==null) { // Empty database: old behavior still handles this.
    return null;
  }
  // Early partial hours are read precisely; recent mutable hours are raw.
  const fullStart=Math.ceil(first/H)*H;
  const fullEnd=Math.floor((now-BEHAVIOR_V3_RECENT_RAW_HOURS*H)/H)*H;
  const segments=[];
  if(fullStart<fullEnd) {
    const slots=await analyticsAll(env.BEHAVIOR_DB.prepare(`
      SELECT hour_start, summary_json FROM analytics_behavior_hourly_v3
      WHERE hour_start>=? AND hour_start<? ORDER BY hour_start ASC
    `).bind(fullStart,fullEnd));
    let expected=fullStart;
    for(const slot of slots) {
      if(Number(slot.hour_start)!==expected)return null;
      let summary;
      try {summary=JSON.parse(slot.summary_json);} catch{return null;}
      if(!summary || summary.overflow || !Number.isInteger(summary.events))return null;
      segments.push(summary);
      expected+=H;
    }
    if(expected!==fullEnd)return null; // Not fully built, never partial reports.
  }
  const acc=behaviorV3Empty();
  for(const slot of segments)behaviorV3Merge(acc,slot);
  // At most the first partial hour plus the two most recent hours. For tiny
  // time spans there is only one raw interval; avoid overlap/double counts.
  if(first<fullStart && fullStart<fullEnd) {
    behaviorV3Merge(acc,await behaviorV3Scan(env,first,fullStart,20000));
    behaviorV3Merge(acc,await behaviorV3Scan(env,fullEnd,9000000000000000,20000));
  } else if(first<fullEnd) {
    behaviorV3Merge(acc,await behaviorV3Scan(env,fullEnd,9000000000000000,20000));
  } else {
    behaviorV3Merge(acc,await behaviorV3Scan(env,first,9000000000000000,20000));
  }
  const out=behaviorV3Report(acc,range.key,now);
  // The private newest-events drilldown remains indexed against raw events;
  // no event metadata is dropped or silently reconstructed from aggregates.
  out.latest=await analyticsAll(env.BEHAVIOR_DB.prepare(`
      SELECT occurred_at, visitor_id, session_id, event_type, story_key,
        source, category, feed_mode, keyword_text, keyword_count,
        mode, value_num, value_text, meta_json
      FROM behavior_events
      WHERE occurred_at >= ?
      ORDER BY occurred_at DESC LIMIT 150
  `).bind(range.since));
  return out;
}

async function behaviorV3MakeHour(env,hour) {
  const now=Date.now();
  if(hour+BEHAVIOR_V3_HOUR > now-BEHAVIOR_V3_RECENT_RAW_HOURS*BEHAVIOR_V3_HOUR)return false;
  let data;
  try {data=await behaviorV3Scan(env,hour,hour+BEHAVIOR_V3_HOUR);} catch(error) {
    if(!String(error?.message||error).includes('exceeded safe bounded'))throw error;
    data={overflow:true,events:0};
  }
  const scannedMaxRowid=Number(data._highestRowid||0);
  delete data._highestRowid;
  let payload=JSON.stringify(data);
  if(new TextEncoder().encode(payload).length>BEHAVIOR_V3_MAX_JSON_SIZE) {
    // The report deliberately stays on the exact legacy SQL path for this hour.
    // Store a marker to avoid repeatedly scanning an oversized hour.
    data={overflow:true,events:0};payload=JSON.stringify(data);
  }
  // Atomic validation protects a rollup from concurrent late inserts during
  // multi-page scanning. If even one row was inserted, retry on the next pass.
  const expectedMaxRowid=scannedMaxRowid;
  if(data.overflow) {
    await env.BEHAVIOR_DB.prepare(`
      INSERT INTO analytics_behavior_hourly_v3(hour_start,built_at,event_count,summary_json)
      VALUES (?,?,?,?)
      ON CONFLICT(hour_start) DO UPDATE SET built_at=excluded.built_at,
        event_count=excluded.event_count,summary_json=excluded.summary_json
    `).bind(hour,Date.now(),-1,payload).run();
    return false;
  }
  const wrote=await env.BEHAVIOR_DB.prepare(`
    INSERT INTO analytics_behavior_hourly_v3(hour_start,built_at,event_count,summary_json)
    SELECT ?,?,?,?
    WHERE (SELECT COALESCE(MAX(rowid),0) FROM behavior_events
           WHERE occurred_at>=? AND occurred_at<?) = ?
    ON CONFLICT(hour_start) DO UPDATE SET
      built_at=excluded.built_at,event_count=excluded.event_count,
      summary_json=excluded.summary_json
  `).bind(hour,Date.now(),data.events,payload,
    hour,hour+BEHAVIOR_V3_HOUR,expectedMaxRowid).run();
  return Number(wrote?.meta?.changes || 0)>0;
}

async function behaviorV3Maintain(env) {
  if(!await behaviorV3Setup(env))return;
  const now=Date.now(),owner=crypto.randomUUID(),H=BEHAVIOR_V3_HOUR;
  const lease=await env.BEHAVIOR_DB.prepare(`
    INSERT INTO analytics_behavior_v3_maintenance(id,lease_until,lease_owner)
    VALUES (1,?,?)
    ON CONFLICT(id) DO UPDATE SET
      lease_until=excluded.lease_until,lease_owner=excluded.lease_owner
    WHERE analytics_behavior_v3_maintenance.lease_until < ?
  `).bind(now+120000,owner,now).run();
  if(Number(lease?.meta?.changes||0)===0)return;
  try {
    const cutoff=Math.floor((now-BEHAVIOR_V3_RECENT_RAW_HOURS*H)/H)*H;
    const oldest=await behaviorV3FirstHour(env);
    if(oldest==null)return;
    const priority=Math.max(oldest,Math.floor((now-7*86400000)/H)*H);
    const rows=await analyticsAll(env.BEHAVIOR_DB.prepare(`
      SELECT hour_start FROM analytics_behavior_hourly_v3
      WHERE hour_start>=? AND hour_start<?
      ORDER BY hour_start DESC
    `).bind(priority,cutoff));
    const present=new Set(rows.map(r=>Number(r.hour_start)));
    const missing=[];
    // Newest first, so the 24h report becomes cheap before the 7d report.
    for(let h=cutoff-H;h>=priority && missing.length<2;h-=H) {
      if(!present.has(h)) missing.push(h);
    }
    // Once the recent week is complete, backfill all historical hours.
    if(!missing.length && oldest<priority) {
      const ancient=await analyticsAll(env.BEHAVIOR_DB.prepare(`
        SELECT hour_start FROM analytics_behavior_hourly_v3
        WHERE hour_start>=? AND hour_start<? ORDER BY hour_start ASC
      `).bind(oldest,priority));
      const oldSet=new Set(ancient.map(r=>Number(r.hour_start)));
      for(let h=priority-H;h>=oldest && missing.length<2;h-=H) {
        if(!oldSet.has(h))missing.push(h);
      }
    }
    for(const hour of missing) {
      try {await behaviorV3MakeHour(env,hour);} catch(error) {
        console.warn('Behavior v3 hourly build skipped:',hour,String(error?.message||error));
        break;
      }
    }
  } finally {
    try {await env.BEHAVIOR_DB.prepare(`
      UPDATE analytics_behavior_v3_maintenance
      SET lease_until=0 WHERE id=1 AND lease_owner=?
    `).bind(owner).run();}catch{}
  }
}

function behaviorV3Schedule(ctx,env,force=false) {
  if(!ctx?.waitUntil || !behaviorV3Enabled(env))return;
  const now=Date.now();
  if(!force && now-behaviorV3LastMaintenanceAttempt<90000)return;
  behaviorV3LastMaintenanceAttempt=now;
  ctx.waitUntil(behaviorV3Maintain(env).catch(error=>
    console.warn('Behavior v3 maintenance unavailable:',String(error?.message||error))));
}

async function behaviorSummaryCached(env, request, ctx, rangeKey = "7d") {
  const range = analyticsRange(rangeKey).key;
  const key = `${ANALYTICS_ADMIN_BEHAVIOR_CACHE_VERSION}:private-behavior:${range}`;
  const now = Date.now();
  const ttlMs = analyticsAdminBehaviorCacheTtl(range);
  const hit = ANALYTICS_ADMIN_BEHAVIOR_MEMORY.get(key);
  if (hit && hit.until > now) return hit.data;
  if (hit) ANALYTICS_ADMIN_BEHAVIOR_MEMORY.delete(key);

  const pending = ANALYTICS_ADMIN_BEHAVIOR_INFLIGHT.get(key);
  if (pending) return pending;

  const task = (async () => {
    const publish = async (data, expiresAt) => {
      const remainingMs = Math.max(0, expiresAt - Date.now());
      if (!remainingMs) return data;
      ANALYTICS_ADMIN_BEHAVIOR_MEMORY.set(key, {
        until: Date.now() + Math.min(remainingMs, 60000), data
      });
      // Synthetic Cache API entry contains no Authorization/Cookie header.
      const response = new Response(JSON.stringify(data), {
        status: 200,
        headers: {
          "Content-Type": "application/json; charset=utf-8",
          "Cache-Control": `public, max-age=${Math.max(1,Math.floor(remainingMs/1000))}`
        }
      });
      await analyticsEdgeCachePut(request, key, response, ctx);
      return data;
    };

    // This key is generated from a fixed range enum. No token, cookie or ID.
    const cached = await analyticsEdgeCacheMatch(request, key);
    if (cached) {
      try {
        const data = await cached.json();
        if (data?.ok === true && data.range === range) {
          ANALYTICS_ADMIN_BEHAVIOR_MEMORY.set(key, {
            until: Date.now() + Math.min(ttlMs, 60000), data
          });
          return data;
        }
      } catch (error) {
        console.warn("Analytics Behavior regional cache invalid:", String(error));
      }
    }

    // Cross-region / cold-isolate cache hit: only one indexed D1 row.
    const durable = await analyticsBehaviorSnapshotRead(env, key, range, ttlMs);
    if (durable) return publish(durable.data, durable.expiresAt);

    // Behavior v3 reads complete sealed hour snapshots, plus precise recent/
    // boundary raw events. If even one hour is not built, return the proven
    // legacy report. Never show an incomplete count.
    let data = null;
    try {data = await behaviorV3Summary(env, range);} catch(error) {
      console.warn('Behavior v3 report fell back:', String(error?.message || error));
    }
    if(!data) data = await behaviorSummary(env, range);
    if (data?.ok === true) {
      const expiresAt = Number(data.generatedAt) + ttlMs;
      await analyticsBehaviorSnapshotWrite(env, key, data, ttlMs);
      await publish(data, expiresAt);
    }
    return data;
  })().finally(() => {
    ANALYTICS_ADMIN_BEHAVIOR_INFLIGHT.delete(key);
  });

  ANALYTICS_ADMIN_BEHAVIOR_INFLIGHT.set(key, task);
  return task;
}

async function behaviorSummary(env, rangeKey = "7d") {
  const range = analyticsRange(rangeKey);
  if (!env.BEHAVIOR_DB) throw new Error("BEHAVIOR_DB is not configured");

  const totals = await env.BEHAVIOR_DB.prepare(`
    SELECT
      COUNT(*) AS events,
      COUNT(DISTINCT session_id) AS sessions,
      COUNT(DISTINCT visitor_id) AS visitors
    FROM behavior_events
    WHERE occurred_at >= ?
  `).bind(range.since).first();

  const eventTypes = await analyticsAll(
    env.BEHAVIOR_DB.prepare(`
      SELECT event_type AS label, COUNT(*) AS count
      FROM behavior_events
      WHERE occurred_at >= ?
      GROUP BY event_type
      ORDER BY count DESC
      LIMIT 80
    `).bind(range.since)
  );

  const keywords = await analyticsAll(
    env.BEHAVIOR_DB.prepare(`
      SELECT
        keyword_text AS keyword,
        mode,
        COUNT(*) AS count
      FROM behavior_events
      WHERE occurred_at >= ? AND keyword_text <> ''
      GROUP BY keyword_text, mode
      ORDER BY count DESC
      LIMIT 100
    `).bind(range.since)
  );

  const sources = await analyticsAll(
    env.BEHAVIOR_DB.prepare(`
      SELECT source AS label, COUNT(*) AS count
      FROM behavior_events
      WHERE occurred_at >= ? AND source <> ''
      GROUP BY source
      ORDER BY count DESC
      LIMIT 40
    `).bind(range.since)
  );

  const categories = await analyticsAll(
    env.BEHAVIOR_DB.prepare(`
      SELECT category AS label, COUNT(*) AS count
      FROM behavior_events
      WHERE occurred_at >= ? AND category <> ''
      GROUP BY category
      ORDER BY count DESC
      LIMIT 40
    `).bind(range.since)
  );

  const sourceFilters = await analyticsAll(
    env.BEHAVIOR_DB.prepare(`
      SELECT
        value_text AS label,
        SUM(CASE WHEN event_type='source_filter_open' THEN 1 ELSE 0 END) AS opens,
        COUNT(DISTINCT CASE WHEN event_type='source_filter_open' THEN visitor_id END) AS visitors,
        AVG(CASE WHEN event_type='source_filter_close' AND value_num>0 THEN value_num END) AS avg_duration_ms,
        SUM(CASE WHEN event_type='source_filter_close' THEN
          CAST(COALESCE(json_extract(meta_json, '$.stories_viewed'), 0) AS INTEGER)
          ELSE 0 END) AS story_views
      FROM behavior_events
      WHERE occurred_at >= ?
        AND event_type IN ('source_filter_open','source_filter_close')
        AND value_text <> ''
      GROUP BY value_text
      ORDER BY opens DESC, story_views DESC
      LIMIT 40
    `).bind(range.since)
  );

  const autoAdvanceRow = await env.BEHAVIOR_DB.prepare(`
    SELECT
      SUM(CASE WHEN event_type='auto_advance_pause' THEN 1 ELSE 0 END) AS pauses,
      SUM(CASE WHEN event_type='auto_advance_resume' THEN 1 ELSE 0 END) AS resumes,
      SUM(CASE WHEN event_type IN ('auto_advance_resume','auto_advance_pause_end') THEN value_num ELSE 0 END) AS total_pause_ms,
      AVG(CASE WHEN event_type IN ('auto_advance_resume','auto_advance_pause_end') AND value_num>0 THEN value_num END) AS avg_pause_ms,
      COUNT(DISTINCT CASE WHEN event_type='auto_advance_pause' THEN visitor_id END) AS users
    FROM behavior_events
    WHERE occurred_at >= ?
      AND event_type IN ('auto_advance_pause','auto_advance_resume','auto_advance_pause_end')
  `).bind(range.since).first();

  const customRssRow = await env.BEHAVIOR_DB.prepare(`
    SELECT
      SUM(CASE WHEN event_type='custom_rss_add' THEN 1 ELSE 0 END) AS adds,
      SUM(CASE WHEN event_type='custom_rss_add_failed' THEN 1 ELSE 0 END) AS add_failures,
      SUM(CASE WHEN event_type='custom_rss_remove' THEN 1 ELSE 0 END) AS removes,
      SUM(CASE WHEN event_type='custom_rss_story_view' THEN 1 ELSE 0 END) AS story_views,
      AVG(CASE WHEN event_type='custom_rss_story_leave' AND value_num>0 THEN value_num END) AS avg_dwell_ms
    FROM behavior_events
    WHERE occurred_at >= ?
      AND event_type IN (
        'custom_rss_add','custom_rss_add_failed','custom_rss_remove',
        'custom_rss_story_view','custom_rss_story_leave'
      )
  `).bind(range.since).first();

  const customRssStateRow = await env.BEHAVIOR_DB.prepare(`
    WITH ranked AS (
      SELECT
        visitor_id,
        value_num,
        ROW_NUMBER() OVER (
          PARTITION BY visitor_id
          ORDER BY occurred_at DESC, event_id DESC
        ) AS rn
      FROM behavior_events
      WHERE occurred_at >= ?
        AND event_type IN ('custom_rss_state','custom_rss_add','custom_rss_remove')
    )
    SELECT
      SUM(CASE WHEN rn=1 AND value_num>0 THEN 1 ELSE 0 END) AS configured_visitors,
      AVG(CASE WHEN rn=1 AND value_num>0 THEN value_num END) AS avg_feed_count
    FROM ranked
  `).bind(range.since).first();

  const customRssFailures = await analyticsAll(
    env.BEHAVIOR_DB.prepare(`
      SELECT mode AS label, COUNT(*) AS count
      FROM behavior_events
      WHERE occurred_at >= ?
        AND event_type='custom_rss_add_failed'
      GROUP BY mode
      ORDER BY count DESC
      LIMIT 20
    `).bind(range.since)
  );

  const daily = await analyticsAll(
    env.BEHAVIOR_DB.prepare(`
      SELECT
        date(occurred_at/1000, 'unixepoch') AS day,
        COUNT(*) AS events
      FROM behavior_events
      WHERE occurred_at >= ?
      GROUP BY day
      ORDER BY day ASC
    `).bind(range.since)
  );

  const latest = await analyticsAll(
    env.BEHAVIOR_DB.prepare(`
      SELECT
        occurred_at, visitor_id, session_id, event_type, story_key,
        source, category, feed_mode, keyword_text, keyword_count,
        mode, value_num, value_text, meta_json
      FROM behavior_events
      WHERE occurred_at >= ?
      ORDER BY occurred_at DESC
      LIMIT 150
    `).bind(range.since)
  );

  const customAdds = analyticsNumber(customRssRow?.adds);
  const customFailures = analyticsNumber(customRssRow?.add_failures);
  const customAttempts = customAdds + customFailures;

  return {
    ok: true,
    range: range.key,
    label: range.label,
    generatedAt: Date.now(),
    totals: {
      events: analyticsNumber(totals?.events),
      sessions: analyticsNumber(totals?.sessions),
      visitors: analyticsNumber(totals?.visitors)
    },
    eventTypes,
    keywords,
    sources,
    categories,
    sourceFilters: sourceFilters.map(row => ({
      label: String(row.label || ""),
      opens: analyticsNumber(row.opens),
      visitors: analyticsNumber(row.visitors),
      avg_duration_ms: Math.round(analyticsNumber(row.avg_duration_ms)),
      story_views: analyticsNumber(row.story_views)
    })),
    autoAdvance: {
      pauses: analyticsNumber(autoAdvanceRow?.pauses),
      resumes: analyticsNumber(autoAdvanceRow?.resumes),
      users: analyticsNumber(autoAdvanceRow?.users),
      total_pause_ms: Math.round(analyticsNumber(autoAdvanceRow?.total_pause_ms)),
      avg_pause_ms: Math.round(analyticsNumber(autoAdvanceRow?.avg_pause_ms))
    },
    customRss: {
      configured_visitors: analyticsNumber(customRssStateRow?.configured_visitors),
      avg_feed_count: Math.round(analyticsNumber(customRssStateRow?.avg_feed_count) * 10) / 10,
      adds: customAdds,
      add_failures: customFailures,
      add_success_rate: customAttempts ? Math.round((customAdds / customAttempts) * 1000) / 10 : 0,
      removes: analyticsNumber(customRssRow?.removes),
      story_views: analyticsNumber(customRssRow?.story_views),
      avg_dwell_ms: Math.round(analyticsNumber(customRssRow?.avg_dwell_ms)),
      failures: customRssFailures
    },
    daily,
    latest
  };
}


async function feedbackAdminPage(env, cursor = "", limitValue = 250) {
  if (!env.BEHAVIOR_DB) throw new Error("BEHAVIOR_DB is not configured");

  const limit = Math.max(1, Math.min(500, Number(limitValue) || 250));
  let cursorTime = 0;
  let cursorId = "";

  if (cursor) {
    try {
      const normalized = String(cursor).replace(/-/g, "+").replace(/_/g, "/");
      const padded = normalized + "=".repeat((4 - normalized.length % 4) % 4);
      const decoded = JSON.parse(atob(padded));
      cursorTime = analyticsNumber(decoded?.t);
      cursorId = clipAnalytics(decoded?.id || "", 160);
    } catch {}
  }

  let statement;
  if (cursorTime && cursorId) {
    statement = env.BEHAVIOR_DB.prepare(`
      SELECT
        event_id, occurred_at, visitor_id, session_id, event_type, story_key,
        source, category, feed_mode, keyword_text, keyword_count,
        mode, value_num, value_text, meta_json
      FROM behavior_events
      WHERE event_type='feedback_submit'
        AND (occurred_at < ? OR (occurred_at = ? AND event_id < ?))
      ORDER BY occurred_at DESC, event_id DESC
      LIMIT ?
    `).bind(cursorTime, cursorTime, cursorId, limit);
  } else {
    statement = env.BEHAVIOR_DB.prepare(`
      SELECT
        event_id, occurred_at, visitor_id, session_id, event_type, story_key,
        source, category, feed_mode, keyword_text, keyword_count,
        mode, value_num, value_text, meta_json
      FROM behavior_events
      WHERE event_type='feedback_submit'
      ORDER BY occurred_at DESC, event_id DESC
      LIMIT ?
    `).bind(limit);
  }

  const items = await analyticsAll(statement);
  const totalRow = await env.BEHAVIOR_DB.prepare(`
    SELECT COUNT(*) AS count
    FROM behavior_events
    WHERE event_type='feedback_submit'
  `).first();

  let nextCursor = "";
  if (items.length === limit) {
    const last = items[items.length - 1];
    const raw = JSON.stringify({
      t: analyticsNumber(last?.occurred_at),
      id: clipAnalytics(last?.event_id || "", 160)
    });
    nextCursor = btoa(raw).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
  }

  return {
    ok: true,
    total: analyticsNumber(totalRow?.count),
    items,
    nextCursor
  };
}

async function deleteFeedbackReport(env, eventId) {
  if (!env.BEHAVIOR_DB) throw new Error("BEHAVIOR_DB is not configured");
  const id = clipAnalytics(eventId || "", 160);
  if (!id) throw new Error("Missing feedback id");

  const result = await env.BEHAVIOR_DB.prepare(`
    DELETE FROM behavior_events
    WHERE event_id = ? AND event_type='feedback_submit'
  `).bind(id).run();

  return {
    ok: true,
    deleted: analyticsNumber(result?.meta?.changes)
  };
}

function adRate(numerator, denominator) {
  const n = Math.max(0, analyticsNumber(numerator));
  const d = Math.max(0, analyticsNumber(denominator));
  if (!d) return 0;
  return Math.round((n / d) * 1000) / 10;
}

function normalizeAdSummaryRow(row = {}) {
  const views = analyticsNumber(row.views);
  const viewers = analyticsNumber(row.viewers);
  const skips = analyticsNumber(row.skips);
  const completes = analyticsNumber(row.completes);
  const returners = analyticsNumber(row.returners);
  const repeatViews = analyticsNumber(row.repeat_views);

  return {
    ad_id: String(row.ad_id || ""),
    title: String(row.title || ""),
    category: String(row.category || ""),
    brand: String(row.brand || ""),
    campaign: String(row.campaign || ""),
    creative: String(row.creative || ""),
    filename: String(row.filename || ""),
    media_type: String(row.media_type || ""),
    views,
    viewers,
    skips,
    completes,
    returns: analyticsNumber(row.returns),
    returners,
    repeat_views: repeatViews,
    avg_dwell_ms: Math.round(analyticsNumber(row.avg_dwell_ms)),
    skip_rate: adRate(skips, views),
    completion_rate: adRate(completes, views),
    return_rate: adRate(returners, viewers),
    repeat_rate: adRate(repeatViews, views)
  };
}

const AD_CATEGORY_LABELS = Object.freeze({
  G: "GIDA", Y: "BANKA, FİNANS, PARA, KRİPTO", O: "OTOMOTİV, MOTOSİKLET, YEDEK PARÇA",
  T: "TEKSTİL, GİYİM, MODA, KUMAŞ", M: "ALIŞVERİŞ, AVM, MARKET, EVE SİPARİŞ",
  S: "SANAYİ, ÜRETİM, FABRİKA, MADENCİLİK", F: "AKARYAKIT, MADENİ YAĞ, PERFORMANS KATKISI",
  E: "İLAÇ, VİTAMİN, TAKVİYE, MEDİKAL", H: "HASTANE, KLİNİK, SAĞLIK KURULUŞU",
  J: "TEKNOLOJİ, TEKNOMAĞAZA, ELEKTRONİK CİHAZ, TELEFON, TABLET, BİLGİSAYAR, TELEVİZYON",
  Z: "BEYAZ EŞYA, MUTFAK İHTİYAÇLARI, KÜÇÜK EV ALETLERİ, ZÜCCACİYE",
  D: "MUTFAK, BANYO, EV DEKORASYONU, MOBİLYA, BOYA, DIŞ CEPHE, HIRDAVAT",
  K: "KİŞİSEL BAKIM, ŞAMPUAN, DEODORANT, PARFÜM, TUVALET KAĞIDI, ISLAK MENDİL",
  U: "KOZMETİK, MAKYAJ, MANİKÜR, PEDİKÜR, GÜZELLİK",
  R: "MEKAN, RESTORAN, BAR, PUB, KAFE", I: "İNTERNET SİTESİ, TELEFON UYGULAMASI, YAZILIM, OYUN",
  Q: "MÜZİK STREAMING PLATFORMLARI, DİZİ/FİLM PLATFORMLARI",
  P: "SİNEMA, TİYATRO, FESTİVAL, ETKİNLİK", W: "MÜZİK, SANATÇI, YENİ ÇIKAN, KONSER, ALBÜM, PLAK",
  X: "DİĞER SEKTÖRLER", A: "FLÖW DUYURULARI"
});

function adCategoryLabel(value) {
  const code = String(value || "").trim();
  return AD_CATEGORY_LABELS[code.toUpperCase()] || code;
}

async function adCenterMetadataMap(env) {
  const secret = String(env.AD_CENTER_SYNC_SECRET || "");
  if (!secret) return new Map();

  const base = String(
    env.AD_CENTER_API_URL ||
    "https://floew-ad-center.thefloewback.workers.dev"
  ).replace(/\/$/, "");
  const url = `${base}/api/internal/analytics-ads`;

  try {
    const request = new Request(url, {
      method: "GET",
      headers: {
        "Authorization": `Bearer ${secret}`,
        "Accept": "application/json"
      }
    });
    // A Cloudflare Service Binding bypasses the public workers.dev route.
    // Keep the external URL as a fallback for deployments without a binding.
    const response = env.AD_CENTER_SERVICE
      ? await env.AD_CENTER_SERVICE.fetch(request)
      : await fetch(request);
    if (!response.ok) {
      console.warn("Ad Center metadata request failed:", response.status,
        env.AD_CENTER_SERVICE ? "service-binding" : "external-fetch");
      return new Map();
    }
    const data = await response.json();
    if (!Array.isArray(data.ads)) {
      console.warn("Ad Center metadata response missing ads array");
      return new Map();
    }
    return new Map(data.ads.map(ad => [String(ad.id || ""), ad]));
  } catch (error) {
    console.warn("Ad Center metadata unavailable:", String(error?.message || error));
    return new Map();
  }
}

function enrichAdSummary(summary, metadata) {
  const ad = metadata.get(String(summary.ad_id || ""));
  if (!ad) {
    return {
      ...summary,
      category: adCategoryLabel(summary.category),
      ad_start_date: "",
      ad_end_date: "",
      ad_active: null,
      ad_live: null,
      ad_duration_days: null,
      ad_status: "Bilgi yok"
    };
  }

  const start = String(ad.start_date || "");
  const end = String(ad.end_date || "");
  let durationDays = null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(start) && /^\d{4}-\d{2}-\d{2}$/.test(end)) {
    const startMs = Date.parse(`${start}T00:00:00Z`);
    const endMs = Date.parse(`${end}T00:00:00Z`);
    if (Number.isFinite(startMs) && Number.isFinite(endMs) && endMs >= startMs) {
      durationDays = Math.floor((endMs - startMs) / 86400000) + 1;
    }
  }

  const active = ad.active === true || Number(ad.is_enabled) === 1;
  const live = ad.live === true;
  return {
    ...summary,
    category: adCategoryLabel(ad.category || summary.category),
    ad_start_date: start,
    ad_end_date: end,
    ad_active: active,
    ad_live: live,
    ad_duration_days: durationDays,
    ad_status: live ? "Aktif · Yayında" : active ? "Aktif · Yayın dışında" : "Pasif"
  };
}

async function enrichAdSummaries(rows, env) {
  const metadata = await adCenterMetadataMap(env);
  return (rows || []).map(row => enrichAdSummary(row, metadata));
}

const SOURCE_REPORT_CACHE = new Map();

async function sourceStatsReport(env, rangeKey="7d") {
  const range=analyticsRange(rangeKey);
  if(!env.CONTENT_DB||!env.BEHAVIOR_DB)throw Error("CONTENT_DB and BEHAVIOR_DB are required");
  // Daily content summaries are complete only after the 7-day backfill.
  // All-time and 24h must read the precise raw events.
  const daily=range.key==="7d"&&await analyticsDailyReady(env.CONTENT_DB);
  const sourceWhere="source IS NOT NULL AND TRIM(source)<>'' AND story_key<>''";
  const aggregate=daily
    ? `SELECT source,
         COUNT(DISTINCT CASE WHEN views>0 THEN story_key END) AS stories,
         SUM(views) AS views,
         SUM(dwell_sum_ms) AS dwell_sum_ms,
         SUM(dwell_count) AS dwell_count
       FROM content_daily WHERE day>=? AND ${sourceWhere}
       GROUP BY source`
    : `SELECT source,
         COUNT(DISTINCT CASE WHEN event_type='story_view' THEN story_key END) AS stories,
         SUM(CASE WHEN event_type='story_view' THEN 1 ELSE 0 END) AS views,
         SUM(CASE WHEN event_type='story_leave' AND dwell_ms>0 THEN dwell_ms ELSE 0 END) AS dwell_sum_ms,
         SUM(CASE WHEN event_type='story_leave' AND dwell_ms>0 THEN 1 ELSE 0 END) AS dwell_count
       FROM content_events WHERE occurred_at>=? AND ${sourceWhere}
       GROUP BY source`;
  const aggregateSince=daily?analyticsUtcDayStart(range.since):range.since;
  const [content,reach,devices]=await Promise.all([
    analyticsAll(env.CONTENT_DB.prepare(aggregate).bind(aggregateSince)),
    analyticsAll(env.BEHAVIOR_DB.prepare(`
      SELECT source,
        COUNT(DISTINCT CASE WHEN event_type='story_view' THEN NULLIF(visitor_id,'') END) AS visitors,
        SUM(CASE WHEN event_type='story_share' THEN 1 ELSE 0 END) AS shares,
        SUM(CASE WHEN event_type='story_view' THEN 1 ELSE 0 END) AS tracked_views
      FROM behavior_events
      WHERE occurred_at>=? AND source IS NOT NULL AND TRIM(source)<>''
        AND event_type IN ('story_view','story_share')
      GROUP BY source
    `).bind(range.since)),
    analyticsAll(env.BEHAVIOR_DB.prepare(`
      SELECT source,
        COALESCE(NULLIF(json_extract(meta_json,'$.analytics_device_type'),''),'Bilinmiyor') AS device,
        COALESCE(NULLIF(json_extract(meta_json,'$.analytics_browser'),''),'Bilinmiyor') AS browser,
        COUNT(*) AS views
      FROM behavior_events
      WHERE occurred_at>=? AND source IS NOT NULL AND TRIM(source)<>''
        AND event_type='story_view'
      GROUP BY source,device,browser
    `).bind(range.since))
  ]);
  const sourceMap=new Map();
  function entry(name){
    name=String(name||"").trim();
    if(!name)return null;
    if(!sourceMap.has(name))sourceMap.set(name,{
      source:name,stories:0,views:0,visitors:0,shares:0,dwell_sum_ms:0,
      avg_user_dwell_ms:0,avg_flora:null,flora_story_count:0,
      flora_sampled:false,devices:[],browsers:[],age:[],gender:[],
      demographic_status:"Kaynak bazlı GA4 ölçümü henüz mevcut değil."
    });
    return sourceMap.get(name);
  }
  for(const r of content){
    const x=entry(r.source);if(!x)continue;
    x.stories=Number(r.stories)||0;x.views=Number(r.views)||0;
    x.dwell_sum_ms=Number(r.dwell_sum_ms)||0;
  }
  for(const r of reach){
    const x=entry(r.source);if(!x)continue;
    x.visitors=Number(r.visitors)||0;x.shares=Number(r.shares)||0;
  }
  const dist=new Map();
  for(const r of devices){
    const x=entry(r.source);if(!x)continue;
    if(!dist.has(x.source))dist.set(x.source,{devices:new Map(),browsers:new Map()});
    const d=dist.get(x.source),v=Number(r.views)||0;
    d.devices.set(r.device,(d.devices.get(r.device)||0)+v);
    d.browsers.set(r.browser,(d.browsers.get(r.browser)||0)+v);
  }
  for(const [name,d] of dist){
    const x=entry(name);
    x.devices=[...d.devices].map(([label,views])=>({label,views})).sort((a,b)=>b.views-a.views);
    x.browsers=[...d.browsers].map(([label,views])=>({label,views})).sort((a,b)=>b.views-a.views);
  }
  // Flöra averages are per distinct story, never weighted by visits.
  // A finite cap bounds Worker memory for extremely large all-time datasets.
  const floraLimit=20001;
  const floraSql=daily
    ? `SELECT source,story_key,SUM(views) AS views,
      CAST(SUM(dwell_sum_ms) AS REAL)/NULLIF(SUM(dwell_count),0) AS avg_dwell_ms,
      CAST(SUM(target_sum_ms) AS REAL)/NULLIF(SUM(target_count),0) AS avg_target_ms,
      SUM(completes) AS completes,SUM(skips) AS skips,SUM(backs) AS backs,
      SUM(source_opens) AS source_opens
      FROM content_daily WHERE day>=? AND ${sourceWhere}
      GROUP BY source,story_key HAVING SUM(views)>0
      ORDER BY views DESC LIMIT ${floraLimit}`
    : `SELECT source,story_key,
      SUM(CASE WHEN event_type='story_view' THEN 1 ELSE 0 END) AS views,
      AVG(CASE WHEN event_type='story_leave' AND dwell_ms>0 THEN dwell_ms END) AS avg_dwell_ms,
      AVG(CASE WHEN event_type='story_leave' AND target_ms>0 THEN target_ms END) AS avg_target_ms,
      SUM(CASE WHEN event_type='story_leave' AND completed=1 THEN 1 ELSE 0 END) AS completes,
      SUM(CASE WHEN event_type='story_leave' AND manual_skip=1 THEN 1 ELSE 0 END) AS skips,
      SUM(CASE WHEN event_type='story_back' THEN 1 ELSE 0 END) AS backs,
      SUM(CASE WHEN event_type='source_open' THEN 1 ELSE 0 END) AS source_opens
      FROM content_events WHERE occurred_at>=? AND ${sourceWhere}
      GROUP BY source,story_key HAVING views>0
      ORDER BY views DESC LIMIT ${floraLimit}`;
  const floraRows=await analyticsAll(env.CONTENT_DB.prepare(floraSql).bind(aggregateSince));
  const floraSum=new Map();
  for(const r of floraRows.slice(0,20000)){
    const x=entry(r.source);if(!x)continue;
    const acc=floraSum.get(x.source)||{sum:0,count:0};
    acc.sum+=calculateFlora(r);acc.count++;
    floraSum.set(x.source,acc);
  }
  for(const x of sourceMap.values()){
    const a=floraSum.get(x.source);
    if(a){x.avg_flora=Math.round((a.sum/a.count)*10)/10;x.flora_story_count=a.count}
    x.flora_sampled=x.flora_story_count<x.stories;
    x.avg_user_dwell_ms=x.visitors?Math.round(x.dwell_sum_ms/x.visitors):0;
  }
  let demoAvailable=false,demoThresholded=false;
  if(ga4ReportingConfigured(env)){
    try{
      const sourceFilter={filter:{fieldName:"eventName",stringFilter:{matchType:"EXACT",value:"floew_story_view"}}};
      const fetchDemo=dimension=>ga4RunReport(env,{
        dateRanges:[ga4DateRange(range.key)],
        dimensions:[{name:"customEvent:news_source"},{name:dimension}],
        metrics:[{name:"eventCount"},{name:"totalUsers"}],
        dimensionFilter:sourceFilter,
        limit:"10000"
      });
      const [ageReport,genderReport]=await Promise.all([
        fetchDemo("userAgeBracket"),fetchDemo("userGender")
      ]);
      demoThresholded=Boolean(ageReport?.metadata?.subjectToThresholding||genderReport?.metadata?.subjectToThresholding);
      for(const [report,field,key] of [
        [ageReport,"userAgeBracket","age"],[genderReport,"userGender","gender"]
      ]){
        for(const r of ga4RowObjects(report)){
          const x=sourceMap.get(String(r["customEvent:news_source"]||"").trim());
          if(!x)continue;
          const label=String(r[field]||"unknown");
          x[key].push({label,users:Number(r.totalUsers)||0,views:Number(r.eventCount)||0});
        }
      }
      demoAvailable=true;
      for(const x of sourceMap.values()){
        x.demographic_status=x.age.length||x.gender.length
          ? "GA4 rızalı kullanıcı örneklemi; eşikleme ve eksik kapsama olabilir."
          : "GA4 üzerinde bu kaynak için raporlanabilir yaş/cinsiyet verisi yok.";
      }
    }catch(e){
      // Missing custom dimension or insufficient GA4 permissions must not
      // block the first-party D1 source report.
      demoAvailable=false;
    }
  }
  const sources=[...sourceMap.values()].filter(x=>x.views||x.shares).sort((a,b)=>b.views-a.views||a.source.localeCompare(b.source,"tr"));
  return {
    ok:true,range:range.key,label:range.label,generatedAt:Date.now(),
    granularity:daily?"UTC günlük toplamları":"Olay zaman damgası",
    sources,demographics:{available:demoAvailable,subjectToThresholding:demoThresholded},
    notes:{
      stories:"Akışta görüntülenmiş farklı haberler; henüz hiç gösterilmemiş yayınlanan haberler sayılmaz.",
      visitors:"Tekil anonim tarayıcı/cihaz tanımlayıcısıdır; gerçek kişi sayısı değildir.",
      duration:"Toplam görüntüleme süresi story_leave olaylarından; kişi başına ortalama toplam süre / tekil tanımlayıcı.",
      shares:"Paylaşım eylemi başlatma sayısıdır; platformda başarıyla yayımlandığı doğrulanmaz.",
      flora:"Görüntülenen her farklı haberin Flöra puanının eşit ağırlıklı ortalaması. Çok geniş dönemlerde örneklem sınırı gösterilir.",
      demographics:"Yalnız rıza verilmiş GA4 floew_story_view olayları ve news_source boyutuyla; veri yoksa demografi tahmin edilmez."
    }
  };
}

async function sourceStatsCached(env,rangeKey="7d") {
  const range=analyticsRange(rangeKey).key;
  const ttl=range==="all"?2*60*60*1000:range==="24h"?5*60*1000:15*60*1000;
  const key="31.24.0:private-source-report:"+range;
  const now=Date.now(),hit=SOURCE_REPORT_CACHE.get(range);
  if(hit?.result&&hit.expires>now)return hit.result;
  if(hit?.pending)return hit.pending;
  const pending=(async()=>{
    // Reuse the existing private Behavior D1 snapshot table. A cold isolate
    // must not rescan all historical events just to render the same report.
    const durable=await analyticsBehaviorSnapshotRead(env,key,range,ttl);
    if(durable){
      SOURCE_REPORT_CACHE.set(range,{result:durable.data,expires:durable.expiresAt});
      return durable.data;
    }
    const result=await sourceStatsReport(env,range);
    await analyticsBehaviorSnapshotWrite(env,key,result,ttl);
    SOURCE_REPORT_CACHE.set(range,{result,expires:result.generatedAt+ttl});
    return result;
  })().catch(e=>{SOURCE_REPORT_CACHE.delete(range);throw e});
  SOURCE_REPORT_CACHE.set(range,{pending,expires:0});
  return pending;
}

function sourceReportHtml(data,sourceName="") {
  const sources=sourceName?data.sources.filter(x=>x.source===sourceName):data.sources;
  if(sourceName&&!sources.length)return null;
  const enc=x=>htmlEscape(x);
  const value=x=>reportNumber(x);
  const duration=x=>reportDuration(x);
  const table=(title,rows,cols)=>reportTable(title,rows,cols);
  const overview=table("Kaynak karşılaştırması",sources,[
    {key:"source",label:"Kaynak"},
    {key:"stories",label:"Farklı haber",format:value},
    {key:"views",label:"Gösterim",format:value},
    {key:"visitors",label:"Tekil erişim",format:value},
    {key:"dwell_sum_ms",label:"Toplam süre",format:duration},
    {key:"avg_user_dwell_ms",label:"Kişi başına",format:duration},
    {key:"avg_flora",label:"Ort. Flöra",format:(v,r)=>v===null?"Veri yok":`${v}${r.flora_sampled?" (örnek)":""}`},
    {key:"shares",label:"Paylaşım",format:value}
  ]);
  const details=sources.map(x=>`
    <section class="source">
      <h2>${enc(x.source)}</h2>
      <div class="metrics">
        ${[
          ["Farklı haber",value(x.stories)],["Gösterim",value(x.views)],
          ["Tekil erişim",value(x.visitors)],["Toplam süre",duration(x.dwell_sum_ms)],
          ["Kişi başına süre",duration(x.avg_user_dwell_ms)],
          ["Ortalama Flöra",x.avg_flora===null?"Veri yok":String(x.avg_flora)+(x.flora_sampled?" (örneklem)":"")],
          ["Paylaşım",value(x.shares)]
        ].map(([k,v])=>`<div class="metric"><span>${enc(k)}</span><strong>${enc(v)}</strong></div>`).join("")}
      </div>
      <div class="charts">
        ${table("Cihazlar",x.devices,[{key:"label",label:"Cihaz"},{key:"views",label:"Gösterim",format:value}])}
        ${table("Tarayıcılar",x.browsers,[{key:"label",label:"Tarayıcı"},{key:"views",label:"Gösterim",format:value}])}
        ${table("Yaş",x.age,[{key:"label",label:"Yaş"},{key:"users",label:"GA4 kullanıcı",format:value}])}
        ${table("Cinsiyet",x.gender,[{key:"label",label:"Cinsiyet"},{key:"users",label:"GA4 kullanıcı",format:value}])}
      </div>
      <p class="note">${enc(x.demographic_status)}</p>
      ${x.flora_sampled?`<p class="note">Flöra örneklemi: ${value(x.flora_story_count)} / ${value(x.stories)} haber.</p>`:""}
    </section>
  `).join("");
  return `<!doctype html><html lang="tr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
    <title>${enc(sourceName||"Tüm kaynaklar")} | Flöw kaynak raporu</title>
    <style>
      *{box-sizing:border-box}body{margin:0;background:#0b1119;color:#e8f0f5;font:14px/1.5 system-ui,Arial,sans-serif}
      main{max-width:1400px;margin:auto;padding:38px 24px 70px}h1{font-size:32px;margin:10px 0}h2{margin:34px 0 18px;font-size:23px}
      p,.note{color:#a7beca}small{color:#91acbd}.metrics{display:grid;grid-template-columns:repeat(auto-fit,minmax(155px,1fr));gap:12px;margin:18px 0}
      .metric,.table-card{background:#122331;border:1px solid #2e4759;border-radius:11px;padding:16px;min-width:0}
      .metric span{display:block;font-size:11px;color:#9bb5c7}.metric strong{font-size:20px;overflow-wrap:anywhere}
      .table-card{overflow:auto}.table-card h3{margin:0 0 12px;font-size:15px}table{width:100%;border-collapse:collapse}
      th,td{padding:9px;border-bottom:1px solid #29404c;text-align:left;white-space:nowrap}th{font-size:11px;color:#9eb9c9}
      .charts{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:14px}
      .source{page-break-before:always}.source:first-of-type{page-break-before:auto}
      .note{font-size:12px;margin-top:13px}.methods{margin-top:34px;font-size:12px;line-height:1.7}
      @media(max-width:750px){.charts{grid-template-columns:1fr}main{padding:22px 14px}}
      @media print{body{background:white;color:black}.metric,.table-card{background:white;color:black;border-color:#bbb}.source{break-before:page}}
    </style></head><body><main>
    <small>FLÖW / FLÜSH ANALYTICS • ${enc(data.label)}</small>
    <h1>${enc(sourceName||"Haber kaynakları")} raporu</h1>
    <p>Oluşturulma: ${enc(new Date(data.generatedAt).toLocaleString("tr-TR",{timeZone:"Europe/Istanbul"}))} • Ölçüm: ${enc(data.granularity)}</p>
    ${overview}${details}
    <section class="methods"><h2>Ölçüm notları</h2>${Object.values(data.notes).map(n=>`<p>${enc(n)}</p>`).join("")}
    ${data.demographics.subjectToThresholding?"<p>GA4 gizlilik eşiklemesi uygulanmış olabilir.</p>":""}</section>
    </main></body></html>`;
}

async function adSummary(env, rangeKey = "7d") {
  const range = analyticsRange(rangeKey);
  if (!env.BEHAVIOR_DB) throw new Error("BEHAVIOR_DB is not configured");

  const rows = await analyticsAll(
    env.BEHAVIOR_DB.prepare(`
      SELECT
        ad_id,
        MAX(COALESCE(NULLIF(json_extract(extra_json, '$.ad_title'), ''), NULLIF(json_extract(extra_json, '$.title'), ''))) AS title,
        MAX(COALESCE(NULLIF(json_extract(extra_json, '$.ad_category'), ''), NULLIF(json_extract(extra_json, '$.category'), ''))) AS category,
        MAX(brand) AS brand,
        MAX(campaign) AS campaign,
        MAX(creative) AS creative,
        MAX(filename) AS filename,
        MAX(media_type) AS media_type,
        SUM(CASE WHEN event_type='ad_view' THEN 1 ELSE 0 END) AS views,
        COUNT(DISTINCT CASE WHEN event_type='ad_view' THEN visitor_id END) AS viewers,
        SUM(CASE WHEN event_type='ad_skip' THEN 1 ELSE 0 END) AS skips,
        SUM(CASE WHEN event_type='ad_complete' THEN 1 ELSE 0 END) AS completes,
        SUM(CASE WHEN event_type='ad_return' THEN 1 ELSE 0 END) AS returns,
        COUNT(DISTINCT CASE WHEN event_type='ad_return' THEN visitor_id END) AS returners,
        SUM(CASE WHEN event_type='ad_repeat_view' THEN 1 ELSE 0 END) AS repeat_views,
        AVG(
          CASE
            WHEN event_type IN ('ad_skip','ad_complete') AND dwell_ms > 0
            THEN dwell_ms
          END
        ) AS avg_dwell_ms
      FROM ad_events
      WHERE occurred_at >= ?
        AND ad_id <> ''
      GROUP BY ad_id
      HAVING views > 0
      ORDER BY views DESC, ad_id ASC
      LIMIT 1000
    `).bind(range.since)
  );

  const ads = rows.map(normalizeAdSummaryRow);
  const totalViews = ads.reduce((sum, row) => sum + row.views, 0);
  const totalSkips = ads.reduce((sum, row) => sum + row.skips, 0);
  const totalCompletes = ads.reduce((sum, row) => sum + row.completes, 0);
  const totalReturns = ads.reduce((sum, row) => sum + row.returns, 0);
  const totalRepeatViews = ads.reduce((sum, row) => sum + row.repeat_views, 0);

  const overall = await env.BEHAVIOR_DB.prepare(`
    SELECT
      COUNT(DISTINCT CASE WHEN event_type='ad_view' THEN visitor_id END) AS viewers,
      COUNT(DISTINCT CASE WHEN event_type='ad_return' THEN visitor_id END) AS returners,
      AVG(
        CASE
          WHEN event_type IN ('ad_skip','ad_complete') AND dwell_ms > 0
          THEN dwell_ms
        END
      ) AS avg_dwell_ms
    FROM ad_events
    WHERE occurred_at >= ?
  `).bind(range.since).first();

  return {
    ok: true,
    range: range.key,
    label: range.label,
    generatedAt: Date.now(),
    totals: {
      ads: ads.length,
      views: totalViews,
      viewers: analyticsNumber(overall?.viewers),
      skips: totalSkips,
      completes: totalCompletes,
      returns: totalReturns,
      returners: analyticsNumber(overall?.returners),
      repeat_views: totalRepeatViews,
      avg_dwell_ms: Math.round(analyticsNumber(overall?.avg_dwell_ms)),
      skip_rate: adRate(totalSkips, totalViews),
      completion_rate: adRate(totalCompletes, totalViews),
      return_rate: adRate(overall?.returners, overall?.viewers),
      repeat_rate: adRate(totalRepeatViews, totalViews)
    },
    ads
  };
}

function normalizeAdBreakdownRow(row = {}, totalViews = 0) {
  const views = analyticsNumber(row.views);
  const viewers = analyticsNumber(row.viewers);
  const skips = analyticsNumber(row.skips);
  const completes = analyticsNumber(row.completes);
  const returners = analyticsNumber(row.returners);
  const repeatViews = analyticsNumber(row.repeat_views);

  return {
    label: String(row.label ?? "Bilinmiyor"),
    views,
    viewers,
    percent: adRate(views, totalViews),
    skips,
    completes,
    returns: analyticsNumber(row.returns),
    returners,
    repeat_views: repeatViews,
    avg_dwell_ms: Math.round(analyticsNumber(row.avg_dwell_ms)),
    skip_rate: adRate(skips, views),
    completion_rate: adRate(completes, views),
    return_rate: adRate(returners, viewers),
    repeat_rate: adRate(repeatViews, views)
  };
}

async function adBreakdown(env, adId, rangeSince, field, totalViews) {
  const allowed = {
    orientation: "orientation",
    device: "device_type",
    hour: "local_hour"
  };

  const column = allowed[field];
  if (!column) throw new Error("Invalid ad breakdown");

  const rows = await analyticsAll(
    env.BEHAVIOR_DB.prepare(`
      SELECT
        CASE
          WHEN ?='local_hour' THEN printf('%02d:00', ${column})
          ELSE COALESCE(NULLIF(${column},''),'Bilinmiyor')
        END AS label,
        SUM(CASE WHEN event_type='ad_view' THEN 1 ELSE 0 END) AS views,
        COUNT(DISTINCT CASE WHEN event_type='ad_view' THEN visitor_id END) AS viewers,
        SUM(CASE WHEN event_type='ad_skip' THEN 1 ELSE 0 END) AS skips,
        SUM(CASE WHEN event_type='ad_complete' THEN 1 ELSE 0 END) AS completes,
        SUM(CASE WHEN event_type='ad_return' THEN 1 ELSE 0 END) AS returns,
        COUNT(DISTINCT CASE WHEN event_type='ad_return' THEN visitor_id END) AS returners,
        SUM(CASE WHEN event_type='ad_repeat_view' THEN 1 ELSE 0 END) AS repeat_views,
        AVG(
          CASE
            WHEN event_type IN ('ad_skip','ad_complete') AND dwell_ms > 0
            THEN dwell_ms
          END
        ) AS avg_dwell_ms
      FROM ad_events
      WHERE occurred_at >= ?
        AND ad_id = ?
        ${field === "hour" ? "AND local_hour BETWEEN 0 AND 23" : ""}
      GROUP BY ${column}
      HAVING views > 0
      ORDER BY ${field === "hour" ? `${column} ASC` : "views DESC"}
    `).bind(column, rangeSince, adId)
  );

  return rows.map(row => normalizeAdBreakdownRow(row, totalViews));
}

async function adOrientationDeviceBreakdown(
  env,
  adId,
  rangeSince,
  totalViews
) {
  const rows = await analyticsAll(
    env.BEHAVIOR_DB.prepare(`
      SELECT
        COALESCE(NULLIF(orientation,''),'Bilinmiyor') AS orientation,
        COALESCE(NULLIF(device_type,''),'Bilinmiyor') AS device,
        SUM(CASE WHEN event_type='ad_view' THEN 1 ELSE 0 END) AS views,
        COUNT(DISTINCT CASE WHEN event_type='ad_view' THEN visitor_id END) AS viewers,
        SUM(CASE WHEN event_type='ad_skip' THEN 1 ELSE 0 END) AS skips,
        SUM(CASE WHEN event_type='ad_complete' THEN 1 ELSE 0 END) AS completes,
        SUM(CASE WHEN event_type='ad_return' THEN 1 ELSE 0 END) AS returns,
        COUNT(DISTINCT CASE WHEN event_type='ad_return' THEN visitor_id END) AS returners,
        SUM(CASE WHEN event_type='ad_repeat_view' THEN 1 ELSE 0 END) AS repeat_views,
        AVG(
          CASE
            WHEN event_type IN ('ad_skip','ad_complete') AND dwell_ms > 0
            THEN dwell_ms
          END
        ) AS avg_dwell_ms
      FROM ad_events
      WHERE occurred_at >= ?
        AND ad_id = ?
      GROUP BY orientation, device_type
      HAVING views > 0
      ORDER BY views DESC, orientation ASC, device_type ASC
    `).bind(rangeSince, adId)
  );

  return rows.map(row => {
    const normalized = normalizeAdBreakdownRow(
      {
        ...row,
        label: `${row.orientation || 'Bilinmiyor'} · ${row.device || 'Bilinmiyor'}`
      },
      totalViews
    );

    return {
      ...normalized,
      orientation: String(row.orientation || "Bilinmiyor"),
      device: String(row.device || "Bilinmiyor")
    };
  });
}

let GA4_TOKEN_CACHE = {
  scope: "",
  token: "",
  expiresAt: 0
};

function ga4Config(env) {
  const propertyId = clipAnalytics(env.GA4_PROPERTY_ID || "", 80)
    .replace(/^properties\//, "");

  return {
    measurementId: clipAnalytics(env.GA4_MEASUREMENT_ID || "", 80),
    propertyId,
    clientEmail: clipAnalytics(env.GA4_CLIENT_EMAIL || "", 500),
    privateKey: String(env.GA4_PRIVATE_KEY || "")
  };
}

function ga4CollectionConfigured(env) {
  return Boolean(ga4Config(env).measurementId);
}

function ga4ReportingConfigured(env) {
  const c = ga4Config(env);
  return Boolean(c.propertyId && c.clientEmail && c.privateKey);
}

function base64UrlString(value = "") {
  const bytes = new TextEncoder().encode(String(value));
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function base64UrlBytes(bytes) {
  let binary = "";
  for (const byte of new Uint8Array(bytes)) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function pemPkcs8Bytes(pem = "") {
  const clean = String(pem || "")
    .replace(/\\n/g, "\n")
    .replace(/-----BEGIN PRIVATE KEY-----/g, "")
    .replace(/-----END PRIVATE KEY-----/g, "")
    .replace(/\s+/g, "");

  if (!clean) throw new Error("GA4_PRIVATE_KEY is empty");

  const binary = atob(clean);
  const bytes = new Uint8Array(binary.length);

  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }

  return bytes.buffer;
}

async function ga4AccessToken(env, scope) {
  const now = Math.floor(Date.now() / 1000);

  if (
    GA4_TOKEN_CACHE.token &&
    GA4_TOKEN_CACHE.scope === scope &&
    GA4_TOKEN_CACHE.expiresAt > now + 90
  ) {
    return GA4_TOKEN_CACHE.token;
  }

  const c = ga4Config(env);
  if (!c.clientEmail || !c.privateKey) {
    throw new Error("GA4 service account is not configured");
  }

  const header = base64UrlString(JSON.stringify({
    alg: "RS256",
    typ: "JWT"
  }));

  const claims = base64UrlString(JSON.stringify({
    iss: c.clientEmail,
    scope,
    aud: "https://oauth2.googleapis.com/token",
    iat: now,
    exp: now + 3600
  }));

  const unsigned = `${header}.${claims}`;

  const key = await crypto.subtle.importKey(
    "pkcs8",
    pemPkcs8Bytes(c.privateKey),
    {
      name: "RSASSA-PKCS1-v1_5",
      hash: "SHA-256"
    },
    false,
    ["sign"]
  );

  const signature = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    key,
    new TextEncoder().encode(unsigned)
  );

  const assertion = `${unsigned}.${base64UrlBytes(signature)}`;

  const response = await fetch(
    "https://oauth2.googleapis.com/token",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded"
      },
      body: new URLSearchParams({
        grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
        assertion
      })
    }
  );

  const data = await response.json().catch(() => ({}));

  if (!response.ok || !data?.access_token) {
    throw new Error(
      data?.error_description ||
      data?.error ||
      `Google OAuth HTTP ${response.status}`
    );
  }

  GA4_TOKEN_CACHE = {
    scope,
    token: data.access_token,
    expiresAt: now + Math.max(300, analyticsNumber(data.expires_in, 3600))
  };

  return GA4_TOKEN_CACHE.token;
}

async function ga4FetchJson(env, url, options = {}, scope = "https://www.googleapis.com/auth/analytics.readonly") {
  const token = await ga4AccessToken(env, scope);

  const response = await fetch(url, {
    ...options,
    headers: {
      ...(options.headers || {}),
      "Authorization": `Bearer ${token}`,
      "Content-Type": "application/json"
    }
  });

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    const message =
      data?.error?.message ||
      data?.error_description ||
      `Google Analytics HTTP ${response.status}`;
    throw new Error(message);
  }

  return data;
}

function ga4DateRange(rangeKey = "7d") {
  if (rangeKey === "all") {
    return {
      startDate: "2020-01-01",
      endDate: "today"
    };
  }

  if (rangeKey === "24h") {
    return {
      startDate: "yesterday",
      endDate: "today"
    };
  }

  return {
    startDate: "7daysAgo",
    endDate: "today"
  };
}

async function ga4RunReport(env, body) {
  const c = ga4Config(env);

  if (!ga4ReportingConfigured(env)) {
    throw new Error("GA4 reporting is not configured");
  }

  return ga4FetchJson(
    env,
    `https://analyticsdata.googleapis.com/v1beta/properties/${encodeURIComponent(c.propertyId)}:runReport`,
    {
      method: "POST",
      body: JSON.stringify(body)
    }
  );
}

function ga4RowObjects(report) {
  const dimensions = (report?.dimensionHeaders || []).map(h => h.name);
  const metrics = (report?.metricHeaders || []).map(h => h.name);

  return (report?.rows || []).map(row => {
    const out = {};

    dimensions.forEach((name, i) => {
      out[name] = row?.dimensionValues?.[i]?.value ?? "";
    });

    metrics.forEach((name, i) => {
      out[name] = analyticsNumber(row?.metricValues?.[i]?.value);
    });

    return out;
  });
}

function ga4AdFilter(adId) {
  return {
    andGroup: {
      expressions: [
        {
          filter: {
            fieldName: "customEvent:ad_id",
            stringFilter: {
              matchType: "EXACT",
              value: String(adId || ""),
              caseSensitive: false
            }
          }
        },
        {
          filter: {
            fieldName: "eventName",
            inListFilter: {
              values: [
                "floew_ad_view",
                "floew_ad_skip",
                "floew_ad_complete",
                "floew_ad_return",
                "floew_ad_repeat_view"
              ],
              caseSensitive: false
            }
          }
        }
      ]
    }
  };
}

function ga4PageViewFilter() {
  return {
    filter: {
      fieldName: "eventName",
      stringFilter: {
        matchType: "EXACT",
        value: "page_view",
        caseSensitive: false
      }
    }
  };
}

async function ga4GeneralDimensionReport(
  env,
  rangeKey,
  dimensions
) {
  return ga4RunReport(env, {
    dateRanges: [ga4DateRange(rangeKey)],
    dimensions: dimensions.map(name => ({ name })),
    metrics: [
      { name: "eventCount" },
      { name: "totalUsers" }
    ],
    dimensionFilter: ga4PageViewFilter(),
    limit: "5000"
  });
}

function ga4SimpleDistribution(report, dimensionName) {
  const rows = ga4RowObjects(report).map(row => ({
    label: String(row[dimensionName] || "unknown"),
    views: analyticsNumber(row.eventCount),
    users: analyticsNumber(row.totalUsers)
  }));

  const totalViews = rows.reduce(
    (sum, row) => sum + row.views,
    0
  );

  rows.forEach(row => {
    row.percent = adRate(row.views, totalViews);
  });

  return rows.sort((a, b) => b.views - a.views);
}

async function ga4GeneralDemographics(
  env,
  rangeKey = "7d"
) {
  const range = analyticsRange(rangeKey);

  if (!ga4ReportingConfigured(env)) {
    return {
      ok: true,
      range: range.key,
      label: range.label,
      reportingConfigured: false,
      collectionConfigured: ga4CollectionConfigured(env),
      age: [],
      gender: [],
      ageHour: [],
      coverage: { age: 0, gender: 0 },
      meta: {}
    };
  }

  const [ageReport, genderReport, ageHourReport] = await Promise.all([
    ga4GeneralDimensionReport(env, range.key, ["userAgeBracket"]),
    ga4GeneralDimensionReport(env, range.key, ["userGender"]),
    ga4GeneralDimensionReport(env, range.key, ["userAgeBracket", "hour"])
  ]);

  const age = ga4SimpleDistribution(
    ageReport,
    "userAgeBracket"
  );

  const gender = ga4SimpleDistribution(
    genderReport,
    "userGender"
  );

  const ageTotals = new Map();
  const rawAgeHour = ga4RowObjects(ageHourReport).map(row => {
    const ageLabel = String(row.userAgeBracket || "unknown");
    const views = analyticsNumber(row.eventCount);

    ageTotals.set(
      ageLabel,
      (ageTotals.get(ageLabel) || 0) + views
    );

    return {
      age: ageLabel,
      hour: String(row.hour || "").padStart(2, "0") + ":00",
      views,
      users: analyticsNumber(row.totalUsers)
    };
  });

  const ageHour = rawAgeHour
    .map(row => ({
      ...row,
      percent: adRate(
        row.views,
        ageTotals.get(row.age) || 0
      )
    }))
    .sort((a, b) =>
      a.age.localeCompare(b.age) ||
      a.hour.localeCompare(b.hour)
    );

  const totalAgeViews = age.reduce(
    (sum, row) => sum + row.views,
    0
  );
  const totalGenderViews = gender.reduce(
    (sum, row) => sum + row.views,
    0
  );

  const knownAgeViews = age
    .filter(row => !/^unknown$/i.test(row.label))
    .reduce((sum, row) => sum + row.views, 0);

  const knownGenderViews = gender
    .filter(row => !/^unknown$/i.test(row.label))
    .reduce((sum, row) => sum + row.views, 0);

  return {
    ok: true,
    range: range.key,
    label: range.label,
    reportingConfigured: true,
    collectionConfigured: ga4CollectionConfigured(env),
    age,
    gender,
    ageHour,
    coverage: {
      age: adRate(knownAgeViews, totalAgeViews),
      gender: adRate(knownGenderViews, totalGenderViews)
    },
    meta: {
      subjectToThresholding:
        Boolean(ageReport?.metadata?.subjectToThresholding) ||
        Boolean(genderReport?.metadata?.subjectToThresholding) ||
        Boolean(ageHourReport?.metadata?.subjectToThresholding),
      dataLossFromOtherRow:
        Boolean(ageReport?.metadata?.dataLossFromOtherRow) ||
        Boolean(genderReport?.metadata?.dataLossFromOtherRow) ||
        Boolean(ageHourReport?.metadata?.dataLossFromOtherRow),
      timeZone: String(
        ageHourReport?.metadata?.timeZone ||
        ageReport?.metadata?.timeZone ||
        genderReport?.metadata?.timeZone ||
        ""
      )
    }
  };
}

async function ga4AdDimensionReport(env, adId, rangeKey, dimensionName) {
  const base = {
    dateRanges: [ga4DateRange(rangeKey)],
    dimensions: [
      { name: dimensionName },
      { name: "eventName" }
    ],
    metrics: [
      { name: "eventCount" },
      { name: "totalUsers" },
      { name: "customEvent:ad_dwell_ms" },
      { name: "countCustomEvent:ad_dwell_ms" }
    ],
    dimensionFilter: ga4AdFilter(adId),
    limit: "1000"
  };

  try {
    return await ga4RunReport(env, base);
  } catch (error) {
    /*
      If the custom metric definition has not been created yet, demographic
      counts are still useful. Retry without dwell metrics and surface the
      missing metric through the setup/status UI.
    */
    const fallback = {
      ...base,
      metrics: [
        { name: "eventCount" },
        { name: "totalUsers" }
      ]
    };

    const report = await ga4RunReport(env, fallback);
    report._floewMetricWarning = String(error?.message || error);
    return report;
  }
}

function ga4AggregateDemographic(report, dimensionName) {
  const map = new Map();

  for (const row of ga4RowObjects(report)) {
    const label = String(row[dimensionName] || "unknown");
    const eventName = String(row.eventName || "");

    if (!map.has(label)) {
      map.set(label, {
        label,
        views: 0,
        viewers: 0,
        skips: 0,
        completes: 0,
        returns: 0,
        returners: 0,
        repeat_views: 0,
        dwell_sum_ms: 0,
        dwell_count: 0
      });
    }

    const item = map.get(label);
    const events = analyticsNumber(row.eventCount);
    const users = analyticsNumber(row.totalUsers);
    const dwellSum = analyticsNumber(row["customEvent:ad_dwell_ms"]);
    const dwellCount = analyticsNumber(row["countCustomEvent:ad_dwell_ms"]);

    if (eventName === "floew_ad_view") {
      item.views += events;
      item.viewers = Math.max(item.viewers, users);
    } else if (eventName === "floew_ad_skip") {
      item.skips += events;
      item.dwell_sum_ms += dwellSum;
      item.dwell_count += dwellCount;
    } else if (eventName === "floew_ad_complete") {
      item.completes += events;
      item.dwell_sum_ms += dwellSum;
      item.dwell_count += dwellCount;
    } else if (eventName === "floew_ad_return") {
      item.returns += events;
      item.returners = Math.max(item.returners, users);
    } else if (eventName === "floew_ad_repeat_view") {
      item.repeat_views += events;
    }
  }

  const rows = [...map.values()].map(item => ({
    ...item,
    avg_dwell_ms: item.dwell_count
      ? Math.round(item.dwell_sum_ms / item.dwell_count)
      : 0,
    skip_rate: adRate(item.skips, item.views),
    completion_rate: adRate(item.completes, item.views),
    return_rate: adRate(item.returners, item.viewers),
    repeat_rate: adRate(item.repeat_views, item.views)
  }));

  const totalViews = rows.reduce((sum, item) => sum + item.views, 0);

  for (const row of rows) {
    row.percent = adRate(row.views, totalViews);
  }

  return rows.sort((a, b) => b.views - a.views || a.label.localeCompare(b.label));
}

async function ga4AdAgeGenderReport(env, adId, rangeKey) {
  const report = await ga4RunReport(env, {
    dateRanges: [ga4DateRange(rangeKey)],
    dimensions: [
      { name: "userAgeBracket" },
      { name: "userGender" },
      { name: "eventName" }
    ],
    metrics: [
      { name: "eventCount" },
      { name: "totalUsers" },
      { name: "customEvent:ad_dwell_ms" },
      { name: "countCustomEvent:ad_dwell_ms" }
    ],
    dimensionFilter: ga4AdFilter(adId),
    limit: "3000"
  }).catch(async error => {
    const report = await ga4RunReport(env, {
      dateRanges: [ga4DateRange(rangeKey)],
      dimensions: [
        { name: "userAgeBracket" },
        { name: "userGender" },
        { name: "eventName" }
      ],
      metrics: [
        { name: "eventCount" },
        { name: "totalUsers" }
      ],
      dimensionFilter: ga4AdFilter(adId),
      limit: "3000"
    });

    report._floewMetricWarning = String(error?.message || error);
    return report;
  });

  const keyed = new Map();

  for (const row of ga4RowObjects(report)) {
    const age = String(row.userAgeBracket || "unknown");
    const gender = String(row.userGender || "unknown");
    const key = `${age}\u0000${gender}`;

    if (!keyed.has(key)) {
      keyed.set(key, {
        age,
        gender,
        views: 0,
        viewers: 0,
        skips: 0,
        completes: 0,
        returns: 0,
        returners: 0,
        repeat_views: 0,
        dwell_sum_ms: 0,
        dwell_count: 0
      });
    }

    const item = keyed.get(key);
    const eventName = String(row.eventName || "");
    const events = analyticsNumber(row.eventCount);
    const users = analyticsNumber(row.totalUsers);
    const dwellSum = analyticsNumber(row["customEvent:ad_dwell_ms"]);
    const dwellCount = analyticsNumber(row["countCustomEvent:ad_dwell_ms"]);

    if (eventName === "floew_ad_view") {
      item.views += events;
      item.viewers = Math.max(item.viewers, users);
    } else if (eventName === "floew_ad_skip") {
      item.skips += events;
      item.dwell_sum_ms += dwellSum;
      item.dwell_count += dwellCount;
    } else if (eventName === "floew_ad_complete") {
      item.completes += events;
      item.dwell_sum_ms += dwellSum;
      item.dwell_count += dwellCount;
    } else if (eventName === "floew_ad_return") {
      item.returns += events;
      item.returners = Math.max(item.returners, users);
    } else if (eventName === "floew_ad_repeat_view") {
      item.repeat_views += events;
    }
  }

  const rows = [...keyed.values()].map(item => ({
    ...item,
    avg_dwell_ms: item.dwell_count
      ? Math.round(item.dwell_sum_ms / item.dwell_count)
      : 0,
    skip_rate: adRate(item.skips, item.views),
    completion_rate: adRate(item.completes, item.views),
    return_rate: adRate(item.returners, item.viewers),
    repeat_rate: adRate(item.repeat_views, item.views)
  }));

  const totalViews = rows.reduce((sum, item) => sum + item.views, 0);
  rows.forEach(item => item.percent = adRate(item.views, totalViews));

  return {
    rows: rows.sort((a, b) => b.views - a.views),
    meta: {
      subjectToThresholding: Boolean(report?.metadata?.subjectToThresholding),
      dataLossFromOtherRow: Boolean(report?.metadata?.dataLossFromOtherRow),
      timeZone: String(report?.metadata?.timeZone || ""),
      metricWarning: String(report?._floewMetricWarning || "")
    }
  };
}

async function ga4AdDemographics(env, adId, rangeKey, d1Views) {
  if (!ga4ReportingConfigured(env)) {
    return {
      configured: false,
      collectionConfigured: ga4CollectionConfigured(env),
      reportingConfigured: false,
      age: [],
      gender: [],
      ageGender: [],
      coverage: {
        age: 0,
        gender: 0
      },
      meta: {}
    };
  }

  const [ageReport, genderReport, ageGender] = await Promise.all([
    ga4AdDimensionReport(env, adId, rangeKey, "userAgeBracket"),
    ga4AdDimensionReport(env, adId, rangeKey, "userGender"),
    ga4AdAgeGenderReport(env, adId, rangeKey)
  ]);

  const age = ga4AggregateDemographic(ageReport, "userAgeBracket");
  const gender = ga4AggregateDemographic(genderReport, "userGender");

  const knownAgeViews = age
    .filter(row => !/^unknown$/i.test(row.label))
    .reduce((sum, row) => sum + row.views, 0);

  const knownGenderViews = gender
    .filter(row => !/^unknown$/i.test(row.label))
    .reduce((sum, row) => sum + row.views, 0);

  return {
    configured: true,
    collectionConfigured: ga4CollectionConfigured(env),
    reportingConfigured: true,
    age,
    gender,
    ageGender: ageGender.rows,
    coverage: {
      age: adRate(knownAgeViews, d1Views),
      gender: adRate(knownGenderViews, d1Views)
    },
    meta: {
      subjectToThresholding:
        Boolean(ageReport?.metadata?.subjectToThresholding) ||
        Boolean(genderReport?.metadata?.subjectToThresholding) ||
        Boolean(ageGender?.meta?.subjectToThresholding),
      dataLossFromOtherRow:
        Boolean(ageReport?.metadata?.dataLossFromOtherRow) ||
        Boolean(genderReport?.metadata?.dataLossFromOtherRow) ||
        Boolean(ageGender?.meta?.dataLossFromOtherRow),
      timeZone:
        String(
          ageReport?.metadata?.timeZone ||
          genderReport?.metadata?.timeZone ||
          ageGender?.meta?.timeZone ||
          ""
        ),
      metricWarning:
        String(
          ageReport?._floewMetricWarning ||
          genderReport?._floewMetricWarning ||
          ageGender?.meta?.metricWarning ||
          ""
        )
    }
  };
}

async function adDetail(env, adId, rangeKey = "7d") {
  const range = analyticsRange(rangeKey);
  if (!env.BEHAVIOR_DB) throw new Error("BEHAVIOR_DB is not configured");

  const row = await env.BEHAVIOR_DB.prepare(`
    SELECT
      ad_id,
      MAX(COALESCE(NULLIF(json_extract(extra_json, '$.ad_title'), ''), NULLIF(json_extract(extra_json, '$.title'), ''))) AS title,
      MAX(COALESCE(NULLIF(json_extract(extra_json, '$.ad_category'), ''), NULLIF(json_extract(extra_json, '$.category'), ''))) AS category,
      MAX(brand) AS brand,
      MAX(campaign) AS campaign,
      MAX(creative) AS creative,
      MAX(filename) AS filename,
      MAX(media_type) AS media_type,
      SUM(CASE WHEN event_type='ad_view' THEN 1 ELSE 0 END) AS views,
      COUNT(DISTINCT CASE WHEN event_type='ad_view' THEN visitor_id END) AS viewers,
      SUM(CASE WHEN event_type='ad_skip' THEN 1 ELSE 0 END) AS skips,
      SUM(CASE WHEN event_type='ad_complete' THEN 1 ELSE 0 END) AS completes,
      SUM(CASE WHEN event_type='ad_return' THEN 1 ELSE 0 END) AS returns,
      COUNT(DISTINCT CASE WHEN event_type='ad_return' THEN visitor_id END) AS returners,
      SUM(CASE WHEN event_type='ad_repeat_view' THEN 1 ELSE 0 END) AS repeat_views,
      AVG(
        CASE
          WHEN event_type IN ('ad_skip','ad_complete') AND dwell_ms > 0
          THEN dwell_ms
        END
      ) AS avg_dwell_ms
    FROM ad_events
    WHERE occurred_at >= ?
      AND ad_id = ?
  `).bind(range.since, adId).first();

  if (!row || !analyticsNumber(row.views)) {
    throw new Error("Reklam için istatistik bulunamadı");
  }

  const summary = normalizeAdSummaryRow(row);
  const metadata = await adCenterMetadataMap(env);
  Object.assign(summary, enrichAdSummary(summary, metadata));

  const [orientation, devices, hours, orientationDevice, demographics] = await Promise.all([
    adBreakdown(env, adId, range.since, "orientation", summary.views),
    adBreakdown(env, adId, range.since, "device", summary.views),
    adBreakdown(env, adId, range.since, "hour", summary.views),
    adOrientationDeviceBreakdown(env, adId, range.since, summary.views),
    ga4AdDemographics(env, adId, range.key, summary.views)
      .catch(error => ({
        configured: ga4ReportingConfigured(env),
        collectionConfigured: ga4CollectionConfigured(env),
        reportingConfigured: ga4ReportingConfigured(env),
        age: [],
        gender: [],
        ageGender: [],
        coverage: { age: 0, gender: 0 },
        meta: {},
        error: String(error?.message || error)
      }))
  ]);

  return {
    ok: true,
    range: range.key,
    label: range.label,
    generatedAt: Date.now(),
    summary,
    orientation,
    devices,
    hours,
    orientationDevice,
    demographics
  };
}

const GA4_CUSTOM_DIMENSIONS = [
  {
    parameterName: "ad_id",
    displayName: "Floew Ad ID",
    description: "Stable Flöw advertisement identifier",
    scope: "EVENT"
  },
  {
    parameterName: "ad_brand",
    displayName: "Floew Ad Brand",
    description: "Flöw advertisement brand",
    scope: "EVENT"
  },
  {
    parameterName: "ad_campaign",
    displayName: "Floew Ad Campaign",
    description: "Flöw advertisement campaign",
    scope: "EVENT"
  },
  {
    parameterName: "ad_creative",
    displayName: "Floew Ad Creative",
    description: "Flöw advertisement creative",
    scope: "EVENT"
  },
  {
    parameterName: "ad_orientation",
    displayName: "Floew Ad Orientation",
    description: "Horizontal or vertical Flöw ad creative",
    scope: "EVENT"
  },
  {
    parameterName: "ad_type",
    displayName: "Floew Ad Type",
    description: "Image or video Flöw advertisement",
    scope: "EVENT"
  },
  {
    parameterName: "news_source",
    displayName: "Floew News Source",
    description: "News publisher name on consented story impressions",
    scope: "EVENT"
  }
];

const GA4_CUSTOM_METRICS = [
  {
    parameterName: "ad_dwell_ms",
    displayName: "Floew Ad Dwell",
    description: "Milliseconds spent on a Flöw advertisement",
    measurementUnit: "MILLISECONDS",
    scope: "EVENT"
  }
];

async function ga4ListDefinitions(env, resource) {
  const c = ga4Config(env);
  const data = await ga4FetchJson(
    env,
    `https://analyticsadmin.googleapis.com/v1beta/properties/${encodeURIComponent(c.propertyId)}/${resource}?pageSize=200`,
    { method: "GET" },
    "https://www.googleapis.com/auth/analytics.edit"
  );

  return resource === "customDimensions"
    ? (data?.customDimensions || [])
    : (data?.customMetrics || []);
}

async function ga4CreateDefinition(env, resource, payload) {
  const c = ga4Config(env);

  return ga4FetchJson(
    env,
    `https://analyticsadmin.googleapis.com/v1beta/properties/${encodeURIComponent(c.propertyId)}/${resource}`,
    {
      method: "POST",
      body: JSON.stringify(payload)
    },
    "https://www.googleapis.com/auth/analytics.edit"
  );
}

async function ga4SetupDefinitions(env) {
  if (!ga4ReportingConfigured(env)) {
    throw new Error(
      "GA4_PROPERTY_ID, GA4_CLIENT_EMAIL ve GA4_PRIVATE_KEY gerekli"
    );
  }

  const [existingDimensions, existingMetrics] = await Promise.all([
    ga4ListDefinitions(env, "customDimensions"),
    ga4ListDefinitions(env, "customMetrics")
  ]);

  const dimensionNames = new Set(
    existingDimensions.map(item => String(item.parameterName || ""))
  );

  const metricNames = new Set(
    existingMetrics.map(item => String(item.parameterName || ""))
  );

  const created = {
    dimensions: [],
    metrics: []
  };

  for (const definition of GA4_CUSTOM_DIMENSIONS) {
    if (dimensionNames.has(definition.parameterName)) continue;

    const result = await ga4CreateDefinition(
      env,
      "customDimensions",
      definition
    );

    created.dimensions.push(
      result?.parameterName || definition.parameterName
    );
  }

  for (const definition of GA4_CUSTOM_METRICS) {
    if (metricNames.has(definition.parameterName)) continue;

    const result = await ga4CreateDefinition(
      env,
      "customMetrics",
      definition
    );

    created.metrics.push(
      result?.parameterName || definition.parameterName
    );
  }

  return {
    ok: true,
    created,
    existing: {
      dimensions: [...dimensionNames],
      metrics: [...metricNames]
    }
  };
}

async function ga4Status(env) {
  const config = ga4Config(env);
  const status = {
    collectionConfigured: ga4CollectionConfigured(env),
    reportingConfigured: ga4ReportingConfigured(env),
    measurementId: config.measurementId,
    propertyId: config.propertyId,
    serviceAccountConfigured: Boolean(config.clientEmail && config.privateKey),
    definitionsReady: false,
    missingDefinitions: [],
    error: ""
  };

  if (!status.reportingConfigured) {
    return status;
  }

  try {
    const [dimensions, metrics] = await Promise.all([
      ga4ListDefinitions(env, "customDimensions"),
      ga4ListDefinitions(env, "customMetrics")
    ]);

    const dimensionNames = new Set(
      dimensions.map(item => String(item.parameterName || ""))
    );

    const metricNames = new Set(
      metrics.map(item => String(item.parameterName || ""))
    );

    for (const definition of GA4_CUSTOM_DIMENSIONS) {
      if (!dimensionNames.has(definition.parameterName)) {
        status.missingDefinitions.push(definition.parameterName);
      }
    }

    for (const definition of GA4_CUSTOM_METRICS) {
      if (!metricNames.has(definition.parameterName)) {
        status.missingDefinitions.push(definition.parameterName);
      }
    }

    status.definitionsReady = !status.missingDefinitions.length;
  } catch (error) {
    status.error = String(error?.message || error);
  }

  return status;
}

function reportPercent(value) {
  const n = Number(value) || 0;
  return `%${new Intl.NumberFormat("tr-TR", {
    maximumFractionDigits: 1,
    minimumFractionDigits: 0
  }).format(n)}`;
}

function reportAdGroupLabel(value) {
  const raw = String(value ?? "");
  const key = raw.toLowerCase();

  if (key === "hor" || key === "horizontal") return "Yatay";
  if (key === "ver" || key === "vertical") return "Dikey";
  if (key === "mobile") return "Mobil";
  if (key === "tablet") return "Tablet";
  if (key === "desktop") return "Masaüstü";
  if (key === "tv") return "TV";
  if (key === "other") return "Diğer";
  if (/^unknown$/i.test(raw)) return "Bilinmiyor";
  if (/^male$/i.test(raw)) return "Erkek";
  if (/^female$/i.test(raw)) return "Kadın";
  return raw || "Bilinmiyor";
}

function reportAdOrientationDevice(rows) {
  return reportTable("Yön × Cihaz", rows, [
    {key:"orientation", label:"Yön", format:reportAdGroupLabel},
    {key:"device", label:"Cihaz", format:reportAdGroupLabel},
    {key:"views", label:"Gösterim", format:reportNumber},
    {key:"percent", label:"Pay", format:reportPercent},
    {key:"avg_dwell_ms", label:"Ort. izleme", format:reportDuration},
    {key:"skip_rate", label:"Skip", format:reportPercent},
    {key:"completion_rate", label:"Tamamlama", format:reportPercent},
    {key:"return_rate", label:"Geri dönüş", format:reportPercent},
    {key:"repeat_rate", label:"Tekrar", format:reportPercent}
  ]);
}

function reportAdBreakdown(title, rows) {
  const localized = (rows || []).map(row => ({
    ...row,
    label: reportAdGroupLabel(row.label)
  }));

  return reportTable(title, localized, [
    {key:"label", label:"Grup"},
    {key:"views", label:"Gösterim", format:reportNumber},
    {key:"percent", label:"Pay", format:reportPercent},
    {key:"avg_dwell_ms", label:"Ort. izleme", format:reportDuration},
    {key:"skip_rate", label:"Skip", format:reportPercent},
    {key:"completion_rate", label:"Tamamlama", format:reportPercent},
    {key:"return_rate", label:"Geri dönüş", format:reportPercent},
    {key:"repeat_rate", label:"Tekrar", format:reportPercent}
  ]);
}

function reportAdDemographic(title, rows, dual = false) {
  const localized = (rows || []).map(row => ({
    ...row,
    label: reportAdGroupLabel(row.label),
    age: reportAdGroupLabel(row.age),
    gender: reportAdGroupLabel(row.gender)
  }));

  const columns = dual
    ? [
        {key:"age", label:"Yaş"},
        {key:"gender", label:"Cinsiyet"}
      ]
    : [
        {key:"label", label:"Grup"}
      ];

  return reportTable(title, localized, [
    ...columns,
    {key:"views", label:"Gösterim", format:reportNumber},
    {key:"percent", label:"Pay", format:reportPercent},
    {key:"avg_dwell_ms", label:"Ort. izleme", format:reportDuration},
    {key:"skip_rate", label:"Skip", format:reportPercent},
    {key:"completion_rate", label:"Tamamlama", format:reportPercent},
    {key:"return_rate", label:"Geri dönüş", format:reportPercent},
    {key:"repeat_rate", label:"Tekrar", format:reportPercent}
  ]);
}

async function adReportHtml(env, adId, rangeKey = "7d") {
  const data = await adDetail(env, adId, rangeKey);
  const s = data.summary;
  const generated = new Date().toLocaleString(
    "tr-TR",
    { timeZone: "Europe/Istanbul" }
  );

  const cards = [
    ["Gösterim", reportNumber(s.views)],
    ["Tekil izleyici", reportNumber(s.viewers)],
    ["Ort. izleme", reportDuration(s.avg_dwell_ms)],
    ["Skip", `${reportNumber(s.skips)} · ${reportPercent(s.skip_rate)}`],
    ["Tamamlama", `${reportNumber(s.completes)} · ${reportPercent(s.completion_rate)}`],
    ["Geri dönüş", `${reportNumber(s.returners)} kişi · ${reportPercent(s.return_rate)}`],
    ["Tekrar karşılaşma", `${reportNumber(s.repeat_views)} · ${reportPercent(s.repeat_rate)}`]
  ].map(([label, value]) =>
    `<div class="metric"><span>${htmlEscape(label)}</span><strong>${htmlEscape(value)}</strong></div>`
  ).join("");

  const d = data.demographics || {};
  const demoNote = d.reportingConfigured
    ? `Yaş kapsama: ${reportPercent(d.coverage?.age)} · Cinsiyet kapsama: ${reportPercent(d.coverage?.gender)}${d.meta?.subjectToThresholding ? " · Google Analytics veri eşiği uygulanmış olabilir." : ""}`
    : "Google Analytics demografi bağlantısı yapılandırılmadığı için yaş/cinsiyet bölümü yok.";

  return `<!doctype html>
<html lang="tr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${htmlEscape(s.title || s.ad_id)} · Flöw Reklam Raporu</title>
<style>
*{box-sizing:border-box}
body{margin:0;background:#080808;color:#eee;font-family:Arial,sans-serif}
main{max-width:1380px;margin:auto;padding:42px 24px 80px}
h1{font-size:34px;margin:0 0 8px}
h2{font-size:24px;margin:48px 0 18px;border-top:1px solid #303030;padding-top:28px}
h3{font-size:15px;margin:28px 0 12px}
.muted{color:#888;line-height:1.6}
.metrics{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px;margin-top:24px}
.metric,.table-card{border:1px solid #292929;background:#111;border-radius:12px;padding:16px}
.metric span{display:block;color:#888;font-size:12px}
.metric strong{display:block;margin-top:7px;font-size:23px}
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(360px,1fr));gap:12px}
.table-card{padding:0;overflow:hidden}
.table-card h3{padding:14px 16px;margin:0}
.table-wrap{overflow:auto}
table{width:100%;border-collapse:collapse;font-size:12px}
th,td{text-align:left;padding:9px 12px;border-top:1px solid #252525;vertical-align:top}
th{color:#999;font-weight:600}
footer{margin-top:50px;color:#666;font-size:11px}
</style>
</head>
<body>
<main>
<h1>${htmlEscape(s.title || s.ad_id)}</h1>
<div class="muted">
${htmlEscape(s.category || "")}${s.brand ? ` · ${htmlEscape(s.brand)}` : ""}${s.campaign ? ` · ${htmlEscape(s.campaign)}` : ""}
${s.creative ? `<br>${htmlEscape(s.creative)}` : ""}
<br>${htmlEscape(data.label)} · Oluşturulma: ${htmlEscape(generated)}
</div>
<div class="metrics">${cards}</div>

<h2>Gösterim kırılımları</h2>
<div class="grid">
${reportAdBreakdown("Yatay / Dikey", data.orientation)}
${reportAdBreakdown("Cihazlar", data.devices)}
${reportAdBreakdown("Saatler", data.hours)}
</div>
${reportAdOrientationDevice(data.orientationDevice || [])}

<h2>Demografi</h2>
<div class="muted">${htmlEscape(demoNote)}</div>
<div class="grid">
${reportAdDemographic("Yaş", d.age || [])}
${reportAdDemographic("Cinsiyet", d.gender || [])}
</div>
${reportAdDemographic("Yaş × Cinsiyet", d.ageGender || [], true)}

<footer>Flöw reklam performans raporu · ${htmlEscape(s.ad_id)}</footer>
</main>
</body>
</html>`;
}


function htmlEscape(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function reportNumber(value) {
  return new Intl.NumberFormat("tr-TR").format(Number(value) || 0);
}

function reportDuration(ms) {
  const seconds = Math.round((Number(ms) || 0) / 1000);
  if (seconds < 60) return `${seconds} sn`;
  const minutes = Math.floor(seconds / 60);
  const remain = seconds % 60;
  if (minutes < 60) return `${minutes} dk ${remain} sn`;
  const hours = Math.floor(minutes / 60);
  return `${hours} sa ${minutes % 60} dk`;
}

function reportTable(title, rows, columns) {
  const head = columns.map(c => `<th>${htmlEscape(c.label)}</th>`).join("");
  const body = (rows || []).map(row =>
    `<tr>${columns.map(c => `<td>${htmlEscape(c.format ? c.format(row[c.key], row) : row[c.key])}</td>`).join("")}</tr>`
  ).join("");

  return `
    <section class="table-card">
      <h3>${htmlEscape(title)}</h3>
      <div class="table-wrap">
        <table>
          <thead><tr>${head}</tr></thead>
          <tbody>${body || `<tr><td colspan="${columns.length}">Veri yok.</td></tr>`}</tbody>
        </table>
      </div>
    </section>
  `;
}

function reportPeriod(title, audience, behavior) {
  const cards = [
    ["Tekil ziyaretçi", reportNumber(audience.totals.visitors)],
    ["Oturum", reportNumber(audience.totals.sessions)],
    ["Yeni ziyaretçi", reportNumber(audience.totals.new_visitors)],
    ["Geri dönen", reportNumber(audience.totals.returning_visitors)],
    ["Ort. oturum", reportDuration(audience.totals.avg_duration_ms)],
    ["Haber görüntüleme", reportNumber(audience.totals.story_views)],
    ["Davranış olayı", reportNumber(behavior.totals.events)],
    ["Kaynak sekmesi açılışı", reportNumber((behavior.sourceFilters||[]).reduce((sum,row)=>sum+Number(row.opens||0),0))],
    ["Oto akış durdurma", reportNumber(behavior.autoAdvance?.pauses||0)],
    ["Özel RSS kullanan", reportNumber(behavior.customRss?.configured_visitors||0)],
    ["Özel RSS haber görüntüleme", reportNumber(behavior.customRss?.story_views||0)]
  ].map(([label, value]) =>
    `<div class="metric"><span>${htmlEscape(label)}</span><strong>${htmlEscape(value)}</strong></div>`
  ).join("");

  return `
    <section class="period">
      <h2>${htmlEscape(title)}</h2>
      <div class="metrics">${cards}</div>

      <h3>Kullanıcılar & Oturumlar</h3>
      <div class="grid">
        ${reportTable("Ülkeler", audience.byCountry, [
          {key:"label", label:"Ülke"}, {key:"count", label:"Oturum", format:reportNumber}
        ])}
        ${reportTable("Şehirler", audience.byCity, [
          {key:"label", label:"Şehir"}, {key:"count", label:"Oturum", format:reportNumber}
        ])}
        ${reportTable("Cihazlar", audience.byDevice, [
          {key:"label", label:"Cihaz"}, {key:"count", label:"Oturum", format:reportNumber}
        ])}
        ${reportTable("Tarayıcılar", audience.byBrowser, [
          {key:"label", label:"Tarayıcı"}, {key:"count", label:"Oturum", format:reportNumber}
        ])}
        ${reportTable("İşletim sistemleri", audience.byOS, [
          {key:"label", label:"Sistem"}, {key:"count", label:"Oturum", format:reportNumber}
        ])}
        ${reportTable("Geliş kaynakları", audience.referrers, [
          {key:"label", label:"Referrer"}, {key:"count", label:"Oturum", format:reportNumber}
        ])}
      </div>

      <h3>Hareketler & Etkileşimler</h3>
      <div class="grid">
        ${reportTable("Olay türleri", behavior.eventTypes, [
          {key:"label", label:"Olay"}, {key:"count", label:"Adet", format:reportNumber}
        ])}
        ${reportTable("Anahtar kelimeler", behavior.keywords, [
          {key:"keyword", label:"Kelime"}, {key:"mode", label:"Mod"}, {key:"count", label:"Adet", format:reportNumber}
        ])}
        ${reportTable("Kaynak etkileşimleri", behavior.sources, [
          {key:"label", label:"Kaynak"}, {key:"count", label:"Olay", format:reportNumber}
        ])}
        ${reportTable("Kategori etkileşimleri", behavior.categories, [
          {key:"label", label:"Kategori"}, {key:"count", label:"Olay", format:reportNumber}
        ])}
        ${reportTable("Tek-kaynak sekmeleri", behavior.sourceFilters || [], [
          {key:"label", label:"Kaynak"},
          {key:"opens", label:"Açılış", format:reportNumber},
          {key:"visitors", label:"Kullanıcı", format:reportNumber},
          {key:"story_views", label:"Görülen haber", format:reportNumber},
          {key:"avg_duration_ms", label:"Ort. süre", format:reportDuration}
        ])}
        ${reportTable("Otomatik akış", [
          {
            label:"Play / Pause",
            pauses:behavior.autoAdvance?.pauses||0,
            users:behavior.autoAdvance?.users||0,
            avg_pause_ms:behavior.autoAdvance?.avg_pause_ms||0,
            total_pause_ms:behavior.autoAdvance?.total_pause_ms||0
          }
        ], [
          {key:"label", label:"Kontrol"},
          {key:"pauses", label:"Pause", format:reportNumber},
          {key:"users", label:"Kullanıcı", format:reportNumber},
          {key:"avg_pause_ms", label:"Ort. pause", format:reportDuration},
          {key:"total_pause_ms", label:"Toplam pause", format:reportDuration}
        ])}
        ${reportTable("Özel RSS", [
          {
            label:"Anonim kullanım",
            users:behavior.customRss?.configured_visitors||0,
            avg_feeds:behavior.customRss?.avg_feed_count||0,
            adds:behavior.customRss?.adds||0,
            success:behavior.customRss?.add_success_rate||0,
            removes:behavior.customRss?.removes||0,
            views:behavior.customRss?.story_views||0,
            dwell:behavior.customRss?.avg_dwell_ms||0
          }
        ], [
          {key:"label", label:"Tür"},
          {key:"users", label:"Kullanıcı", format:reportNumber},
          {key:"avg_feeds", label:"Ort. RSS"},
          {key:"adds", label:"Ekleme", format:reportNumber},
          {key:"success", label:"Başarı", format:reportPercent},
          {key:"removes", label:"Silme", format:reportNumber},
          {key:"views", label:"Haber görünümü", format:reportNumber},
          {key:"dwell", label:"Ort. bakma", format:reportDuration}
        ])}
        ${reportTable("Özel RSS ekleme hataları", behavior.customRss?.failures || [], [
          {key:"label", label:"Neden"},
          {key:"count", label:"Adet", format:reportNumber}
        ])}
      </div>
    </section>
  `;
}

async function analyticsExportHtml(env, request, ctx) {
  const [
    audience7d, behavior7d, ads7d,
    audienceAll, behaviorAll, adsAll
  ] = await Promise.all([
    audienceSummary(env, "7d"),
    behaviorSummaryCached(env, request, ctx, "7d"),
    adSummary(env, "7d").catch(() => ({ads:[], totals:{}})),
    audienceSummary(env, "all"),
    behaviorSummaryCached(env, request, ctx, "all"),
    adSummary(env, "all").catch(() => ({ads:[], totals:{}}))
  ]);

  const generated = new Date().toLocaleString("tr-TR", { timeZone: "Europe/Istanbul" });

  return `<!doctype html>
<html lang="tr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Flöw Analytics Raporu</title>
<style>
  *{box-sizing:border-box}
  body{margin:0;background:#0a0a0a;color:#eee;font-family:Arial,sans-serif}
  main{max-width:1380px;margin:auto;padding:42px 24px 80px}
  h1{font-size:34px;margin:0 0 8px}
  h2{font-size:26px;margin:55px 0 20px;border-top:1px solid #333;padding-top:30px}
  h3{font-size:15px;margin:28px 0 12px}
  .muted{color:#888}
  .metrics{display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:10px}
  .metric,.table-card{border:1px solid #292929;background:#111;border-radius:12px;padding:16px}
  .metric span{display:block;color:#888;font-size:12px}
  .metric strong{display:block;margin-top:7px;font-size:23px}
  .grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(340px,1fr));gap:12px}
  .table-card{padding:0;overflow:hidden}
  .table-card h3{padding:14px 16px;margin:0}
  .table-wrap{overflow:auto}
  table{width:100%;border-collapse:collapse;font-size:12px}
  th,td{text-align:left;padding:9px 12px;border-top:1px solid #252525;vertical-align:top}
  th{color:#999;font-weight:600}
  td{word-break:break-word}
  footer{margin-top:50px;color:#666;font-size:11px}
</style>
</head>
<body>
<main>
  <h1>Flöw Analytics</h1>
  <div class="muted">Oluşturulma: ${htmlEscape(generated)}</div>
  ${reportPeriod("Son 7 gün", audience7d, behavior7d)}
  <h2>Reklamlar · Son 7 gün</h2>
  ${reportTable("Reklam performansı", ads7d.ads || [], [
    {key:"ad_id", label:"ID"},
    {key:"brand", label:"Marka"},
    {key:"campaign", label:"Kampanya"},
    {key:"views", label:"Gösterim", format:reportNumber},
    {key:"avg_dwell_ms", label:"Ort. izleme", format:reportDuration},
    {key:"skip_rate", label:"Skip", format:reportPercent},
    {key:"completion_rate", label:"Tamamlama", format:reportPercent},
    {key:"return_rate", label:"Geri dönüş", format:reportPercent}
  ])}
  ${reportPeriod("Tüm zamanlar", audienceAll, behaviorAll)}
  <h2>Reklamlar · Tüm zamanlar</h2>
  ${reportTable("Reklam performansı", adsAll.ads || [], [
    {key:"ad_id", label:"ID"},
    {key:"brand", label:"Marka"},
    {key:"campaign", label:"Kampanya"},
    {key:"views", label:"Gösterim", format:reportNumber},
    {key:"avg_dwell_ms", label:"Ort. izleme", format:reportDuration},
    {key:"skip_rate", label:"Skip", format:reportPercent},
    {key:"completion_rate", label:"Tamamlama", format:reportPercent},
    {key:"return_rate", label:"Geri dönüş", format:reportPercent}
  ])}
  <footer>Flöw özel yönetim raporu</footer>
</main>
</body>
</html>`;
}


export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const corsHeaders = {
      // Frontend uses credentials:"omit", so wildcard CORS is safe here and
      // also works for GitHub Pages, custom domains and local testing.
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
      "Access-Control-Max-Age": "86400",
      "Vary": "Origin"
    };

    // Always answer preflight with the same CORS policy.
    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: corsHeaders
      });
    }

    if (url.pathname === "/track") {
      if (request.method !== "POST") {
        return analyticsJsonResponse(
          { ok:false, error:"Method Not Allowed" },
          corsHeaders,
          405
        );
      }
      return trackAnalytics(request, env, corsHeaders, ctx);
    }

    // V31.22.3 shadow admin endpoints; no public access, no old API changes.
    if (url.pathname === '/admin/v2/setup' ||
        url.pathname === '/admin/v2/status' ||
        url.pathname === '/admin/v2/ads') {
      if (!analyticsAuthorized(request, env)) {
        return analyticsJsonResponse({ok:false,error:'Unauthorized'},corsHeaders,401);
      }
      if (!env.BEHAVIOR_DB) {
        return analyticsJsonResponse({ok:false,error:'BEHAVIOR_DB missing'},corsHeaders,503);
      }
      if (url.pathname === '/admin/v2/setup' && request.method !== 'POST') {
        return analyticsJsonResponse({ok:false,error:'Method Not Allowed'},corsHeaders,405);
      }
      if (url.pathname !== '/admin/v2/setup' && request.method !== 'GET') {
        return analyticsJsonResponse({ok:false,error:'Method Not Allowed'},corsHeaders,405);
      }
      try {
        if (url.pathname === '/admin/v2/setup') {
          const statements = await runAnalyticsSchema(env.BEHAVIOR_DB,ANALYTICS_V2_AD_SCHEMA);
          return analyticsJsonResponse({ok:true,statements:statements.length,
            status:await analyticsV2AdShadowStatus(env)},corsHeaders);
        }
        if (url.pathname === '/admin/v2/status') {
          return analyticsJsonResponse({ok:true,
            status:await analyticsV2AdShadowStatus(env)},corsHeaders);
        }
        return analyticsJsonResponse(
          await analyticsV2AdShadowReport(env,url.searchParams.get('range')||'7d'),
          corsHeaders);
      } catch (error) {
        return analyticsJsonResponse({ok:false,error:String(error?.message||error)},corsHeaders,500);
      }
    }

    if (url.pathname === "/admin/setup") {
      if (request.method !== "POST") {
        return analyticsJsonResponse(
          { ok:false, error:"Method Not Allowed" },
          corsHeaders,
          405
        );
      }
      if (!analyticsAuthorized(request, env)) {
        return analyticsJsonResponse(
          { ok:false, error:"Unauthorized" },
          corsHeaders,
          401
        );
      }
      try {
        const before = await analyticsDatabaseStatus(env);
        const exec = await ensureAnalyticsSchema(env);

        let contentDailyBackfill;
        try {
          contentDailyBackfill =
            await ensureContentDailyBackfill(env);
        } catch (error) {
          /*
            Schema creation must still succeed when the account has already
            exhausted today's D1 read quota. Running /admin/setup again after
            the daily reset will retry the one-time 8-day backfill.
          */
          contentDailyBackfill = {
            ok: false,
            error: String(
              error?.message || error
            )
          };
        }

        const after = await analyticsDatabaseStatus(env);

        return analyticsJsonResponse({
          ok: true,
          before,
          after,
          exec,
          contentDailyBackfill
        }, corsHeaders);
      } catch (error) {
        const state = await analyticsDatabaseStatus(env).catch(() => null);
        return analyticsJsonResponse(
          {
            ok:false,
            error:String(error?.message||error),
            state
          },
          corsHeaders,
          500
        );
      }
    }

    if (url.pathname === "/admin/backfill-content-daily") {
      if (request.method !== "POST") {
        return analyticsJsonResponse(
          { ok:false, error:"Method Not Allowed" },
          corsHeaders,
          405
        );
      }

      if (!analyticsAuthorized(request, env)) {
        return analyticsJsonResponse(
          { ok:false, error:"Unauthorized" },
          corsHeaders,
          401
        );
      }

      try {
        await ensureAnalyticsSchema(env);
        const result = await backfillContentDaily(env);

        return analyticsJsonResponse(
          result,
          corsHeaders
        );
      } catch (error) {
        return analyticsJsonResponse(
          {
            ok:false,
            error:String(
              error?.message || error
            )
          },
          corsHeaders,
          500
        );
      }
    }

    if (url.pathname === "/admin/ga4/setup") {
      if (request.method !== "POST") {
        return analyticsJsonResponse(
          { ok:false, error:"Method Not Allowed" },
          corsHeaders,
          405
        );
      }

      if (!analyticsAuthorized(request, env)) {
        return analyticsJsonResponse(
          { ok:false, error:"Unauthorized" },
          corsHeaders,
          401
        );
      }

      try {
        const result = await ga4SetupDefinitions(env);
        return analyticsJsonResponse({
          ...result,
          status: await ga4Status(env)
        }, corsHeaders);
      } catch (error) {
        return analyticsJsonResponse(
          { ok:false, error:String(error?.message||error) },
          corsHeaders,
          500
        );
      }
    }

    if (url.pathname === "/admin/feedback-delete") {
      if (request.method !== "POST") {
        return analyticsJsonResponse(
          { ok:false, error:"Method Not Allowed" },
          corsHeaders,
          405
        );
      }
      if (!analyticsAuthorized(request, env)) {
        return analyticsJsonResponse(
          { ok:false, error:"Unauthorized" },
          corsHeaders,
          401
        );
      }

      try {
        const body = await request.json().catch(() => ({}));
        return analyticsJsonResponse(
          await deleteFeedbackReport(env, body?.event_id || ""),
          corsHeaders
        );
      } catch (error) {
        return analyticsJsonResponse(
          { ok:false, error:String(error?.message||error) },
          corsHeaders,
          400
        );
      }
    }

    if (request.method !== "GET") {
      return new Response(
        JSON.stringify({
          ok: false,
          error: "Method Not Allowed"
        }),
        {
          status: 405,
          headers: {
            ...corsHeaders,
            "Content-Type": "application/json; charset=utf-8",
            "Cache-Control": "no-store"
          }
        }
      );
    }

    if (url.pathname === "/analytics/config") {
      const c = ga4Config(env);

      return analyticsJsonResponse({
        ok: true,
        ga4: {
          enabled: ga4CollectionConfigured(env),
          measurementId: c.measurementId
        }
      }, corsHeaders, 200, {
        "Cache-Control":"public, max-age=300"
      });
    }

    if (url.pathname === "/analytics/health") {
      return analyticsJsonResponse({
        ok: true,
        bindings: {
          CONTENT_DB: Boolean(env.CONTENT_DB),
          AUDIENCE_DB: Boolean(env.AUDIENCE_DB),
          BEHAVIOR_DB: Boolean(env.BEHAVIOR_DB),
          ADMIN_TOKEN: Boolean(env.ADMIN_TOKEN),
          GA4_MEASUREMENT_ID: Boolean(env.GA4_MEASUREMENT_ID),
          GA4_PROPERTY_ID: Boolean(env.GA4_PROPERTY_ID),
          GA4_CLIENT_EMAIL: Boolean(env.GA4_CLIENT_EMAIL),
          GA4_PRIVATE_KEY: Boolean(env.GA4_PRIVATE_KEY)
        }
      }, corsHeaders);
    }

    if (url.pathname === "/stats/flora-scores") {
      try {
        const range =
          url.searchParams.get("range") || "7d";
        const stream =
          url.searchParams.get("stream") || "main";

        return await analyticsServePublicCachedJson({
          request,
          env,
          ctx,
          corsHeaders,
          scope: "flora-scores",
          parts: {
            range,
            stream
          },
          producer: () =>
            publicFloraScores(
              env,
              range,
              stream
            ),
          /*
            v31.20 — Legacy clients can still poll this bulk endpoint every
            five minutes. Protect the D1 free-tier quota by treating the
            snapshot as slow-changing. New frontend builds use indexed
            /stats/flora-story requests for visible stories instead.
          */
          freshMs:
            range === "all"
              ? 24 * 60 * 60 * 1000
              : 6 * 60 * 60 * 1000,
          staleMs:
            range === "all"
              ? 7 * 24 * 60 * 60 * 1000
              : 72 * 60 * 60 * 1000,
          edgeMaxAge: 2 * 60 * 60
        });
      } catch (error) {
        return analyticsJsonResponse(
          {
            ok:false,
            error:String(
              error?.message || error
            )
          },
          corsHeaders,
          500
        );
      }
    }

    if (url.pathname === "/stats/flora-vocabulary") {
      try {
        const stream=url.searchParams.get("stream")==="foreign"?"foreign":"main";
        return await analyticsServePublicCachedJson({
          request,env,ctx,corsHeaders,
          scope:"flora-vocabulary-v3",
          parts:{stream},
          producer:()=>publicFloraVocabulary(env,stream),
          freshMs:24*60*60*1000,
          staleMs:7*24*60*60*1000,
          edgeMaxAge:3*60*60
        });
      } catch(error) {
        return analyticsJsonResponse(
          {ok:false,error:String(error?.message||error)},
          corsHeaders,500
        );
      }
    }

    if (url.pathname === "/stats/flora-story") {
      try {
        const range =
          url.searchParams.get("range") || "7d";
        const stream =
          url.searchParams.get("stream") || "main";
        const storyKey =
          url.searchParams.get("story_key") || "";

        return await analyticsServePublicCachedJson({
          request,
          env,
          ctx,
          corsHeaders,
          scope: "flora-story-v2",
          parts: {
            range,
            stream,
            storyKey
          },
          producer: () =>
            publicFloraStory(
              env,
              range,
              stream,
              storyKey
            ),
          freshMs: 10 * 60 * 1000,
          staleMs: 2 * 60 * 60 * 1000,
          edgeMaxAge: 3 * 60
        });
      } catch (error) {
        return analyticsJsonResponse(
          {
            ok:false,
            error:String(
              error?.message || error
            )
          },
          corsHeaders,
          500
        );
      }
    }

    if (url.pathname === "/stats/public") {
      try {
        const range =
          url.searchParams.get("range") || "7d";
        const stream =
          url.searchParams.get("stream") || "main";

        return await analyticsServePublicCachedJson({
          request,
          env,
          ctx,
          corsHeaders,
          scope: "public-stats",
          parts: {
            range,
            stream
          },
          producer: () =>
            publicContentStats(
              env,
              range,
              stream
            ),
          /*
            Public dashboard data does not need minute-level freshness.
            Rebuilding it every ten minutes scans the same 7-day aggregate
            several times and can exhaust the 5M/day free row-read budget.
          */
          freshMs:
            range === "all"
              ? 24 * 60 * 60 * 1000
              : 2 * 60 * 60 * 1000,
          staleMs:
            range === "all"
              ? 7 * 24 * 60 * 60 * 1000
              : 48 * 60 * 60 * 1000,
          edgeMaxAge: 30 * 60
        });
      } catch (error) {
        return analyticsJsonResponse(
          {
            ok:false,
            error:String(
              error?.message || error
            )
          },
          corsHeaders,
          500
        );
      }
    }

    if (url.pathname === "/admin/ping") {
      if (!analyticsAuthorized(request, env)) {
        return analyticsJsonResponse(
          { ok:false, error:"Unauthorized" },
          corsHeaders,
          401
        );
      }

      const dbStatus = await analyticsDatabaseStatus(env);

      return analyticsJsonResponse({
        ok:true,
        bindings:{
          CONTENT_DB:Boolean(env.CONTENT_DB),
          AUDIENCE_DB:Boolean(env.AUDIENCE_DB),
          BEHAVIOR_DB:Boolean(env.BEHAVIOR_DB)
        },
        ga4:{
          collectionConfigured:ga4CollectionConfigured(env),
          reportingConfigured:ga4ReportingConfigured(env)
        },
        ...dbStatus
      }, corsHeaders);
    }

    if (
      url.pathname === "/admin/sources" ||
      url.pathname === "/admin/source-report" ||
      url.pathname === "/admin/audience" ||
      url.pathname === "/admin/behavior" ||
      url.pathname === "/admin/feedback" ||
      url.pathname === "/admin/demographics" ||
      url.pathname === "/admin/ads" ||
      url.pathname === "/admin/ad" ||
      url.pathname === "/admin/ad-report" ||
      url.pathname === "/admin/ga4/status" ||
      url.pathname === "/admin/export"
    ) {
      if (!analyticsAuthorized(request, env)) {
        return analyticsJsonResponse(
          { ok:false, error:"Unauthorized" },
          corsHeaders,
          401
        );
      }

      try {
        if (url.pathname === "/admin/sources") {
          return analyticsJsonResponse(
            await sourceStatsCached(env, url.searchParams.get("range") || "7d"),
            corsHeaders, 200, { "Cache-Control":"private, no-store" }
          );
        }
        if (url.pathname === "/admin/source-report") {
          const name=clipAnalytics(url.searchParams.get("source")||"",240);
          const data=await sourceStatsCached(env,url.searchParams.get("range")||"7d");
          const html=sourceReportHtml(data,name);
          if(!html)return analyticsJsonResponse({ok:false,error:"Source not found"},corsHeaders,404);
          return new Response(html,{status:200,headers:{
            ...corsHeaders,"Content-Type":"text/html; charset=utf-8",
            "Content-Security-Policy":"default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; sandbox",
            "Content-Disposition":'attachment; filename="floew-sources-'+data.range+(name?"-single":"")+'.html"',
            "Cache-Control":"private, no-store"
          }});
        }
        if (url.pathname === "/admin/audience") {
          return analyticsJsonResponse(
            await audienceSummary(
              env,
              url.searchParams.get("range") || "7d"
            ),
            corsHeaders
          );
        }

        if (url.pathname === "/admin/behavior") {
          behaviorV3Schedule(ctx,env);
          return analyticsJsonResponse(
            await behaviorSummaryCached(
              env, request, ctx,
              url.searchParams.get("range") || "7d"
            ),
            corsHeaders
          );
        }

        if (url.pathname === "/admin/feedback") {
          return analyticsJsonResponse(
            await feedbackAdminPage(
              env,
              url.searchParams.get("cursor") || "",
              url.searchParams.get("limit") || "250"
            ),
            corsHeaders
          );
        }

        if (url.pathname === "/admin/demographics") {
          return analyticsJsonResponse(
            await ga4GeneralDemographics(
              env,
              url.searchParams.get("range") || "7d"
            ),
            corsHeaders
          );
        }

        if (url.pathname === "/admin/ads") {
          const data = await adSummary(
            env,
            url.searchParams.get("range") || "7d"
          );
          data.ads = await enrichAdSummaries(data.ads, env);
          return analyticsJsonResponse(data, corsHeaders);
        }

        if (url.pathname === "/admin/ad") {
          const adId = clipAnalytics(
            url.searchParams.get("id") || "",
            120
          );

          if (!adId) {
            return analyticsJsonResponse(
              { ok:false, error:"Missing ad id" },
              corsHeaders,
              400
            );
          }

          return analyticsJsonResponse(
            await adDetail(
              env,
              adId,
              url.searchParams.get("range") || "7d"
            ),
            corsHeaders
          );
        }

        if (url.pathname === "/admin/ga4/status") {
          return analyticsJsonResponse(
            {
              ok:true,
              status:await ga4Status(env)
            },
            corsHeaders
          );
        }

        if (url.pathname === "/admin/ad-report") {
          const adId = clipAnalytics(
            url.searchParams.get("id") || "",
            120
          );

          if (!adId) {
            return analyticsJsonResponse(
              { ok:false, error:"Missing ad id" },
              corsHeaders,
              400
            );
          }

          const html = await adReportHtml(
            env,
            adId,
            url.searchParams.get("range") || "7d"
          );

          const safeId = adId
            .replace(/[^A-Za-z0-9_-]+/g, "-")
            .slice(0, 80);

          return new Response(html, {
            status:200,
            headers:{
              ...corsHeaders,
              "Content-Type":"text/html; charset=utf-8",
              "Content-Disposition":`attachment; filename="floew-ad-${safeId}-${url.searchParams.get("range") || "7d"}.html"`,
              "Cache-Control":"no-store"
            }
          });
        }

        const html = await analyticsExportHtml(env, request, ctx);
        const stamp = new Date().toISOString().slice(0,10);
        return new Response(html, {
          status: 200,
          headers: {
            ...corsHeaders,
            "Content-Type":"text/html; charset=utf-8",
            "Content-Disposition":`attachment; filename="floew-analytics-${stamp}.html"`,
            "Cache-Control":"no-store"
          }
        });
      } catch (error) {
        return analyticsJsonResponse(
          { ok:false, error:String(error?.message||error) },
          corsHeaders,
          500
        );
      }
    }


    return analyticsJsonResponse(
      {
        ok: true,
        service: "Flöw Analytics Worker",
        endpoints: [
          "/track",
          "/stats/public",
          "/stats/flora-scores",
          "/stats/flora-story",
          "/stats/flora-vocabulary",
          "/analytics/config",
          "/analytics/health",
          "/admin/ping",
          "/admin/audience",
          "/admin/sources",
          "/admin/source-report",
          "/admin/behavior",
          "/admin/feedback",
          "/admin/feedback-delete",
          "/admin/demographics",
          "/admin/ads",
          "/admin/ad",
          "/admin/ad-report",
          "/admin/ga4/status",
          "/admin/ga4/setup",
          "/admin/export",
          "/admin/setup",
          "/admin/backfill-content-daily"
        ]
      },
      corsHeaders,
      200,
      { "Cache-Control": "no-store" }
    );
  }
};