window.__floewAppStarted=true;
window.__floewAppVersion="31.79.2";
const FLOEW_CONFIG=window.FLOEW_CONFIG||{};
const NEWS_WORKER_BASE=String(
  FLOEW_CONFIG.newsWorkerBase||"https://thefloew.thefloewback.workers.dev"
).replace(/\/$/,"");
const ANALYTICS_WORKER_BASE=String(
  FLOEW_CONFIG.analyticsWorkerBase||"https://thefloew-analytics.thefloewback.workers.dev"
).replace(/\/$/,"");
const MARKET_WORKER_BASE=String(
  FLOEW_CONFIG.marketWorkerBase||"https://thefloew-market.thefloewback.workers.dev"
).replace(/\/$/,"");
const API=`${NEWS_WORKER_BASE}/news`;
const VIDEO_API=`${NEWS_WORKER_BASE}/video`;
const IMAGE_PROXY_API=`${NEWS_WORKER_BASE}/image`;
const CUSTOM_RSS_API=`${NEWS_WORKER_BASE}/custom-rss`;
const SOURCE_VIEW_API=`${NEWS_WORKER_BASE}/source`;
const MARKET_API=`${MARKET_WORKER_BASE}/market`;
const FLORA_SCORES_API=`${ANALYTICS_WORKER_BASE}/stats/flora-scores`;
const FLORA_STORY_API=`${ANALYTICS_WORKER_BASE}/stats/flora-story`;
const NEWS_REQUEST_SESSION=
  `${Date.now().toString(36)}-${Math.random().toString(36).slice(2,10)}`;
const NEWS_BATCH_CACHE_PREFIX="thefloew.newsBatchCache.v1.";
const NEWS_BATCH_CACHE_MAX_AGE_MS=20*60*1000;

const NEWS_BATCH_COUNT=Math.max(1,Number(FLOEW_CONFIG.newsBatchCount)||12);

/*
  12 Worker batch'ini aynı anda ateşlemek özellikle mobil tarayıcılarda
  bağlantı havuzunu ve Worker tarafındaki RSS isteklerini gereksiz biçimde
  sıkıştırabiliyor. Küçük bir kuyruk daha kararlı davranıyor.
*/
const NEWS_BATCH_CONCURRENCY=4;
const INITIAL_NEWS_BATCH_COUNT=Math.min(NEWS_BATCH_COUNT,4);
const NEWS_FETCH_TIMEOUT_MS=22000;
const NEWS_JSONP_TIMEOUT_MS=22000;
const NEWS_BATCH_STALE_CACHE_MAX_AGE_MS=24*60*60*1000;
const DEFAULT_SHOW_SECONDS=10;
const SHOW_SECONDS_KEY="thefloew.showSeconds.v1";
const TIME_RANGE_KEY="thefloew.timeRange.v1";
const FEED_ORDER_KEY="thefloew.feedOrder.v1";
const RECENT_SEEN_KEY="thefloew.recentSeen.v1";
const RECENT_SEEN_TTL_MS=6*60*60*1000;
const RECENT_SEEN_MAX=300;
const ALGO_TOP_CANDIDATES=6;
const ALGO_SESSION_SEED=`${Date.now().toString(36)}-${Math.random().toString(36).slice(2,10)}`;
const KEYWORD_FILTER_KEY="thefloew.keywordFilter.v1";
const KEYWORD_WATCH_KEY="thefloew.keywordWatch.v1";
const WEATHER_PREFS_KEY="thefloew.weather.v1";
const FX_RATES_VISIBLE_KEY="thefloew.fxRatesVisible.v1";
const STOCK_TICKER_VISIBLE_KEY="thefloew.stockTickerVisible.v1";
const STOCK_TICKER_SCALE_KEY="thefloew.stockTickerScale.v1";
const MARKET_DATA_CACHE_KEY="thefloew.marketDataCache.v1";
const MARKET_REFRESH_MS=60*1000;
const MARKET_CACHE_MAX_AGE_MS=6*60*60*1000;
const GOLD_SPOT_API="https://api.gold-api.com/price/XAU";
const GOLD_REFRESH_MS=5*60*1000;
const TROY_OUNCE_GRAMS=31.1034768;
const STOCK_TICKER_SCALE_MIN=.8;
const STOCK_TICKER_SCALE_STEP=.1;
const COOKIE_NOTICE_KEY="thefloew.cookieNotice.v1";
const CUSTOM_RSS_STORAGE_KEY="thefloew.customRss.v1";
const CUSTOM_RSS_LEGACY_COOKIE_KEY="thefloew.customRss.v1";
const CUSTOM_RSS_MAX_FEEDS=8;
const CUSTOM_RSS_MAX_URL_LENGTH=320;
const CUSTOM_RSS_FALLBACK_IMAGE="assets/defaultrss.jpg";

/*
  Algoritmik akışta farklı kaynakların aynı olayı çok benzer başlıklarla
  tekrar etmesini azaltır. Kronolojik mod bu kurala hiçbir zaman girmez.
*/
const NEAR_DUPLICATE_PREF_KEY="thefloew.nearDuplicateDedup.v1";
const NEAR_DUPLICATE_WINDOW_MS=8*60*60*1000;
const NEAR_DUPLICATE_HISTORY_DEPTH=20;
const NEAR_DUPLICATE_MIN_COMMON_TOKENS=3;
const NEAR_DUPLICATE_OVERLAP_THRESHOLD=.70;
const NEAR_DUPLICATE_JACCARD_THRESHOLD=.38;
const REFRESH_MS=120000;
const SWIPE=44;
const TOUCH_DRAG_START_PX=7;
const TOUCH_DRAG_COMMIT_RATIO=.18;
const TOUCH_DRAG_MIN_COMMIT_PX=64;
const TOUCH_DRAG_VELOCITY_PX_MS=.48;

const ADS_MANIFESTS=FLOEW_CONFIG.adsManifest||{hor:"data/ads-hor.json",ver:"data/ads-ver.json"};
const ADS_CACHE_KEY="thefloew.adsCatalog.v6";
const ADS_TEST_MODE=new URLSearchParams(location.search).get("adtest")==="1";
const ADS_INTERVAL_NEWS=10;
const AD_IMAGE_MS=15000;
const ADS_REFRESH_MS=5*60*1000;
let adsCatalogPromise=null;
let adsCatalogPromiseLayout="";
let adCatalogLayout="";
let adLayoutRefreshTimer=null;
let adTestRan=false;

function loadShowDuration(){
  try{
    const saved=Number(localStorage.getItem(SHOW_SECONDS_KEY));
    if(Number.isFinite(saved)){
      return Math.min(60,Math.max(5,Math.round(saved)));
    }
  }catch(e){}
  return DEFAULT_SHOW_SECONDS;
}

let showDurationSeconds=loadShowDuration();
let autoAdvancePaused=false;
let sourceViewerOpen=false;
let sourceViewerRemainingMs=0;
let sourceViewerArticleUrl="";
let sourceViewerDirectMode=false;
let uiFlowPauseActive=false;
let uiFlowPauseRemainingMs=0;

function loadNearDuplicateDedupPreference(){
  try{
    const raw=localStorage.getItem(NEAR_DUPLICATE_PREF_KEY);
    return raw===null ? true : raw!=="0";
  }catch(e){
    return true;
  }
}

let nearDuplicateDedupEnabled=loadNearDuplicateDedupPreference();

function saveNearDuplicateDedupPreference(){
  try{
    localStorage.setItem(
      NEAR_DUPLICATE_PREF_KEY,
      nearDuplicateDedupEnabled ? "1" : "0"
    );
  }catch(e){}
}

function loadBooleanUiPreference(key,defaultValue){
  try{
    const raw=localStorage.getItem(key);
    return raw===null ? Boolean(defaultValue) : raw!=="0";
  }catch(e){
    return Boolean(defaultValue);
  }
}

let fxRatesVisible=loadBooleanUiPreference(FX_RATES_VISIBLE_KEY,true);
let stockTickerVisible=loadBooleanUiPreference(STOCK_TICKER_VISIBLE_KEY,false);

function saveBooleanUiPreference(key,value){
  try{
    localStorage.setItem(key,value?"1":"0");
  }catch(e){}
}


function readCookieValue(name){
  const prefix=`${encodeURIComponent(name)}=`;

  for(const part of String(document.cookie||"").split(";")){
    const value=part.trim();
    if(value.startsWith(prefix)){
      return decodeURIComponent(value.slice(prefix.length));
    }
  }

  return "";
}

function writeCookieValue(name,value,maxAgeSeconds=31536000){
  document.cookie=
    `${encodeURIComponent(name)}=${encodeURIComponent(value)}; `+
    `Path=/; Max-Age=${Math.max(0,Math.round(maxAgeSeconds))}; `+
    "SameSite=Lax";
}

function normalizeCustomRssUrl(value){
  const raw=String(value||"").trim();
  if(!raw || raw.length>CUSTOM_RSS_MAX_URL_LENGTH)return "";

  try{
    const url=new URL(raw);
    if(url.protocol!=="https:" && url.protocol!=="http:")return "";
    if(url.username || url.password)return "";
    return url.href;
  }catch(e){
    return "";
  }
}

function normalizeCustomRssCollection(parsed){
  if(!Array.isArray(parsed))return [];

  const seen=new Set();
  const feeds=[];

  for(const entry of parsed){
    const url=normalizeCustomRssUrl(
      typeof entry==="string" ? entry : entry?.url
    );

    if(!url || seen.has(url))continue;
    seen.add(url);
    feeds.push({url});

    if(feeds.length>=CUSTOM_RSS_MAX_FEEDS)break;
  }

  return feeds;
}

function loadCustomRssFeeds(){
  try{
    const stored=localStorage.getItem(CUSTOM_RSS_STORAGE_KEY);
    if(stored){
      return normalizeCustomRssCollection(JSON.parse(stored));
    }

    /*
      V31.28: önceki sürümlerde özel RSS listesi cookie'de tutuluyordu.
      Bir kez okuyup localStorage'a taşı; mevcut kullanıcı listesi kaybolmasın.
    */
    const legacy=readCookieValue(CUSTOM_RSS_LEGACY_COOKIE_KEY);
    if(!legacy)return [];

    const feeds=normalizeCustomRssCollection(JSON.parse(legacy));
    if(feeds.length){
      localStorage.setItem(
        CUSTOM_RSS_STORAGE_KEY,
        JSON.stringify(feeds)
      );
    }
    writeCookieValue(CUSTOM_RSS_LEGACY_COOKIE_KEY,"",0);
    return feeds;
  }catch(e){
    console.warn("Custom RSS storage:",e);
    return [];
  }
}

let customRssFeeds=loadCustomRssFeeds();
let customRssSourceKeys=new Set();

function saveCustomRssFeeds(){
  try{
    localStorage.setItem(
      CUSTOM_RSS_STORAGE_KEY,
      JSON.stringify(customRssFeeds.map(feed=>({url:feed.url})))
    );
    return true;
  }catch(e){
    console.warn("Custom RSS save:",e);
    return false;
  }
}

function customRssClientError(message,code="unknown",status=0,details={}){
  const error=new Error(message||code||"Custom RSS error");
  error.code=String(code||"unknown");
  error.status=Number(status)||0;
  error.details=details&&typeof details==="object"?details:{};
  return error;
}

function customRssErrorMessage(error){
  const code=String(error?.code||"");
  const upstreamStatus=Number(error?.details?.upstream_status||0);

  if(error?.name==="AbortError" || code==="timeout"){
    return "Kaynak çok yavaş yanıt verdi (zaman aşımı).";
  }

  switch(code){
    case "invalid_url":
    case "unsafe_url":
      return "Bu adres geçerli ve herkese açık bir RSS/Atom adresi değil.";

    case "unsafe_redirect":
      return "RSS adresinin yönlendirmesi güvenlik nedeniyle engellendi.";

    case "too_many_redirects":
      return "RSS adresi çok fazla yönlendirme yapıyor.";

    case "upstream_forbidden":
      return `Kaynak Worker erişimini reddetti${upstreamStatus?` (${upstreamStatus})`:""}.`;

    case "upstream_rate_limited":
      return "Kaynak çok fazla istek nedeniyle erişimi geçici olarak sınırladı (429).";

    case "upstream_not_found":
      return `RSS adresi bulunamadı${upstreamStatus?` (${upstreamStatus})`:""}.`;

    case "upstream_error":
      return `Kaynak sunucusu geçici bir hata verdi${upstreamStatus?` (${upstreamStatus})`:""}.`;

    case "upstream_http":
      return `Kaynak isteği kabul etmedi${upstreamStatus?` (${upstreamStatus})`:""}.`;

    case "feed_too_large":
      return "RSS dosyası çok büyük (2,5 MB sınırı).";

    case "unsupported_format":
      return "Adres desteklenen bir RSS, Atom veya JSON Feed biçimi döndürmüyor.";

    case "no_items":
      return "RSS bulundu ancak kullanılabilir haber bulunamadı.";

    case "network_error":
      return "Kaynağa ağ üzerinden ulaşılamadı.";

    default:
      return error?.status
        ? `RSS kaynağı okunamadı (HTTP ${error.status}).`
        : "RSS adresine ulaşılamadı veya kaynak okunamadı.";
  }
}

async function fetchCustomRssFeed(feed){
  const controller=new AbortController();
  const timeout=setTimeout(()=>controller.abort(),12000);

  try{
    const url=new URL(CUSTOM_RSS_API);
    url.searchParams.set("url",feed.url);

    const response=await fetch(url.href,{
      method:"GET",
      mode:"cors",
      credentials:"omit",
      cache:"no-store",
      signal:controller.signal,
      headers:{"Accept":"application/json"}
    });

    let data=null;
    try{
      data=await response.json();
    }catch(e){
      if(response.ok){
        throw customRssClientError(
          "Worker geçersiz JSON yanıtı döndürdü.",
          "invalid_worker_response",
          response.status
        );
      }
    }

    if(!response.ok || data?.ok===false){
      throw customRssClientError(
        String(data?.error||`HTTP ${response.status}`),
        String(data?.code||`http_${response.status}`),
        response.status,
        data||{}
      );
    }

    const items=Array.isArray(data?.items)
      ? data.items
      : Array.isArray(data)
        ? data
        : [];

    const fetchedAt=Date.now();
    const sourceName=String(data?.source||"").trim();

    return items
      .filter(item=>item?.title && item?.link)
      .map((item,index)=>{
        const publishedMs=new Date(item?.published).getTime();

        /*
          Bazı RSS/Atom akışları tarih alanını hiç vermiyor ya da tarayıcının
          parse edemediği bir format kullanıyor. Kronolojik modda bu maddeler
          listenin görünmez dibine düşmesin: feed sırasını koruyacak biçimde
          çekim anından geriye doğru küçük bir fallback zaman damgası veriyoruz.
        */
        const published=Number.isFinite(publishedMs)
          ? item.published
          : new Date(fetchedAt-index*1000).toISOString();

        return {
          ...item,
          source:String(item.source||sourceName||"Özel RSS").trim()||"Özel RSS",
          published,
          customRss:true,
          customRssFeedUrl:feed.url,
          image:String(item.image||"").trim() || CUSTOM_RSS_FALLBACK_IMAGE
        };
      });
  }catch(error){
    if(error?.name==="AbortError"){
      const timeoutError=customRssClientError(
        "RSS isteği zaman aşımına uğradı.",
        "timeout",
        0
      );
      timeoutError.name="AbortError";
      throw timeoutError;
    }
    throw error;
  }finally{
    clearTimeout(timeout);
  }
}

async function loadCustomRssStories(){
  if(!customRssFeeds.length)return [];

  const settled=await Promise.allSettled(
    customRssFeeds.map(fetchCustomRssFeed)
  );

  const stories=[];

  settled.forEach((result,index)=>{
    if(result.status==="fulfilled"){
      stories.push(...result.value);
    }else{
      console.warn(
        "Custom RSS:",
        customRssFeeds[index]?.url,
        result.reason
      );
    }
  });

  return stories;
}

const TIME_RANGE_OPTIONS=[
  {value:"1",hours:1,label:"1 saat"},
  {value:"2",hours:2,label:"2 saat"},
  {value:"4",hours:4,label:"4 saat"},
  {value:"8",hours:8,label:"8 saat"},
  {value:"16",hours:16,label:"16 saat"},
  {value:"24",hours:24,label:"1 gün"},
  {value:"120",hours:120,label:"5 gün"},
  {value:"all",hours:Infinity,label:"Tüm zamanlar"}
];

function normalizeTimeRangeValue(value){
  const raw=String(value??"all");
  return TIME_RANGE_OPTIONS.some(option=>option.value===raw)
    ? raw
    : "all";
}

function loadTimeRange(){
  try{
    return normalizeTimeRangeValue(
      localStorage.getItem(TIME_RANGE_KEY)
    );
  }catch(e){
    return "all";
  }
}

let timeRangeValue=loadTimeRange();

function saveTimeRange(){
  try{
    localStorage.setItem(
      TIME_RANGE_KEY,
      timeRangeValue
    );
  }catch(e){}
}

function currentTimeRangeOption(){
  return TIME_RANGE_OPTIONS.find(
    option=>option.value===timeRangeValue
  ) || TIME_RANGE_OPTIONS[TIME_RANGE_OPTIONS.length-1];
}

const FEED_ORDER_MODES=[
  {value:"algorithmic",label:"Algoritmik"},
  {value:"chronological",label:"Kronolojik"}
];

function normalizeFeedOrderMode(value){
  const raw=String(value||"algorithmic");
  return FEED_ORDER_MODES.some(option=>option.value===raw)
    ? raw
    : "algorithmic";
}

function loadFeedOrderMode(){
  try{
    return normalizeFeedOrderMode(
      localStorage.getItem(FEED_ORDER_KEY)
    );
  }catch(e){
    return "algorithmic";
  }
}

let feedOrderMode=loadFeedOrderMode();

function saveFeedOrderMode(){
  try{
    localStorage.setItem(FEED_ORDER_KEY,feedOrderMode);
  }catch(e){}
}

function currentFeedOrderOption(){
  return FEED_ORDER_MODES.find(
    option=>option.value===feedOrderMode
  ) || FEED_ORDER_MODES[0];
}

function saveShowDuration(){
  try{
    localStorage.setItem(
      SHOW_SECONDS_KEY,
      String(showDurationSeconds)
    );
  }catch(e){}
}

function loadWeatherPreferences(){
  try{
    const raw=localStorage.getItem(WEATHER_PREFS_KEY);
    if(!raw){
      return {
        city:"İstanbul",
        label:"İstanbul",
        unit:"celsius",
        lat:null,
        lon:null
      };
    }

    const p=JSON.parse(raw)||{};

    return {
      city:String(p.city||"İstanbul"),
      label:String(p.label||p.city||"İstanbul"),
      unit:p.unit==="fahrenheit"?"fahrenheit":"celsius",
      lat:Number.isFinite(p.lat)?p.lat:null,
      lon:Number.isFinite(p.lon)?p.lon:null
    };
  }catch(e){
    return {
      city:"İstanbul",
      label:"İstanbul",
      unit:"celsius",
      lat:null,
      lon:null
    };
  }
}

let weatherPreferences=loadWeatherPreferences();

function saveWeatherPreferences(){
  try{
    localStorage.setItem(
      WEATHER_PREFS_KEY,
      JSON.stringify(weatherPreferences)
    );
  }catch(e){}
}

const SOURCE_LOGOS={
  "cnn türk":"https://icons.duckduckgo.com/ip3/cnnturk.com.ico",
  "cnn turk":"https://icons.duckduckgo.com/ip3/cnnturk.com.ico",
  "sözcü":"https://icons.duckduckgo.com/ip3/sozcu.com.tr.ico",
  "sozcu":"https://icons.duckduckgo.com/ip3/sozcu.com.tr.ico",
  "anadolu ajansı":"https://icons.duckduckgo.com/ip3/aa.com.tr.ico",
  "aa":"https://icons.duckduckgo.com/ip3/aa.com.tr.ico",
  "trt haber":"https://icons.duckduckgo.com/ip3/trthaber.com.ico",
  "ntv":"https://icons.duckduckgo.com/ip3/ntv.com.tr.ico",
  "habertürk":"https://icons.duckduckgo.com/ip3/haberturk.com.ico",
  "haberturk":"https://icons.duckduckgo.com/ip3/haberturk.com.ico",
  "hürriyet":"https://icons.duckduckgo.com/ip3/hurriyet.com.tr.ico",
  "hurriyet":"https://icons.duckduckgo.com/ip3/hurriyet.com.tr.ico",
  "cumhuriyet":"https://icons.duckduckgo.com/ip3/cumhuriyet.com.tr.ico",
  "milliyet":"https://icons.duckduckgo.com/ip3/milliyet.com.tr.ico",
  "bbc türkçe":"https://icons.duckduckgo.com/ip3/bbc.com.ico",
  "dw türkçe":"https://icons.duckduckgo.com/ip3/dw.com.ico",
  "mynet":"https://icons.duckduckgo.com/ip3/mynet.com.ico",
  "sputnik türkiye":"https://icons.duckduckgo.com/ip3/sputniknews.com.ico",
  "bigpara":"https://icons.duckduckgo.com/ip3/bigpara.hurriyet.com.tr.ico",
  "ekoseyir":"https://icons.duckduckgo.com/ip3/ekoseyir.com.ico",
  "aydinlik":"https://icons.duckduckgo.com/ip3/aydinlik.com.tr.ico",
  "bha":"https://icons.duckduckgo.com/ip3/bha.net.tr.ico",
  "birgun":"https://icons.duckduckgo.com/ip3/birgun.net.ico",
  "bloomberg ht":"https://icons.duckduckgo.com/ip3/bloomberght.com.ico",
  "capital":"https://icons.duckduckgo.com/ip3/capital.com.tr.ico",
  "forbes":"https://icons.duckduckgo.com/ip3/forbes.com.tr.ico",
  "cnbc-e":"https://icons.duckduckgo.com/ip3/cnbce.com.ico",
  "diken":"https://icons.duckduckgo.com/ip3/diken.com.tr.ico",
  "halk tv":"https://icons.duckduckgo.com/ip3/halktv.com.tr.ico",
  "independent turkce":"https://icons.duckduckgo.com/ip3/indyturk.com.ico",
  "teyit.org":"https://icons.duckduckgo.com/ip3/teyit.org.ico",

  "shiftdelete.net":"https://icons.duckduckgo.com/ip3/shiftdelete.net.ico",
  "onedio":"https://icons.duckduckgo.com/ip3/onedio.com.ico",
  "beyazperde":"https://icons.duckduckgo.com/ip3/beyazperde.com.ico",
  "motor1 türkiye":"https://icons.duckduckgo.com/ip3/tr.motor1.com.ico",
  "chip online":"https://icons.duckduckgo.com/ip3/chip.com.tr.ico",
  "log":"https://icons.duckduckgo.com/ip3/log.com.tr.ico",
  "teknopat":"https://icons.duckduckgo.com/ip3/technopat.net.ico",
  "evrim ağacı":"https://icons.duckduckgo.com/ip3/evrimagaci.org.ico",
  "bant mag.":"https://icons.duckduckgo.com/ip3/bantmag.com.ico",
  "bir baba indie":"https://icons.duckduckgo.com/ip3/birbabaindie.com.ico",
  "independent bilim":"https://icons.duckduckgo.com/ip3/indyturk.com.ico",
  "2yaka":"https://icons.duckduckgo.com/ip3/2yaka.org.ico",
  "cazkolik":"https://icons.duckduckgo.com/ip3/cazkolik.com.ico",
  "deli kasap":"https://icons.duckduckgo.com/ip3/delikasap.org.ico",
  "edebiyat haber":"https://icons.duckduckgo.com/ip3/edebiyathaber.net.ico",
  "elle türkiye":"https://icons.duckduckgo.com/ip3/elle.com.tr.ico",
  "marie claire türkiye":"https://icons.duckduckgo.com/ip3/marieclaire.com.tr.ico",
  "istanbul life":"https://icons.duckduckgo.com/ip3/istanbullife.com.tr.ico",
  "live to bloom":"https://icons.duckduckgo.com/ip3/livetobloom.com.ico",
  "elele":"https://icons.duckduckgo.com/ip3/elele.com.tr.ico",
  "bigumigu":"https://icons.duckduckgo.com/ip3/bigumigu.com.ico",
  "basket dergisi":"https://icons.duckduckgo.com/ip3/basketdergisi.com.ico",
  "arkeofili":"https://icons.duckduckgo.com/ip3/arkeofili.com.ico",
  "işin detayı":"https://icons.duckduckgo.com/ip3/isindetayi.com.ico",
  "al jazeera":"https://icons.duckduckgo.com/ip3/aljazeera.com.ico",
  "dw":"https://icons.duckduckgo.com/ip3/dw.com.ico",
  "france 24":"https://icons.duckduckgo.com/ip3/france24.com.ico",
  "euronews":"https://icons.duckduckgo.com/ip3/euronews.com.ico",
  "sky news":"https://icons.duckduckgo.com/ip3/news.sky.com.ico",
  "bbc news":"https://icons.duckduckgo.com/ip3/bbc.com.ico",
  "the new york times":"https://icons.duckduckgo.com/ip3/nytimes.com.ico",
  "npr":"https://icons.duckduckgo.com/ip3/npr.org.ico",
  "nbc news":"https://icons.duckduckgo.com/ip3/nbcnews.com.ico",
  "los angeles times":"https://icons.duckduckgo.com/ip3/latimes.com.ico",
  "the guardian":"https://icons.duckduckgo.com/ip3/theguardian.com.ico",
  "the independent":"https://icons.duckduckgo.com/ip3/independent.co.uk.ico",
  "financial times":"https://icons.duckduckgo.com/ip3/ft.com.ico",
  "the sun":"https://icons.duckduckgo.com/ip3/thesun.co.uk.ico",
  "the mirror":"https://icons.duckduckgo.com/ip3/mirror.co.uk.ico",
  "le monde":"https://icons.duckduckgo.com/ip3/lemonde.fr.ico",
  "global news":"https://icons.duckduckgo.com/ip3/globalnews.ca.ico",
  "south china morning post":"https://icons.duckduckgo.com/ip3/scmp.com.ico",
  "the sydney morning herald":"https://icons.duckduckgo.com/ip3/smh.com.au.ico",
  "the japan times":"https://icons.duckduckgo.com/ip3/japantimes.co.jp.ico",
  "cnbc":"https://icons.duckduckgo.com/ip3/cnbc.com.ico",
  "the wall street journal":"https://icons.duckduckgo.com/ip3/wsj.com.ico",
  "the verge":"https://icons.duckduckgo.com/ip3/theverge.com.ico",
  "techcrunch":"https://icons.duckduckgo.com/ip3/techcrunch.com.ico",
  "wired":"https://icons.duckduckgo.com/ip3/wired.com.ico",
  "vox":"https://icons.duckduckgo.com/ip3/vox.com.ico",
  "rt":"https://icons.duckduckgo.com/ip3/rt.com.ico",
  "sputnik":"https://icons.duckduckgo.com/ip3/sputnikglobe.com.ico"

};

const slides=[document.getElementById("a"),document.getElementById("b")];

const adOverlay=document.getElementById("ad-overlay");
const adImage=document.getElementById("ad-image");
const adVideo=document.getElementById("ad-video");

let adCatalog=[];
let adActive=false;
let newsShownSinceAd=0;
let lastAdName="";
let adCatalogRefreshTimer=null;
let adPlaybackFinish=null;
let adHasEntered=false;
let adSkipRequestedDirection=0;

/*
  Reklamı açan wheel/swipe hareketinin kalan momentum event'leri reklamı
  yanlışlıkla hemen atlamasın. Reklam tamamen girdikten kısa süre sonra
  kullanıcı skip hareketlerini kabul etmeye başlarız.
*/
let adSkipEnabledAt=0;
const AD_SKIP_GRACE_MS=180;

let currentAd=null;
let adEntryDirection=1;

/*
  Reklamlar haber history dizisini bozmadan iki komşu haber arasındaki gerçek
  navigation kayıtları olarak tutulur. Bu, daha önce çalışan replayRecord
  modelinin güncel sürüme uyarlanmış halidir. Reklam tamamlanmadan geçilse de
  A -> reklam -> B sınırı history'de kalır ve geri/ileri gezinmede aynı reklam
  yeniden açılır.
*/
const adHistoryByAfterPos=new Map();
let activeAdRecord=null;
let historicalAdContext=null;

function clearAdNavigationHistory(){
  adHistoryByAfterPos.clear();
  activeAdRecord=null;
  historicalAdContext=null;
}

function adRecordAfterCurrent(){
  const record=adHistoryByAfterPos.get(state.historyPos+1);
  if(
    record &&
    record.beforeHistoryPos===state.historyPos &&
    record.afterHistoryPos===state.historyPos+1
  ){
    return record;
  }
  return null;
}

function adRecordBeforeCurrent(){
  const record=adHistoryByAfterPos.get(state.historyPos);
  if(
    record &&
    record.afterHistoryPos===state.historyPos &&
    record.beforeHistoryPos===state.historyPos-1
  ){
    return record;
  }
  return null;
}

/*
  V31.26.1 — mobil reklam direct-drag durumu.
  Reklam, haberlerdekiyle aynı biçimde parmağı takip eder. Commit sonrası
  mevcut reklam/history akışı korunur; yalnız görsel geçiş ikinci kez
  animasyonlandırılmaz.
*/
let touchAdDragActive=false;
let touchAdDragDirection=0;
let touchAdDragTargetIndex=-1;
let touchAdDragTargetSlide=null;
let touchAdDragDy=0;
let touchAdDragLastY=0;
let touchAdDragLastT=0;
let touchAdDragVelocityY=0;
let touchAdDragCommitted=null;

const state={
  stories:[],
  index:0,
  active:0,
  busy:false,
  timer:null,
  timerDeadline:0,
  timerRemainingMs:0,
  x:0,y:0,t:0,
  pointerId:null,
  swipeHandled:false,
  swipeTouch:false,
  touchDragActive:false,
  touchDragDirection:0,
  touchDragTargetIndex:-1,
  touchDragFromHistory:false,
  touchDragDy:0,
  touchDragLastY:0,
  touchDragLastT:0,
  touchDragVelocityY:0,
  history:[],
  historyPos:0
};
const CATEGORIES=[
  "#SonDakika","#Yaşam","#Türkiye","#Dünya","#Siyaset",
  "#Ekonomi","#Magazin","#Teknoloji","#Kültür-Sanat","#Sinema",
  "#Otomotiv","#Edebiyat","#Müzik","#Televizyon","#Spor",
  "#Sağlık","#Bilim","#Moda","#Tarih","#Gezi"
];

const PREFS_KEY="thefloew.preferences.v5";
const FOREIGN_SOURCE_PREFS_KEY="thefloew.foreignSources.v1";
const FOREIGN_CATEGORY="#Yabancı";
const BASE_FEED_MODE_ORDER=["breaking","agenda","foreign"];
let temporarySourceFilter=null;
let temporaryCategoryFilter=null;

function currentFeedModeOrder(){
  if(temporarySourceFilter){
    return ["breaking","agenda","source","foreign"];
  }

  if(temporaryCategoryFilter){
    return ["breaking","agenda","category","foreign"];
  }

  return BASE_FEED_MODE_ORDER;
}

const NEW_CATEGORIES=["#Yaşam","#Sağlık","#Otomotiv","#Sinema","#Müzik","#Edebiyat","#Televizyon","#Bilim","#Moda","#Tarih","#Gezi"];

function loadPreferences(){
  try{
    const raw=localStorage.getItem(PREFS_KEY);
    if(!raw)return {sources:null,categories:null,direction:"up",videoEnabled:true,videoOnlyEnabled:false};
    const p=JSON.parse(raw)||{};

    let categories=Array.isArray(p.categories)?p.categories.filter(c=>c!=="#Gündem"):null;
    if(categories){
      for(const cat of NEW_CATEGORIES){
        if(!categories.includes(cat))categories.push(cat);
      }
    }

    return {
      sources:Array.isArray(p.sources)?p.sources:null,
      categories,
      direction:["up","down"].includes(p.direction)?p.direction:"up",
      videoEnabled:p.videoEnabled!==false,
      videoOnlyEnabled:p.videoOnlyEnabled===true
    };
  }catch(e){
    console.warn("Preferences:",e);
    return {sources:null,categories:null,direction:"up",videoEnabled:true,videoOnlyEnabled:false};
  }
}

const savedPreferences=loadPreferences();
let transitionDirection=savedPreferences.direction||"up";
let videoEnabled=savedPreferences.videoEnabled!==false;
let videoOnlyEnabled=savedPreferences.videoOnlyEnabled===true;
let sourcePreferencesApplied=false;

function savePreferences(){
  try{
    localStorage.setItem(PREFS_KEY,JSON.stringify({
      sources:[...filters.sources],
      categories:[...filters.categories],
      direction:transitionDirection,
      videoEnabled,
      videoOnlyEnabled
    }));
  }catch(e){
    console.warn("Preferences:",e);
  }
}

function loadForeignSourcePreferences(){
  try{
    const raw=localStorage.getItem(FOREIGN_SOURCE_PREFS_KEY);
    if(!raw)return null;
    const parsed=JSON.parse(raw);
    return Array.isArray(parsed)
      ? parsed.map(sourceKey).filter(Boolean)
      : null;
  }catch(e){
    console.warn("Foreign source preferences:",e);
    return null;
  }
}

function saveForeignSourcePreferences(){
  try{
    localStorage.setItem(
      FOREIGN_SOURCE_PREFS_KEY,
      JSON.stringify([...foreignSourceFilters])
    );
  }catch(e){
    console.warn("Foreign source preferences:",e);
  }
}

const filters={
  sources:new Set(),
  categories:Array.isArray(savedPreferences.categories)
    ? new Set(savedPreferences.categories.filter(c=>CATEGORIES.includes(c)))
    : new Set(CATEGORIES)
};

let knownSources=[];
let knownForeignSources=[];
let foreignSourceFilters=new Set();
let foreignSourcePreferencesApplied=false;
const savedForeignSources=loadForeignSourcePreferences();

let rawStories=[];

/*
  v31.72 — "Sadece videolu haberler"
  Sonuçlar yalnız bu oturumda cache'lenir. Gerçek video doğrulaması mevcut
  /video resolver üzerinden yapılır; RSS'deki video hint'i tek başına yeterli
  sayılmaz.
*/
const videoOnlyVerdicts=new Map();
const VIDEO_ONLY_TRUE_TTL_MS=20*60*1000;
const VIDEO_ONLY_FALSE_TTL_MS=3*60*1000;
const VIDEO_ONLY_BATCH_SIZE=36;
const VIDEO_ONLY_TARGET_COUNT=18;
const VIDEO_ONLY_MIN_PER_SOURCE=2;
const VIDEO_ONLY_SOURCE_SAMPLE_MAX=6;
const VIDEO_ONLY_CONCURRENCY=5;
let videoOnlyScanRunning=false;
let videoOnlyScanQueued=false;
let videoOnlyScanRerun=false;
let videoOnlyScanGeneration=0;
let videoOnlyFilterRefreshTimer=null;

function videoOnlyVerdictKey(story){
  return mediaKey(story);
}

function currentVideoOnlyVerdict(story){
  /*
    Worker tarafından gerçek bir medya URL'si olarak doğrulanmış ve
    yayıncının /video RSS kanalından geldiği işaretlenmiş haberler,
    video-only için güçlü doğrudan kanıttır. Böylece özellikle CNN Türk
    gibi gerçek video RSS'leri tarama kuyruğunda gereksiz yere kaybolmaz.
  */
  if(
    story?.videoVerified===true &&
    story?.videoArticleHint===true
  ){
    return true;
  }

  const key=videoOnlyVerdictKey(story);
  if(!key)return null;

  const row=videoOnlyVerdicts.get(key);
  if(!row)return null;

  const age=Date.now()-Number(row.checkedAt||0);
  const ttl=row.hasVideo
    ? VIDEO_ONLY_TRUE_TTL_MS
    : VIDEO_ONLY_FALSE_TTL_MS;

  if(age>ttl){
    videoOnlyVerdicts.delete(key);
    return null;
  }

  return Boolean(row.hasVideo);
}

function storyConfirmedVideo(story){
  return currentVideoOnlyVerdict(story)===true;
}

function applyVideoOnlyFilter(list,options={}){
  if(
    !videoOnlyEnabled ||
    options?.skipVideoOnly
  ){
    return list;
  }

  return list.filter(
    story=>storyConfirmedVideo(story)
  );
}

function videoOnlyBaseCandidates(mode=feedMode){
  return storiesForFeedMode(
    mode,
    {skipVideoOnly:true}
  );
}

function videoOnlyFilterRefresh(){
  if(!videoOnlyEnabled)return;

  clearTimeout(videoOnlyFilterRefreshTimer);
  videoOnlyFilterRefreshTimer=setTimeout(()=>{
    if(videoOnlyEnabled){
      applyFilters({
        preserveScan:true,
        preserveHistory:true
      });
    }
  },90);
}

function queueVideoOnlyScan(){
  if(!videoOnlyEnabled)return;

  if(videoOnlyScanRunning){
    videoOnlyScanRerun=true;
    return;
  }

  if(videoOnlyScanQueued)return;
  videoOnlyScanQueued=true;

  setTimeout(()=>{
    videoOnlyScanQueued=false;
    void runVideoOnlyScan();
  },35);
}

function videoOnlyLikelyScore(story){
  let score=0;

  if(story?.videoDiscovery)score+=180;
  if(story?.video)score+=100;

  const text=normalizeText(
    `${story?.title||""} ${story?.description||""}`
  );

  if(
    /\b(video|görüntü|goruntu|kamerada|kameraya|izle|canlı yayın|canli yayin|yayında|yayinda|o anlar)\b/
      .test(text)
  ){
    score+=36;
  }

  if(
    /\b(video galeri|video haber|canlı izle|canli izle)\b/
      .test(text)
  ){
    score+=24;
  }

  return score;
}

function videoOnlySourceStats(candidates){
  const groups=new Map();
  let sourceOrder=0;

  for(const story of candidates){
    const key=sourceKey(story?.source)||"__unknown__";
    let group=groups.get(key);

    if(!group){
      group={
        key,
        order:sourceOrder++,
        total:0,
        checked:0,
        confirmed:0,
        unknown:[]
      };
      groups.set(key,group);
    }

    group.total++;

    const verdict=currentVideoOnlyVerdict(story);

    if(verdict===true){
      group.checked++;
      group.confirmed++;
    }else if(verdict===false){
      group.checked++;
    }else{
      group.unknown.push(story);
    }
  }

  for(const group of groups.values()){
    group.unknown.sort((a,b)=>
      (videoOnlyLikelyScore(b)-videoOnlyLikelyScore(a))
    );
  }

  return groups;
}

function videoOnlySourceCoverage(candidates){
  const groups=videoOnlySourceStats(candidates);
  let complete=true;

  for(const group of groups.values()){
    const required=Math.min(
      VIDEO_ONLY_SOURCE_SAMPLE_MAX,
      group.total
    );

    /*
      Bir kaynakta video bulduysak kaynak kapsaması tamamdır.
      Henüz bulamadıysak, o kaynaktan sınırlı ama gerçek bir örneklem
      tamamlanana kadar aramaya devam ederiz.
    */
    if(
      group.confirmed===0 &&
      group.checked<required &&
      group.unknown.length
    ){
      complete=false;
      break;
    }
  }

  return {
    complete,
    groups
  };
}

function videoOnlyBalancedBatch(candidates){
  const groups=videoOnlySourceStats(candidates);
  const ordered=[];
  const used=new Set();

  const addStory=story=>{
    const key=videoOnlyVerdictKey(story);
    if(!key || used.has(key))return false;

    used.add(key);
    ordered.push(story);
    return true;
  };

  /*
    Öncelik: Henüz tek bir video bile bulamadığımız kaynaklar.
    Kaynakları "kaç haber kontrol edildi" sayısına göre sırala.
    Böylece ilk 36 kaynak dolunca sonraki batch'te aynı kaynaklar tekrar
    başa geçmez; henüz hiç kontrol edilmemiş kaynaklar otomatik olarak öne gelir.
  */
  const uncovered=[...groups.values()]
    .filter(group=>
      group.confirmed===0 &&
      group.unknown.length &&
      group.checked<
        Math.min(
          VIDEO_ONLY_SOURCE_SAMPLE_MAX,
          group.total
        )
    )
    .sort((a,b)=>
      (a.checked-b.checked) ||
      (a.order-b.order)
    );

  let progress=true;

  while(
    progress &&
    ordered.length<VIDEO_ONLY_BATCH_SIZE
  ){
    progress=false;

    for(const group of uncovered){
      const story=group.unknown.shift();
      if(!story)continue;

      if(addStory(story)){
        progress=true;
      }

      if(ordered.length>=VIDEO_ONLY_BATCH_SIZE){
        return ordered;
      }
    }
  }

  /*
    Kaynak kapsaması için ayrılan kapasiteden sonra, kalan yerleri
    video olma ihtimali en yüksek bilinmeyen haberlerle doldur.
  */
  const remainder=[];

  for(const group of groups.values()){
    for(const story of group.unknown){
      remainder.push({
        story,
        score:videoOnlyLikelyScore(story),
        sourceOrder:group.order
      });
    }
  }

  remainder.sort((a,b)=>
    (b.score-a.score) ||
    (a.sourceOrder-b.sourceOrder)
  );

  for(const item of remainder){
    if(addStory(item.story) &&
       ordered.length>=VIDEO_ONLY_BATCH_SIZE){
      break;
    }
  }

  return ordered;
}

async function runVideoOnlyScan(){
  if(!videoOnlyEnabled)return;

  if(videoOnlyScanRunning){
    videoOnlyScanRerun=true;
    return;
  }

  videoOnlyScanRunning=true;
  videoOnlyScanRerun=false;
  const generation=++videoOnlyScanGeneration;

  try{
    const candidates=videoOnlyBaseCandidates(feedMode);
    const unknown=videoOnlyBalancedBatch(candidates);

    if(!unknown.length)return;

    let cursor=0;

    const worker=async()=>{
      while(
        videoOnlyEnabled &&
        generation===videoOnlyScanGeneration
      ){
        const index=cursor++;
        if(index>=unknown.length)return;

        const story=unknown[index];
        const key=videoOnlyVerdictKey(story);
        if(!key)continue;

        let media=null;

        try{
          media=await resolveStoryMedia(
            story,
            {
              force:true,
              strict:true
            }
          );
        }catch(e){
          media=null;
        }

        if(
          !videoOnlyEnabled ||
          generation!==videoOnlyScanGeneration
        ){
          return;
        }

        videoOnlyVerdicts.set(
          key,
          {
            hasVideo:Boolean(media),
            checkedAt:Date.now()
          }
        );

        if(media){
          videoOnlyFilterRefresh();
        }
      }
    };

    await Promise.all(
      Array.from(
        {
          length:Math.min(
            VIDEO_ONLY_CONCURRENCY,
            unknown.length
          )
        },
        ()=>worker()
      )
    );
  }finally{
    if(generation===videoOnlyScanGeneration){
      videoOnlyScanRunning=false;

      if(videoOnlyEnabled){
        videoOnlyFilterRefresh();

        const candidates=videoOnlyBaseCandidates(feedMode);
        const confirmedCount=candidates.filter(
          story=>currentVideoOnlyVerdict(story)===true
        ).length;
        const stillUnknown=candidates.some(
          story=>currentVideoOnlyVerdict(story)===null
        );
        const coverage=
          videoOnlySourceCoverage(candidates);

        /*
          Global hedefe ulaşmış olsak bile her aktif kaynağa asgari tarama
          şansı verilmeden durma. Böylece NTV/Halk TV gibi RSS'inde video hint'i
          taşımayan kaynaklar diğer kaynaklar tarafından aç bırakılmaz.
        */
        if(
          videoOnlyScanRerun ||
          (
            stillUnknown &&
            (
              confirmedCount<VIDEO_ONLY_TARGET_COUNT ||
              !coverage.complete
            )
          )
        ){
          videoOnlyScanRerun=false;
          queueVideoOnlyScan();
        }
      }
    }
  }
}

/*
  IDDQD — hidden six-panel news wall.
  Deliberately runtime-only: no localStorage, URL flag or preference import.
*/
const IDDQD_CODE="IDDQD";
const IDDQD_CATEGORIES=[
  "#Türkiye",
  "#Dünya",
  "#Siyaset",
  "#Ekonomi",
  "#Teknoloji",
  "#Spor"
];
let iddqdModeActive=false;
let iddqdTrustedActionGate="";
let iddqdRotationTimer=null;
const DEFAULT_HEADER_LOGO_SRC="assets/logo-beta.png";
const ADHD_MODE_LOGO_SRC="assets/adhd-mode-logo.png";

const iddqdCategoryPositions=new Map();


/*
  Üst sekme her yeni sayfa yüklemesinde bilinçli olarak Gündem'den başlar.
  Bu değer localStorage'a yazılmaz.
*/
let feedMode="agenda";
const feedModeStoryKeys={
  agenda:"",
  breaking:"",
  source:"",
  category:"",
  foreign:""
};
const BREAKING_WINDOW_MS=20*60*1000;

/*
  Bir kaynak/kategori geçici olarak kapatıldığı için ekrandaki haber
  filtre dışına çıkarsa, kullanıcının geri açması halinde aynı haberi
  geri getirmek için link tabanlı bir dönüş noktası tutuyoruz.
  Normal gezinme başladığında bu dönüş noktası bırakılır.
*/
let filterReturnStoryKey="";

function normalizeText(v){
  return String(v||"")
    .toLocaleLowerCase("tr-TR")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g,"");
}

function canonicalStoryLink(value){
  const raw=String(value||"").trim();
  if(!raw)return "";

  try{
    const url=new URL(raw,location.href);
    url.hash="";

    const removable=[];
    for(const key of url.searchParams.keys()){
      const lower=key.toLowerCase();
      if(
        lower.startsWith("utm_") ||
        [
          "fbclid","gclid","dclid","msclkid","mc_cid","mc_eid",
          "ref","ref_src","ref_url","ocid","cmpid","campaign",
          "partner","output","amp"
        ].includes(lower)
      ){
        removable.push(key);
      }
    }
    removable.forEach(key=>url.searchParams.delete(key));
    url.searchParams.sort();

    if(url.pathname.length>1){
      url.pathname=url.pathname.replace(/\/+$/g,"");
    }

    return url.href;
  }catch(e){
    return raw;
  }
}

function storyIdentity(story){
  if(!story)return "";
  if(story.link)return canonicalStoryLink(story.link);
  return `${String(story.source||"").trim().toLocaleLowerCase("tr-TR")}|${String(story.title||"").trim()}`;
}

/*
  Aynı kaynağın aynı haberi birden fazla RSS/feed URL'sinden farklı link
  varyasyonlarıyla getirmesi mümkündür. History ve algoritmik seçimde bunları
  farklı haber saymamak için kaynak + normalize başlık tabanlı ikincil kimlik.
*/
function exactDuplicateSignature(story){
  if(!story)return "";
  const source=String(story.source||"").trim().toLocaleLowerCase("tr-TR");
  const title=normalizeText(story.title||"")
    .replace(/[^a-z0-9çğıöşü]+/gi," ")
    .replace(/\s+/g," ")
    .trim();
  return source && title ? `${source}|${title}` : "";
}

function pruneRecentSeenEntries(entries){
  const now=Date.now();
  return Object.entries(entries||{})
    .filter(([key,ts])=>
      key &&
      Number.isFinite(Number(ts)) &&
      now-Number(ts)<=RECENT_SEEN_TTL_MS
    )
    .sort((a,b)=>Number(b[1])-Number(a[1]))
    .slice(0,RECENT_SEEN_MAX);
}

function loadRecentSeenStories(){
  try{
    const parsed=JSON.parse(localStorage.getItem(RECENT_SEEN_KEY)||"{}");
    return new Map(pruneRecentSeenEntries(parsed));
  }catch(e){
    return new Map();
  }
}

const recentSeenStories=loadRecentSeenStories();
const sessionSeenStories=new Set();
const sessionSeenStorySignatures=new Set();

function saveRecentSeenStories(){
  try{
    const entries=pruneRecentSeenEntries(
      Object.fromEntries(recentSeenStories)
    );
    recentSeenStories.clear();
    for(const [key,ts] of entries){
      recentSeenStories.set(key,Number(ts));
    }
    localStorage.setItem(
      RECENT_SEEN_KEY,
      JSON.stringify(Object.fromEntries(recentSeenStories))
    );
  }catch(e){}
}

function rememberSeenStory(story){
  const key=storyIdentity(story);
  if(!key)return;
  const now=Date.now();
  sessionSeenStories.add(key);
  const signature=exactDuplicateSignature(story);
  if(signature)sessionSeenStorySignatures.add(signature);
  recentSeenStories.set(key,now);
  saveRecentSeenStories();
}

function storyPublishedMs(story){
  const value=new Date(story?.published).getTime();
  return Number.isFinite(value) ? value : 0;
}

function hashUnit(value){
  const input=String(value||"");
  let hash=2166136261;
  for(let i=0;i<input.length;i++){
    hash^=input.charCodeAt(i);
    hash=Math.imul(hash,16777619);
  }
  return (hash>>>0)/4294967295;
}

function stableStoryJitter(story){
  return hashUnit(`${ALGO_SESSION_SEED}|${storyIdentity(story)}`);
}

function recentSeenPenalty(story){
  const key=storyIdentity(story);
  if(!key)return 0;
  if(sessionSeenStories.has(key))return -1000;

  const seenAt=Number(recentSeenStories.get(key))||0;
  if(!seenAt)return 0;

  const age=Math.max(0,Date.now()-seenAt);
  if(age>=RECENT_SEEN_TTL_MS)return 0;

  return -180*(1-age/RECENT_SEEN_TTL_MS);
}

function algorithmicStoryScore(story){
  const published=storyPublishedMs(story);
  const ageHours=published
    ? Math.max(0,(Date.now()-published)/(60*60*1000))
    : 999;

  /*
    Güncellik ana ağırlık. 8 saatlik yumuşak azalma eski haberlerin bir anda
    çok yeni haberlerin önüne fırlamasını önler. Oturum/jitter yalnız eşit
    güçteki adayların sırasını canlı tutar.
  */
  const freshness=150*Math.exp(-ageHours/8);
  const jitter=stableStoryJitter(story)*24;

  return freshness+jitter+recentSeenPenalty(story);
}

function chronologicalStories(list){
  return [...list].sort((a,b)=>{
    const delta=storyPublishedMs(b)-storyPublishedMs(a);
    if(delta)return delta;
    return storyIdentity(a).localeCompare(storyIdentity(b),"tr");
  });
}

function orderStoriesForFeed(list,mode){
  const chronological=chronologicalStories(list);

  /* Son dakika kendi güncellik mantığında kesin kronolojik kalır. */
  if(mode==="breaking" || feedOrderMode==="chronological"){
    return chronological;
  }

  return chronological.sort((a,b)=>{
    const scoreDelta=algorithmicStoryScore(b)-algorithmicStoryScore(a);
    if(Math.abs(scoreDelta)>.0001)return scoreDelta;
    return storyPublishedMs(b)-storyPublishedMs(a);
  });
}

const floraScoreMap=new Map();
const floraStatsMap=new Map();
const floraStoryRequestCache=new Map();
let floraScoresLoading=false;
let floraScoresLoadedAt=0;
let floraPopoverOpen=false;
const FLORA_SCORES_REFRESH_MS=5*60*1000;

function formatInlineFloraScore(value){
  const number=Number(value);
  return Number.isFinite(number)
    ? number.toFixed(1)
    : "—";
}

function floraNumber(value){
  const number=Number(value);
  return Number.isFinite(number)?number:0;
}

function normalizeFloraStatsRow(row){
  const key=String(row?.story_key||"").trim();
  if(!key)return null;

  return {
    story_key:key,
    flora:Number.isFinite(Number(row?.flora))?Number(row.flora):null,
    views:floraNumber(row?.views),
    avg_dwell_ms:floraNumber(row?.avg_dwell_ms),
    avg_target_ms:floraNumber(row?.avg_target_ms),
    completes:floraNumber(row?.completes),
    skips:floraNumber(row?.skips),
    backs:floraNumber(row?.backs),
    source_opens:floraNumber(row?.source_opens),
    video_starts:floraNumber(row?.video_starts),
    video_completes:floraNumber(row?.video_completes)
  };
}

function cacheFloraStatsRow(row){
  const normalized=normalizeFloraStatsRow(row);
  if(!normalized)return null;

  floraStatsMap.set(normalized.story_key,normalized);
  if(Number.isFinite(normalized.flora)){
    floraScoreMap.set(normalized.story_key,normalized.flora);
  }
  return normalized;
}

function floraPercent(part,total){
  const denominator=Math.max(0,Number(total)||0);
  if(!denominator)return "—";
  return `${Math.round((Math.max(0,Number(part)||0)/denominator)*100)}%`;
}

function floraDuration(ms){
  const seconds=Math.max(0,Math.round((Number(ms)||0)/1000));
  if(seconds<60)return `${seconds} sn`;
  return `${Math.floor(seconds/60)} dk ${seconds%60} sn`;
}

function ensureFloraPopover(){
  let popover=document.getElementById("flora-story-popover");
  if(popover)return popover;

  popover=document.createElement("div");
  popover.id="flora-story-popover";
  popover.className="flora-story-popover";
  popover.hidden=true;
  popover.setAttribute("role","dialog");
  popover.setAttribute("aria-modal","false");
  popover.setAttribute("aria-label","Flöra haber istatistikleri");
  popover.innerHTML=`
    <div class="flora-story-popover-head">
      <div class="flora-story-popover-title">
        <span class="flora-story-popover-mark" aria-hidden="true">𝒇</span>
        <span>Flöra</span>
      </div>
      <button class="flora-story-popover-close" type="button" aria-label="Flöra kutusunu kapat">×</button>
    </div>
    <div class="flora-story-popover-score">—</div>
    <div class="flora-story-popover-status">İstatistikler hazırlanıyor...</div>
    <div class="flora-story-popover-grid"></div>
  `;

  popover.querySelector(".flora-story-popover-close")?.addEventListener("click",event=>{
    event.preventDefault();
    event.stopPropagation();
    closeFloraPopover();
  });

  for(const eventName of ["pointerdown","pointerup","click","wheel"]){
    popover.addEventListener(eventName,event=>event.stopPropagation(),{passive:eventName==="wheel"});
  }

  document.body.appendChild(popover);
  return popover;
}

function positionFloraPopover(popover,anchor){
  if(!popover || !anchor)return;

  popover.style.left="12px";
  popover.style.top="12px";
  popover.style.visibility="hidden";
  popover.hidden=false;

  const anchorRect=anchor.getBoundingClientRect();
  const box=popover.getBoundingClientRect();
  const margin=12;

  let left=anchorRect.right-box.width;
  left=Math.max(margin,Math.min(left,innerWidth-box.width-margin));

  let top=anchorRect.top-box.height-10;
  if(top<margin){
    top=anchorRect.bottom+10;
  }
  top=Math.max(margin,Math.min(top,innerHeight-box.height-margin));

  popover.style.left=`${Math.round(left)}px`;
  popover.style.top=`${Math.round(top)}px`;
  popover.style.visibility="visible";
}

function renderFloraPopover(popover,story,stats){
  if(!popover)return;

  const scoreEl=popover.querySelector(".flora-story-popover-score");
  const statusEl=popover.querySelector(".flora-story-popover-status");
  const grid=popover.querySelector(".flora-story-popover-grid");

  if(!stats){
    if(scoreEl)scoreEl.textContent="—";
    if(statusEl)statusEl.textContent="Bu haber için henüz yeterli Flöra verisi oluşmadı.";
    if(grid)grid.replaceChildren();
    return;
  }

  if(scoreEl){
    scoreEl.textContent=Number.isFinite(stats.flora)
      ? `${stats.flora.toFixed(1)} / 100`
      : "—";
  }

  if(statusEl){
    statusEl.textContent="Son 7 günlük anonim kullanım verileri";
  }

  if(!grid)return;
  grid.replaceChildren();

  const rows=[
    ["Görüntülenme",String(Math.round(stats.views))],
    ["Ort. bakma",floraDuration(stats.avg_dwell_ms)],
    ["Tamamlama",floraPercent(stats.completes,stats.views)],
    ["Erken geçiş",floraPercent(stats.skips,stats.views)],
    ["Geri dönüş",String(Math.round(stats.backs))],
    ["Kaynağa gidiş",String(Math.round(stats.source_opens))]
  ];

  if(stats.video_starts>0){
    rows.push([
      "Video tamamlama",
      floraPercent(stats.video_completes,stats.video_starts)
    ]);
  }

  for(const [label,value] of rows){
    const item=document.createElement("div");
    item.className="flora-story-popover-metric";

    const labelEl=document.createElement("span");
    labelEl.textContent=label;

    const valueEl=document.createElement("strong");
    valueEl.textContent=value;

    item.append(labelEl,valueEl);
    grid.appendChild(item);
  }
}

function closeFloraPopover({resume=true}={}){
  const popover=document.getElementById("flora-story-popover");
  if(!popover || popover.hidden)return;

  popover.hidden=true;
  popover.style.visibility="";
  floraPopoverOpen=false;

  if(resume){
    queueUiFlowResumeCheck();
  }
}

async function loadFloraStoryStats(story,{force=false}={}){
  const key=storyIdentity(story);
  if(!key || story?.customRss)return null;

  if(!force && floraStatsMap.has(key)){
    return floraStatsMap.get(key);
  }

  if(!force && floraStoryRequestCache.has(key)){
    return floraStoryRequestCache.get(key);
  }

  const promise=(async()=>{
    const url=new URL(FLORA_STORY_API);
    url.searchParams.set("range","7d");
    url.searchParams.set("stream",story?.flowForeign?"foreign":"main");
    url.searchParams.set("story_key",key);
    url.searchParams.set("_floew",`${NEWS_REQUEST_SESSION}-flora-story-${Date.now().toString(36)}`);

    const response=await fetch(url.href,{
      method:"GET",
      mode:"cors",
      credentials:"omit",
      cache:"no-store",
      headers:{"Accept":"application/json"}
    });

    if(!response.ok){
      throw new Error(`Flöra detay: HTTP ${response.status}`);
    }

    const data=await response.json();
    if(!data?.ok){
      throw new Error(data?.error||"Flöra detay yanıtı okunamadı");
    }

    if(!data?.stats)return null;
    return cacheFloraStatsRow(data.stats);
  })()
    .catch(error=>{
      console.warn("Flöra story details:",error);
      return null;
    })
    .finally(()=>{
      floraStoryRequestCache.delete(key);
    });

  floraStoryRequestCache.set(key,promise);
  return promise;
}

async function openFloraPopover(anchor,story){
  if(!anchor || !story)return;

  closeFloraPopover({resume:false});
  pauseFlowForUi();
  floraPopoverOpen=true;

  const popover=ensureFloraPopover();
  popover.dataset.storyKey=storyIdentity(story);

  const cached=floraStatsMap.get(storyIdentity(story))||null;
  renderFloraPopover(popover,story,cached);
  positionFloraPopover(popover,anchor);

  if(story.customRss){
    const statusEl=popover.querySelector(".flora-story-popover-status");
    if(statusEl)statusEl.textContent="Özel RSS haberleri Flöra hesaplamasına dahil edilmez.";
    return;
  }

  const stats=await loadFloraStoryStats(story,{force:!cached});

  if(
    popover.hidden ||
    popover.dataset.storyKey!==storyIdentity(story)
  )return;

  renderFloraPopover(popover,story,stats);
  positionFloraPopover(popover,anchor);
  refreshVisibleFloraScores();
}

function bindFloraScoreControl(scoreEl){
  if(!scoreEl || scoreEl.dataset.floraBound==="1")return;
  scoreEl.dataset.floraBound="1";
  scoreEl.setAttribute("role","button");
  scoreEl.tabIndex=0;

  const stop=event=>event.stopPropagation();
  scoreEl.addEventListener("pointerdown",stop);
  scoreEl.addEventListener("pointerup",stop);
  scoreEl.addEventListener("touchstart",stop,{passive:true});

  const open=event=>{
    event.preventDefault();
    event.stopPropagation();
    const key=scoreEl.dataset.floraStoryKey||"";
    const popover=document.getElementById("flora-story-popover");

    if(
      floraPopoverOpen &&
      popover &&
      !popover.hidden &&
      popover.dataset.storyKey===key
    ){
      closeFloraPopover();
      return;
    }

    const story=state.stories.find(item=>storyIdentity(item)===key) ||
      state.stories[state.index] || null;
    if(story)openFloraPopover(scoreEl,story);
  };

  scoreEl.addEventListener("click",open);
  scoreEl.addEventListener("keydown",event=>{
    if(event.key==="Enter" || event.key===" ")open(event);
  });
}

document.addEventListener("pointerdown",event=>{
  if(!floraPopoverOpen)return;

  const popover=document.getElementById("flora-story-popover");
  const target=event.target;
  if(
    popover?.contains(target) ||
    target?.closest?.(".flora-inline")
  )return;

  closeFloraPopover();
},{capture:true,passive:true});

function setSlideFloraScore(el,story){
  if(!el)return;

  const scoreEl=el.querySelector(".flora-inline");
  const valueEl=el.querySelector(".flora-inline-value");

  if(!scoreEl || !valueEl)return;

  const key=storyIdentity(story);
  const score=key
    ? floraScoreMap.get(key)
    : undefined;

  valueEl.textContent=formatInlineFloraScore(score);
  scoreEl.dataset.floraStoryKey=key;
  bindFloraScoreControl(scoreEl);

  const hasScore=Number.isFinite(Number(score));

  scoreEl.classList.toggle(
    "has-score",
    hasScore
  );

  scoreEl.title=hasScore
    ? `Flöra: ${Number(score).toFixed(1)}/100 · Ayrıntıları göster`
    : "Flöra ayrıntılarını göster";

  scoreEl.setAttribute(
    "aria-label",
    scoreEl.title
  );
}

function refreshVisibleFloraScores(){
  const current=state.stories[state.index]||null;
  const currentSlide=slides[state.active]||null;
  const standbySlide=slides[1-state.active]||null;

  if(currentSlide && current){
    setSlideFloraScore(
      currentSlide,
      current
    );
  }

  if(standbySlide){
    const key=standbySlide.dataset.storyKey||"";
    const story=state.stories.find(
      item=>mediaKey(item)===key || storyIdentity(item)===key
    );

    if(story){
      setSlideFloraScore(
        standbySlide,
        story
      );
    }
  }
}

async function loadInlineFloraScores(force=false){
  if(floraScoresLoading)return;

  if(
    !force &&
    floraScoresLoadedAt &&
    Date.now()-floraScoresLoadedAt<FLORA_SCORES_REFRESH_MS
  ){
    return;
  }

  floraScoresLoading=true;

  try{
    const streams=["main","foreign"];

    const results=await Promise.allSettled(
      streams.map(async stream=>{
        const url=new URL(FLORA_SCORES_API);
        url.searchParams.set("range","7d");
        url.searchParams.set("stream",stream);
        url.searchParams.set(
          "_floew",
          `${NEWS_REQUEST_SESSION}-flora-${stream}-${Date.now().toString(36)}`
        );

        const response=await fetch(url.href,{
          method:"GET",
          mode:"cors",
          credentials:"omit",
          cache:"no-store",
          headers:{
            "Accept":"application/json"
          }
        });

        if(!response.ok){
          throw new Error(
            `Flöra ${stream}: HTTP ${response.status}`
          );
        }

        const data=await response.json();

        if(!data?.ok){
          throw new Error(
            data?.error||
            `Flöra ${stream} yanıtı okunamadı`
          );
        }

        return data;
      })
    );

    const payloads=[];
    for(const result of results){
      if(result.status==="fulfilled"){
        payloads.push(result.value);
      }else{
        console.warn("Inline Flöra stream:",result.reason);
      }
    }

    /* Bir akış geçici hata verse bile diğer akışın geçerli skorlarını koru. */
    if(payloads.length){
      if(payloads.length===streams.length){
        floraScoreMap.clear();
        floraStatsMap.clear();
      }

      for(const data of payloads){
        for(const row of data?.scores||[]){
          cacheFloraStatsRow(row);
        }
      }

      floraScoresLoadedAt=Date.now();
      refreshVisibleFloraScores();
    }
  }catch(error){
    console.warn(
      "Inline Flöra scores:",
      error
    );
  }finally{
    floraScoresLoading=false;
  }
}

function parseKeywordList(value){
  return [...new Set(
    String(value||"")
      .split(",")
      .map(part=>normalizeText(part).trim())
      .filter(Boolean)
  )];
}

function loadKeywordFilterState(){
  try{
    const saved=JSON.parse(
      localStorage.getItem(KEYWORD_FILTER_KEY)||"{}"
    );

    const mode=
      saved?.mode==="show" || saved?.mode==="hide"
        ? saved.mode
        : "off";

    return {
      text:String(saved?.text||""),
      mode
    };
  }catch(e){
    return {text:"",mode:"off"};
  }
}

function saveKeywordFilterState(){
  try{
    localStorage.setItem(
      KEYWORD_FILTER_KEY,
      JSON.stringify(keywordFilterState)
    );
  }catch(e){}
}

function loadKeywordWatchText(){
  try{
    return String(
      localStorage.getItem(KEYWORD_WATCH_KEY)||""
    );
  }catch(e){
    return "";
  }
}

function saveKeywordWatchText(){
  try{
    localStorage.setItem(
      KEYWORD_WATCH_KEY,
      keywordWatchText
    );
  }catch(e){}
}

let keywordFilterState=loadKeywordFilterState();
let keywordWatchText=loadKeywordWatchText();

function storyKeywordText(story){
  return normalizeText([
    story?.title,
    story?.description,
    story?.summary,
    story?.content
  ].filter(Boolean).join(" "));
}

function storyMatchesKeywords(story,keywords){
  if(!keywords?.length)return false;

  const text=storyKeywordText(story);
  if(!text)return false;

  return keywords.some(keyword=>
    keyword && text.includes(keyword)
  );
}

function passesKeywordFilter(story){
  const keywords=parseKeywordList(
    keywordFilterState.text
  );

  if(
    keywordFilterState.mode==="off" ||
    !keywords.length
  ){
    return true;
  }

  const matched=storyMatchesKeywords(
    story,
    keywords
  );

  return keywordFilterState.mode==="show"
    ? matched
    : !matched;
}

function currentKeywordWatchKeywords(){
  return parseKeywordList(keywordWatchText);
}

function updateKeywordAlert(story){
  const frame=
    document.getElementById("keyword-alert-frame");

  if(!frame)return;

  const keywords=currentKeywordWatchKeywords();
  const matched=
    keywords.length &&
    storyMatchesKeywords(story,keywords);

  frame.classList.toggle(
    "active",
    Boolean(matched)
  );

  if(matched){
    const text=storyKeywordText(story);
    frame.dataset.matches=
      keywords.filter(keyword=>text.includes(keyword)).join(",");
  }else{
    delete frame.dataset.matches;
  }
}

function categoryForStory(story){
  // Worker kategorisi birincil kaynaktır. Frontend sınıflandırması yalnızca
  // eski/eksik cevaplar için güvenli geri dönüş olarak kalır.
  const explicit=story.category || story.categories || story.section || story.topic;
  const explicitText=normalizeText(Array.isArray(explicit)?explicit.join(" "):explicit);

  if(
    Boolean(story?.foreign) ||
    explicitText.includes(normalizeText(FOREIGN_CATEGORY))
  ){
    return FOREIGN_CATEGORY;
  }

  for(const cat of CATEGORIES){
    if(cat==="#SonDakika")continue;
    const key=normalizeText(cat.replace("#",""));
    if(explicitText.includes(key)) return cat;
  }

  const text=normalizeText([story.title,story.description,story.summary,story.content].join(" "));
  const rules=[
    ["#Sağlık",["sağlık","hastalık","tedavi","doktor","hekim","aşı","kanser","ruh sağlığı"]],
    ["#Bilim",["bilim","bilimsel","fizik","kimya","biyoloji","astronomi","uzay","nasa","evrim","genetik"]],
    ["#Otomotiv",["otomobil","otomotiv","elektrikli araç","suv","sedan","togg","tesla","volkswagen","bmw","mercedes"]],
    ["#Sinema",["sinema","film","vizyon","yönetmen","fragman","box office","oscar","cannes"]],
    ["#Televizyon",["televizyon","dizi","sezon","bölüm","netflix dizisi","show tv","kanal d","star tv","trt 1"]],
    ["#Müzik",["müzik","albüm","single","şarkı","müzisyen","konser","spotify","plak","turne","indie"]],
    ["#Edebiyat",["edebiyat","kitap","roman","öykü","şiir","yazar","şair","yayınevi"]],
    ["#Moda",["moda","fashion","defile","koleksiyon","tasarımcı","giyim","stil","moda haftası","vogue"]],
    ["#Tarih",["tarih","tarihi","osmanlı","bizans","antik","arkeoloji","imparatorluk","medeniyet"]],
    ["#Gezi",["seyahat","gezi","gezilecek","rota","tatil","turizm","otel","seyahat rehberi"]],
    ["#Spor",["futbol","basketbol","voleybol","tenis","formula 1","şampiyon","lig","maç","transfer","gol"]],
    ["#Teknoloji",["teknoloji","yapay zeka","iphone","android","google","apple","microsoft","siber","yazılım","çip","robot"]],
    ["#Magazin",["magazin","ünlü","evlilik","boşanma","kırmızı halı","influencer"]],
    ["#Kültür-Sanat",["kültür","sanat","sergi","müze","tiyatro","opera","bale","bienal"]],
    ["#Ekonomi",["ekonomi","borsa","dolar","euro","altın","faiz","enflasyon","merkez bankası","vergi"]],
    ["#Siyaset",["siyaset","hükümet","bakan","milletvekili","meclis","parti","seçim","cumhurbaşkanı","tbmm"]],
    ["#Dünya",["abd","amerika","avrupa","rusya","ukrayna","israil","filistin","iran","suriye","almanya","fransa","çin","nato"]],
    ["#Türkiye",["türkiye","istanbul","ankara","izmir","deprem","belediye","valilik","jandarma","emniyet","yangın"]],
    ["#Yaşam",["yaşam","hayat","dekorasyon","gastronomi","yemek","ilişki","aile","wellness"]]
  ];

  for(const [cat,words] of rules){
    if(words.some(w=>text.includes(normalizeText(w)))) return cat;
  }

  return "#Yaşam";
}

function enrichStories(list){
  return list.map(s=>{
    const flowCategory=categoryForStory(s);
    const flowForeign=
      Boolean(s?.foreign) ||
      flowCategory===FOREIGN_CATEGORY;

    return {
      ...s,
      flowCategory,
      flowForeign,
      flowBreaking:
        !flowForeign &&
        (Boolean(s.breaking) || normalizeText(s.category).includes("sondakika"))
    };
  });
}

function storyInTimeRange(story){
  const option=currentTimeRangeOption();

  if(!Number.isFinite(option.hours)){
    return true;
  }

  const publishedAt=new Date(story?.published).getTime();

  /*
    Zamanı bilinmeyen bir haber sonlu aralıkta güvenle sınıflandırılamaz.
    "Tüm zamanlar" seçildiğinde ise bu haberler yine gösterilir.
  */
  if(!Number.isFinite(publishedAt)){
    return false;
  }

  const ageMs=Date.now()-publishedAt;
  const limitMs=option.hours*60*60*1000;

  /*
    Kaynak saatindeki küçük ileri sapmalar yeni haberi yanlışlıkla elemesin.
    Negatif yaş doğal olarak limitin altında kalır ve gösterilir.
  */
  return ageMs<=limitMs;
}

const BREAKING_EXTRA_CATEGORIES=new Set([
  "#Türkiye",
  "#Dünya",
  "#Siyaset"
]);

function storyInBreakingWindow(story){
  const isBreakingFeedStory=Boolean(story?.flowBreaking);
  const isPriorityCategory=
    BREAKING_EXTRA_CATEGORIES.has(story?.flowCategory);

  if(!isBreakingFeedStory && !isPriorityCategory)return false;

  const publishedAt=new Date(story?.published).getTime();
  if(!Number.isFinite(publishedAt))return false;

  return (Date.now()-publishedAt)<=BREAKING_WINDOW_MS;
}

function storiesForFeedMode(mode,options={}){
  if(mode==="source"){
    if(!temporarySourceFilter)return [];

    const list=rawStories.filter(s=>{
      if(sourceKey(s.source)!==temporarySourceFilter.key)return false;
      if(!storyInTimeRange(s))return false;
      if(!passesKeywordFilter(s))return false;
      return true;
    });

    return applyVideoOnlyFilter(orderStoriesForFeed(list,mode),options);
  }

  if(mode==="category"){
    if(!temporaryCategoryFilter)return [];

    const list=rawStories.filter(s=>{
      if(String(s.flowCategory||"")!==temporaryCategoryFilter.name)return false;
      if(!storyInTimeRange(s))return false;
      if(!passesKeywordFilter(s))return false;
      return true;
    });

    return applyVideoOnlyFilter(orderStoriesForFeed(list,mode),options);
  }

  if(mode==="foreign"){
    const list=rawStories.filter(s=>{
      if(!s.flowForeign)return false;
      if(!storyInTimeRange(s))return false;
      if(!foreignSourceFilters.has(sourceKey(s.source)))return false;
      if(!passesKeywordFilter(s))return false;
      return true;
    });
    return applyVideoOnlyFilter(orderStoriesForFeed(list,mode),options);
  }

  if(mode==="breaking"){
    const list=rawStories.filter(s=>{
      if(s.flowForeign)return false;
      if(!storyInBreakingWindow(s))return false;
      if(!filters.sources.has(sourceKey(s.source)))return false;
      if(!passesKeywordFilter(s))return false;
      return true;
    });
    return applyVideoOnlyFilter(orderStoriesForFeed(list,mode),options);
  }

  const list=rawStories.filter(s=>{
    /*
      #Yabancı hiçbir koşulda Gündem havuzuna giremez.
    */
    if(s.flowForeign)return false;

    if(!storyInTimeRange(s))return false;
    if(!filters.sources.has(sourceKey(s.source)))return false;
    if(!passesKeywordFilter(s))return false;

    /*
      Gündem sekmesi mevcut Flöw davranışını aynen korur:
      normal kategori açık olmalı; breaking etiketi normal kategoriyi delemez.
    */
    if(!filters.categories.has(s.flowCategory))return false;

    if(
      s.flowBreaking &&
      !filters.categories.has("#SonDakika")
    ) return false;

    return true;
  });

  return applyVideoOnlyFilter(orderStoriesForFeed(list,mode),options);
}

function activeStories(){
  return storiesForFeedMode(feedMode);
}

function emptyStoriesMessage(){
  if(videoOnlyEnabled){
    if(videoOnlyScanRunning || videoOnlyScanQueued){
      return "Videolu haberler aranıyor…";
    }

    return "Seçtiğiniz filtrelerde videolu haber bulunamadı.";
  }

  const keywordCount=
    parseKeywordList(keywordFilterState.text).length;

  if(keywordCount && keywordFilterState.mode==="show"){
    return "Anahtar kelime filtresine uyan haber bulunamadı.";
  }

  if(keywordCount && keywordFilterState.mode==="hide"){
    return "Anahtar kelime filtresi sonrası gösterilecek haber kalmadı.";
  }

  if(feedMode==="breaking"){
    return "Son 20 dakikada Son dakika, Türkiye, Dünya veya Siyaset haberi bulunamadı.";
  }

  if(feedMode==="foreign"){
    return "Seçtiğiniz yabancı kaynak ve zaman aralığında haber bulunamadı.";
  }

  if(feedMode==="source"){
    return `${temporarySourceFilter?.name||"Bu kaynak"} için seçilen zaman aralığında haber bulunamadı.`;
  }

  if(feedMode==="category"){
    return `${temporaryCategoryFilter?.name||"Bu kategori"} için seçilen zaman aralığında haber bulunamadı.`;
  }

  return "Seçtiğiniz kaynak, kategori ve zaman aralığında haber bulunamadı.";
}

function setStoryStageVisible(visible){
  slides.forEach(slide=>{
    slide.style.visibility=visible?"visible":"hidden";
  });
}

function bindFeedTabButton(button){
  if(!button || button.dataset.floewBound==="1")return;

  button.dataset.floewBound="1";
  button.addEventListener("pointerdown",e=>e.stopPropagation());
  button.addEventListener("pointerup",e=>e.stopPropagation());
  button.addEventListener("click",e=>{
    e.stopPropagation();
    switchFeedMode(button.dataset.feedMode||"agenda");
  });
}

function ensureTemporarySourceTab(){
  const tabs=document.getElementById("feed-tabs");
  if(!tabs || !temporarySourceFilter)return null;

  let button=tabs.querySelector('[data-feed-mode="source"]');

  if(!button){
    button=document.createElement("button");
    button.type="button";
    button.className="feed-tab source-feed-tab";
    button.dataset.feedMode="source";
    button.setAttribute("aria-pressed","false");

    const foreign=tabs.querySelector('[data-feed-mode="foreign"]');
    tabs.insertBefore(button,foreign||null);

    /* DOM'a eklendikten sonraki frame'de genişleyerek gelsin. */
    requestAnimationFrame(()=>{
      requestAnimationFrame(()=>button?.classList.add("is-visible"));
    });
  }else{
    button.classList.add("is-visible");
  }

  button.textContent=temporarySourceFilter.name;
  button.title=`${temporarySourceFilter.name} haberleri`;
  bindFeedTabButton(button);
  return button;
}

function clearTemporarySourceTab(){
  const button=document.querySelector('[data-feed-mode="source"]');

  if(button){
    /*
      Filtreyi hemen kaldır; buton yalnız görsel çıkış animasyonunu tamamlar.
      data-feed-mode değiştirilir ki kullanıcı anında yeni bir kaynak açarsa
      çıkmakta olan eski düğme tekrar kullanılmasın.
    */
    button.dataset.feedMode="source-leaving";
    button.classList.remove("is-visible");
    button.classList.add("is-leaving");
    setTimeout(()=>button.remove(),320);
  }

  temporarySourceFilter=null;
  feedModeStoryKeys.source="";
}

function activateTemporarySourceFeed(sourceName){
  const name=String(sourceName||"").trim();
  const key=sourceKey(name);
  if(!name || !key)return;

  if(
    feedMode==="source" &&
    temporarySourceFilter?.key===key
  ){
    return;
  }

  if(temporaryCategoryFilter){
    clearTemporaryCategoryTab();
  }

  temporarySourceFilter={name,key};
  feedModeStoryKeys.source=storyIdentity(
    state.stories[state.index]
  );
  ensureTemporarySourceTab();
  switchFeedMode("source");
}

function ensureTemporaryCategoryTab(){
  const tabs=document.getElementById("feed-tabs");
  if(!tabs || !temporaryCategoryFilter)return null;

  let button=tabs.querySelector('[data-feed-mode="category"]');

  if(!button){
    button=document.createElement("button");
    button.type="button";
    button.className="feed-tab source-feed-tab category-feed-tab";
    button.dataset.feedMode="category";
    button.setAttribute("aria-pressed","false");

    const foreign=tabs.querySelector('[data-feed-mode="foreign"]');
    tabs.insertBefore(button,foreign||null);

    requestAnimationFrame(()=>{
      requestAnimationFrame(()=>button?.classList.add("is-visible"));
    });
  }else{
    button.classList.add("is-visible");
  }

  button.textContent=temporaryCategoryFilter.name;
  button.title=`${temporaryCategoryFilter.name} haberleri`;
  bindFeedTabButton(button);
  return button;
}

function clearTemporaryCategoryTab(){
  const button=document.querySelector('[data-feed-mode="category"]');

  if(button){
    button.dataset.feedMode="category-leaving";
    button.classList.remove("is-visible");
    button.classList.add("is-leaving");
    setTimeout(()=>button.remove(),320);
  }

  temporaryCategoryFilter=null;
  feedModeStoryKeys.category="";
}

function activateTemporaryCategoryFeed(categoryName){
  const name=String(categoryName||"").trim();
  if(!name)return;

  if(
    feedMode==="category" &&
    temporaryCategoryFilter?.name===name
  ){
    return;
  }

  if(temporarySourceFilter){
    clearTemporarySourceTab();
  }

  temporaryCategoryFilter={name};
  feedModeStoryKeys.category=storyIdentity(
    state.stories[state.index]
  );
  ensureTemporaryCategoryTab();
  switchFeedMode("category");
}

function renderFeedMode(){
  document.body.classList.toggle(
    "breaking-mode",
    feedMode==="breaking"
  );
  document.body.classList.toggle(
    "foreign-mode",
    feedMode==="foreign"
  );

  document.querySelectorAll(".feed-tab").forEach(button=>{
    const active=button.dataset.feedMode===feedMode;
    button.classList.toggle("active",active);
    button.setAttribute("aria-pressed",active?"true":"false");
  });

  if(feedMode==="breaking"){
    closeTimeRangePanel();
  }
}

let adjacentFeedPreloadTimer=null;

function feedModePreviewStory(mode){
  const list=storiesForFeedMode(mode);
  if(!list.length)return null;

  const preferredKey=feedModeStoryKeys[mode];
  if(preferredKey){
    const preferred=list.find(story=>storyIdentity(story)===preferredKey);
    if(preferred)return preferred;
  }

  return list[0]||null;
}

function scheduleAdjacentFeedPreload(delay=120){
  clearTimeout(adjacentFeedPreloadTimer);

  adjacentFeedPreloadTimer=setTimeout(()=>{
    if(adActive || state.busy || !rawStories.length)return;

    const order=currentFeedModeOrder();
    const currentIndex=order.indexOf(feedMode);
    if(currentIndex<0)return;

    for(const index of [currentIndex-1,currentIndex+1]){
      if(index<0 || index>=order.length)continue;
      const story=feedModePreviewStory(order[index]);
      if(!story)continue;

      preloadStoryAssets(story);
      preloadImage(story.image).catch(()=>{});
      void detectSmartFocalPoint(story).catch(()=>null);
    }
  },Math.max(0,delay));
}

async function switchFeedMode(nextMode){
  closeFloraPopover({resume:false});
  const modeOrder=currentFeedModeOrder();
  const next=
    modeOrder.includes(nextMode)
      ? nextMode
      : "agenda";

  if(next===feedMode || state.busy || adActive)return;

  /* Son dakika boşsa sekmeye hiç geçmiyoruz. */
  const previewList=storiesForFeedMode(next);

  if(next==="breaking" && !previewList.length){
    closeQuickPanels();
    showFullscreenButton();
    status("Son 20 dakikada Son dakika, Türkiye, Dünya veya Siyaset haberi bulunamadı.");
    return;
  }

  const previousMode=feedMode;
  const currentStory=state.stories[state.index]||null;
  const preferredKey=feedModeStoryKeys[next];
  let idx=
    preferredKey
      ? previewList.findIndex(story=>storyIdentity(story)===preferredKey)
      : -1;
  if(idx<0)idx=0;

  if(!previewList.length){
    feedModeStoryKeys[feedMode]=storyIdentity(currentStory);
    feedMode=next;
    filterReturnStoryKey="";

    if(previousMode==="source" && next!=="source")clearTemporarySourceTab();
    if(previousMode==="category" && next!=="category")clearTemporaryCategoryTab();

    closeQuickPanels();
    renderFeedMode();
    renderOptions();
    showFullscreenButton();
    state.stories=[];
    state.index=0;
    state.history=[];
    state.historyPos=0;
    clearAdNavigationHistory();
    historicalAdContext=null;
    clearTimeout(state.timer);
    setStoryStageVisible(false);
    status(emptyStoriesMessage());
    return;
  }

  const currentSlide=slides[state.active];
  const nextSlide=slides[1-state.active];
  const nextStory=previewList[idx];

  const previousModeIndex=modeOrder.indexOf(previousMode);
  const nextModeIndex=modeOrder.indexOf(next);
  const movingRight=nextModeIndex>previousModeIndex;
  const enterClass=movingRight ? "enter-left" : "enter-right";
  const exitClass=movingRight ? "exit-left" : "exit-right";

  state.busy=true;
  clearTimeout(state.timer);

  /* Dikey haber geçişindeki hazırlık sırasını yatay akış geçişine de uygula:
     hedef görsel decode ve odak noktası hazır olmadan animasyonu başlatma. */
  try{await preloadImage(nextStory.image)}catch(e){}
  preloadStoryAssets(nextStory);
  prepareTransitionSlide(nextSlide,nextStory);

  const nextImage=nextSlide.querySelector(".slide-image");
  if(nextImage?.decode){
    try{await nextImage.decode()}catch(e){}
  }
  if(nextImage){
    await lockSmartFocalPointForTransition(nextImage,nextStory);
  }

  feedModeStoryKeys[feedMode]=storyIdentity(currentStory);
  feedMode=next;
  filterReturnStoryKey="";

  if(previousMode==="source" && next!=="source")clearTemporarySourceTab();
  if(previousMode==="category" && next!=="category")clearTemporaryCategoryTab();

  closeQuickPanels();
  renderFeedMode();
  showFullscreenButton();
  clearStatus();
  setStoryStageVisible(true);

  currentSlide.className="slide";
  nextSlide.className="slide";

  /* offsetWidth ile zorunlu layout yerine frame sınırında compositor
     animasyonuna giriyoruz. */
  await new Promise(resolve=>requestAnimationFrame(()=>resolve()));

  nextSlide.classList.add(enterClass);
  currentSlide.classList.add(exitClass);
  activateSlideMedia(nextSlide,nextStory);

  state.stories=previewList;
  state.index=idx;
  state.history=[idx];
  state.historyPos=0;
  clearAdNavigationHistory();
  historicalAdContext=null;
  state.active=1-state.active;

  updateKeywordAlert(nextStory);

  let finished=false;
  const finish=()=>{
    if(finished)return;
    finished=true;
    nextSlide.className="slide active";
    currentSlide.className="slide";
    stopSlideMedia(currentSlide);
    state.busy=false;

    /* Menü kapalıyken seçenek listesini animasyonun kritik frame'lerinden
       çıkar; açık ise kullanıcı güncel listeyi yine geçiş sonunda görür. */
    renderOptions();
    timer();
    scheduleAdjacentFeedPreload(120);
  };

  nextSlide.addEventListener("animationend",finish,{once:true});
  setTimeout(()=>{
    if(state.busy && feedMode===next)finish();
  },900);
}



let filterApplyFrame=0;
let filterApplySecondFrame=0;
let pendingNormalPreferenceSave=false;
let pendingForeignPreferenceSave=false;

function setOptionVisualState(el,on){
  if(!el)return;
  el.classList.toggle("on",Boolean(on));
  const check=el.querySelector(".option-check");
  if(check)check.textContent=on?"✓︎":"";
}

function scheduleFilterApply(saveKind="normal"){
  if(saveKind==="foreign")pendingForeignPreferenceSave=true;
  else pendingNormalPreferenceSave=true;
  if(filterApplyFrame)cancelAnimationFrame(filterApplyFrame);
  if(filterApplySecondFrame)cancelAnimationFrame(filterApplySecondFrame);

  /* Seçim işaretini önce ekrana bastır, filtre listesinin yeniden kurulması ve
     haber seçiminin hesabını bir sonraki frame'e bırak. Böylece dokunma geri
     bildirimi ağır filtre işinden önce görünür. */
  filterApplyFrame=requestAnimationFrame(()=>{
    filterApplyFrame=0;
    filterApplySecondFrame=requestAnimationFrame(()=>{
      filterApplySecondFrame=0;
      if(pendingNormalPreferenceSave){
        pendingNormalPreferenceSave=false;
        savePreferences();
      }
      if(pendingForeignPreferenceSave){
        pendingForeignPreferenceSave=false;
        saveForeignSourcePreferences();
      }
      applyFilters({skipRenderOptions:true});
    });
  });
}

function renderOptions(){
  const sourceBox=document.getElementById("source-options");
  const categoryBox=document.getElementById("category-options");
  if(!sourceBox || !categoryBox)return;

  const sourceFragment=document.createDocumentFragment();
  const categoryFragment=document.createDocumentFragment();

  const foreignMode=feedMode==="foreign";
  const visibleSources=
    foreignMode
      ? knownForeignSources
      : knownSources;
  const visibleSourceSet=
    foreignMode
      ? foreignSourceFilters
      : filters.sources;

  for(const source of visibleSources){
    const key=sourceKey(source);
    const on=visibleSourceSet.has(key);
    const el=document.createElement("div");
    el.className="option"+(on?" on":"");
    el.dataset.key=key;
    el.innerHTML=`<span class="option-name">${source}</span><span class="option-check">${on?"✓︎":""}</span>`;
    el.addEventListener("click",()=>toggleSource(key,el));
    sourceFragment.appendChild(el);
  }

  if(foreignMode){
    const el=document.createElement("div");
    el.className="option on foreign-category-option";
    el.dataset.key=FOREIGN_CATEGORY;
    el.innerHTML=`<span class="option-name">${FOREIGN_CATEGORY}</span><span class="option-check">✓︎</span>`;
    categoryFragment.appendChild(el);
  }else{
    for(const category of CATEGORIES){
      const on=filters.categories.has(category);
      const el=document.createElement("div");
      el.className="option"+(on?" on":"");
      el.dataset.key=category;
      el.innerHTML=`<span class="option-name">${category}</span><span class="option-check">${on?"✓︎":""}</span>`;
      el.addEventListener("click",()=>toggleCategory(category,el));
      categoryFragment.appendChild(el);
    }
  }

  sourceBox.replaceChildren(sourceFragment);
  categoryBox.replaceChildren(categoryFragment);
  updateFilterCount();
}

function updateFilterCount(){
  const count=document.getElementById("filter-count");
  if(!count)return;

  const sourcesPanel=document.getElementById("sources-panel");
  count.hidden=!Boolean(sourcesPanel?.classList.contains("active"));

  if(feedMode==="foreign"){
    count.textContent=
      `${foreignSourceFilters.size}/${knownForeignSources.length} yabancı kaynak · ${FOREIGN_CATEGORY}`;
    return;
  }

  const totalSources=knownSources.length;
  count.textContent=`${filters.sources.size}/${totalSources} kaynak · ${filters.categories.size}/${CATEGORIES.length} kategori açık`;
}

function toggleSource(key,optionEl=null){
  let on=false;

  if(feedMode==="foreign"){
    if(foreignSourceFilters.has(key)) foreignSourceFilters.delete(key);
    else foreignSourceFilters.add(key);
    on=foreignSourceFilters.has(key);
  }else{
    if(filters.sources.has(key)) filters.sources.delete(key);
    else filters.sources.add(key);
    on=filters.sources.has(key);
  }

  setOptionVisualState(optionEl,on);
  updateFilterCount();
  scheduleFilterApply(feedMode==="foreign"?"foreign":"normal");
}

function toggleCategory(cat,optionEl=null){
  if(filters.categories.has(cat)) filters.categories.delete(cat);
  else filters.categories.add(cat);

  setOptionVisualState(optionEl,filters.categories.has(cat));
  updateFilterCount();
  scheduleFilterApply();
}


function applyFilters(options={}){
  const preserveHistory=Boolean(options?.preserveHistory);
  const previousStories=preserveHistory && Array.isArray(state.stories)
    ? state.stories
    : null;
  const previousHistory=preserveHistory && Array.isArray(state.history)
    ? [...state.history]
    : [];
  const previousHistoryPos=preserveHistory && Number.isInteger(state.historyPos)
    ? Math.max(0,Math.min(state.historyPos,Math.max(0,previousHistory.length-1)))
    : 0;
  const previousStory=state.stories[state.index]||null;
  const previousKey=storyIdentity(previousStory);
  const list=activeStories();

  if(!options?.skipRenderOptions)renderOptions();
  else updateFilterCount();

  if(
    videoOnlyEnabled &&
    !options?.preserveScan
  ){
    queueVideoOnlyScan();
  }

  if(!list.length){
    if(!filterReturnStoryKey && previousKey){
      filterReturnStoryKey=previousKey;
    }

    /*
      Video-only arka plan taraması yeni verdict'leri parça parça ekler.
      Taramanın ara anında liste geçici olarak boşalırsa mevcut akış/history
      silinmesin. Kullanıcı ayarı gerçekten değiştirdiğinde eski davranış
      korunur; bu koruma yalnız preserveHistory çağrıları için geçerlidir.
    */
    if(videoOnlyEnabled && !preserveHistory){
      state.stories=[];
      state.index=0;
      state.history=[];
      state.historyPos=0;
      clearAdNavigationHistory();
      historicalAdContext=null;
      clearTimeout(state.timer);
      state.timer=null;
      state.timerDeadline=0;
      setStoryStageVisible(false);
    }

    status(emptyStoriesMessage());
    return;
  }

  clearStatus();
  setStoryStageVisible(true);

  const resetToStart=Boolean(options?.resetToStart);
  const preferredKey=resetToStart
    ? ""
    : (filterReturnStoryKey || previousKey);

  let idx=resetToStart
    ? 0
    : (preferredKey
        ? list.findIndex(x=>storyIdentity(x)===preferredKey)
        : -1);

  if(idx<0){
    if(!filterReturnStoryKey && previousKey){
      filterReturnStoryKey=previousKey;
    }

    idx=0;
  }

  const targetStory=list[idx];
  const targetKey=storyIdentity(targetStory);

  state.stories=list;
  state.index=idx;

  if(preserveHistory && previousStories?.length && previousHistory.length){
    const indexByKey=new Map();
    const indexBySignature=new Map();

    list.forEach((story,index)=>{
      const key=storyIdentity(story);
      const signature=exactDuplicateSignature(story);
      if(key && !indexByKey.has(key))indexByKey.set(key,index);
      if(signature && !indexBySignature.has(signature)){
        indexBySignature.set(signature,index);
      }
    });

    const remapped=[];
    let remappedPos=-1;

    previousHistory.forEach((oldIndex,position)=>{
      if(!Number.isInteger(oldIndex))return;
      const oldStory=previousStories[oldIndex];
      if(!oldStory)return;

      const key=storyIdentity(oldStory);
      const signature=exactDuplicateSignature(oldStory);
      let mapped=-1;

      if(key && indexByKey.has(key))mapped=indexByKey.get(key);
      else if(signature && indexBySignature.has(signature)){
        mapped=indexBySignature.get(signature);
      }

      if(mapped<0)return;

      if(remapped[remapped.length-1]!==mapped){
        remapped.push(mapped);
      }

      if(position<=previousHistoryPos){
        remappedPos=remapped.length-1;
      }
    });

    if(!remapped.length){
      remapped.push(idx);
      remappedPos=0;
    }else{
      remappedPos=Math.max(0,Math.min(remappedPos,remapped.length-1));

      if(remapped[remappedPos]!==idx){
        remapped.splice(remappedPos+1);
        if(remapped[remapped.length-1]!==idx){
          remapped.push(idx);
        }
        remappedPos=remapped.length-1;
      }
    }

    state.history=remapped;
    state.historyPos=remappedPos;
  }else{
    state.history=[idx];
    state.historyPos=0;
    clearAdNavigationHistory();
    historicalAdContext=null;
  }

  /*
    Eski kod state'i geri taşıyıp ekrandaki slide'ı değiştirmeyebiliyordu.
    Hedef haber farklıysa görünür slide da aynı anda güncellenir.
  */
  if(targetKey!==previousKey){
    fill(slides[state.active],targetStory);
    slides[state.active].className="slide active";
  }

  if(
    filterReturnStoryKey &&
    targetKey===filterReturnStoryKey
  ){
    filterReturnStoryKey="";
  }

  updateKeywordAlert(targetStory);
  timer();
}


const INITIAL_LOADING_MIN_MS=280;
const INITIAL_LOADING_MAX_MS=12000;
const initialLoadingStartedAt=Date.now();
let initialLoadFinished=false;
let initialLoadingWatchdog=null;

function finishInitialLoading(forceImmediate=false){
  if(initialLoadFinished)return;
  initialLoadFinished=true;

  if(initialLoadingWatchdog){
    clearTimeout(initialLoadingWatchdog);
    initialLoadingWatchdog=null;
  }

  const screen=document.getElementById("loading-screen");
  if(!screen){
    if(!window.__floewInitialReady){
      window.__floewInitialReady=true;
      window.dispatchEvent(new Event("floew:ready"));
    }
    return;
  }

  const progress=screen.querySelector(".loading-progress");

  const remove=()=>{
    if(screen.isConnected)screen.remove();

    if(!window.__floewInitialReady){
      window.__floewInitialReady=true;
      window.dispatchEvent(new Event("floew:ready"));
    }
  };

  if(forceImmediate){
    progress?.classList.add("is-complete");
    remove();
    return;
  }

  const elapsed=Date.now()-initialLoadingStartedAt;
  const wait=Math.max(0,INITIAL_LOADING_MIN_MS-elapsed);

  setTimeout(()=>{
    requestAnimationFrame(()=>{
      progress?.classList.add("is-complete");

      /* Barın %100'e vardığı kısa an görünür kalsın; ardından loading katmanı
         yumuşak biçimde kaybolsun. */
      setTimeout(()=>{
        if(!screen.isConnected){
          remove();
          return;
        }
        screen.classList.add("is-done");
        screen.addEventListener("transitionend",remove,{once:true});
        // Güvenlik: transitionend herhangi bir nedenle gelmezse overlay kalmasın.
        setTimeout(remove,700);
      },80);
    });
  },wait);
}

function waitForInitialStoryVisual(slide,timeoutMs=2600){
  return new Promise(resolve=>{
    const image=slide?.querySelector?.(".slide-image");
    if(!image){resolve(false);return;}

    let settled=false;
    const finish=value=>{
      if(settled)return;
      settled=true;
      clearTimeout(timeout);
      image.removeEventListener("load",check);
      image.removeEventListener("error",check);
      resolve(Boolean(value));
    };

    const check=async()=>{
      /* setStoryImage küçük thumbnail'den article-proxy'ye aynı load olayı
         içinde geçebilir. Bir microtask bekleyip gerçekten son src hazır mı
         kontrol ediyoruz. */
      await Promise.resolve();

      if(image.dataset.imageStage==="failed"){
        finish(false);
        return;
      }

      if(!image.complete || !image.naturalWidth)return;

      if(image.decode){
        try{await image.decode()}catch(e){}
      }

      if(image.complete && image.naturalWidth){
        finish(true);
      }
    };

    const timeout=setTimeout(()=>finish(false),timeoutMs);
    image.addEventListener("load",check);
    image.addEventListener("error",check);
    void check();
  });
}

async function finishInitialLoadingAfterVisual(slide){
  if(initialLoadFinished)return;
  await waitForInitialStoryVisual(slide);
  finishInitialLoading();
  scheduleAdjacentFeedPreload(0);
}

/*
  Worker cevapları uzarsa loading katmanının sayfayı sonsuza kadar
  kilitlemesine izin verme. Haberler daha sonra gelirse normal akış devam eder.
*/
initialLoadingWatchdog=setTimeout(
  ()=>finishInitialLoading(true),
  INITIAL_LOADING_MAX_MS
);

function status(msg){
  const e=document.getElementById("status");
  e.innerHTML="";
  const band=document.createElement("div");
  band.className="status-band";

  const text=document.createElement("span");
  text.className="status-message";
  text.textContent=msg;

  const close=document.createElement("button");
  close.className="status-close";
  close.type="button";
  close.setAttribute("aria-label","Uyarıyı kapat");
  close.textContent="×";
  close.addEventListener("pointerdown",ev=>ev.stopPropagation());
  close.addEventListener("pointerup",ev=>ev.stopPropagation());
  close.addEventListener("click",ev=>{
    ev.stopPropagation();
    clearStatus();
  });

  band.append(text,close);
  e.appendChild(band);
  e.hidden=false;
}
function clearStatus(){
  const e=document.getElementById("status");
  e.hidden=true;
  e.innerHTML="";
}

function sourceKey(source){return String(source||"").trim().toLocaleLowerCase("tr-TR")}

function sourceLogo(source,link=""){
  const raw=String(source||"").trim();
  const rawKey=sourceKey(raw);
  const standardKey=raw.toLowerCase();
  const asciiKey=standardKey
    .replace(/ı/g,"i")
    .replace(/ğ/g,"g")
    .replace(/ü/g,"u")
    .replace(/ş/g,"s")
    .replace(/ö/g,"o")
    .replace(/ç/g,"c")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g,"");

  const mapped=
    SOURCE_LOGOS[rawKey] ||
    SOURCE_LOGOS[standardKey] ||
    SOURCE_LOGOS[asciiKey];

  if(mapped)return mapped;

  /*
    Yeni bir kaynak eklenip SOURCE_LOGOS tablosu henüz güncellenmemiş olsa bile
    Google News simgesine düşmek yerine haberin gerçek alan adının faviconunu
    kullan. Böylece kaynak kataloğu büyüdükçe logolar kendiliğinden doğru kalır.
  */
  try{
    const u=new URL(String(link||""));
    const host=u.hostname.replace(/^www\./i,"").trim();
    if(host){
      return `https://icons.duckduckgo.com/ip3/${host}.ico`;
    }
  }catch(e){}

  return "https://icons.duckduckgo.com/ip3/news.google.com.ico";
}

function timeText(v){
  const d=new Date(v);
  if(!v||Number.isNaN(d.getTime()))return "";
  const m=Math.max(0,Math.floor((Date.now()-d.getTime())/60000));
  if(m<1)return "az önce";
  if(m<60)return m+" dakika önce";
  const h=Math.floor(m/60);
  if(h<24)return h+" saat önce";
  return d.toLocaleDateString("tr-TR",{day:"2-digit",month:"2-digit",year:"numeric"});
}


const storyMediaCache=new Map();
const VIDEO_RESOLVER_VERSION="20260825-6";
const SUPPORTED_EMBED_VIDEO_PROVIDERS=new Set([
  "youtube",
  "vimeo",
  "dailymotion"
]);
let videoAudioEnabled=false;
let videoAudioStoryKey="";
let videoAudioUiSyncQueued=false;

function mediaKey(story){
  if(!story)return "";
  const link=String(story?.link||"").trim();
  const title=normalizeText(story?.title||"")
    .replace(/\s+/g," ")
    .trim();

  /*
    Link tek başına yeterli değil: rolling/live URL'ler zaman içinde başka
    başlık ve videoya dönüşebiliyor. Async medya işlemlerini başlıkla da bağla.
  */
  if(link)return `${link}|${title}`;
  return `${String(story?.source||"").trim()}|${title}`;
}

function mediaUrlIsSafe(value=""){
  try{
    const url=new URL(String(value||""));
    return url.protocol==="https:" || url.protocol==="http:";
  }catch(e){
    return false;
  }
}

function normalizeResolvedStoryMedia(value){
  if(!value || typeof value!=="object")return null;

  const kind=String(value.kind||"").toLowerCase();
  const url=String(value.url||"").trim();
  if(!url || !mediaUrlIsSafe(url))return null;

  if(kind==="video"){
    return {
      kind:"video",
      url,
      type:String(value.type||""),
      provider:"native",
      source:String(value.source||""),
      confidence:Number(value.confidence)||0
    };
  }

  if(kind==="embed"){
    const provider=String(value.provider||"").toLowerCase();
    if(!SUPPORTED_EMBED_VIDEO_PROVIDERS.has(provider))return null;
    return {
      kind:"embed",
      url,
      type:"",
      provider,
      source:String(value.source||""),
      confidence:Number(value.confidence)||0
    };
  }

  return null;
}

function retireDailymotionHost(host){
  if(!host)return;

  host.dataset.retired="1";
  host.removeAttribute("data-media-token");

  if(host.__floewDailymotionMonitor){
    clearInterval(host.__floewDailymotionMonitor);
    host.__floewDailymotionMonitor=null;
  }

  const player=host.__floewDailymotionPlayer;
  host.__floewDailymotionPlayer=null;
  host.__floewDailymotionPlayerId="";
  host.__floewDailymotionVideoId="";

  if(player){
    try{
      const r=player.pause?.();
      if(r?.catch)r.catch(()=>{});
    }catch(e){}
    try{
      const r=player.pipClose?.();
      if(r?.catch)r.catch(()=>{});
    }catch(e){}
  }

  try{
    const r=window.dailymotion?.destroy?.(host.id);
    if(r?.catch)r.catch(()=>{});
  }catch(e){}

  try{host.remove()}catch(e){
    try{host.replaceChildren()}catch(innerError){}
  }
}

function resetSlideMedia(el){
  if(!el)return;

  el.dataset.mediaToken=String(
    (Number(el.dataset.mediaToken)||0)+1
  );
  el.removeAttribute("data-preloaded-story-key");
  el.removeAttribute("data-media-ready-story-key");
  el.removeAttribute("data-media-kind");
  el.removeAttribute("data-media-timer-story-key");
  el.__floewMediaPrepare=null;

  const image=el.querySelector(".slide-image");
  const video=el.querySelector(".slide-video");
  const embed=el.querySelector(".slide-embed");
  const dailymotionHost=el.querySelector(".slide-dailymotion");

  if(image){
    image.onerror=null;
    image.onload=null;
    image.removeAttribute("data-image-stage");
    image.removeAttribute("data-focal-key");
    image.style.display="block";
    image.style.visibility="visible";
    image.style.objectPosition="50% 50%";
  }

  if(video){
    video.__floewShouldPlay=false;
    video.__floewMediaDescriptor=null;
    video.__floewMediaStoryKey="";
    if(video.__floewHls){
      try{video.__floewHls.destroy()}catch(e){}
      video.__floewHls=null;
    }
    try{video.pause()}catch(e){}
    video.onloadeddata=null;
    video.onerror=null;
    video.removeAttribute("src");
    try{video.load()}catch(e){}
    video.classList.remove("media-visible");
    video.setAttribute("aria-hidden","true");
  }

  if(embed){
    embed.onload=null;
    embed.src="about:blank";
    embed.classList.remove("media-visible");
    embed.setAttribute("aria-hidden","true");
    embed.removeAttribute("data-provider");
  }

  if(dailymotionHost){
    dailymotionHost.classList.remove("media-visible");
    dailymotionHost.setAttribute("aria-hidden","true");
    retireDailymotionHost(dailymotionHost);
  }

  queueVideoAudioUiSync();
}

function stopSlideMedia(el){
  if(!el)return;
  resetSlideMedia(el);
}

async function resolveStoryMedia(story,options={}){
  const force=Boolean(options?.force);
  const strict=Boolean(options?.strict);
  if((!videoEnabled && !force) || !story)return null;

  const key=mediaKey(story);
  if(!key)return null;

  /*
    Normal oynatma ile "Sadece videolu haberler" doğrulaması aynı cache'i
    paylaşamaz. Normal resolver önerilen/site-geneli bir player bulmuş olsa
    bile strict tarama bunu yeniden Worker'da article-linked olarak
    doğrulamalıdır.
  */
  const cacheKey=strict
    ? `${key}|video-only-strict`
    : key;

  if(storyMediaCache.has(cacheKey)){
    return storyMediaCache.get(cacheKey);
  }

  const promise=(async()=>{
    /*
      RSS media:content/enclosure URL'si doğrudan oynatılabilir olsa bile
      artık frontend tarafından körlemesine kullanılmıyor. Worker'a hint olarak
      gönderiliyor; aynı haber sayfası ve başlık bağlamında normalize ediliyor.
    */
    if(!story.link){
      const direct=normalizeResolvedStoryMedia({
        kind:"video",
        url:story.video,
        type:story.videoType||"",
        source:"feed"
      });
      return direct;
    }

    const controller=new AbortController();
    const timeout=setTimeout(()=>controller.abort(),13000);

    try{
      const requestUrl=new URL(VIDEO_API);
      requestUrl.searchParams.set("url",story.link);
      requestUrl.searchParams.set("title",String(story.title||""));
      requestUrl.searchParams.set("rv",VIDEO_RESOLVER_VERSION);

      if(strict){
        requestUrl.searchParams.set("strict","1");
      }

      if(story.video){
        requestUrl.searchParams.set("hint",String(story.video));
        requestUrl.searchParams.set("hintType",String(story.videoType||""));
      }

      const response=await fetch(requestUrl.href,{
        method:"GET",
        mode:"cors",
        credentials:"omit",
        cache:"no-store",
        signal:controller.signal,
        headers:{"Accept":"application/json"}
      });

      if(!response.ok)return null;
      const data=await response.json();
      return normalizeResolvedStoryMedia(data?.media);
    }catch(error){
      if(error?.name!=="AbortError"){
        console.warn("Video resolve:",story.link,error);
      }
      return null;
    }finally{
      clearTimeout(timeout);
    }
  })();

  storyMediaCache.set(cacheKey,promise);

  promise.then(media=>{
    /* Null/error sonucunu oturum boyunca kilitleme; sonraki preload tekrar deneyebilir. */
    if(!media && storyMediaCache.get(cacheKey)===promise){
      storyMediaCache.delete(cacheKey);
      return;
    }

    /*
      Dailymotion metadata'sından çözülen native URL'ler imzalı/geçici olabilir.
      Oturum boyunca sonsuza kadar cache'leme; birkaç dakika sonra yeniden çöz.
    */
    if(
      media?.source==="cumhuriyet-dailymotion-native" &&
      storyMediaCache.get(cacheKey)===promise
    ){
      setTimeout(()=>{
        if(storyMediaCache.get(cacheKey)===promise){
          storyMediaCache.delete(cacheKey);
        }
      },4*60*1000);
    }
  }).catch(()=>{
    if(storyMediaCache.get(cacheKey)===promise){
      storyMediaCache.delete(cacheKey);
    }
  });

  if(storyMediaCache.size>160){
    const first=storyMediaCache.keys().next().value;
    if(first)storyMediaCache.delete(first);
  }

  return promise;
}

const HLS_JS_URL="https://cdn.jsdelivr.net/npm/hls.js@1.6.17/dist/hls.min.js";
let hlsLibraryPromise=null;

function ensureHlsLibrary(){
  if(window.Hls)return Promise.resolve(window.Hls);
  if(hlsLibraryPromise)return hlsLibraryPromise;

  hlsLibraryPromise=new Promise(resolve=>{
    const existing=document.querySelector('script[data-floew-hls="1"]');
    if(existing){
      existing.addEventListener("load",()=>resolve(window.Hls||null),{once:true});
      existing.addEventListener("error",()=>resolve(null),{once:true});
      return;
    }

    const script=document.createElement("script");
    script.src=HLS_JS_URL;
    script.async=true;
    script.crossOrigin="anonymous";
    script.referrerPolicy="no-referrer";
    script.dataset.floewHls="1";
    script.addEventListener("load",()=>resolve(window.Hls||null),{once:true});
    script.addEventListener("error",()=>{
      console.warn("Flöw video: HLS.js yüklenemedi.");
      hlsLibraryPromise=null;
      resolve(null);
    },{once:true});
    document.head.appendChild(script);
  });

  return hlsLibraryPromise;
}

function setMutedInlinePlaybackAttributes(video){
  if(!video)return;

  video.muted=true;
  video.defaultMuted=true;
  video.volume=0;
  video.autoplay=true;
  video.loop=true;
  video.playsInline=true;
  video.controls=false;
  video.preload="auto";
  video.disablePictureInPicture=true;
  try{video.disableRemotePlayback=true}catch(e){}

  video.setAttribute("muted","");
  video.setAttribute("autoplay","");
  video.setAttribute("loop","");
  video.setAttribute("playsinline","");
  video.setAttribute("webkit-playsinline","");
  video.setAttribute("preload","auto");
  video.setAttribute("controlslist","nodownload noplaybackrate noremoteplayback");

  if(!video.__floewPlaybackGuardBound){
    video.__floewPlaybackGuardBound=true;

    video.addEventListener("ended",()=>{
      if(!video.__floewShouldPlay)return;
      try{video.currentTime=0}catch(e){}
      const p=video.play?.();
      if(p?.catch)p.catch(()=>{});
    });

    video.addEventListener("pause",()=>{
      if(
        !video.__floewShouldPlay ||
        document.visibilityState!=="visible"
      )return;

      setTimeout(()=>{
        if(!video.__floewShouldPlay || document.visibilityState!=="visible")return;
        const p=video.play?.();
        if(p?.catch)p.catch(()=>{});
      },70);
    });
  }
}

async function attemptMutedAutoplay(video,attempts=4){
  if(!video)return false;
  setMutedInlinePlaybackAttributes(video);
  video.__floewShouldPlay=true;

  const delays=[0,70,180,380];
  const count=Math.max(1,Math.min(attempts,delays.length));

  for(let i=0;i<count;i++){
    if(delays[i]){
      await new Promise(resolve=>setTimeout(resolve,delays[i]));
    }else{
      await new Promise(resolve=>requestAnimationFrame(()=>resolve()));
    }

    if(!video.__floewShouldPlay)return false;

    try{
      const result=video.play();
      if(result?.then)await result;
      if(!video.paused)return true;
    }catch(e){}
  }

  return !video.paused;
}

function activeVideoSlide(){
  return document.querySelector(".slide.active") || slides?.[state?.active||0] || null;
}

function slideVisibleMedia(el){
  if(!el)return null;

  const direct=el.querySelector(".slide-video.media-visible");
  if(direct){
    return {kind:"video",provider:"native",element:direct};
  }

  const dailymotion=el.querySelector(".slide-dailymotion.media-visible");
  if(dailymotion){
    return {kind:"embed",provider:"dailymotion",element:dailymotion};
  }

  const embed=el.querySelector(".slide-embed.media-visible");
  if(embed){
    const provider=String(embed.dataset.provider||"").toLowerCase();
    if(SUPPORTED_EMBED_VIDEO_PROVIDERS.has(provider)){
      return {kind:"embed",provider,element:embed};
    }
  }

  return null;
}

function postYouTubeCommand(iframe,func,args=[]){
  try{
    iframe?.contentWindow?.postMessage(
      JSON.stringify({event:"command",func,args}),
      "*"
    );
  }catch(e){}
}

function postVimeoCommand(iframe,method,value){
  try{
    const payload=value===undefined ? {method} : {method,value};
    iframe?.contentWindow?.postMessage(payload,"https://player.vimeo.com");
  }catch(e){}
}

function applySlideVideoAudio(el,enabled){
  const media=slideVisibleMedia(el);
  if(!media)return;

  if(media.provider==="native"){
    const video=media.element;
    try{
      video.muted=!enabled;
      video.defaultMuted=!enabled;
      video.volume=enabled?1:0;
    }catch(e){}
    return;
  }

  if(media.provider==="youtube"){
    postYouTubeCommand(media.element,enabled?"unMute":"mute");
    postYouTubeCommand(media.element,"setVolume",[enabled?100:0]);
    return;
  }

  if(media.provider==="vimeo"){
    postVimeoCommand(media.element,"setVolume",enabled?1:0);
    return;
  }

  if(media.provider==="dailymotion"){
    const player=media.element.__floewDailymotionPlayer;
    try{
      const result=player?.setVolume?.(enabled?1:0);
      if(result?.catch)result.catch(()=>{});
    }catch(e){}
  }
}

function syncActiveVideoAudioUi(){
  videoAudioUiSyncQueued=false;
  const button=document.getElementById("video-audio-toggle");
  if(!button)return;

  const slide=activeVideoSlide();
  const media=slideVisibleMedia(slide);
  const storyKey=String(slide?.dataset.storyKey||"");

  if(!media || !storyKey || adActive){
    button.hidden=true;
    button.setAttribute("aria-hidden","true");
    return;
  }

  if(videoAudioStoryKey!==storyKey){
    videoAudioStoryKey=storyKey;
    videoAudioEnabled=false;
  }

  /* Her yeni haber varsayılan olarak sessiz başlar. */
  applySlideVideoAudio(slide,videoAudioEnabled);

  button.hidden=false;
  button.setAttribute("aria-hidden","false");
  button.classList.toggle("sound-on",videoAudioEnabled);
  button.setAttribute("aria-pressed",videoAudioEnabled?"true":"false");
  button.setAttribute("aria-label",videoAudioEnabled?"Videonun sesini kapat":"Videonun sesini aç");
  button.title=videoAudioEnabled?"Sesi kapat":"Sesi aç";
}

function queueVideoAudioUiSync(){
  if(videoAudioUiSyncQueued)return;
  videoAudioUiSyncQueued=true;
  queueMicrotask(syncActiveVideoAudioUi);
}

function bindVideoAudioUi(){
  const button=document.getElementById("video-audio-toggle");
  if(!button)return;

  const stop=e=>e.stopPropagation();
  button.addEventListener("pointerdown",stop);
  button.addEventListener("pointerup",stop);
  button.addEventListener("click",e=>{
    e.preventDefault();
    e.stopPropagation();

    const slide=activeVideoSlide();
    if(!slideVisibleMedia(slide))return;

    videoAudioEnabled=!videoAudioEnabled;
    applySlideVideoAudio(slide,videoAudioEnabled);
    syncActiveVideoAudioUi();
  });

  const root=document.querySelector("main");
  if(root && window.MutationObserver){
    const observer=new MutationObserver(queueVideoAudioUiSync);
    observer.observe(root,{
      subtree:true,
      childList:true,
      attributes:true,
      attributeFilter:["class","data-story-key","aria-hidden"]
    });
  }

  document.addEventListener("visibilitychange",()=>{
    if(document.visibilityState==="visible"){
      const slide=activeVideoSlide();
      const direct=slide?.querySelector(".slide-video.media-visible");
      if(direct?.__floewShouldPlay){
        const p=direct.play?.();
        if(p?.catch)p.catch(()=>{});
      }
      queueVideoAudioUiSync();
    }
  });

  queueVideoAudioUiSync();
}

function storyLikelyNeedsMediaGrace(story){
  if(!videoEnabled || !story)return false;

  if(
    story.videoVerified===true ||
    story.videoArticleHint===true ||
    story.videoDiscovery===true ||
    Boolean(story.video)
  )return true;

  try{
    const path=new URL(String(story.link||""),location.href).pathname;
    if(/(?:^|\/)video(?:\/|-)/i.test(path))return true;
  }catch(e){}

  return false;
}

function markSlideMediaReady(el,story,kind){
  if(!el || !story)return;
  el.dataset.mediaReadyStoryKey=mediaKey(story);
  el.dataset.mediaKind=kind;

  /*
    İlk ziyarette /video çözümü geç tamamlanırsa eski sayaç haberi video
    görünmeden ilerletebiliyordu. Medya aktif slaytta sonradan gerçekten hazır
    olduğunda o haber için süreyi bir kez yeniden başlat; preload edilen pasif
    slaytlar bu davranışı tetiklemez.
  */
  const identity=storyIdentity(story);
  const current=state.stories[state.index];
  if(
    identity &&
    storyLikelyNeedsMediaGrace(story) &&
    el.classList.contains("active") &&
    storyIdentity(current)===identity &&
    el.dataset.mediaTimerStoryKey!==identity
  ){
    el.dataset.mediaTimerStoryKey=identity;
    if(!state.busy)timer();
  }

  queueVideoAudioUiSync();
}

function timerAfterLikelyMediaWarmup(el,story,maxGraceMs=7000){
  if(!storyLikelyNeedsMediaGrace(story)){
    timer();
    return;
  }

  const key=mediaKey(story);
  const pending=
    el?.__floewMediaPrepare?.key===key
      ? el.__floewMediaPrepare.promise
      : null;

  if(!pending || typeof pending.then!=="function"){
    timer();
    return;
  }

  const identity=storyIdentity(story);
  let finished=false;
  const arm=()=>{
    if(finished)return;
    finished=true;

    if(
      adActive ||
      state.busy ||
      !el?.classList.contains("active") ||
      storyIdentity(state.stories[state.index])!==identity
    )return;

    timer();
  };

  Promise.race([
    Promise.resolve(pending).catch(()=>false),
    new Promise(resolve=>setTimeout(resolve,Math.max(0,maxGraceMs)))
  ]).then(arm,arm);
}

function showDirectVideo(el,story,media,token){
  const image=el.querySelector(".slide-image");
  const video=el.querySelector(".slide-video");

  if(!video || !media?.url)return Promise.resolve(false);

  setMutedInlinePlaybackAttributes(video);
  video.poster=story.image||"";
  video.__floewMediaDescriptor=media;
  video.__floewMediaStoryKey=mediaKey(story);
  video.__floewShouldPlay=true;

  return new Promise(resolve=>{
    let settled=false;
    let revealing=false;
    let mediaRecoveryTried=false;

    const isCurrent=()=>Boolean(
      videoEnabled &&
      token===el.dataset.mediaToken &&
      mediaKey(story)===el.dataset.storyKey &&
      video.__floewMediaStoryKey===mediaKey(story)
    );

    const finish=value=>{
      if(settled)return;
      settled=true;
      resolve(Boolean(value));
    };

    const destroyHls=()=>{
      if(video.__floewHls){
        try{video.__floewHls.destroy()}catch(e){}
        video.__floewHls=null;
      }
    };

    const fallback=()=>{
      if(settled)return;
      if(!isCurrent()){
        finish(false);
        return;
      }

      video.__floewShouldPlay=false;
      destroyHls();
      try{video.pause()}catch(e){}
      video.removeAttribute("src");
      try{video.load()}catch(e){}
      video.classList.remove("media-visible");
      video.setAttribute("aria-hidden","true");
      if(image)image.style.display="block";
      queueVideoAudioUiSync();
      finish(false);
    };

    const reveal=async()=>{
      if(settled || revealing)return;
      revealing=true;

      if(!isCurrent()){
        revealing=false;
        finish(false);
        return;
      }

      const played=await attemptMutedAutoplay(video,4);
      revealing=false;

      if(!played || !isCurrent()){
        fallback();
        return;
      }

      video.classList.add("media-visible");
      video.setAttribute("aria-hidden","false");
      if(image)image.style.display="none";
      markSlideMediaReady(el,story,"video");
      finish(true);
    };

    /*
      İlk HLS gelişinde manifest hazır olsa bile ilk video karesi henüz buffer'a
      düşmemiş olabilir. Görseli ancak gerçek medya verisi hazır olduğunda
      kaldır; bu, ilk ziyarette görselde kalıp geri dönüşte videonun açılması
      şeklindeki yarış durumunu azaltır.
    */
    const requestReveal=()=>{reveal();};
    video.onloadeddata=requestReveal;
    video.oncanplay=requestReveal;
    video.onerror=fallback;

    const type=String(media.type||"").toLowerCase();
    const isHls=
      type.includes("mpegurl") ||
      /\.m3u8(?:[?#]|$)/i.test(media.url);

    const startNative=()=>{
      if(!isCurrent()){
        finish(false);
        return;
      }
      video.src=media.url;
      video.load();
      if(video.readyState>=2)reveal();
    };

    if(!isHls){
      startNative();
      return;
    }

    (async()=>{
      const HlsCtor=await ensureHlsLibrary();
      if(settled || !isCurrent()){
        finish(false);
        return;
      }

      if(HlsCtor?.isSupported?.()){
        const hls=new HlsCtor({
          enableWorker:true,
          lowLatencyMode:false,
          backBufferLength:30
        });
        video.__floewHls=hls;

        hls.on(HlsCtor.Events.MEDIA_ATTACHED,()=>{
          if(!settled && isCurrent())hls.loadSource(media.url);
        });
        hls.on(HlsCtor.Events.MANIFEST_PARSED,()=>{
          if(settled || !isCurrent())return;

          /*
            MANIFEST_PARSED yalnız playlist'in çözüldüğünü söyler; ilk frame'in
            oynatılabilir olduğunu garanti etmez. Autoplay'i erkenden tetikle,
            fakat görseli loadeddata/canplay gelene kadar kapatma.
          */
          attemptMutedAutoplay(video,4).catch(()=>{});
          if(video.readyState>=2)requestReveal();
        });
        if(HlsCtor.Events.FRAG_BUFFERED){
          hls.on(HlsCtor.Events.FRAG_BUFFERED,()=>{
            if(!settled && isCurrent() && video.readyState>=2)requestReveal();
          });
        }
        hls.on(HlsCtor.Events.ERROR,(_event,data)=>{
          if(!data?.fatal || settled)return;

          if(
            data.type===HlsCtor.ErrorTypes.MEDIA_ERROR &&
            !mediaRecoveryTried
          ){
            mediaRecoveryTried=true;
            try{
              hls.recoverMediaError();
              return;
            }catch(e){}
          }
          fallback();
        });
        hls.attachMedia(video);
        return;
      }

      if(
        video.canPlayType("application/vnd.apple.mpegurl") ||
        video.canPlayType("application/x-mpegURL")
      ){
        startNative();
        return;
      }

      fallback();
    })();
  });
}

function youtubeVideoIdFromEmbed(url=""){
  try{
    const u=new URL(url);
    const match=u.pathname.match(/\/embed\/([A-Za-z0-9_-]{6,20})/);
    return match?.[1]||"";
  }catch(e){
    return "";
  }
}

function cleanEmbedUrl(media){
  if(!media?.url)return "";

  try{
    const u=new URL(media.url);
    const provider=String(media.provider||"").toLowerCase();

    if(provider==="youtube"){
      const id=youtubeVideoIdFromEmbed(u.href);
      u.searchParams.set("autoplay","1");
      u.searchParams.set("mute","1");
      u.searchParams.set("controls","0");
      u.searchParams.set("disablekb","1");
      u.searchParams.set("fs","0");
      u.searchParams.set("playsinline","1");
      u.searchParams.set("iv_load_policy","3");
      u.searchParams.set("cc_load_policy","0");
      u.searchParams.set("rel","0");
      u.searchParams.set("loop","1");
      u.searchParams.set("enablejsapi","1");
      if(id)u.searchParams.set("playlist",id);
      try{u.searchParams.set("origin",location.origin)}catch(e){}
    }else if(provider==="vimeo"){
      u.searchParams.set("autoplay","1");
      u.searchParams.set("muted","1");
      u.searchParams.set("background","1");
      u.searchParams.set("loop","1");
      u.searchParams.set("controls","0");
      u.searchParams.set("title","0");
      u.searchParams.set("byline","0");
      u.searchParams.set("portrait","0");
      u.searchParams.set("keyboard","0");
      u.searchParams.set("dnt","1");
    }else if(provider==="dailymotion"){
      u.searchParams.set("autoplay","true");
      u.searchParams.set("mute","true");
      u.searchParams.set("loop","true");
      u.searchParams.set("scaleMode","fill");
    }else{
      return "";
    }

    return u.href;
  }catch(e){
    return "";
  }
}

function showProviderEmbedVideo(el,story,media,token){
  const image=el.querySelector(".slide-image");
  const embed=el.querySelector(".slide-embed");
  const provider=String(media?.provider||"").toLowerCase();

  if(
    !embed ||
    !media?.url ||
    !["youtube","vimeo"].includes(provider)
  )return Promise.resolve(false);

  const cleanUrl=cleanEmbedUrl(media);
  if(!cleanUrl)return Promise.resolve(false);

  embed.dataset.provider=provider;
  embed.tabIndex=-1;
  embed.setAttribute("allow","autoplay; encrypted-media");

  return new Promise(resolve=>{
    let settled=false;
    const isCurrent=()=>Boolean(
      videoEnabled &&
      token===el.dataset.mediaToken &&
      mediaKey(story)===el.dataset.storyKey
    );

    const finish=value=>{
      if(settled)return;
      settled=true;
      resolve(Boolean(value));
    };

    embed.onload=()=>{
      if(!isCurrent()){
        finish(false);
        return;
      }

      embed.classList.add("media-visible");
      embed.setAttribute("aria-hidden","false");
      if(image)image.style.display="none";
      markSlideMediaReady(el,story,"embed");

      /* Parametreye ek olarak API komutunu da gönder; preload sırasında başlasın. */
      if(provider==="youtube"){
        postYouTubeCommand(embed,"mute");
        postYouTubeCommand(embed,"playVideo");
        setTimeout(()=>{
          if(isCurrent()){
            postYouTubeCommand(embed,"mute");
            postYouTubeCommand(embed,"playVideo");
          }
        },320);
      }else if(provider==="vimeo"){
        postVimeoCommand(embed,"setVolume",0);
        postVimeoCommand(embed,"setLoop",true);
        postVimeoCommand(embed,"play");
        setTimeout(()=>{
          if(isCurrent()){
            postVimeoCommand(embed,"setVolume",0);
            postVimeoCommand(embed,"play");
          }
        },320);
      }

      finish(true);
    };

    embed.src=cleanUrl;
  });
}

let dailymotionLibraryPromise=null;
let dailymotionHostSequence=0;

function dailymotionMediaParts(media){
  if(String(media?.provider||"").toLowerCase()!=="dailymotion")return null;

  try{
    const url=new URL(media.url);
    const videoId=String(url.searchParams.get("video")||"").trim();
    const playerMatch=url.pathname.match(
      /\/player\/([A-Za-z0-9_-]+)\.html$/i
    );
    const playerId=playerMatch?.[1]||"";

    if(!/^[A-Za-z0-9]{5,24}$/.test(videoId))return null;
    if(!/^[A-Za-z0-9_-]{3,40}$/.test(playerId))return null;
    return {videoId,playerId};
  }catch(e){
    return null;
  }
}

function ensureDailymotionHost(el){
  const existing=el.querySelector(".slide-dailymotion");
  if(existing)retireDailymotionHost(existing);

  const host=document.createElement("div");
  host.className="slide-dailymotion";
  host.id=`floew-dailymotion-${Date.now().toString(36)}-${++dailymotionHostSequence}`;
  host.setAttribute("aria-hidden","true");

  const embed=el.querySelector(".slide-embed");
  if(embed)embed.insertAdjacentElement("afterend",host);
  else el.appendChild(host);

  return host;
}

function ensureDailymotionLibrary(playerId){
  if(!/^[A-Za-z0-9_-]{3,40}$/.test(String(playerId||"")))return Promise.resolve(null);
  if(window.dailymotion?.createPlayer)return Promise.resolve(window.dailymotion);
  if(dailymotionLibraryPromise)return dailymotionLibraryPromise;

  dailymotionLibraryPromise=new Promise(resolve=>{
    const existing=document.querySelector('script[data-floew-dailymotion-library="1"]');
    const finish=()=>resolve(window.dailymotion?.createPlayer?window.dailymotion:null);

    if(existing){
      if(window.dailymotion?.createPlayer)finish();
      else{
        existing.addEventListener("load",finish,{once:true});
        existing.addEventListener("error",()=>resolve(null),{once:true});
      }
      return;
    }

    /* Dailymotion'ın resmi Player Library URL biçimi. */
    const script=document.createElement("script");
    script.src=`https://geo.dailymotion.com/libs/player/${encodeURIComponent(playerId)}.js`;
    script.async=true;
    script.referrerPolicy="strict-origin-when-cross-origin";
    script.dataset.floewDailymotionLibrary="1";
    script.addEventListener("load",finish,{once:true});
    script.addEventListener("error",()=>{
      console.warn("Flöw video: Dailymotion Player Library yüklenemedi.");
      dailymotionLibraryPromise=null;
      resolve(null);
    },{once:true});
    document.body.appendChild(script);
  });

  return dailymotionLibraryPromise;
}

async function dailymotionState(player){
  if(!player?.getState)return null;
  try{
    const state=await player.getState();
    return state && typeof state==="object" ? state : null;
  }catch(e){
    return null;
  }
}

async function dailymotionStateVideoId(player){
  const state=await dailymotionState(player);
  return String(state?.videoId||"").trim();
}

async function ensureDailymotionExactVideo(player,videoId){
  const expected=String(videoId||"").trim();
  if(!player || !expected)return false;

  const readWithRetries=async()=>{
    for(const delay of [0,80,170,300]){
      if(delay)await new Promise(resolve=>setTimeout(resolve,delay));
      if(await dailymotionStateVideoId(player)===expected)return true;
    }
    return false;
  };

  if(await readWithRetries())return true;

  try{await player.loadContent?.({video:expected});}
  catch(e){return false;}

  return readWithRetries();
}

function monitorDailymotionExactVideo(host,player,expected,isCurrent){
  if(host.__floewDailymotionMonitor){
    clearInterval(host.__floewDailymotionMonitor);
  }

  let checking=false;
  host.__floewDailymotionMonitor=setInterval(async()=>{
    if(checking || !isCurrent())return;
    checking=true;

    try{
      const state=await dailymotionState(player);
      const current=String(state?.videoId||"").trim();
      const loadedFrom=String(state?.videoLoadedFrom||"").toLowerCase();

      /*
        Dailymotion player konfigürasyonu auto-next/recommendation açmışsa,
        video bittiğinde başka içerik yükleyebilir. Bunu mümkün olan en kısa
        sürede beklenen habere geri sabitle.
      */
      if(
        isCurrent() &&
        (
          (current && current!==expected) ||
          (
            loadedFrom==="auto_next" &&
            current!==expected
          )
        )
      ){
        try{await player.loadContent?.({video:expected});}catch(e){}
        try{await player.setVolume?.(0);}catch(e){}
        try{await player.setScaleMode?.("fill");}catch(e){}
        try{await player.play?.();}catch(e){}
      }
    }finally{
      checking=false;
    }
  },180);
}

async function showDailymotionVideo(el,story,media,token){
  const parts=dailymotionMediaParts(media);
  if(!parts)return false;

  const image=el.querySelector(".slide-image");
  const host=ensureDailymotionHost(el);
  host.dataset.mediaToken=token;
  host.dataset.dailymotionVideoId=parts.videoId;
  host.dataset.dailymotionPlayerId=parts.playerId;

  const dm=await ensureDailymotionLibrary(parts.playerId);

  const isCurrent=()=>Boolean(
    videoEnabled &&
    token===el.dataset.mediaToken &&
    host.isConnected &&
    host.dataset.retired!=="1" &&
    host.dataset.mediaToken===token &&
    host.dataset.dailymotionVideoId===parts.videoId &&
    mediaKey(story)===el.dataset.storyKey
  );

  if(!dm?.createPlayer || !isCurrent()){
    retireDailymotionHost(host);
    return false;
  }

  try{
    const options={
      video:parts.videoId,
      params:{
        autoplay:true,
        loop:true,
        mute:true,
        scaleMode:"fill"
      }
    };
    if(parts.playerId)options.player=parts.playerId;

    const player=await dm.createPlayer(host.id,options);
    host.__floewDailymotionPlayer=player;
    host.__floewDailymotionPlayerId=parts.playerId;
    host.__floewDailymotionVideoId=parts.videoId;

    if(!isCurrent()){
      retireDailymotionHost(host);
      return false;
    }

    try{await player.setVolume?.(0)}catch(e){}
    try{await player.setScaleMode?.("fill")}catch(e){}

    if(!await ensureDailymotionExactVideo(player,parts.videoId) || !isCurrent()){
      retireDailymotionHost(host);
      return false;
    }

    try{await player.play?.();}
    catch(e){
      await new Promise(resolve=>setTimeout(resolve,180));
      if(isCurrent()){
        try{await player.play?.();}catch(innerError){}
      }
    }

    if(!await ensureDailymotionExactVideo(player,parts.videoId) || !isCurrent()){
      retireDailymotionHost(host);
      return false;
    }

    monitorDailymotionExactVideo(host,player,parts.videoId,isCurrent);
    host.classList.add("media-visible");
    host.setAttribute("aria-hidden","false");
    if(image)image.style.display="none";
    markSlideMediaReady(el,story,"embed");
    return true;
  }catch(error){
    console.warn("Flöw video: Dailymotion SDK:",error);
    retireDailymotionHost(host);
    return false;
  }
}

function showEmbedVideo(el,story,media,token){
  const provider=String(media?.provider||"").toLowerCase();
  if(provider==="dailymotion")return showDailymotionVideo(el,story,media,token);
  if(provider==="youtube" || provider==="vimeo"){
    return showProviderEmbedVideo(el,story,media,token);
  }
  return Promise.resolve(false);
}

async function prepareSlideMedia(el,story,{preload=false}={}){
  if(!videoEnabled || !el || !story)return false;
  if(mediaKey(story)!==el.dataset.storyKey)return false;

  const key=mediaKey(story);
  const direct=el.querySelector(".slide-video");

  if(el.dataset.mediaReadyStoryKey===key){
    const dmHost=el.querySelector(".slide-dailymotion.media-visible");

    if(dmHost){
      const expected=String(dmHost.dataset.dailymotionVideoId||"").trim();
      const player=dmHost.__floewDailymotionPlayer;

      if(
        !expected ||
        !player ||
        !await ensureDailymotionExactVideo(player,expected)
      ){
        resetSlideMedia(el);
        el.dataset.storyKey=key;
      }else{
        try{await player.setVolume?.(0);}catch(e){}
        try{await player.play?.();}catch(e){}
        if(!preload)queueVideoAudioUiSync();
        return true;
      }
    }else{
      if(direct?.classList.contains("media-visible")){
        direct.__floewShouldPlay=true;
        const p=direct.play?.();
        if(p?.catch)p.catch(()=>{});
      }
      if(!preload)queueVideoAudioUiSync();
      return true;
    }
  }

  if(el.__floewMediaPrepare?.key===key){
    return el.__floewMediaPrepare.promise;
  }

  const token=el.dataset.mediaToken;
  const promise=(async()=>{
    const media=await resolveStoryMedia(story);

    if(
      !videoEnabled ||
      !media ||
      token!==el.dataset.mediaToken ||
      key!==el.dataset.storyKey
    )return false;

    if(media.kind==="video"){
      return showDirectVideo(el,story,media,token);
    }

    if(media.kind==="embed"){
      const provider=String(media.provider||"").toLowerCase();

      /*
        Dailymotion preload'u player oluşturarak yapma.
        Cumhuriyet'in kısa videoları gizli slaytta biterse Dailymotion
        auto-next/recommendation başka videoya geçebiliyor. Yalnız library
        ve origin'i ısıt; gerçek player haber görünürken oluşturulsun.
      */
      if(preload && provider==="dailymotion"){
        warmEmbedMedia(media);
        return false;
      }

      return showEmbedVideo(el,story,media,token);
    }

    return false;
  })();

  el.__floewMediaPrepare={key,promise};

  try{
    return await promise;
  }finally{
    if(el.__floewMediaPrepare?.promise===promise){
      el.__floewMediaPrepare=null;
    }
    if(!preload)queueVideoAudioUiSync();
  }
}

bindVideoAudioUi();

function renderVideoSetting(){
  const btn=document.getElementById("video-setting");
  if(!btn)return;

  btn.classList.toggle("active",videoEnabled);
  btn.setAttribute(
    "aria-pressed",
    videoEnabled?"true":"false"
  );

  const state=btn.querySelector(
    ".media-setting-state"
  );

  if(state){
    state.textContent=
      videoEnabled?"Açık":"Kapalı";
  }
}

function renderVideoOnlySetting(){
  const btn=document.getElementById("video-only-setting");
  if(!btn)return;

  btn.classList.toggle(
    "active",
    videoOnlyEnabled
  );

  btn.setAttribute(
    "aria-pressed",
    videoOnlyEnabled
      ? "true"
      : "false"
  );

  const stateEl=btn.querySelector(
    ".media-setting-state"
  );

  if(stateEl){
    stateEl.textContent=
      videoOnlyEnabled
        ? "Açık"
        : "Kapalı";
  }
}

function applyVideoOnlySetting(){
  renderVideoOnlySetting();

  videoOnlyScanGeneration++;
  videoOnlyScanRunning=false;
  videoOnlyScanQueued=false;
  videoOnlyScanRerun=false;

  clearTimeout(
    videoOnlyFilterRefreshTimer
  );

  if(videoOnlyEnabled){
    /*
      Mevcut görünür haber zaten çözülmüş bir videoysa onu anında doğrula.
      Aksi halde sahneyi temizleyip arka plan taramasından ilk gerçek videoyu
      bekle.
    */
    const current=
      state.stories[
        state.index
      ] || null;

    /*
      Normal oynatma cache'i video-only için kanıt sayılmaz. Mevcut haber de
      diğerleri gibi strict resolver üzerinden doğrulanır; aksi halde sayfa
      altındaki önerilen bir player filtreyi yanlış pozitif yapabilir.
    */

    applyFilters({
      preserveScan:true
    });
    queueVideoOnlyScan();
  }else{
    clearStatus();
    setStoryStageVisible(true);
    applyFilters({
      resetToStart:false,
      preserveScan:true
    });
  }
}

function applyVideoSetting(){
  renderVideoSetting();

  for(const slide of slides){
    stopSlideMedia(slide);
  }

  const story=state.stories[state.index];

  if(videoEnabled && story){
    const activeSlide=slides[state.active];
    activeSlide.dataset.storyKey=mediaKey(story);
    prepareSlideMedia(activeSlide,story);
  }
}

const ARTICLE_FIRST_IMAGE_SOURCES=new Set([
  "halk tv",
  "aydınlık",
  "aydinlik"
]);

function storyPrefersArticleImage(story){
  return ARTICLE_FIRST_IMAGE_SOURCES.has(
    sourceKey(story?.source)
  );
}

function storyImageProxyUrl(story,{preferArticle=false}={}){
  const imageUrl=String(story?.image||"").trim();
  if(!/^https?:\/\//i.test(imageUrl))return "";

  const proxy=new URL(IMAGE_PROXY_API);
  proxy.searchParams.set("url",imageUrl);

  const articleUrl=String(story?.link||"").trim();
  if(articleUrl){
    proxy.searchParams.set("ref",articleUrl);
  }

  if(preferArticle || storyPrefersArticleImage(story)){
    proxy.searchParams.set("preferArticle","1");
  }

  return proxy.href;
}

function losAngelesTimesOriginImageUrl(value=""){
  try{
    const transformed=new URL(value);

    if(
      transformed.hostname.toLowerCase()!=="ca-times.brightspotcdn.com"
    ){
      return "";
    }

    let nested=transformed.searchParams.get("url")||"";
    if(!nested)return "";

    for(let i=0;i<2;i++){
      try{
        const candidate=new URL(nested);

        if(
          candidate.hostname.toLowerCase()===
          "california-times-brightspot.s3.amazonaws.com"
        ){
          return candidate.href;
        }

        return "";
      }catch(e){
        try{
          const decoded=decodeURIComponent(nested);
          if(decoded===nested)return "";
          nested=decoded;
        }catch(innerError){
          return "";
        }
      }
    }
  }catch(e){}

  return "";
}

function storyExternalImageProxyUrl(story){
  const source=String(story?.source||"").trim().toLowerCase();

  if(source!=="los angeles times"){
    return "";
  }

  const direct=String(story?.image||"").trim();
  if(!direct)return "";

  /*
    Los Angeles Times Brightspot görselleri hem tarayıcı gömme
    kurallarına hem de sunucu tarafı hotlink/transform kontrollerine
    takılabildiği için son çare olarak görseli uzman bir image-cache
    servisi üzerinden isteriz. Varsa Brightspot transformer yerine
    içindeki gerçek California Times S3 görselini kullanırız.
  */
  const sourceImage=
    losAngelesTimesOriginImageUrl(direct)||
    direct;

  const proxy=new URL("https://wsrv.nl/");
  proxy.searchParams.set("url",sourceImage);
  proxy.searchParams.set("output","webp");
  proxy.searchParams.set("q","86");

  return proxy.href;
}


const smartFocalCache=new Map();
const smartFocalResolvedCache=new Map();
const SMART_FOCAL_SAMPLE=64;
const SMART_FOCAL_CACHE_MAX=160;
const SMART_FOCAL_LOCK_TIMEOUT_MS=520;

function smartCropEnabled(){
  /*
    v31.69 — Akıllı odak artık ekran boyutundan bağımsız.
    Mobilde kullanılan aynı FaceDetector + hafif saliency fallback'i
    masaüstü haber görsellerinde de uygulanır.
  */
  return true;
}

function clampFocal(value,min,max){
  return Math.max(min,Math.min(max,value));
}

function smartFocalObjectPosition(img,focal){
  if(!img || !focal)return "50% 50%";

  const naturalWidth=img.naturalWidth||0;
  const naturalHeight=img.naturalHeight||0;
  const boxWidth=img.clientWidth||window.innerWidth||0;
  const boxHeight=img.clientHeight||window.innerHeight||0;

  if(!naturalWidth || !naturalHeight || !boxWidth || !boxHeight){
    return `${clampFocal(focal.x,0,100).toFixed(1)}% ${clampFocal(focal.y,0,100).toFixed(1)}%`;
  }

  const scale=Math.max(boxWidth/naturalWidth,boxHeight/naturalHeight);
  const renderedWidth=naturalWidth*scale;
  const renderedHeight=naturalHeight*scale;
  const bounds=focal.faceBounds||null;

  const solveAxis=(rendered,viewport,focusPercent,minPercent,maxPercent,targetRatio=.5)=>{
    const excess=rendered-viewport;
    if(excess<=.5)return 50;

    const focus=(clampFocal(focusPercent,0,100)/100)*rendered;
    let position=(focus-(viewport*targetRatio))/excess;

    if(Number.isFinite(minPercent) && Number.isFinite(maxPercent)){
      const min=(clampFocal(minPercent,0,100)/100)*rendered;
      const max=(clampFocal(maxPercent,0,100)/100)*rendered;
      const margin=Math.min(viewport*.045,28);
      const lower=(max-(viewport-margin))/excess;
      const upper=(min-margin)/excess;

      if(lower<=upper){
        position=clampFocal(position,Math.max(0,lower),Math.min(1,upper));
      }
    }

    return clampFocal(position,0,1)*100;
  };

  const x=solveAxis(
    renderedWidth,
    boxWidth,
    focal.x,
    bounds?.left,
    bounds?.right,
    .5
  );
  const y=solveAxis(
    renderedHeight,
    boxHeight,
    focal.y,
    bounds?.top,
    bounds?.bottom,
    .44
  );

  return `${x.toFixed(1)}% ${y.toFixed(1)}%`;
}

function smartFocalFromPixels(data,width,height){
  if(!data || width<5 || height<5)return null;

  const count=width*height;
  const luminance=new Float32Array(count);
  const saliency=new Float32Array(count);

  for(let i=0,p=0;i<count;i++,p+=4){
    const r=data[p];
    const g=data[p+1];
    const b=data[p+2];
    luminance[i]=0.2126*r+0.7152*g+0.0722*b;
  }

  for(let y=1;y<height-1;y++){
    for(let x=1;x<width-1;x++){
      const i=y*width+x;
      const p=i*4;
      const r=data[p];
      const g=data[p+1];
      const b=data[p+2];
      const maxC=Math.max(r,g,b);
      const minC=Math.min(r,g,b);
      const saturation=maxC-minC;

      const edge=
        Math.abs(luminance[i-1]-luminance[i+1])+
        Math.abs(luminance[i-width]-luminance[i+width]);

      const nx=(x/(width-1))-.5;
      const ny=(y/(height-1))-.45;
      const centerDistance=Math.min(1,Math.hypot(nx,ny)*1.35);
      const centerBias=.78+.22*(1-centerDistance);

      /* FaceDetector olmayan Safari/iOS için düşük maliyetli bir yüz/ten
         ipucu. Tek başına karar vermez; kenar ve doygunluk haritasına yalnız
         orta ağırlıkta katkı sağlar. */
      const skinLike=(
        r>70 && g>35 && b>20 &&
        r>g*.92 && r>b*1.05 &&
        Math.max(r,g,b)-Math.min(r,g,b)>12
      );
      const skinScore=skinLike?34:0;

      saliency[i]=(edge+saturation*.18+skinScore)*centerBias;
    }
  }

  /*
    Tek bir parlak piksel yerine özneye benzeyen bir bölgeyi seçmek için
    saliency haritasını küçük bir pencere içinde topluyoruz.
  */
  const integral=new Float32Array((width+1)*(height+1));
  for(let y=0;y<height;y++){
    let rowSum=0;
    for(let x=0;x<width;x++){
      rowSum+=saliency[y*width+x];
      integral[(y+1)*(width+1)+(x+1)]=
        integral[y*(width+1)+(x+1)]+rowSum;
    }
  }

  const radius=Math.max(2,Math.round(Math.min(width,height)*.09));
  let bestScore=-1;
  let bestX=Math.round(width*.5);
  let bestY=Math.round(height*.45);

  const marginX=Math.max(1,Math.round(width*.06));
  const marginY=Math.max(1,Math.round(height*.05));

  for(let y=marginY;y<height-marginY;y++){
    for(let x=marginX;x<width-marginX;x++){
      const x0=Math.max(0,x-radius);
      const y0=Math.max(0,y-radius);
      const x1=Math.min(width-1,x+radius);
      const y1=Math.min(height-1,y+radius);
      const stride=width+1;
      const sum=
        integral[(y1+1)*stride+(x1+1)]-
        integral[y0*stride+(x1+1)]-
        integral[(y1+1)*stride+x0]+
        integral[y0*stride+x0];
      const area=(x1-x0+1)*(y1-y0+1);
      const score=sum/Math.max(1,area);

      if(score>bestScore){
        bestScore=score;
        bestX=x;
        bestY=y;
      }
    }
  }

  if(!(bestScore>0))return null;

  return {
    x:clampFocal((bestX/(width-1))*100,8,92),
    y:clampFocal((bestY/(height-1))*100,8,88)
  };
}

function smartFocalCacheSet(key,value){
  smartFocalCache.set(key,value);

  while(smartFocalCache.size>SMART_FOCAL_CACHE_MAX){
    const first=smartFocalCache.keys().next().value;
    smartFocalCache.delete(first);
    smartFocalResolvedCache.delete(first);
  }
}

function smartFocalResolvedCacheSet(key,value){
  smartFocalResolvedCache.set(key,value);

  while(smartFocalResolvedCache.size>SMART_FOCAL_CACHE_MAX){
    const first=smartFocalResolvedCache.keys().next().value;
    smartFocalResolvedCache.delete(first);
  }
}

function detectSmartFocalPoint(story){
  const source=String(story?.image||"").trim();
  if(!source)return Promise.resolve(null);

  const key=`${mediaKey(story)}|${source}`;
  if(smartFocalCache.has(key))return smartFocalCache.get(key);

  const task=new Promise(resolve=>{
    const probe=new Image();
    let settled=false;

    const finish=value=>{
      if(settled)return;
      settled=true;
      clearTimeout(timeout);
      resolve(value);
    };

    const timeout=setTimeout(()=>finish(null),7000);

    probe.crossOrigin="anonymous";
    probe.referrerPolicy="no-referrer";
    probe.decoding="async";

    probe.onload=async()=>{
      try{
        const naturalWidth=probe.naturalWidth||probe.width;
        const naturalHeight=probe.naturalHeight||probe.height;
        if(!naturalWidth || !naturalHeight){
          finish(null);
          return;
        }

        /*
          Tarayıcı yerleşik yüz algılamasını destekliyorsa önce yüzü kadraj odağı
          say. Desteklemeyen tarayıcılarda aşağıdaki genel görsel-saliency yöntemi
          devreye girer; harici ML kütüphanesi indirilmez.
        */
        if("FaceDetector" in window){
          try{
            const detector=new window.FaceDetector({
              fastMode:true,
              maxDetectedFaces:4
            });
            const faces=await detector.detect(probe);
            if(Array.isArray(faces) && faces.length){
              const boxes=faces
                .map(item=>item?.boundingBox)
                .filter(box=>
                  box &&
                  Number.isFinite(box.x) &&
                  Number.isFinite(box.y) &&
                  Number.isFinite(box.width) &&
                  Number.isFinite(box.height) &&
                  box.width>0 &&
                  box.height>0
                );

              if(boxes.length){
                /*
                  Birden fazla insan varsa yalnız en büyük yüzü takip etmek,
                  diğer kişileri portre kadrajının dışında bırakabiliyordu.
                  En büyük yüz alanının en az %12'si büyüklüğündeki yüzleri
                  anlamlı grup sayıp grubun tamamını kapsayan union alanının
                  merkezini kullanıyoruz.
                */
                const largestArea=Math.max(
                  ...boxes.map(box=>box.width*box.height)
                );

                const meaningful=boxes.filter(
                  box=>(box.width*box.height)>=largestArea*.12
                );

                const group=meaningful.length
                  ? meaningful
                  : boxes;

                const left=Math.min(...group.map(box=>box.x));
                const top=Math.min(...group.map(box=>box.y));
                const right=Math.max(...group.map(box=>box.x+box.width));
                const bottom=Math.max(...group.map(box=>box.y+box.height));

                const centerX=(left+right)/2;
                const centerY=(top+bottom)/2;

                finish({
                  x:clampFocal((centerX/naturalWidth)*100,2,98),
                  y:clampFocal((centerY/naturalHeight)*100,2,96),
                  faceBounds:{
                    left:clampFocal((left/naturalWidth)*100,0,100),
                    top:clampFocal((top/naturalHeight)*100,0,100),
                    right:clampFocal((right/naturalWidth)*100,0,100),
                    bottom:clampFocal((bottom/naturalHeight)*100,0,100)
                  }
                });
                return;
              }
            }
          }catch(e){}
        }

        const scale=Math.min(
          SMART_FOCAL_SAMPLE/naturalWidth,
          SMART_FOCAL_SAMPLE/naturalHeight,
          1
        );
        const width=Math.max(8,Math.round(naturalWidth*scale));
        const height=Math.max(8,Math.round(naturalHeight*scale));
        const canvas=document.createElement("canvas");
        canvas.width=width;
        canvas.height=height;
        const ctx=canvas.getContext("2d",{willReadFrequently:true});
        if(!ctx){
          finish(null);
          return;
        }

        ctx.drawImage(probe,0,0,width,height);
        const pixels=ctx.getImageData(0,0,width,height).data;
        finish(smartFocalFromPixels(pixels,width,height));
      }catch(e){
        finish(null);
      }
    };

    probe.onerror=()=>finish(null);

    /*
      Görsel analizi CORS yüzünden takılmasın diye mümkün olduğunda mevcut
      Worker image proxy'sini kullanıyoruz. Bu işlem akıllı odak açıkken ve arka planda çalışır.
    */
    probe.src=storyImageProxyUrl(story)||source;
  }).then(value=>{
    smartFocalResolvedCacheSet(key,value);
    smartFocalCacheSet(key,Promise.resolve(value));
    return value;
  });

  smartFocalCacheSet(key,task);
  return task;
}

async function lockSmartFocalPoint(
  img,
  story,
  timeoutMs=SMART_FOCAL_LOCK_TIMEOUT_MS
){
  if(!img)return null;

  const focalKey=
    `${mediaKey(story)}|${String(story?.image||"").trim()}`;

  img.dataset.focalKey=focalKey;

  if(!smartCropEnabled()){
    img.style.objectPosition="50% 50%";
    img.dataset.focalLockedKey=focalKey;
    return null;
  }

  /*
    Odak sonucu slide hareket etmeye başlamadan önce kilitlenir.
    FaceDetector/saliency sonucu bu kısa pencereye yetişmezse merkez kullanılır;
    geçiş başladıktan sonra object-position sonradan değiştirilmez.
  */
  let timeoutId=0;
  const timeout=new Promise(resolve=>{
    timeoutId=setTimeout(()=>resolve(null),Math.max(0,timeoutMs));
  });

  let focal=null;
  try{
    focal=await Promise.race([
      detectSmartFocalPoint(story),
      timeout
    ]);
  }catch(e){
    focal=null;
  }finally{
    clearTimeout(timeoutId);
  }

  if(
    img.dataset.focalKey!==focalKey ||
    !smartCropEnabled()
  ){
    return null;
  }

  /*
    Başka bir geçiş çağrısı bu görseli biz beklerken kilitlediyse artık
    object-position'ı sonradan değiştirme. Bu özellikle masaüstündeki
    non-blocking ok geçişlerinde görünür kadraj sıçramasını önler.
  */
  if(img.dataset.focalLockedKey===focalKey){
    return smartFocalResolvedCache.has(focalKey)
      ? smartFocalResolvedCache.get(focalKey)
      : null;
  }

  if(focal){
    img.style.objectPosition=smartFocalObjectPosition(img,focal);
  }else{
    img.style.objectPosition="50% 50%";
  }

  img.dataset.focalLockedKey=focalKey;
  return focal;
}

function desktopFinePointer(){
  try{
    return Boolean(
      window.matchMedia?.("(pointer: fine)")?.matches
    );
  }catch(e){
    return window.innerWidth>900;
  }
}

function lockSmartFocalPointImmediate(img,story){
  if(!img)return null;

  const focalKey=
    `${mediaKey(story)}|${String(story?.image||"").trim()}`;

  img.dataset.focalKey=focalKey;

  if(!smartCropEnabled()){
    img.style.objectPosition="50% 50%";
    img.dataset.focalLockedKey=focalKey;
    return null;
  }

  /*
    Masaüstünde geçişi yüz analizine bağlamıyoruz.
    Analiz preload sırasında bittiyse sonucu senkron kullan; bitmediyse
    merkez kadrajla hemen geç ve analizi sonraki kullanım için arka planda
    cache'e doldurmaya devam et.
  */
  const hasResolved=
    smartFocalResolvedCache.has(focalKey);

  const focal=
    hasResolved
      ? smartFocalResolvedCache.get(focalKey)
      : null;

  if(focal){
    img.style.objectPosition=smartFocalObjectPosition(img,focal);
  }else{
    img.style.objectPosition="50% 50%";

    if(!hasResolved){
      void detectSmartFocalPoint(story).catch(()=>null);
    }
  }

  img.dataset.focalLockedKey=focalKey;
  return focal;
}

async function lockSmartFocalPointForTransition(img,story){
  if(!img)return null;

  /*
    Fine pointer = masaüstü/laptop: tuş ve mouse geçişi anında başlar.
    Coarse pointer = mevcut mobil davranış: odak animasyondan önce en fazla
    520 ms kilitlenmeye devam eder.
  */
  if(desktopFinePointer()){
    return lockSmartFocalPointImmediate(img,story);
  }

  return lockSmartFocalPoint(
    img,
    story,
    SMART_FOCAL_LOCK_TIMEOUT_MS
  );
}

function applySmartFocalPoint(img,story){
  if(!img)return;

  const focalKey=
    `${mediaKey(story)}|${String(story?.image||"").trim()}`;

  if(img.dataset.focalLockedKey===focalKey)return;

  /*
    Görünür/ilk slide için de sonucu sonsuza kadar beklemeyiz.
    En geç 520 ms'de merkez kilitlenir; geç gelen analiz sonucu ekrandaki
    görseli sonradan kaydırmaz.
  */
  void lockSmartFocalPoint(
    img,
    story,
    SMART_FOCAL_LOCK_TIMEOUT_MS
  );
}

function setStoryImage(img,story){
  if(!img)return;

  const direct=String(story?.image||"").trim();
  const proxied=storyImageProxyUrl(story);
  const articleProxy=storyImageProxyUrl(
    story,
    {preferArticle:true}
  );
  const externalProxy=storyExternalImageProxyUrl(story);
  const articleFirst=storyPrefersArticleImage(story) && articleProxy;

  img.onerror=null;
  img.onload=null;
  img.alt=story?.title||"";
  img.referrerPolicy="no-referrer";
  img.style.visibility="visible";
  img.style.objectPosition="50% 50%";
  img.dataset.focalKey="";
  img.dataset.focalLockedKey="";

  if(!direct){
    img.removeAttribute("src");
    img.style.visibility="hidden";
    return;
  }

  img.dataset.imageStage=articleFirst
    ? "article-proxy"
    : "direct";

  img.onload=()=>{
    const stage=img.dataset.imageStage;

    /*
      RSS resmi tarayıcıda başarıyla açılsa bile küçük bir thumbnail olabilir.
      Bu durumda hata beklemeden Worker'a haber sayfasındaki OG/JSON-LD
      görselini tercih etmesini söyleriz.
    */
    if(
      stage==="direct" &&
      articleProxy &&
      /^https?:\/\//i.test(direct) &&
      (
        (img.naturalWidth>0 && img.naturalWidth<700) ||
        (img.naturalHeight>0 && img.naturalHeight<400)
      )
    ){
      img.dataset.imageStage="article-proxy";
      img.src=articleProxy;
      return;
    }

    img.style.visibility="visible";
    applySmartFocalPoint(img,story);
  };

  img.onerror=()=>{
    const stage=img.dataset.imageStage;

    if(
      stage==="direct" &&
      proxied &&
      proxied!==img.src
    ){
      img.dataset.imageStage="proxy";
      img.src=proxied;
      return;
    }

    if(
      stage==="article-proxy" &&
      direct &&
      direct!==img.src
    ){
      img.dataset.imageStage="direct-fallback";
      img.src=direct;
      return;
    }

    if(
      (stage==="proxy" || stage==="direct-fallback") &&
      externalProxy &&
      externalProxy!==img.src
    ){
      img.dataset.imageStage="external-proxy";
      img.src=externalProxy;
      return;
    }

    img.dataset.imageStage="failed";
    img.style.visibility="hidden";
  };

  img.src=articleFirst ? articleProxy : direct;
}

function fill(el,s,options={}){
  resetSlideMedia(el);
  el.dataset.storyKey=mediaKey(s);

  const slideImage=el.querySelector(".slide-image");
  setStoryImage(slideImage,s);

  const logo=el.querySelector(".source-logo");
  logo.src=sourceLogo(s.source,s.link);
  logo.alt=s.source||"";
  logo.onerror=()=>{logo.style.visibility="hidden"};
  logo.onload=()=>{logo.style.visibility="visible"};

  const sourceEl=el.querySelector(".source");
  if(sourceEl){
    sourceEl.textContent=s.source||"";
    sourceEl.title="Bu kaynakten tüm haberleri göster";
    sourceEl.setAttribute("role","button");
    sourceEl.tabIndex=0;
    sourceEl.onpointerdown=e=>e.stopPropagation();
    sourceEl.onpointerup=e=>e.stopPropagation();
    sourceEl.onclick=e=>{
      e.stopPropagation();
      activateTemporarySourceFeed(s.source);
    };
    sourceEl.onkeydown=e=>{
      if(e.key==="Enter" || e.key===" "){
        e.preventDefault();
        e.stopPropagation();
        activateTemporarySourceFeed(s.source);
      }
    };
  }
  const category=el.querySelector(".category");
  if(category){
    const categoryName=s.flowCategory||"#Yaşam";
    category.textContent=categoryName;
    category.title="Bu kategoriden tüm haberleri göster";
    category.setAttribute("role","button");
    category.tabIndex=0;
    category.onpointerdown=e=>e.stopPropagation();
    category.onpointerup=e=>e.stopPropagation();
    category.onclick=e=>{
      e.stopPropagation();
      activateTemporaryCategoryFeed(categoryName);
    };
    category.onkeydown=e=>{
      if(e.key==="Enter" || e.key===" "){
        e.preventDefault();
        e.stopPropagation();
        activateTemporaryCategoryFeed(categoryName);
      }
    };
  }
  el.querySelector("h1").textContent=s.title||"";

  const description=el.querySelector(".description");
  if(description){
    let text=String(s.description||s.summary||"").trim();

    if(text){
      try{
        const doc=new DOMParser().parseFromString(text,"text/html");
        text=(doc.body?.textContent||text).replace(/\s+/g," ").trim();
      }catch(e){
        text=text.replace(/\s+/g," ").trim();
      }
    }

    description.textContent=text;
    description.hidden=!text;
    description.classList.remove("is-expanded");
    description.setAttribute("aria-expanded","false");
    description.tabIndex=text?0:-1;
    description.title=text?"Tamamını okumak için tıklayın":"";

    if(text){
      prepareDescriptionPreview(description);
    }else{
      description.style.removeProperty("max-height");
    }
  }

  el.querySelector(".time").textContent=timeText(s.published);

  setSlideFloraScore(el,s);

  const sourceLink=el.querySelector(".source-link");
  if(sourceLink){
    sourceLink.title="Kaynağı gör";
    sourceLink.setAttribute("aria-label","Kaynağı gör");

    if(s.link){
      sourceLink.href=s.link;
      sourceLink.removeAttribute("target");
      sourceLink.removeAttribute("aria-hidden");
      sourceLink.style.display="inline-block";
    }else{
      sourceLink.removeAttribute("href");
      sourceLink.setAttribute("aria-hidden","true");
      sourceLink.style.display="none";
    }
  }

  if(videoEnabled && options.prepareMedia!==false){
    prepareSlideMedia(el,s);
  }
}

function activateSlideMedia(el,story){
  if(!videoEnabled || !el || !story)return;
  if(mediaKey(story)!==el.dataset.storyKey)return;
  prepareSlideMedia(el,story);
}

function slidePreloadedForStory(el,story){
  return Boolean(
    el &&
    story &&
    el.dataset.preloadedStoryKey===storyIdentity(story) &&
    el.dataset.storyKey===mediaKey(story)
  );
}

function prepareTransitionSlide(el,story){
  if(!slidePreloadedForStory(el,story)){
    fill(el,story,{prepareMedia:false});
  }
  el?.removeAttribute("data-preloaded-story-key");
}



const descriptionMetricCache=new WeakMap();

function descriptionPreviewHeight(description){
  const cached=descriptionMetricCache.get(description);
  if(cached?.previewHeight)return cached.previewHeight;

  const computed=getComputedStyle(description);
  const fontSize=parseFloat(computed.fontSize)||16;

  let lineHeight=parseFloat(computed.lineHeight);
  if(!Number.isFinite(lineHeight)){
    lineHeight=fontSize*1.42;
  }

  const mobile=Boolean(
    window.matchMedia?.("(max-width:700px), (pointer:coarse)")?.matches
  );
  const previewHeight=Math.ceil(lineHeight*(mobile?4:5));

  descriptionMetricCache.set(description,{previewHeight,lineHeight});
  return previewHeight;
}

function prepareDescriptionPreview(description){
  if(!description || description.hidden)return;

  descriptionMetricCache.delete(description);
  description.classList.add("description-no-motion");
  description.classList.remove("is-expanded");
  description.style.maxHeight=
    `${descriptionPreviewHeight(description)}px`;
  description.dataset.descriptionAnimating="0";

  /* Yeni haber fill edilirken görünür bir kapanma animasyonu oluşmasın. */
  requestAnimationFrame(()=>{
    requestAnimationFrame(()=>{
      description.classList.remove("description-no-motion");
    });
  });
}

function setDescriptionExpanded(description,expanded){
  if(!description || description.hidden)return;

  const isExpanded=description.classList.contains("is-expanded");
  if(isExpanded===expanded)return;

  const collapsedHeight=descriptionPreviewHeight(description);
  const targetHeight=expanded
    ? Math.ceil(description.scrollHeight)
    : collapsedHeight;

  /* Normal aç/kapa yolunda mevcut inline max-height zaten animasyonun doğru
     başlangıç değeridir. Eski kod her tıklamada getBoundingClientRect + RAF ile
     iki ayrı zorunlu layout yaptırıyordu; görünür hareketi değiştirmeden bu
     senkron reflow'ları kaldırıyoruz. */
  if(description.dataset.descriptionAnimating==="1"){
    const current=parseFloat(getComputedStyle(description).maxHeight);
    if(Number.isFinite(current)){
      description.classList.add("description-no-motion");
      description.style.maxHeight=`${current}px`;
      void description.offsetHeight;
      description.classList.remove("description-no-motion");
    }
  }

  description.classList.toggle("is-expanded",expanded);
  description.setAttribute("aria-expanded",expanded?"true":"false");
  description.title=expanded
    ?"Metni daraltmak için tıklayın"
    :"Tamamını okumak için tıklayın";
  description.dataset.descriptionAnimating="1";
  description.style.maxHeight=`${targetHeight}px`;

  const finish=event=>{
    if(event.target!==description || event.propertyName!=="max-height")return;
    description.dataset.descriptionAnimating="0";
    description.removeEventListener("transitionend",finish);
  };
  description.addEventListener("transitionend",finish);

  if(expanded){
    clearTimeout(state.timer);
  }else if(!adActive){
    timer();
  }
}


function toggleDescription(description){
  setDescriptionExpanded(
    description,
    !description.classList.contains("is-expanded")
  );
}

const descriptionPointerState=new WeakMap();

function descriptionUsesSwipeNavigation(e){
  return Boolean(
    e.pointerType==="touch" ||
    (
      window.matchMedia?.("(pointer: coarse)")?.matches &&
      e.pointerType!=="mouse"
    )
  );
}

document.querySelectorAll(".description").forEach(description=>{
  description.setAttribute("role","button");
  description.setAttribute("aria-expanded","false");

  description.addEventListener("pointerdown",e=>{
    if(!descriptionUsesSwipeNavigation(e)){
      e.stopPropagation();
      return;
    }

    descriptionPointerState.set(description,{
      pointerId:e.pointerId,
      x:e.clientX,
      y:e.clientY,
      moved:false
    });
  });

  description.addEventListener("pointermove",e=>{
    const gesture=descriptionPointerState.get(description);
    if(!gesture || gesture.pointerId!==e.pointerId)return;

    if(
      Math.abs(e.clientX-gesture.x)>10 ||
      Math.abs(e.clientY-gesture.y)>10
    ){
      gesture.moved=true;
    }
  },{passive:true});

  description.addEventListener("pointerup",e=>{
    if(!descriptionUsesSwipeNavigation(e)){
      e.stopPropagation();
      return;
    }

    const gesture=descriptionPointerState.get(description);
    if(!gesture || gesture.pointerId!==e.pointerId)return;

    /* Click, pointerup'tan hemen sonra gelebilir; swipe bilgisini kısa süre tut. */
    setTimeout(()=>{
      if(descriptionPointerState.get(description)===gesture){
        descriptionPointerState.delete(description);
      }
    },450);
  });

  description.addEventListener("pointercancel",()=>{
    descriptionPointerState.delete(description);
  });

  description.addEventListener("click",e=>{
    const gesture=descriptionPointerState.get(description);
    if(gesture?.moved){
      e.preventDefault();
      e.stopPropagation();
      descriptionPointerState.delete(description);
      return;
    }

    e.preventDefault();
    e.stopPropagation();
    descriptionPointerState.delete(description);
    toggleDescription(description);
    showFullscreenButton();
  });

  description.addEventListener("keydown",e=>{
    if(e.key!=="Enter" && e.key!==" ")return;
    e.preventDefault();
    e.stopPropagation();
    toggleDescription(description);
  });
});

window.addEventListener("resize",()=>{
  document.querySelectorAll(".description").forEach(description=>{
    descriptionMetricCache.delete(description);
    if(description.hidden)return;

    description.style.maxHeight=description.classList.contains("is-expanded")
      ? `${Math.ceil(description.scrollHeight)}px`
      : `${descriptionPreviewHeight(description)}px`;
  });
},{passive:true});


function isMobileAdDevice(){
  try{
    if(navigator.userAgentData?.mobile===true)return true;
  }catch(e){}

  return /Android|iPhone|iPod|IEMobile|Opera Mini|Mobile/i.test(
    navigator.userAgent||""
  );
}

function getAdsLayout(){
  const portrait=
    window.innerHeight>window.innerWidth ||
    (
      window.matchMedia &&
      window.matchMedia("(orientation: portrait)").matches
    );

  /*
    Telefonda yatay tutulsa bile mobil kreatifi kullan.
    Masaüstünde ise pencere dikey oranlara çekildiğinde ver'e geç.
  */
  return portrait || isMobileAdDevice()
    ? "ver"
    : "hor";
}

function adsCacheKey(layout=getAdsLayout()){
  return `${ADS_CACHE_KEY}.${layout}`;
}

function parseAdFilenameClient(name=""){
  const filename=String(name||"").trim();
  const base=filename.replace(/\.[^.]+$/,"");
  const parts=base.split("__").map(part=>part.trim());

  if(
    parts.length>=4 &&
    /^[A-Za-z][A-Za-z0-9_-]{1,39}$/.test(parts[0])
  ){
    const label=value=>String(value||"")
      .replace(/[-_]+/g," ")
      .replace(/\s+/g," ")
      .trim();

    return {
      ad_id:parts[0].toUpperCase(),
      brand:label(parts[1]),
      campaign:label(parts[2]),
      creative:label(parts.slice(3).join(" ")),
      standardized:true
    };
  }

  return {
    ad_id:base.slice(0,80)||"unknown-ad",
    brand:"",
    campaign:"",
    creative:base
      .replace(/[-_]+/g," ")
      .replace(/\s+/g," ")
      .trim(),
    standardized:false
  };
}

function normalizeAdEntry(item){
  if(!item)return null;

  const rawSrc=
    typeof item==="string"
      ? item
      : String(item.url||item.src||"");

  const src=rawSrc.trim();
  if(!src)return null;

  const name=
    typeof item==="object"
      ? String(item.name||"")
      : "";

  const layout=
    typeof item==="object" &&
    (item.layout==="ver" || item.layout==="hor")
      ? item.layout
      : "";

  const clean=(name||src)
    .split("?")[0]
    .split("#")[0]
    .toLocaleLowerCase("en-US");

  let type=
    typeof item==="object" && item.type
      ? String(item.type).toLocaleLowerCase("en-US")
      : "";

  if(!type){
    if(clean.endsWith(".mp4"))type="video";
    else if(clean.endsWith(".jpg")||clean.endsWith(".jpeg"))type="image";
  }

  if(type!=="video" && type!=="image")return null;

  const parsed=parseAdFilenameClient(
    name||clean.split("/").pop()||""
  );

  try{
    return {
      src:new URL(src,document.baseURI).href,
      type,
      name:name||clean.split("/").pop()||"",
      layout,
      id:String(
        typeof item==="object"
          ? item.ad_id||item.id||parsed.ad_id
          : parsed.ad_id
      ),
      ad_id:String(
        typeof item==="object"
          ? item.ad_id||item.id||parsed.ad_id
          : parsed.ad_id
      ),
      brand:String(
        typeof item==="object"
          ? item.brand||parsed.brand
          : parsed.brand
      ),
      campaign:String(
        typeof item==="object"
          ? item.campaign||parsed.campaign
          : parsed.campaign
      ),
      creative:String(
        typeof item==="object"
          ? item.creative||parsed.creative
          : parsed.creative
      ),
      standardized:Boolean(
        typeof item==="object" &&
        typeof item.standardized==="boolean"
          ? item.standardized
          : parsed.standardized
      )
    };
  }catch(e){
    return null;
  }
}

function loadCachedAdsCatalog(layout=getAdsLayout()){
  try{
    const raw=localStorage.getItem(
      adsCacheKey(layout)
    );

    if(!raw)return [];

    const data=JSON.parse(raw);
    const list=Array.isArray(data?.ads)?data.ads:[];

    return list
      .map(normalizeAdEntry)
      .filter(Boolean);
  }catch(e){
    return [];
  }
}

function saveCachedAdsCatalog(list,layout=getAdsLayout()){
  try{
    localStorage.setItem(
      adsCacheKey(layout),
      JSON.stringify({
        savedAt:Date.now(),
        layout,
        ads:list.map(item=>({
          src:item.src,
          type:item.type,
          name:item.name||"",
          layout:item.layout||layout,
          id:item.id||item.ad_id||"",
          ad_id:item.ad_id||item.id||"",
          brand:item.brand||"",
          campaign:item.campaign||"",
          creative:item.creative||"",
          standardized:Boolean(item.standardized)
        }))
      })
    );
  }catch(e){}
}

async function actuallyLoadAdsCatalog(layout=getAdsLayout()){
  const controller=new AbortController();
  const timeout=setTimeout(
    ()=>controller.abort(),
    10000
  );

  try{
    const manifestPath=ADS_MANIFESTS[layout]||`data/ads-${layout}.json`;
    const manifestUrl=new URL(manifestPath,document.baseURI);
    manifestUrl.searchParams.set("_floew",Date.now().toString(36));
    const response=await fetch(
      manifestUrl.href,
      {
        method:"GET",
        mode:"cors",
        credentials:"omit",
        cache:"no-store",
        signal:controller.signal,
        headers:{
          "Accept":"application/json"
        }
      }
    );

    if(!response.ok){
      throw new Error(`Ads HTTP ${response.status}`);
    }

    const data=await response.json();
    const list=Array.isArray(data)
      ? data
      : Array.isArray(data?.ads)
        ? data.ads
        : [];

    const normalized=list
      .map(item=>normalizeAdEntry({
        ...(typeof item==="object" ? item : {url:item}),
        layout:
          typeof item==="object" && item?.layout
            ? item.layout
            : layout
      }))
      .filter(Boolean);

    /*
      Pencere katalog isteği sürerken başka orana döndüyse eski isteğin
      sonucu yeni yönü ezmesin.
    */
    if(layout!==getAdsLayout()){
      return adCatalog;
    }

    adCatalog=[...new Map(
      normalized.map(item=>[item.name||item.src,item])
    ).values()];

    adCatalogLayout=layout;
    saveCachedAdsCatalog(adCatalog,layout);

    console.info(
      `Flöw ads (${layout}):`,
      adCatalog.length,
      "reklam bulundu:",
      adCatalog.map(item=>item.name).join(", ")
    );

    return adCatalog;
  }catch(err){
    console.warn(`Flöw ads catalog (${layout}):`,err);

    if(layout===getAdsLayout()){
      const cached=loadCachedAdsCatalog(layout);

      if(cached.length || !adCatalog.length){
        adCatalog=cached;
        adCatalogLayout=layout;
      }
    }

    return adCatalog;
  }finally{
    clearTimeout(timeout);
  }
}

function loadAdsCatalog(layout=getAdsLayout()){
  if(adsCatalogPromise){
    if(adsCatalogPromiseLayout===layout){
      return adsCatalogPromise;
    }

    /*
      Bir önceki yönün isteği bitince yeni yönü hemen çek.
    */
    return adsCatalogPromise.finally(
      ()=>loadAdsCatalog(layout)
    );
  }

  adsCatalogPromiseLayout=layout;

  adsCatalogPromise=actuallyLoadAdsCatalog(layout)
    .finally(()=>{
      adsCatalogPromise=null;
      adsCatalogPromiseLayout="";
    });

  return adsCatalogPromise;
}

function startAdsCatalogRefresh(){
  const layout=getAdsLayout();
  const cached=loadCachedAdsCatalog(layout);

  adCatalogLayout=layout;

  if(cached.length){
    adCatalog=cached;
  }

  loadAdsCatalog(layout);

  if(adCatalogRefreshTimer){
    clearInterval(adCatalogRefreshTimer);
  }

  adCatalogRefreshTimer=setInterval(
    ()=>loadAdsCatalog(getAdsLayout()),
    ADS_REFRESH_MS
  );
}

function refreshAdsLayoutIfNeeded(){
  const layout=getAdsLayout();

  if(layout===adCatalogLayout)return;

  clearTimeout(adLayoutRefreshTimer);

  adLayoutRefreshTimer=setTimeout(()=>{
    const current=getAdsLayout();

    if(current===adCatalogLayout)return;

    const cached=loadCachedAdsCatalog(current);

    /*
      Yeni oranın cache'i varsa anında kullan; ardından Worker'dan tazele.
      Cache yoksa eski oranın reklamını yeni bir reklam arası için kullanmayız.
    */
    adCatalog=cached;
    adCatalogLayout=current;
    clearUpcomingAdPreload();

    loadAdsCatalog(current);
  },180);
}

let upcomingAd=null;
let upcomingAdPreloadPromise=null;
let upcomingAdPreloadKey="";
let stagedAdAssetKey="";

function adAssetKey(ad){
  return ad?.src ? `${ad.type||"image"}|${ad.src}` : "";
}

function chooseRandomAdCandidate(){
  if(!adCatalog.length)return null;

  const candidates=
    adCatalog.length>1
      ? adCatalog.filter(
          item=>(item.name||item.src)!==lastAdName
        )
      : adCatalog;

  const pool=candidates.length?candidates:adCatalog;
  return pool[Math.floor(Math.random()*pool.length)]||null;
}

function markAdChosen(ad){
  if(ad){
    lastAdName=ad.name||ad.src;
  }
  return ad||null;
}

function chooseRandomAd(){
  return markAdChosen(chooseRandomAdCandidate());
}

function clearUpcomingAdPreload(options={}){
  upcomingAd=null;
  upcomingAdPreloadPromise=null;
  upcomingAdPreloadKey="";

  if(!options.preserveStaged && !adActive){
    stagedAdAssetKey="";
    resetAdMedia();
  }
}

function preloadAdAsset(ad){
  if(!ad?.src)return Promise.resolve(false);

  const key=adAssetKey(ad);
  if(upcomingAdPreloadPromise && upcomingAdPreloadKey===key){
    return upcomingAdPreloadPromise;
  }

  upcomingAdPreloadKey=key;
  stagedAdAssetKey=key;

  upcomingAdPreloadPromise=new Promise(resolve=>{
    let settled=false;
    const done=value=>{
      if(settled)return;
      settled=true;
      clearTimeout(timeout);
      resolve(Boolean(value));
    };

    const timeout=setTimeout(()=>done(false),5000);

    if(ad.type==="video" && adVideo){
      try{adVideo.pause()}catch(e){}
      adVideo.hidden=true;
      adVideo.muted=true;
      adVideo.defaultMuted=true;
      adVideo.autoplay=false;
      adVideo.loop=false;
      adVideo.playsInline=true;
      adVideo.preload="auto";
      adVideo.onloadeddata=()=>done(true);
      adVideo.oncanplay=()=>done(true);
      adVideo.onerror=()=>done(false);

      if(adVideo.getAttribute("src")!==ad.src){
        adVideo.src=ad.src;
        try{adVideo.load()}catch(e){done(false)}
      }else if(adVideo.readyState>=2){
        done(true);
      }
      return;
    }

    if(adImage){
      adImage.hidden=true;
      adImage.decoding="async";

      const finishImage=async()=>{
        try{
          if(adImage.decode)await adImage.decode();
        }catch(e){}
        done(adImage.naturalWidth>0);
      };

      adImage.onload=finishImage;
      adImage.onerror=()=>done(false);

      if(adImage.getAttribute("src")!==ad.src){
        adImage.src=ad.src;
      }else if(adImage.complete && adImage.naturalWidth>0){
        finishImage();
      }
      return;
    }

    const image=new Image();
    image.decoding="async";
    image.onload=()=>done(true);
    image.onerror=()=>done(false);
    image.src=ad.src;
  });

  return upcomingAdPreloadPromise;
}

async function prepareUpcomingAd(){
  if(
    adActive ||
    upcomingAd ||
    newsShownSinceAd<Math.max(1,ADS_INTERVAL_NEWS-4)
  ){
    return upcomingAd;
  }

  if(!adCatalog.length){
    await loadAdsCatalog(getAdsLayout());
  }

  if(adActive || upcomingAd || !adCatalog.length)return upcomingAd;

  const candidate=chooseRandomAdCandidate();
  if(!candidate)return null;

  upcomingAd=candidate;
  void preloadAdAsset(candidate).catch(()=>false);
  return upcomingAd;
}

function maybeScheduleUpcomingAdPreload(){
  if(
    adActive ||
    upcomingAd ||
    newsShownSinceAd<Math.max(1,ADS_INTERVAL_NEWS-4)
  ) return;

  const run=()=>{ void prepareUpcomingAd(); };
  if("requestIdleCallback" in window){
    requestIdleCallback(run,{timeout:900});
  }else{
    setTimeout(run,80);
  }
}

function takeUpcomingAd(){
  const ad=upcomingAd;
  clearUpcomingAdPreload({preserveStaged:true});
  return markAdChosen(ad);
}

const FLOW_TRANSITION_CLASSES=[
  "enter-up","exit-up","enter-down","exit-down",
  "enter-left","exit-left","enter-right","exit-right"
];

function transitionPair(dir=1){
  const forward=dir>0;
  const directionMap={
    up:    forward ? ["enter-up","exit-up"]       : ["enter-down","exit-down"],
    down:  forward ? ["enter-down","exit-down"]   : ["enter-up","exit-up"],
    left:  forward ? ["enter-left","exit-left"]   : ["enter-right","exit-right"],
    right: forward ? ["enter-right","exit-right"] : ["enter-left","exit-left"]
  };

  return directionMap[transitionDirection]||directionMap.up;
}

function clearFlowTransitionClasses(el){
  if(!el)return;
  el.classList.remove(...FLOW_TRANSITION_CLASSES);
}

function waitForFlowAnimation(el,timeoutMs=900){
  return new Promise(resolve=>{
    if(!el){resolve();return;}

    let done=false;
    let timerId=null;

    const finish=()=>{
      if(done)return;
      done=true;
      clearTimeout(timerId);
      el.removeEventListener("animationend",onEnd);
      resolve();
    };

    const onEnd=e=>{
      if(e.target===el)finish();
    };

    el.addEventListener("animationend",onEnd);
    timerId=setTimeout(finish,timeoutMs);
  });
}

async function transitionAdIn(dir=adEntryDirection){
  if(!adOverlay)return false;
  if(adHasEntered)return true;

  const currentSlide=slides[state.active];
  const [enterClass,exitClass]=transitionPair(dir);

  showAdOverlay();
  clearFlowTransitionClasses(adOverlay);
  currentSlide.className="slide";

  /*
    PiP de tarayıcıdakiyle aynı anda haberden reklama kayar.
  */
  if(currentAd){
    startPiPAdTransition(
      currentAd,
      dir
    );
  }

  void adOverlay.offsetWidth;

  adOverlay.classList.add(enterClass);
  currentSlide.classList.add(exitClass);

  await waitForFlowAnimation(adOverlay);

  clearFlowTransitionClasses(adOverlay);
  stopSlideMedia(currentSlide);
  adHasEntered=true;
  adSkipEnabledAt=performance.now()+AD_SKIP_GRACE_MS;

  return true;
}

function requestAdSkip(dir=1){
  if(!adActive)return false;

  /*
    Kritik düzeltme:
    Reklamı tetikleyen trackpad/mouse-wheel gesture'ı birden fazla wheel
    olayı üretir. Eski davranışta ilk olay reklamı açıyor, hemen arkasından
    gelen momentum olayları ise reklam henüz giriş animasyonundayken
    adSkipRequestedDirection değerini set ediyordu. Giriş animasyonu
    tamamlanınca reklam yaklaşık 1 saniyede "skip" edilmiş görünüyordu.

    Reklam tamamen görünür olmadan ve kısa grace süresi dolmadan skip
    isteğini kaydetmiyoruz.
  */
  const touchSkip=Boolean(state.swipeTouch || touchAdDragActive);
  if(
    !adHasEntered ||
    (!touchSkip && performance.now()<adSkipEnabledAt)
  ){
    return false;
  }

  adSkipRequestedDirection=dir<0?-1:1;

  if(adPlaybackFinish){
    adPlaybackFinish(adSkipRequestedDirection);
  }

  return true;
}

function resetAdMedia(options={}){
  const preserveKey=adAssetKey(options.preserveAd);
  const preserveStaged=Boolean(
    preserveKey &&
    stagedAdAssetKey===preserveKey
  );

  if(adImage){
    adImage.hidden=true;
    adImage.onload=null;
    adImage.onerror=null;
    if(!preserveStaged || !preserveKey.startsWith("image|")){
      adImage.removeAttribute("src");
    }
  }

  if(adVideo){
    adVideo.__floewShouldPlay=false;
    try{adVideo.pause()}catch(e){}

    adVideo.autoplay=false;
    adVideo.loop=false;
    adVideo.controls=false;
    adVideo.hidden=true;
    adVideo.onloadeddata=null;
    adVideo.oncanplay=null;
    adVideo.onended=null;
    adVideo.onerror=null;
    adVideo.onabort=null;

    adVideo.removeAttribute("autoplay");
    adVideo.removeAttribute("loop");

    if(!preserveStaged || !preserveKey.startsWith("video|")){
      adVideo.removeAttribute("src");
      try{adVideo.load()}catch(e){}
    }
  }

  if(!preserveStaged){
    stagedAdAssetKey="";
  }
}

function showAdOverlay(){
  document.body.classList.add("ad-mode");

  if(adOverlay){
    adOverlay.hidden=false;
    adOverlay.setAttribute("aria-hidden","false");
  }

  showFullscreenButton();
}

function hideAdOverlay(){
  document.body.classList.remove("ad-mode");

  if(touchAdDragActive || touchAdDragCommitted){
    /* Reklam parmak ekrandayken doğal olarak biterse aynı pointerup ikinci
       bir haber hareketine dönüşmesin. */
    state.swipeHandled=true;
    clearTouchAdDragVisuals();
    resetTouchAdDragState();
  }

  if(adOverlay){
    adOverlay.hidden=true;
    adOverlay.setAttribute("aria-hidden","true");
  }

  resetAdMedia();
}

function waitForImageAd(src){
  return new Promise(resolve=>{
    if(!adImage){
      resolve({
        shown:false,
        direction:1,
        skipped:false
      });
      return;
    }

    let finished=false;
    let timerId=null;
    let loadTimer=null;

    const finish=(shown,direction=1,skipped=false)=>{
      if(finished)return;
      finished=true;
      clearTimeout(timerId);
      clearTimeout(loadTimer);
      adImage.onload=null;
      adImage.onerror=null;

      if(adPlaybackFinish===skip){
        adPlaybackFinish=null;
      }

      resolve({
        shown:Boolean(shown),
        direction:direction<0?-1:1,
        skipped:Boolean(skipped)
      });
    };

    const skip=direction=>{
      finish(
        adHasEntered,
        direction,
        true
      );
    };

    adPlaybackFinish=skip;

    const start=async()=>{
      if(finished)return;
      const entered=await transitionAdIn(adEntryDirection);
      if(!entered){finish(false,1,false);return;}
      if(adSkipRequestedDirection){
        finish(true,adSkipRequestedDirection,true);
        return;
      }
      timerId=setTimeout(()=>finish(true,1,false),AD_IMAGE_MS);
    };

    adImage.onload=start;
    adImage.onerror=()=>{
      console.warn("Ad image could not load:",src);
      finish(false,1,false);
    };

    adImage.hidden=false;
    const alreadyReady=
      adImage.getAttribute("src")===src &&
      adImage.complete &&
      adImage.naturalWidth>0;
    if(alreadyReady){
      queueMicrotask(start);
    }else{
      adImage.src=src;
    }

    loadTimer=setTimeout(()=>{
      if(!finished && !(adImage.complete&&adImage.naturalWidth>0)){
        console.warn("Ad image load timeout:",src);
        finish(false,1,false);
      }
    },10000);
  });
}

function configureAdVideoPlayback(video){
  if(!video)return;

  /*
    Reklam videosu, haber videosu motorundan bilinçli olarak ayrıdır.

    Haber videosu:
      autoplay + muted + loop + pause/ended guard

    Reklam videosu:
      autoplay + muted + TEK SEFER + ended => reklam tamamlanır

    __floewShouldPlay=false bırakılması, bu DOM elemanına eski bir
    playback guard bağlanmış olsa bile reklamın yeniden başlamasını önler.
  */
  video.__floewShouldPlay=false;

  video.muted=true;
  video.defaultMuted=true;
  video.volume=0;
  video.autoplay=true;
  video.loop=false;
  video.playsInline=true;
  video.controls=false;
  video.preload="auto";
  video.disablePictureInPicture=true;

  try{video.disableRemotePlayback=true}catch(e){}

  video.setAttribute("muted","");
  video.setAttribute("autoplay","");
  video.removeAttribute("loop");
  video.setAttribute("playsinline","");
  video.setAttribute("webkit-playsinline","");
  video.setAttribute("preload","auto");
  video.setAttribute(
    "controlslist",
    "nodownload noplaybackrate noremoteplayback"
  );
}

async function attemptAdVideoAutoplay(video,attempts=5){
  if(!video)return false;

  configureAdVideoPlayback(video);

  const delays=[0,70,180,380,700];
  const count=Math.max(
    1,
    Math.min(attempts,delays.length)
  );

  for(let i=0;i<count;i++){
    if(delays[i]){
      await new Promise(
        resolve=>setTimeout(resolve,delays[i])
      );
    }else{
      await new Promise(
        resolve=>requestAnimationFrame(()=>resolve())
      );
    }

    /*
      Reklam başka bir hareketle kapatılmışsa yeni play() çağrısı yapma.
    */
    if(
      !adActive ||
      adVideo!==video ||
      video.hidden
    ){
      return false;
    }

    try{
      const result=video.play();
      if(result?.then)await result;

      if(!video.paused){
        return true;
      }
    }catch(e){}
  }

  return !video.paused;
}

function waitForVideoAd(src){
  return new Promise(resolve=>{
    if(!adVideo){
      resolve({
        shown:false,
        direction:1,
        skipped:false
      });
      return;
    }

    let finished=false;
    let started=false;
    let safetyTimer=null;
    let loadTimer=null;

    const cleanup=()=>{
      clearTimeout(safetyTimer);
      clearTimeout(loadTimer);

      /*
        Bir reklam bittiğinde haber video motorunun restart bayrağını
        kesin olarak kapalı tut.
      */
      adVideo.__floewShouldPlay=false;
      adVideo.loop=false;
      adVideo.removeAttribute("loop");

      adVideo.onloadeddata=null;
      adVideo.oncanplay=null;
      adVideo.onended=null;
      adVideo.onerror=null;
      adVideo.onabort=null;
    };

    const finish=(shown,direction=1,skipped=false)=>{
      if(finished)return;
      finished=true;
      cleanup();

      if(adPlaybackFinish===skip){
        adPlaybackFinish=null;
      }

      resolve({
        shown:Boolean(shown),
        direction:direction<0?-1:1,
        skipped:Boolean(skipped)
      });
    };

    const skip=direction=>{
      finish(
        adHasEntered,
        direction,
        true
      );
    };

    adPlaybackFinish=skip;

    const start=async()=>{
      if(started||finished)return;
      started=true;

      const entered=await transitionAdIn(
        adEntryDirection
      );

      if(!entered){
        finish(false,1,false);
        return;
      }

      if(adSkipRequestedDirection){
        finish(
          true,
          adSkipRequestedDirection,
          true
        );
        return;
      }

      const played=await attemptAdVideoAutoplay(adVideo,5);
      if(finished)return;

      if(!played){
        /*
          Mobil autoplay yine de engellenirse reklamı bitmiş sayıp bir sonraki
          habere sıçrama. İlk kareyi kısa süre reklam olarak tut; kullanıcı
          swipe ederse normal reklam-history davranışı çalışmaya devam eder.
        */
        console.warn("Flöw ads: video autoplay engellendi; sabit-kare fallback.");
        try{adVideo.pause()}catch(e){}
        adVideo.controls=false;
        safetyTimer=setTimeout(
          ()=>finish(true,1,false),
          AD_IMAGE_MS
        );
        return;
      }

      safetyTimer=setTimeout(
        ()=>finish(true,1,false),
        30*60*1000
      );
    };

    configureAdVideoPlayback(adVideo);
    adVideo.hidden=false;

    adVideo.onloadeddata=start;
    adVideo.oncanplay=start;
    adVideo.onended=()=>finish(true,1,false);
    adVideo.onerror=()=>{
      console.warn("Ad video could not load:",src);
      finish(adHasEntered,1,false);
    };
    adVideo.onabort=()=>finish(adHasEntered,1,false);

    const alreadyReady=
      adVideo.getAttribute("src")===src &&
      adVideo.readyState>=2;
    if(alreadyReady){
      queueMicrotask(start);
    }else{
      adVideo.src=src;
      adVideo.load();
    }

    loadTimer=setTimeout(()=>{
      if(!started&&!finished){
        console.warn("Ad video load timeout:",src);
        finish(false,1,false);
      }
    },15000);
  });
}

async function playAdBreak(options={}){
  if(adActive)return false;
  if(!adCatalog.length && !options.record && !options.ad)return false;

  const replayRecord=options.record||null;
  const ad=
    replayRecord?.ad ||
    options.ad ||
    takeUpcomingAd() ||
    chooseRandomAd();

  if(!ad)return false;

  const record=
    replayRecord || {
      ad,
      beforeHistoryPos:state.historyPos,
      beforeStoryIndex:state.index,
      beforeIndex:state.index,
      beforeKey:storyIdentity(state.stories[state.index]),
      afterHistoryPos:null,
      afterStoryIndex:null,
      afterIndex:null,
      afterKey:""
    };

  activeAdRecord=record;
  currentAd=ad;
  adEntryDirection=options.entryDir<0?-1:1;
  historicalAdContext=options.historyContext || (replayRecord ? record : null);

  adActive=true;
  adHasEntered=false;
  adSkipRequestedDirection=0;
  adSkipEnabledAt=0;
  adPlaybackFinish=null;
  clearTimeout(state.timer);
  resetAdMedia({preserveAd:ad});

  let result={
    shown:false,
    direction:adEntryDirection,
    skipped:false
  };

  try{
    result=
      ad.type==="video"
        ? await waitForVideoAd(ad.src)
        : await waitForImageAd(ad.src);
  }catch(err){
    console.warn("Ad playback:",err);
    result={
      shown:false,
      direction:adEntryDirection,
      skipped:false
    };
  }

  if(!result?.shown){
    hideAdOverlay();
    adActive=false;
    adHasEntered=false;
    adSkipRequestedDirection=0;
    adSkipEnabledAt=0;
    adPlaybackFinish=null;
    currentAd=null;
    activeAdRecord=null;
    historicalAdContext=null;
    slides[state.active].className="slide active";
    return false;
  }

  /*
    Geçmiş reklamına geri dönmek yeni bir 10-haber sayacı başlangıcı değildir.
  */
  if(!replayRecord && !options.historyContext){
    newsShownSinceAd=0;
  }

  return {
    shown:true,
    direction:result.direction<0?-1:1,
    skipped:Boolean(result.skipped),
    ad,
    record
  };
}

function adBreakDue(){
  return (
    !adActive &&
    newsShownSinceAd>=ADS_INTERVAL_NEWS
  );
}

async function tryPlayDueAd(){
  if(!adBreakDue())return false;

  /*
    Önceki sürümde katalog ilk istekte boş kalırsa reklam arası sessizce
    atlanıyordu ve bir sonraki katalog yenilemesine kadar bekliyordu.
    Artık 10. haberden sonra katalog boşsa o anda yeniden yüklemeyi deniyoruz.
  */
  if(!adCatalog.length){
    await loadAdsCatalog();
  }

  if(!adCatalog.length){
    console.warn(
      "Flöw ads: reklam sırası geldi ancak katalog hâlâ boş."
    );
    return false;
  }

  return playAdBreak();
}

let mouseFlowPaused=false;
let mouseFlowResumeTimer=null;
const MOUSE_FLOW_IDLE_MS=450;
const MOUSE_FLOW_RESUME_BONUS_MS=3000;

function desktopMouseFlowEnabled(){
  return Boolean(
    window.matchMedia?.("(hover: hover) and (pointer: fine)")?.matches
  );
}

function timer(durationMs=null){
  clearTimeout(state.timer);
  state.timer=null;
  state.timerDeadline=0;

  if(iddqdModeActive){
    state.timerRemainingMs=0;
    return;
  }

  if(sourceViewerOpen || uiFlowPauseActive){
    return;
  }

  /* Otomatik ilerleme kapalı olsa bile sıradaki haber hazır tutulur. */
  scheduleNextStoryPreload();

  const hasExplicitDuration=(durationMs!==null && durationMs!==undefined);
  const requested=hasExplicitDuration ? Number(durationMs) : NaN;
  const delay=Number.isFinite(requested)
    ? Math.max(250,requested)
    : Math.max(5,showDurationSeconds)*1000;

  state.timerRemainingMs=delay;

  if(autoAdvancePaused || mouseFlowPaused)return;

  state.timerDeadline=Date.now()+delay;
  state.timer=setTimeout(()=>{
    state.timer=null;
    state.timerDeadline=0;
    state.timerRemainingMs=0;
    move(1,{origin:"auto"});
  },delay);
}

function pauseFlowForMouseMovement(){
  /*
    Tercihler açıkken akış zaten UI duraklatma koordinatörü tarafından
    tutulur; menü içindeki fare hareketleri ayrıca bir pause başlatmasın.
  */
  if(document.getElementById("menu-overlay")?.classList.contains("open")){
    return;
  }

  if(
    !desktopMouseFlowEnabled() ||
    adActive ||
    autoAdvancePaused ||
    sourceViewerOpen ||
    !state.stories.length
  ) return;

  if(!mouseFlowPaused){
    const remaining=state.timerDeadline
      ? Math.max(0,state.timerDeadline-Date.now())
      : (state.timerRemainingMs || Math.max(5,showDurationSeconds)*1000);

    clearTimeout(state.timer);
    state.timer=null;
    state.timerDeadline=0;
    state.timerRemainingMs=remaining;
    mouseFlowPaused=true;
  }

  clearTimeout(mouseFlowResumeTimer);
  mouseFlowResumeTimer=setTimeout(
    resumeFlowAfterMouseStops,
    MOUSE_FLOW_IDLE_MS
  );
}

function resumeFlowAfterMouseStops(){
  mouseFlowResumeTimer=null;
  if(!mouseFlowPaused)return;

  /*
    Açık menüler otomatik haber akışını bloke etmez.
    Kullanıcı fareyi hareket ettirdiği sürece akış pause edilir; hareket
    bittikten sonra hamburger/tercihler/quick panel açık olsa bile sayaç
    kaldığı yer + 3 saniye ile devam eder.

    Yalnız gerçek bir haber/reklam geçişi sürerken yeniden timer kurmayız.
  */
  if(sourceViewerOpen){
    return;
  }

  if(state.busy || adActive){
    mouseFlowResumeTimer=setTimeout(
      resumeFlowAfterMouseStops,
      MOUSE_FLOW_IDLE_MS
    );
    return;
  }

  mouseFlowPaused=false;

  if(autoAdvancePaused || !state.stories.length)return;

  const remaining=state.timerRemainingMs || Math.max(5,showDurationSeconds)*1000;
  timer(remaining+MOUSE_FLOW_RESUME_BONUS_MS);
}

window.addEventListener("mousemove",pauseFlowForMouseMovement,{passive:true});

/*
  Her geçişte mümkünse mevcut kaynaktan farklı
  bir haber seçilir. Önce farklı kaynaklar filtrelenir;
  ardından o kaynaklardan rastgele bir haber seçilir.
*/
function sourceKey(source){
  return String(source||"").trim().toLocaleLowerCase("tr-TR");
}

const nearDuplicateTokenCache=new WeakMap();

const NEAR_DUPLICATE_STOPWORDS=new Set([
  "ve","veya","ile","icin","ama","fakat","ancak","bir","bu","su","o",
  "da","de","mi","mu","ne","nasil","neden","son","dakika","sondakika",
  "flas","iste","detay","detaylar","haber","haberi","yeni","canli",
  "acikladi","aciklandi","belli","oldu","gelisme","gelismesi"
]);

function normalizeNearDuplicateTitle(value){
  return normalizeText(value)
    .replace(/ı/g,"i")
    .replace(/(\d)[.,](\d)/g,"$1$2")
    .replace(/[^a-z0-9]+/g," ")
    .trim();
}

function nearDuplicateStem(token){
  const value=String(token||"");
  if(value.length>=10)return value.slice(0,7);
  if(value.length>=8)return value.slice(0,6);
  return value;
}

function nearDuplicateTokens(story){
  if(story && typeof story==="object" && nearDuplicateTokenCache.has(story)){
    return nearDuplicateTokenCache.get(story);
  }

  const normalized=normalizeNearDuplicateTitle(story?.title||"");
  if(!normalized)return [];

  const tokens=[];
  const seen=new Set();

  for(const raw of normalized.split(/\s+/)){
    if(!raw)continue;
    if(raw.length<3 && !/^\d{2,}$/.test(raw))continue;
    if(NEAR_DUPLICATE_STOPWORDS.has(raw))continue;

    const token=nearDuplicateStem(raw);
    if(!token || seen.has(token))continue;
    seen.add(token);
    tokens.push(token);
  }

  if(story && typeof story==="object"){
    nearDuplicateTokenCache.set(story,tokens);
  }

  return tokens;
}

function areNearDuplicateStories(a,b){
  if(!a || !b)return false;

  const sourceA=sourceKey(a.source);
  const sourceB=sourceKey(b.source);

  /* Özellik yalnız farklı kaynakların aynı olayı tekrar etmesini hedefler. */
  if(!sourceA || !sourceB || sourceA===sourceB)return false;

  const timeA=storyPublishedMs(a);
  const timeB=storyPublishedMs(b);
  if(!timeA || !timeB)return false;
  if(Math.abs(timeA-timeB)>NEAR_DUPLICATE_WINDOW_MS)return false;

  const tokensA=nearDuplicateTokens(a);
  const tokensB=nearDuplicateTokens(b);
  if(tokensA.length<NEAR_DUPLICATE_MIN_COMMON_TOKENS ||
     tokensB.length<NEAR_DUPLICATE_MIN_COMMON_TOKENS){
    return false;
  }

  const setB=new Set(tokensB);
  let common=0;
  for(const token of tokensA){
    if(setB.has(token))common++;
  }

  if(common<NEAR_DUPLICATE_MIN_COMMON_TOKENS)return false;

  const smaller=Math.min(tokensA.length,tokensB.length);
  const union=tokensA.length+tokensB.length-common;
  const overlap=smaller ? common/smaller : 0;
  const jaccard=union ? common/union : 0;

  /*
    Dört veya daha fazla ortak anlamlı kelime varsa farklı haber sitelerinin
    başlığa eklediği kısa editoryal parçalar yüzünden Jaccard'ı biraz daha
    toleranslı tut. Üç ortak kelimede ise daha sıkı eşik korunur.
  */
  if(common>=4){
    return overlap>=.60 && jaccard>=.32;
  }

  return overlap>=NEAR_DUPLICATE_OVERLAP_THRESHOLD &&
    jaccard>=NEAR_DUPLICATE_JACCARD_THRESHOLD;
}

function recentStoriesForNearDuplicateCheck(){
  const result=[];
  const used=new Set();

  const pushStory=story=>{
    const key=storyIdentity(story);
    if(!story || !key || used.has(key))return;
    used.add(key);
    result.push(story);
  };

  /* Mevcut haber mutlaka karşılaştırma penceresinin içindedir. */
  pushStory(state.stories[state.index]);

  const history=Array.isArray(state.history)?state.history:[];
  let pos=Math.min(
    Number.isInteger(state.historyPos)?state.historyPos:history.length-1,
    history.length-1
  );

  for(;pos>=0 && result.length<NEAR_DUPLICATE_HISTORY_DEPTH;pos--){
    const index=history[pos];
    if(!Number.isInteger(index))continue;
    pushStory(state.stories[index]);
  }

  return result.slice(0,NEAR_DUPLICATE_HISTORY_DEPTH);
}

function nearDuplicateDedupActive(){
  return nearDuplicateDedupEnabled &&
    feedOrderMode==="algorithmic" &&
    feedMode!=="breaking" &&
    feedMode!=="source" &&
    feedMode!=="category";
}

/*
  İleri giderken farklı bir kaynak seçilir ve seçilen haber history'ye
  eklenir. Geri giderken history'deki gerçek önceki haber gösterilir;
  böylece aynı haberin yeni bir versiyonu seçilmez.
*/
function chooseForwardCandidate(){
  if(!state.stories.length)return -1;
  if(state.stories.length===1)return 0;

  /*
    Kronolojik seçimde hiçbir algoritmik atlama yok: listedeki gerçek bir
    sonraki (daha eski) haber gelir. Son dakika da bu davranışı kullanır.
  */
  if(feedOrderMode==="chronological" || feedMode==="breaking"){
    return (state.index+1)%state.stories.length;
  }

  const currentStory=state.stories[state.index]||null;
  const currentSource=sourceKey(currentStory?.source);
  const currentKey=storyIdentity(currentStory);

  let candidates=state.stories
    .map((story,index)=>({story,index}))
    .filter(item=>
      item.index!==state.index &&
      !item.story?._historyOnly &&
      storyIdentity(item.story)!==currentKey
    );

  /*
    Önce oturum içinde hiç gösterilmemiş haberleri koru. Eski sıra önce
    "farklı kaynak" filtresini uyguladığı için, başka kaynaklarda yalnız
    görülmüş haber kaldığında aynı haberi birkaç adım sonra tekrar seçebiliyordu.
  */
  const unseen=candidates.filter(item=>{
    const key=storyIdentity(item.story);
    const signature=exactDuplicateSignature(item.story);
    return !sessionSeenStories.has(key) &&
      (!signature || !sessionSeenStorySignatures.has(signature));
  });
  if(unseen.length)candidates=unseen;

  /* Ardından mümkünse aynı kaynak arka arkaya gelmesin. */
  const differentSource=candidates.filter(item=>
    sourceKey(item.story?.source)!==currentSource
  );
  if(differentSource.length)candidates=differentSource;

  /*
    Yalnız algoritmik mod: son 12 haberde gösterilen farklı kaynaklı ve
    çok benzer başlıklı haberleri aday havuzundan çıkar. Eğer bütün havuz
    eleniyorsa akışın kilitlenmemesi için mevcut havuzu koru.
  */
  if(nearDuplicateDedupActive()){
    const recentStories=recentStoriesForNearDuplicateCheck();
    const distinctCandidates=candidates.filter(item=>
      !recentStories.some(previous=>
        areNearDuplicateStories(item.story,previous)
      )
    );

    if(distinctCandidates.length){
      candidates=distinctCandidates;
    }
  }

  candidates.sort((a,b)=>
    algorithmicStoryScore(b.story)-algorithmicStoryScore(a.story)
  );

  const top=candidates.slice(0,ALGO_TOP_CANDIDATES);
  if(!top.length){
    return (state.index+1)%state.stories.length;
  }

  /*
    En güçlü altı aday arasında sıra ağırlıklı seçim: 6,5,4,3,2,1.
    Böylece güncellik/seen puanı korunur ama aynı havuz her oturumda aynı
    deterministik sırayla akmaz.
  */
  const total=top.length*(top.length+1)/2;
  let pick=Math.random()*total;

  for(let rank=0;rank<top.length;rank++){
    pick-=top.length-rank;
    if(pick<=0)return top[rank].index;
  }

  return top[0].index;
}


let plannedForwardStory=null;

function chooseForward(){
  const currentKey=storyIdentity(state.stories[state.index]);
  const planned=plannedForwardStory;

  if(
    planned &&
    planned.fromKey===currentKey &&
    planned.index>=0 &&
    planned.index<state.stories.length &&
    storyIdentity(state.stories[planned.index])===planned.toKey
  ){
    plannedForwardStory=null;
    return planned.index;
  }

  plannedForwardStory=null;
  return chooseForwardCandidate();
}

const imagePreloadCache=new Map();
const storyAssetPreloadCache=new Map();
const mediaWarmupCache=new Map();
let nextStoryPreloadTimer=null;

function preloadImage(url){
  if(!url)return Promise.resolve();
  if(imagePreloadCache.has(url))return imagePreloadCache.get(url);

  const promise=new Promise(resolve=>{
    const img=new Image();
    let done=false;

    const finish=()=>{
      if(done)return;
      done=true;

      if(img.decode){
        let resolved=false;
        const done=()=>{
          if(resolved)return;
          resolved=true;
          resolve();
        };
        img.decode().catch(()=>{}).finally(done);
        setTimeout(done,700);
      }else{
        resolve();
      }
    };

    img.onload=finish;
    img.onerror=finish;
    img.src=url;
    setTimeout(finish,5000);
  });

  imagePreloadCache.set(url,promise);
  if(imagePreloadCache.size>120){
    const first=imagePreloadCache.keys().next().value;
    if(first)imagePreloadCache.delete(first);
  }

  return promise;
}

function warmDirectMedia(media){
  const url=String(media?.url||"");
  if(!url || mediaWarmupCache.has(url))return;

  const type=String(media?.type||"").toLowerCase();
  const isHls=
    type.includes("mpegurl") ||
    /\.m3u8(?:[?#]|$)/i.test(url);

  if(isHls)ensureHlsLibrary();

  try{
    const video=document.createElement("video");
    setMutedInlinePlaybackAttributes(video);
    video.autoplay=false;
    video.removeAttribute("autoplay");
    video.preload="auto";
    video.src=url;
    video.load();

    mediaWarmupCache.set(url,video);

    if(mediaWarmupCache.size>3){
      const first=mediaWarmupCache.keys().next().value;
      const old=mediaWarmupCache.get(first);
      try{old?.pause?.()}catch(e){}
      try{old?.removeAttribute?.("src");old?.load?.()}catch(e){}
      mediaWarmupCache.delete(first);
    }
  }catch(e){}
}

function warmEmbedMedia(media){
  try{
    const url=new URL(media?.url||"");
    const origin=url.origin;
    const found=[...document.querySelectorAll('link[data-floew-preconnect]')]
      .some(link=>link.dataset.floewPreconnect===origin);

    if(origin && !found){
      const link=document.createElement("link");
      link.rel="preconnect";
      link.href=origin;
      link.crossOrigin="anonymous";
      link.dataset.floewPreconnect=origin;
      document.head.appendChild(link);
    }
  }catch(e){}

  if(String(media?.provider||"").toLowerCase()==="dailymotion"){
    const parts=dailymotionMediaParts(media);
    if(parts?.playerId)ensureDailymotionLibrary(parts.playerId);
  }
}

function preloadStoryAssets(story){
  if(!story)return Promise.resolve();
  const key=mediaKey(story);
  if(storyAssetPreloadCache.has(key))return storyAssetPreloadCache.get(key);

  const promise=(async()=>{
    const imagePromise=preloadImage(story.image);
    const focalPromise=
      smartCropEnabled() && story?.image
        ? detectSmartFocalPoint(story).catch(()=>null)
        : Promise.resolve(null);
    const mediaPromise=videoEnabled
      ? resolveStoryMedia(story).then(media=>{
          if(!media)return;
          if(media.kind==="video")warmDirectMedia(media);
          else if(media.kind==="embed")warmEmbedMedia(media);
        }).catch(()=>{})
      : Promise.resolve();

    await Promise.allSettled([
      imagePromise,
      focalPromise,
      mediaPromise
    ]);
  })();

  storyAssetPreloadCache.set(key,promise);
  if(storyAssetPreloadCache.size>80){
    const first=storyAssetPreloadCache.keys().next().value;
    if(first)storyAssetPreloadCache.delete(first);
  }

  return promise;
}

function nextStoryIndexForPreload(){
  if(state.stories.length<2)return -1;

  if(state.historyPos<state.history.length-1){
    return state.history[state.historyPos+1];
  }

  const currentKey=storyIdentity(state.stories[state.index]);

  if(
    plannedForwardStory &&
    plannedForwardStory.fromKey===currentKey &&
    plannedForwardStory.index>=0 &&
    plannedForwardStory.index<state.stories.length &&
    storyIdentity(state.stories[plannedForwardStory.index])===plannedForwardStory.toKey
  ){
    return plannedForwardStory.index;
  }

  const index=chooseForwardCandidate();
  if(index<0)return -1;

  plannedForwardStory={
    fromKey:currentKey,
    toKey:storyIdentity(state.stories[index]),
    index
  };

  return index;
}

function scheduleNextStoryPreload(delay=70){
  clearTimeout(nextStoryPreloadTimer);

  nextStoryPreloadTimer=setTimeout(()=>{
    if(adActive || state.busy || state.stories.length<2)return;

    const index=nextStoryIndexForPreload();
    if(index<0)return;

    const story=state.stories[index];
    const fromKey=storyIdentity(state.stories[state.index]);
    const targetKey=storyIdentity(story);

    /* Video URL/player çözümü ile ağ ısınmasını arka planda başlat. */
    preloadStoryAssets(story);

    /*
      Görsel decode olunca pasif slaytı da önceden doldur. Geçiş anında aynı
      hedef hâlâ sıradaysa fill/decode beklemeden doğrudan animasyona girer.
    */
    preloadImage(story.image).then(()=>{
      if(
        adActive ||
        state.busy ||
        storyIdentity(state.stories[state.index])!==fromKey ||
        storyIdentity(state.stories[index])!==targetKey
      ) return;

      const inactiveSlide=slides[1-state.active];
      fill(inactiveSlide,story,{prepareMedia:false});
      inactiveSlide.className="slide";

      /*
        Sıradaki haber ekrana gelmeden önce video da pasif slaytta gerçekten
        yüklenip sessiz şekilde oynatılmaya başlar. Geçişte aynı medya instance'ı
        korunur; ikinci kez player oluşturulmaz.
      */
      if(videoEnabled){
        prepareSlideMedia(inactiveSlide,story,{preload:true}).catch(()=>{});
      }

      const image=inactiveSlide.querySelector(".slide-image");

      const cleanupReady=()=>{
        image?.removeEventListener("load",markReady);
        image?.removeEventListener("error",markReady);
      };

      const markReady=async()=>{
        /* setStoryImage ilk thumbnail yüklenince daha iyi article-proxy'ye
           geçebilir. O anda img.complete tekrar false olur; son URL gerçekten
           hazır olana kadar bu listener yaşamaya devam eder. */
        await Promise.resolve();
        if(image && (!image.complete || !image.naturalWidth))return;

        if(image?.decode){
          try{await image.decode();}catch(e){}
        }

        if(
          adActive ||
          state.busy ||
          slides[1-state.active]!==inactiveSlide ||
          storyIdentity(state.stories[state.index])!==fromKey ||
          storyIdentity(state.stories[index])!==targetKey
        ){
          cleanupReady();
          return;
        }

        inactiveSlide.dataset.preloadedStoryKey=targetKey;
        cleanupReady();
      };

      image?.addEventListener("load",markReady);
      image?.addEventListener("error",markReady);
      markReady();
    }).catch(()=>{});
  },Math.max(0,delay));
}


async function finalizeNewAdForward(record){
  if(!record)return false;

  const beforePos=state.historyPos;
  const beforeIndex=state.index;

  if(state.historyPos < state.history.length-1){
    const target=state.history[state.historyPos+1];
    await transitionFromAdTo(target,true,1);
    state.historyPos++;
  }else{
    const next=chooseForward();
    if(next<0)return false;

    await transitionFromAdTo(next,false,1);
    state.history.push(next);
    state.historyPos=state.history.length-1;
  }

  record.beforeHistoryPos=beforePos;
  record.beforeStoryIndex=beforeIndex;
  record.beforeIndex=beforeIndex;
  record.beforeKey=storyIdentity(state.stories[beforeIndex]);
  record.afterHistoryPos=state.historyPos;
  record.afterStoryIndex=state.index;
  record.afterIndex=state.index;
  record.afterKey=storyIdentity(state.stories[state.index]);

  adHistoryByAfterPos.set(record.afterHistoryPos,record);
  activeAdRecord=null;
  historicalAdContext=null;
  return true;
}

/*
  Kaydedilmiş reklam story history içindeki iki komşu haberin arasında gerçek
  bir navigation öğesi gibi davranır. Reklam yarıda geçilmiş olsa da aynı
  record tekrar oynatılır; yeni reklam seçilmez.
*/
async function navigateRecordedAd(record,entryDir){
  if(!record)return false;

  historicalAdContext=record;
  const result=await playAdBreak({
    record,
    entryDir,
    historyContext:record
  });

  if(!result?.shown){
    adHistoryByAfterPos.delete(record.afterHistoryPos);
    activeAdRecord=null;
    historicalAdContext=null;
    return false;
  }

  const exitDir=result.skipped
    ? result.direction
    : (entryDir<0?-1:1);

  if(entryDir>0 && exitDir<0){
    await transitionAdBackToCurrent(-1);
    activeAdRecord=null;
    historicalAdContext=null;
    return true;
  }

  if(entryDir<0 && exitDir>0){
    await transitionAdBackToCurrent(1);
    activeAdRecord=null;
    historicalAdContext=null;
    return true;
  }

  if(exitDir<0){
    await transitionFromAdTo(record.beforeStoryIndex,true,-1);
    state.historyPos=record.beforeHistoryPos;
  }else{
    await transitionFromAdTo(record.afterStoryIndex,true,1);
    state.historyPos=record.afterHistoryPos;
  }

  activeAdRecord=null;
  historicalAdContext=null;
  return true;
}

async function move(dir,options={}){
  if(iddqdModeActive || sourceViewerOpen)return;

  closeFloraPopover({resume:false});

  if(
    filterReturnStoryKey &&
    !options.fromAd &&
    !options.preserveFilterReturn
  ){
    filterReturnStoryKey="";
  }

  if(adActive && !options.fromAd){
    requestAdSkip(dir);
    return;
  }

  if(state.busy||state.stories.length<2)return;

  if(!options.skipRecordedAd && !options.skipHistoricalAd){
    if(dir<0){
      const recorded=adRecordBeforeCurrent();
      if(recorded){
        const handled=await navigateRecordedAd(recorded,-1);
        if(handled)return;
      }
    }else if(dir>0 && state.historyPos<state.history.length-1){
      const recorded=adRecordAfterCurrent();
      if(recorded){
        const handled=await navigateRecordedAd(recorded,1);
        if(handled)return;
      }
    }
  }

  if(
    dir>0 &&
    !options.skipAd &&
    adBreakDue()
  ){
    const adResult=await tryPlayDueAd();

    if(adResult?.shown){
      if(adResult.direction<0){
        await transitionAdBackToCurrent(-1);
        activeAdRecord=null;
      }else{
        await finalizeNewAdForward(adResult.record);
      }
      return;
    }
  }

  if(dir<0){
    if(state.historyPos<=0)return;

    const target=state.history[state.historyPos-1];
    await transitionTo(target,true,dir);
    state.historyPos--;
    return;
  }

  if(state.historyPos < state.history.length-1){
    const target=state.history[state.historyPos+1];

    if(options.fromAd){
      await transitionFromAdTo(target,true,dir);
    }else{
      await transitionTo(target,true,dir);
    }

    state.historyPos++;
    return;
  }

  const next=chooseForward();
  if(next<0)return;

  if(options.fromAd){
    await transitionFromAdTo(next,false,dir);
  }else{
    await transitionTo(next,false,dir);
  }

  state.history.push(next);
  state.historyPos=state.history.length-1;
}

async function transitionFromAdTo(nextIndex,fromHistory,dir=1){
  if(state.busy)return;

  if(consumeTouchAdCommit(nextIndex,dir)){
    const previousIndex=state.index;
    const ok=await finalizeCommittedAdDragToStory(nextIndex,dir);
    if(ok && dir>0 && nextIndex!==previousIndex){
      newsShownSinceAd++;
      maybeScheduleUpcomingAdPreload();
    }
    return;
  }

  state.busy=true;
  clearTimeout(state.timer);

  const previousSlide=slides[state.active];
  const nextSlide=slides[1-state.active];
  const story=state.stories[nextIndex];

  if(!slidePreloadedForStory(nextSlide,story)){
    await preloadImage(story.image);
  }
  preloadStoryAssets(story);
  prepareTransitionSlide(nextSlide,story);

  const nextImage=nextSlide.querySelector(".slide-image");
  if(nextImage?.decode){
    try{await nextImage.decode();}catch(e){}
  }

  if(nextImage){
    await lockSmartFocalPointForTransition(
      nextImage,
      story
    );
  }

  nextSlide.className="slide";
  clearFlowTransitionClasses(adOverlay);

  void nextSlide.offsetWidth;

  const [enterClass,exitClass]=transitionPair(dir);

  startPiPTransition(
    state.stories[state.index],
    story,
    dir
  );

  nextSlide.classList.add(enterClass);
  adOverlay.classList.add(exitClass);
  activateSlideMedia(nextSlide,story);

  await waitForFlowAnimation(nextSlide);

  nextSlide.className="slide active";
  previousSlide.className="slide";
  stopSlideMedia(previousSlide);

  state.active=1-state.active;
  state.index=nextIndex;
  updateKeywordAlert(story);

  if(dir>0){
    newsShownSinceAd++;
    maybeScheduleUpcomingAdPreload();
  }

  clearFlowTransitionClasses(adOverlay);
  hideAdOverlay();
  adActive=false;
  adHasEntered=false;
  adSkipRequestedDirection=0;
  adSkipEnabledAt=0;
  adPlaybackFinish=null;
  currentAd=null;
  historicalAdContext=null;
  state.busy=false;

  timer();
}

async function transitionAdBackToCurrent(dir=-1){
  if(state.busy)return;

  if(consumeTouchAdCommit(state.index,dir)){
    await finalizeCommittedAdDragToStory(state.index,dir);
    return;
  }

  state.busy=true;
  clearTimeout(state.timer);

  const currentSlide=slides[state.active];
  const [enterClass,exitClass]=transitionPair(dir);

  clearFlowTransitionClasses(adOverlay);
  currentSlide.className="slide";

  /*
    Reklamdan mevcut habere dönüş PiP'te de aynı yönde gerçekleşir.
    startPiPTransition, pipCurrent reklam ise onu çıkış öğesi olarak kullanır.
  */
  startPiPTransition(
    state.stories[state.index],
    state.stories[state.index],
    dir
  );

  void currentSlide.offsetWidth;

  currentSlide.classList.add(enterClass);
  adOverlay.classList.add(exitClass);
  activateSlideMedia(currentSlide,state.stories[state.index]);

  await waitForFlowAnimation(currentSlide);

  currentSlide.className="slide active";
  clearFlowTransitionClasses(adOverlay);
  hideAdOverlay();

  adActive=false;
  adHasEntered=false;
  adSkipRequestedDirection=0;
  adSkipEnabledAt=0;
  adPlaybackFinish=null;
  currentAd=null;
  historicalAdContext=null;
  state.busy=false;

  timer();
}

async function transitionTo(nextIndex,fromHistory,dir){
  if(state.busy)return;

  state.busy=true;
  clearTimeout(state.timer);

  const currentSlide=
    slides[state.active];

  const nextSlide=
    slides[1-state.active];

  const story=
    state.stories[nextIndex];

  /*
    Yeni görsel tamamen hazır olmadan animasyonu başlatma.
    Böylece geçiş sırasında alttaki/eski görsel görünmez.
  */
  if(!slidePreloadedForStory(nextSlide,story)){
    await preloadImage(story.image);
  }
  preloadStoryAssets(story);

  prepareTransitionSlide(nextSlide,story);

  const nextImage=
    nextSlide.querySelector(".slide-image");

  if(nextImage.decode){
    try{
      await nextImage.decode();
    }catch(e){}
  }

  if(nextImage){
    await lockSmartFocalPointForTransition(
      nextImage,
      story
    );
  }

  currentSlide.className="slide";
  nextSlide.className="slide";

  void nextSlide.offsetWidth;

  /*
    dir > 0 = sonraki haber:
      yeni haber aşağıdan yukarı gelir.

    dir < 0 = önceki haber:
      yeni haber yukarıdan aşağı gelir.
  */
  const [enterClass,exitClass]=transitionPair(dir);

  startPiPTransition(
    state.stories[state.index],
    story,
    dir
  );

  nextSlide.classList.add(enterClass);
  currentSlide.classList.add(exitClass);
  activateSlideMedia(nextSlide,story);

  nextSlide.addEventListener(
    "animationend",
    ()=>{
      nextSlide.className="slide active";
      currentSlide.className="slide";
      stopSlideMedia(currentSlide);

      state.active=
        1-state.active;

      state.index=
        nextIndex;

      updateKeywordAlert(story);

      if(dir>0){
        newsShownSinceAd++;
        maybeScheduleUpcomingAdPreload();
      }

      state.busy=false;

      timerAfterLikelyMediaWarmup(nextSlide,story);
    },
    {once:true}
  );
}


let sourceCatalogLoaded=false;

async function fetchSourceCatalog(){
  if(sourceCatalogLoaded && knownSources.length){
    return knownSources;
  }

  const sources=Array.isArray(FLOEW_CONFIG.sources)
    ? FLOEW_CONFIG.sources.filter(Boolean)
    : [];
  const foreignSources=Array.isArray(FLOEW_CONFIG.foreignSources)
    ? FLOEW_CONFIG.foreignSources.filter(Boolean)
    : [];

  if(sources.length){
    knownSources=[...new Map(
      sources.map(source=>[sourceKey(source),source])
    ).values()];
  }

  if(foreignSources.length){
    knownForeignSources=[...new Map(
      foreignSources.map(source=>[sourceKey(source),source])
    ).values()];
  }

  sourceCatalogLoaded=Boolean(
    knownSources.length || knownForeignSources.length
  );

  return knownSources;
}

function newsBatchCacheKey(batch){
  return `${NEWS_BATCH_CACHE_PREFIX}${batch}`;
}

function saveNewsBatchCache(batch,data){
  if(!Array.isArray(data) || !data.length)return;

  try{
    localStorage.setItem(
      newsBatchCacheKey(batch),
      JSON.stringify({
        savedAt:Date.now(),
        data
      })
    );
  }catch(e){
    // This cache is only a resilience layer.
  }
}

function loadNewsBatchCache(
  batch,
  {allowStale=false}={}
){
  try{
    const raw=localStorage.getItem(
      newsBatchCacheKey(batch)
    );
    if(!raw)return null;

    const parsed=JSON.parse(raw);
    const savedAt=Number(parsed?.savedAt)||0;
    const data=Array.isArray(parsed?.data)
      ? parsed.data
      : null;

    if(!data || !savedAt){
      localStorage.removeItem(
        newsBatchCacheKey(batch)
      );
      return null;
    }

    const age=Date.now()-savedAt;
    const maxAge=allowStale
      ? NEWS_BATCH_STALE_CACHE_MAX_AGE_MS
      : NEWS_BATCH_CACHE_MAX_AGE_MS;

    if(age>maxAge){
      if(allowStale){
        localStorage.removeItem(
          newsBatchCacheKey(batch)
        );
      }
      return null;
    }

    return data;
  }catch(e){
    return null;
  }
}

function loadInitialNewsBatchCacheSnapshot(){
  const results=[];
  let cachedBatchCount=0;
  let cachedStoryCount=0;

  for(let batch=0;batch<NEWS_BATCH_COUNT;batch++){
    const cached=loadNewsBatchCache(batch);
    if(cached?.length){
      cachedBatchCount++;
      cachedStoryCount+=cached.length;
      results.push({status:"fulfilled",value:cached});
    }else{
      /* İlk çizim cache snapshot'ında eksik batch hata değildir; canlı
         yenileme hemen arkasından bütün batch'leri yeniden çeker. */
      results.push({status:"fulfilled",value:[]});
    }
  }

  const minimumBatches=Math.min(
    NEWS_BATCH_COUNT,
    Math.max(3,Math.ceil(NEWS_BATCH_COUNT/3))
  );

  if(cachedBatchCount<minimumBatches || cachedStoryCount<24){
    return null;
  }

  return results;
}

function waitForNewsRetry(ms){
  return new Promise(resolve=>setTimeout(resolve,ms));
}

function buildNewsBatchUrl(batch,transport="fetch",attempt=0){
  const url=new URL(API);
  url.searchParams.set("batch",String(batch));
  url.searchParams.set(
    "_floew",
    `${NEWS_REQUEST_SESSION}-${transport}-${batch}-${attempt}-${Date.now().toString(36)}`
  );
  return url;
}

async function fetchNewsBatchHttp(batch,attempt=0){
  const controller=new AbortController();
  const timeout=setTimeout(()=>controller.abort(),NEWS_FETCH_TIMEOUT_MS);

  try{
    const url=buildNewsBatchUrl(batch,"fetch",attempt);

    const r=await fetch(url.href,{
      method:"GET",
      mode:"cors",
      credentials:"omit",
      cache:"no-store",
      signal:controller.signal,
      headers:{
        "Accept":"application/json"
      }
    });

    if(!r.ok){
      throw new Error(`Batch ${batch}: HTTP ${r.status}`);
    }

    const data=await r.json();

    if(!Array.isArray(data)){
      throw new Error(`Batch ${batch}: Geçersiz Worker yanıtı`);
    }

    saveNewsBatchCache(batch,data);
    return data;
  }finally{
    clearTimeout(timeout);
  }
}

function fetchNewsBatchJsonp(batch){
  return new Promise((resolve,reject)=>{
    const callback=
      `__floewNews_${batch}_${Date.now().toString(36)}_${Math.random()
        .toString(36)
        .slice(2,8)}`;

    const script=document.createElement("script");
    const url=buildNewsBatchUrl(batch,"jsonp",0);
    url.searchParams.set("callback",callback);

    let settled=false;

    const cleanup=()=>{
      try{
        delete window[callback];
      }catch(e){
        window[callback]=undefined;
      }
      script.remove();
    };

    const finish=(fn,value)=>{
      if(settled)return;
      settled=true;
      clearTimeout(timeout);
      cleanup();
      fn(value);
    };

    window[callback]=(data)=>{
      if(!Array.isArray(data)){
        finish(
          reject,
          new Error(`Batch ${batch}: Geçersiz JSONP yanıtı`)
        );
        return;
      }

      saveNewsBatchCache(batch,data);
      finish(resolve,data);
    };

    script.async=true;
    script.src=url.href;
    script.onerror=()=>{
      finish(
        reject,
        new Error(`Batch ${batch}: JSONP bağlantısı başarısız`)
      );
    };

    const timeout=setTimeout(()=>{
      finish(
        reject,
        new Error(`Batch ${batch}: JSONP zaman aşımı`)
      );
    },NEWS_JSONP_TIMEOUT_MS);

    document.head.appendChild(script);
  });
}

async function fetchNewsBatch(batch){
  let firstHttpError=null;
  let jsonpError=null;

  /*
    İlk normal CORS isteği. Başarısızsa aynı hatayı iki kez üst üste
    üretmek yerine hemen JSONP'ye geç.
  */
  try{
    return await fetchNewsBatchHttp(
      batch,
      0
    );
  }catch(err){
    firstHttpError=err;

    console.warn(
      `NEWS WALL batch ${batch} fetch:`,
      err
    );
  }

  /*
    JSONP, fetch/CORS katmanından bağımsız ikinci taşıma yolu.
  */
  try{
    return await fetchNewsBatchJsonp(batch);
  }catch(err){
    jsonpError=err;

    console.warn(
      `NEWS WALL batch ${batch} JSONP fallback:`,
      err
    );
  }

  /*
    Son bir kısa HTTP denemesi; radyo/Wi-Fi geçişinde bağlantı geri geldiyse
    toparlanır. Kuyruk sayesinde 12 batch aynı anda retry fırtınası oluşturmaz.
  */
  await waitForNewsRetry(450);

  try{
    return await fetchNewsBatchHttp(
      batch,
      1
    );
  }catch(finalHttpError){
    console.warn(
      `NEWS WALL batch ${batch} final fetch:`,
      finalHttpError
    );

    const cached=
      loadNewsBatchCache(batch) ||
      loadNewsBatchCache(
        batch,
        {allowStale:true}
      );

    if(cached){
      console.warn(
        `NEWS WALL batch ${batch}: yerel haber önbelleği kullanılıyor.`
      );
      return cached;
    }

    const detail=[
      firstHttpError?.message,
      jsonpError?.message,
      finalHttpError?.message
    ]
      .filter(Boolean)
      .join(" / ");

    throw new Error(
      detail
        ? `Batch ${batch}: bağlantı kurulamadı (${detail})`
        : `Batch ${batch}: bağlantı kurulamadı`
    );
  }
}

async function settleNewsBatches(
  batchCount=NEWS_BATCH_COUNT,
  concurrency=NEWS_BATCH_CONCURRENCY
){
  const results=
    Array.from(
      {length:batchCount},
      ()=>null
    );

  let nextBatch=0;

  async function runner(){
    while(true){
      const batch=nextBatch++;

      if(batch>=batchCount){
        return;
      }

      try{
        results[batch]={
          status:"fulfilled",
          value:await fetchNewsBatch(batch)
        };
      }catch(reason){
        results[batch]={
          status:"rejected",
          reason
        };
      }
    }
  }

  const runnerCount=Math.max(
    1,
    Math.min(
      concurrency,
      batchCount
    )
  );

  await Promise.all(
    Array.from(
      {length:runnerCount},
      ()=>runner()
    )
  );

  return results;
}

let initialNewsRetryCount=0;
let initialNewsRetryTimer=null;
const INITIAL_NEWS_RETRY_DELAYS=[900,2200,5000];

function resetInitialNewsRetry(){
  initialNewsRetryCount=0;
  if(initialNewsRetryTimer){
    clearTimeout(initialNewsRetryTimer);
    initialNewsRetryTimer=null;
  }
}

function scheduleInitialNewsRetry(){
  if(state.stories.length)return false;
  if(initialNewsRetryCount>=INITIAL_NEWS_RETRY_DELAYS.length)return false;

  const delay=INITIAL_NEWS_RETRY_DELAYS[initialNewsRetryCount++];
  clearTimeout(initialNewsRetryTimer);

  initialNewsRetryTimer=setTimeout(()=>{
    initialNewsRetryTimer=null;
    load();
  },delay);

  return true;
}

let newsLoadInFlight=null;

async function performNewsLoad(){
  /*
    Periyodik yenileme bir slide geçişinin tam ortasında state.stories'i
    değiştirirse transition'ın tuttuğu sayısal index başka habere kayabilir.
    Aktif geçiş/reklam varken mevcut akışı olduğu gibi bırak; sonraki refresh
    turu güncel listeyi alır.
  */
  if((state.busy || adActive || state.touchDragActive) && state.stories.length){
    return;
  }

  try{
    /*
      Worker kaynakları batch çağrılarına böler. Böylece tek Worker
      invocation'ında Cloudflare'ın external subrequest sınırına yaklaşmayız.
      Bir batch geçici olarak hata verse bile diğer batch'lerin haberleri
      kullanılmaya devam eder.
    */
    const catalogPromise=
      sourceCatalogLoaded
        ? Promise.resolve(knownSources)
        : fetchSourceCatalog();

    const initialCacheSnapshot=
      !state.stories.length
        ? loadInitialNewsBatchCacheSnapshot()
        : null;
    const usedInitialCacheSnapshot=Boolean(initialCacheSnapshot);
    const usedInitialNetworkFastPass=Boolean(
      !initialCacheSnapshot &&
      !state.stories.length &&
      INITIAL_NEWS_BATCH_COUNT<NEWS_BATCH_COUNT
    );

    let settled;
    let customStories;

    if(initialCacheSnapshot){
      settled=initialCacheSnapshot;
      customStories=[];
    }else if(usedInitialNetworkFastPass){
      settled=await settleNewsBatches(
        INITIAL_NEWS_BATCH_COUNT,
        Math.min(NEWS_BATCH_CONCURRENCY,INITIAL_NEWS_BATCH_COUNT)
      );
      customStories=[];
    }else{
      [settled,customStories]=await Promise.all([
        settleNewsBatches(
          NEWS_BATCH_COUNT,
          NEWS_BATCH_CONCURRENCY
        ),
        loadCustomRssStories()
      ]);
    }

    await catalogPromise;

    /* Fetch sürerken kullanıcı kaydırmaya başlamış olabilir. Eski refresh
       sonucu geçişin kullandığı history/index yapısını değiştirmesin. */
    if((state.busy || adActive || state.touchDragActive) && state.stories.length){
      return;
    }

    const successful=[
      ...settled
        .filter(result=>result.status==="fulfilled")
        .flatMap(result=>result.value),
      ...customStories
    ];

    const failures=settled
      .map((result,batch)=>({result,batch}))
      .filter(x=>x.result.status==="rejected");

    for(const failure of failures){
      console.warn(
        `NEWS WALL batch ${failure.batch}:`,
        failure.result.reason
      );
    }

    const unique=new Map();
    const uniqueSignatureKeys=new Map();

    function mergeDuplicateStory(existing,candidate){
      if(!existing)return candidate;

      const oldPriority=Number(existing.categoryPriority)||0;
      const newPriority=Number(candidate.categoryPriority)||0;

      let preferred=
        newPriority>oldPriority
          ? candidate
          : existing;

      const other=
        preferred===candidate
          ? existing
          : candidate;

      return {
        ...preferred,
        breaking:Boolean(existing.breaking||candidate.breaking),
        video:preferred.video||other.video||"",
        videoType:preferred.videoType||other.videoType||"",
        videoArticleHint:Boolean(
          preferred.videoArticleHint || other.videoArticleHint
        ),
        videoVerified:Boolean(
          preferred.videoVerified || other.videoVerified
        ),
        videoDiscovery:Boolean(
          preferred.videoDiscovery || other.videoDiscovery
        )
      };
    }

    for(const item of successful){
      if(!item||!item.title||!item.image)continue;

      const signature=exactDuplicateSignature(item);
      const naturalKey=
        item.link ||
        `${item.source||""}|${item.title}`;
      const key=
        (signature && uniqueSignatureKeys.get(signature)) ||
        naturalKey;

      unique.set(
        key,
        mergeDuplicateStory(
          unique.get(key),
          item
        )
      );

      if(signature)uniqueSignatureKeys.set(signature,key);
    }

    const incoming=[...unique.values()];

    if(incoming.length){
      resetInitialNewsRetry();
    }

    if(!incoming.length){
      const firstError=failures[0]?.result?.reason;
      throw firstError||new Error("Görselli haber yok");
    }

    rawStories=enrichStories(incoming);

    if(videoOnlyEnabled){
      queueVideoOnlyScan();
    }

    if(iddqdModeActive){
      renderIddqdGrid();
    }

    /*
      Yerleşik kaynak kataloğu GitHub'daki config.js'den gelir. Özel RSS
      kaynaklarını her yüklemede canlı sonuçtan ekleyip artık silinmiş özel
      kaynakları çıkarıyoruz.
    */
    if(customRssSourceKeys.size){
      knownSources=knownSources.filter(
        name=>!customRssSourceKeys.has(sourceKey(name))
      );
    }

    customRssSourceKeys=new Set();

    const customSourceNames=[...new Map(
      rawStories
        .filter(story=>story.customRss)
        .map(story=>[
          sourceKey(story.source),
          story.source||"Özel RSS"
        ])
    ).values()];

    for(const name of customSourceNames){
      const key=sourceKey(name);
      if(!key)continue;
      customRssSourceKeys.add(key);

      if(!knownSources.some(source=>sourceKey(source)===key)){
        knownSources.push(name);
      }
    }

    if(
      filterReturnStoryKey &&
      !rawStories.some(
        story=>storyIdentity(story)===filterReturnStoryKey
      )
    ){
      filterReturnStoryKey="";
    }

    if(!knownSources.length){
      knownSources=[...new Map(
        rawStories
          .filter(story=>!story.flowForeign)
          .map(s=>[
            sourceKey(s.source),
            s.source||"Bilinmeyen kaynak"
          ])
      ).values()];
    }

    if(!knownForeignSources.length){
      knownForeignSources=[...new Map(
        rawStories
          .filter(story=>story.flowForeign)
          .map(s=>[
            sourceKey(s.source),
            s.source||"Bilinmeyen kaynak"
          ])
      ).values()];
    }

    if(!sourcePreferencesApplied){
      const available=new Set(knownSources.map(sourceKey));

      if(Array.isArray(savedPreferences.sources)){
        filters.sources=new Set(
          savedPreferences.sources.filter(key=>available.has(key))
        );
      }else{
        filters.sources=new Set(available);
      }

      /* Yeni eklenen özel RSS kaynakları ilk yüklemede açık gelsin. */
      for(const key of customRssSourceKeys){
        filters.sources.add(key);
      }

      sourcePreferencesApplied=true;
    }

    if(!foreignSourcePreferencesApplied){
      const availableForeign=
        new Set(knownForeignSources.map(sourceKey));

      if(Array.isArray(savedForeignSources)){
        foreignSourceFilters=new Set(
          savedForeignSources.filter(key=>availableForeign.has(key))
        );
      }else{
        foreignSourceFilters=new Set(availableForeign);
      }

      foreignSourcePreferencesApplied=true;
    }

    renderOptions();

    const list=activeStories();
    if(!list.length){
      status(emptyStoriesMessage());

      if(feedMode==="breaking" || feedMode==="foreign"){
        state.stories=[];
        state.index=0;
        state.history=[];
        state.historyPos=0;
        setStoryStageVisible(false);
      }

      finishInitialLoading();
      return;
    }

    if(!state.stories.length){
      setStoryStageVisible(true);
      state.stories=list;
      state.index=0;
      state.history=[0];
      state.historyPos=0;
      clearAdNavigationHistory();
      historicalAdContext=null;
      preloadImage(list[0].image).catch(()=>{});
      fill(slides[0],list[0],{prepareMedia:false});
      slides[0].className="slide active";
      activateSlideMedia(slides[0],list[0]);
      updateKeywordAlert(list[0]);
      newsShownSinceAd=1;
      clearStatus();
      void finishInitialLoadingAfterVisual(slides[0]);
      timerAfterLikelyMediaWarmup(slides[0],list[0]);

      if(usedInitialCacheSnapshot || usedInitialNetworkFastPass){
        const refreshLive=()=>setTimeout(()=>load(),260);
        if(window.__floewInitialReady){
          refreshLive();
        }else{
          window.addEventListener("floew:ready",refreshLive,{once:true});
        }
      }

      if(ADS_TEST_MODE){
        setTimeout(runAdTestOnce,900);
      }

      return;
    }

    const oldStories=state.stories;
    const oldHistory=Array.isArray(state.history)
      ? [...state.history]
      : [];
    const oldHistoryPos=Number.isInteger(state.historyPos)
      ? state.historyPos
      : Math.max(0,oldHistory.length-1);
    const currentStory=oldStories[state.index]||null;
    const oldSource=sourceKey(currentStory?.source);

    /*
      Periyodik Worker yenilemesi state.stories sırasını değiştirebilir. History
      yalnız sayısal indeks tutarsa eski indeks başka haberi işaret eder. Daha
      önce gerçekten gösterilen haberleri yeni listeye history-only snapshot
      olarak ekleyip tüm history indekslerini haber kimliğine göre yeniden
      eşliyoruz. Böylece geri hareketi her zaman gerçek önceki habere döner.
    */
    const nextStories=[...list];
    const nextKeys=new Set(nextStories.map(storyIdentity).filter(Boolean));
    const nextSignatures=new Set(nextStories.map(exactDuplicateSignature).filter(Boolean));

    for(const historyIndex of oldHistory){
      if(!Number.isInteger(historyIndex))continue;
      const story=oldStories[historyIndex];
      if(!story)continue;

      const key=storyIdentity(story);
      const signature=exactDuplicateSignature(story);
      if(
        (key && nextKeys.has(key)) ||
        (signature && nextSignatures.has(signature))
      )continue;

      nextStories.push({...story,_historyOnly:true});
      if(key)nextKeys.add(key);
      if(signature)nextSignatures.add(signature);
    }

    state.stories=nextStories;
    plannedForwardStory=null;

    const indexByKey=new Map();
    const indexBySignature=new Map();
    state.stories.forEach((story,index)=>{
      const key=storyIdentity(story);
      const signature=exactDuplicateSignature(story);
      if(key && !indexByKey.has(key))indexByKey.set(key,index);
      if(signature && !indexBySignature.has(signature))indexBySignature.set(signature,index);
    });

    const locateStory=story=>{
      if(!story)return -1;
      const key=storyIdentity(story);
      if(key && indexByKey.has(key))return indexByKey.get(key);
      const signature=exactDuplicateSignature(story);
      if(signature && indexBySignature.has(signature))return indexBySignature.get(signature);
      return -1;
    };

    let remappedHistory=[];
    let remappedHistoryPos=-1;

    oldHistory.forEach((oldIndex,position)=>{
      const oldStory=oldStories[oldIndex];
      const mapped=locateStory(oldStory);
      if(mapped<0)return;

      if(remappedHistory[remappedHistory.length-1]!==mapped){
        remappedHistory.push(mapped);
      }

      if(position<=oldHistoryPos){
        remappedHistoryPos=remappedHistory.length-1;
      }
    });

    let currentIndex=locateStory(currentStory);
    let currentChanged=false;

    if(currentIndex<0){
      currentIndex=state.stories.findIndex(
        story=>!story?._historyOnly && sourceKey(story.source)!==oldSource
      );
      if(currentIndex<0){
        currentIndex=state.stories.findIndex(story=>!story?._historyOnly);
      }
      if(currentIndex<0)currentIndex=0;
      currentChanged=true;
    }

    state.index=currentIndex;

    if(!remappedHistory.length){
      remappedHistory.push(currentIndex);
      remappedHistoryPos=0;
    }else{
      remappedHistoryPos=Math.max(0,Math.min(
        remappedHistoryPos,
        remappedHistory.length-1
      ));

      if(remappedHistory[remappedHistoryPos]!==currentIndex){
        remappedHistory=remappedHistory.slice(0,remappedHistoryPos+1);
        if(remappedHistory[remappedHistory.length-1]!==currentIndex){
          remappedHistory.push(currentIndex);
        }
        remappedHistoryPos=remappedHistory.length-1;
      }
    }

    state.history=remappedHistory;
    state.historyPos=remappedHistoryPos;

    if(adHistoryByAfterPos.size){
      const oldRecords=[...adHistoryByAfterPos.values()];
      adHistoryByAfterPos.clear();

      for(const record of oldRecords){
        const beforeIndex=record.beforeKey
          ? indexByKey.get(record.beforeKey)
          : undefined;
        const afterIndex=record.afterKey
          ? indexByKey.get(record.afterKey)
          : undefined;

        if(!Number.isInteger(beforeIndex) || !Number.isInteger(afterIndex)){
          continue;
        }

        const candidates=[];
        for(let pos=0;pos<state.history.length-1;pos++){
          if(
            state.history[pos]===beforeIndex &&
            state.history[pos+1]===afterIndex
          ){
            candidates.push(pos);
          }
        }

        if(!candidates.length)continue;

        const beforeHistoryPos=candidates.reduce((best,pos)=>
          Math.abs(pos-(record.beforeHistoryPos??pos)) <
          Math.abs(best-(record.beforeHistoryPos??best)) ? pos : best
        ,candidates[0]);
        const afterHistoryPos=beforeHistoryPos+1;

        const remapped={
          ...record,
          beforeStoryIndex:beforeIndex,
          beforeIndex,
          afterStoryIndex:afterIndex,
          afterIndex,
          beforeHistoryPos,
          afterHistoryPos
        };

        adHistoryByAfterPos.set(afterHistoryPos,remapped);
      }

      if(!adHistoryByAfterPos.size){
        historicalAdContext=null;
      }
    }

    if(currentChanged){
      fill(slides[state.active],state.stories[state.index]);
      slides[state.active].className="slide active";
      activateSlideMedia(slides[state.active],state.stories[state.index]);
    }

    updateKeywordAlert(state.stories[state.index]);
    clearStatus();
    if(!initialLoadFinished){
      void finishInitialLoadingAfterVisual(slides[state.active]);
    }
  }catch(err){
    console.error("NEWS WALL:",err);

    if(!state.stories.length){
      let detail=err?.message||"Worker yanıtı okunamadı.";
      if(err?.name==="AbortError"){
        detail="Worker yanıtı zaman aşımına uğradı.";
      }

      if(scheduleInitialNewsRetry()){
        status("Haber bağlantısı yeniden deneniyor...");
      }else{
        status(`Haberler alınamadı. ${detail}`);
      }

      finishInitialLoading();
    }
  }
}


function load(){
  if(newsLoadInFlight){
    return newsLoadInFlight;
  }

  newsLoadInFlight=performNewsLoad()
    .finally(()=>{
      newsLoadInFlight=null;
    });

  return newsLoadInFlight;
}



let marketRefreshTimer=null;
let marketFetchInFlight=null;
let marketDataSnapshot=null;

function readMarketDataCache(){
  try{
    const parsed=JSON.parse(localStorage.getItem(MARKET_DATA_CACHE_KEY)||"null");
    if(
      !parsed ||
      typeof parsed!=="object" ||
      !Number.isFinite(Number(parsed.cachedAt)) ||
      Date.now()-Number(parsed.cachedAt)>MARKET_CACHE_MAX_AGE_MS
    ){
      return null;
    }
    return parsed.data||null;
  }catch(e){
    return null;
  }
}

function writeMarketDataCache(data){
  try{
    localStorage.setItem(
      MARKET_DATA_CACHE_KEY,
      JSON.stringify({cachedAt:Date.now(),data})
    );
  }catch(e){}
}

function formatMarketNumber(value,digits=2){
  const number=Number(value);
  if(!Number.isFinite(number))return "—";
  return number.toLocaleString("tr-TR",{
    minimumFractionDigits:digits,
    maximumFractionDigits:digits
  });
}

function formatMarketPercent(value){
  const number=Number(value);
  if(!Number.isFinite(number))return "";

  const direction=
    number>0 ? "▲︎ " :
    number<0 ? "▼︎ " :
    "";

  const prefix=number>0?"+":"";

  return `${direction}${prefix}${number.toLocaleString("tr-TR",{
    minimumFractionDigits:2,
    maximumFractionDigits:2
  })}%`;
}

function renderMarketPreferenceButton(id,enabled){
  const button=document.getElementById(id);
  if(!button)return;
  button.classList.toggle("active",Boolean(enabled));
  button.setAttribute("aria-pressed",enabled?"true":"false");
  const stateEl=button.querySelector(".media-setting-state");
  if(stateEl)stateEl.textContent=enabled?"Açık":"Kapalı";
}

function ensureGoldFxRow(){
  const box=document.getElementById("fx-rates");
  if(!box || box.querySelector('[data-fx="GOLD"]'))return;

  const row=document.createElement("span");
  row.className="fx-rate fx-rate-gold";
  row.dataset.fx="GOLD";
  row.dataset.direction="flat";
  row.setAttribute("title","Gram altın · TL");
  row.innerHTML=
    '<span class="fx-gold-icon" aria-hidden="true">'+
      '<img src="assets/gold.png" alt="" draggable="false">'+
    '</span>'+
    '<strong>XAU</strong>'+
    '<span class="fx-value">—</span>';

  box.appendChild(row);
}

function marketGoldFromSnapshot(){
  const rows=Array.isArray(marketDataSnapshot?.fx)
    ? marketDataSnapshot.fx
    : [];

  return rows.find(
    item=>String(item?.key||"").toUpperCase()==="GOLD"
  )||null;
}

async function enrichMarketDataWithGold(data){
  const fx=Array.isArray(data?.fx)?data.fx:[];
  const usd=fx.find(
    item=>String(item?.key||"").toUpperCase()==="USD"
  );

  const usdTry=Number(usd?.value);
  if(!Number.isFinite(usdTry) || usdTry<=0)return data;

  const previousGold=marketGoldFromSnapshot();
  const previousAt=Number(marketDataSnapshot?.goldGeneratedAt)||0;

  if(
    previousGold &&
    previousAt &&
    Date.now()-previousAt<GOLD_REFRESH_MS
  ){
    return {
      ...data,
      fx:[
        ...fx.filter(item=>String(item?.key||"").toUpperCase()!=="GOLD"),
        previousGold
      ],
      goldGeneratedAt:previousAt
    };
  }

  try{
    const controller=new AbortController();
    const timeout=setTimeout(()=>controller.abort(),5000);

    let response;
    try{
      response=await fetch(
        GOLD_SPOT_API,
        {
          method:"GET",
          mode:"cors",
          credentials:"omit",
          cache:"no-store",
          signal:controller.signal,
          headers:{"Accept":"application/json"}
        }
      );
    }finally{
      clearTimeout(timeout);
    }

    if(!response.ok){
      throw new Error(`gold_http_${response.status}`);
    }

    const payload=await response.json();
    const ounceUsd=Number(payload?.price);

    if(!Number.isFinite(ounceUsd) || ounceUsd<=0){
      throw new Error("gold_invalid_payload");
    }

    const gramTry=ounceUsd*usdTry/TROY_OUNCE_GRAMS;
    const previousGoldValue=Number(previousGold?.value);
    const goldChangePercent=
      Number.isFinite(previousGoldValue) && previousGoldValue>0
        ? ((gramTry-previousGoldValue)/previousGoldValue)*100
        : 0;

    const gold={
      key:"GOLD",
      label:"Gram Altın",
      shortLabel:"XAU",
      value:gramTry,
      changePercent:goldChangePercent,
      unit:"TRY/g",
      source:"gold-api.com"
    };

    return {
      ...data,
      fx:[
        ...fx.filter(item=>String(item?.key||"").toUpperCase()!=="GOLD"),
        gold
      ],
      goldGeneratedAt:Date.now()
    };
  }catch(error){
    console.warn("Flöw gold data:",error);

    if(previousGold){
      return {
        ...data,
        fx:[
          ...fx.filter(item=>String(item?.key||"").toUpperCase()!=="GOLD"),
          previousGold
        ],
        goldGeneratedAt:previousAt||Date.now()
      };
    }

    return data;
  }
}

function loadStockTickerScale(){
  try{
    const saved=Number(localStorage.getItem(STOCK_TICKER_SCALE_KEY));
    if(Number.isFinite(saved)){
      return Math.max(STOCK_TICKER_SCALE_MIN,saved);
    }
  }catch(e){}
  return 1;
}

let stockTickerScale=loadStockTickerScale();

function stockTickerBaseHeightPx(){
  return window.matchMedia?.("(max-width:700px)")?.matches ? 50 : 56;
}

function stockTickerMaxScale(){
  const base=Math.max(1,stockTickerBaseHeightPx());
  return Math.max(
    1,
    (Math.max(1,window.innerHeight)/8)/base
  );
}

function clampStockTickerScale(value){
  const number=Number(value);
  const next=Number.isFinite(number)?number:1;

  return Math.min(
    stockTickerMaxScale(),
    Math.max(STOCK_TICKER_SCALE_MIN,next)
  );
}

function saveStockTickerScale(){
  try{
    localStorage.setItem(
      STOCK_TICKER_SCALE_KEY,
      String(stockTickerScale)
    );
  }catch(e){}
}

function renderStockTickerScaleControl(){
  const minus=document.getElementById("stock-ticker-size-minus");
  const plus=document.getElementById("stock-ticker-size-plus");
  const value=document.getElementById("stock-ticker-size-value");

  stockTickerScale=clampStockTickerScale(stockTickerScale);
  const max=stockTickerMaxScale();
  const rounded=Math.round(stockTickerScale*100);

  if(value)value.textContent=`%${rounded}`;
  if(minus){
    minus.disabled=stockTickerScale<=STOCK_TICKER_SCALE_MIN+.001;
  }
  if(plus){
    plus.disabled=stockTickerScale>=max-.001;
  }
}

function setStockTickerScale(value){
  const next=clampStockTickerScale(value);
  if(Math.abs(next-stockTickerScale)<.0001){
    renderStockTickerScaleControl();
    return;
  }

  stockTickerScale=next;
  saveStockTickerScale();
  applyStockTickerScale();
}

function applyStockTickerScale({reconfigure=true}={}){
  const ticker=document.getElementById("market-ticker");
  if(!ticker)return;

  stockTickerScale=clampStockTickerScale(stockTickerScale);

  const base=stockTickerBaseHeightPx();
  const target=Math.min(
    Math.max(1,window.innerHeight)/8,
    base*stockTickerScale
  );

  /*
    Tek görsel state JS'de: kullanıcının seçtiği ölçek. Gerçek yükseklik,
    iki bandın paylaşımı ve çevredeki yerleşim CSS değişkeniyle yönetilir.
  */
  const targetHeight=`${Math.max(1,target).toFixed(1)}px`;
  document.body.style.setProperty(
    "--floew-market-height",
    targetHeight
  );
  ticker.style.setProperty(
    "--floew-market-height",
    targetHeight
  );
  ticker.style.setProperty(
    "--floew-market-scale",
    String(stockTickerScale)
  );

  /*
    Bandın yüksekliğiyle birlikte kayan piyasa metinleri ve aralıkları da
    aynı oranda büyüyüp küçülsün. Mobil taban ölçüleri mevcut tasarımı korur.
  */
  const compactMarket=window.matchMedia("(max-width:700px)").matches;
  const marketMetrics=compactMarket
    ? {item:10,strong:9,value:10,change:9,itemGap:7,changeMin:48,setGap:28,companyGap:26}
    : {item:12,strong:11,value:12,change:11,itemGap:9,changeMin:58,setGap:38,companyGap:34};

  ticker.style.setProperty("--floew-market-item-font",`${(marketMetrics.item*stockTickerScale).toFixed(2)}px`);
  ticker.style.setProperty("--floew-market-strong-font",`${(marketMetrics.strong*stockTickerScale).toFixed(2)}px`);
  ticker.style.setProperty("--floew-market-value-font",`${(marketMetrics.value*stockTickerScale).toFixed(2)}px`);
  ticker.style.setProperty("--floew-market-change-font",`${(marketMetrics.change*stockTickerScale).toFixed(2)}px`);
  ticker.style.setProperty("--floew-market-item-gap",`${(marketMetrics.itemGap*stockTickerScale).toFixed(2)}px`);
  ticker.style.setProperty("--floew-market-change-min",`${(marketMetrics.changeMin*stockTickerScale).toFixed(2)}px`);
  ticker.style.setProperty("--floew-market-set-gap",`${(marketMetrics.setGap*stockTickerScale).toFixed(2)}px`);
  ticker.style.setProperty("--floew-market-company-gap",`${(marketMetrics.companyGap*stockTickerScale).toFixed(2)}px`);

  renderStockTickerScaleControl();

  if(reconfigure){
    requestAnimationFrame(()=>{
      ticker
        .querySelectorAll(".market-ticker-track")
        .forEach(track=>{
          const state=marketTrackState.get(track);
          if(!state?.items?.length)return;
          configureMarketTrackLoop(
            track,
            {company:Boolean(state.company)}
          );
        });
    });
  }
}

function renderMarketPreferences(){
  renderMarketPreferenceButton("fx-rates-setting",fxRatesVisible);
  renderMarketPreferenceButton("stock-ticker-setting",stockTickerVisible);
  renderStockTickerScaleControl();
}

function renderFxRates(data=marketDataSnapshot){
  const box=document.getElementById("fx-rates");
  if(!box)return;

  ensureGoldFxRow();

  box.hidden=!fxRatesVisible;
  document.body.classList.toggle("fx-rates-visible",fxRatesVisible);

  if(!fxRatesVisible)return;

  const rows=Array.isArray(data?.fx)?data.fx:[];
  const map=new Map(rows.map(item=>[String(item?.key||"").toUpperCase(),item]));

  for(const key of ["USD","EUR","GBP","GOLD"]){
    const row=box.querySelector(`[data-fx="${key}"]`);
    const value=row?.querySelector(".fx-value");
    if(!row || !value)continue;
    const item=map.get(key);
    value.textContent=item?formatMarketNumber(item.value,2):"—";
    row.dataset.direction=
      Number(item?.changePercent)>0?"up":
      Number(item?.changePercent)<0?"down":"flat";
  }

  box.dataset.stale=data?.stale?"1":"0";
}

function marketTickerItemHtml(item,{company=false}={}){
  const change=Number(item?.changePercent);
  const direction=change>0?"up":change<0?"down":"flat";

  const label=String(
    company
      ? (item?.shortLabel||item?.key||item?.label||"")
      : (item?.label||item?.key||"")
  );

  return `<span class="market-ticker-item${company?" market-company-item":""}" data-direction="${direction}">`+
    `<strong>${label}</strong>`+
    `<span class="market-ticker-value">${formatMarketNumber(item?.value,2)}</span>`+
    `<span class="market-ticker-change">${formatMarketPercent(change)}</span>`+
    `</span>`;
}

const marketTrackState=new WeakMap();

function marketTrackReducedMotion(){
  return Boolean(
    window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches
  );
}

function marketTrackSignature(items,{company=false}={}){
  return JSON.stringify(
    (Array.isArray(items)?items:[]).map(item=>[
      String(item?.key||item?.label||""),
      Number.isFinite(Number(item?.value))
        ? Number(item.value).toFixed(4)
        : "",
      Number.isFinite(Number(item?.changePercent))
        ? Number(item.changePercent).toFixed(4)
        : "",
      company?"1":"0"
    ])
  );
}

function marketTrackSpeedPxPerSecond(company){
  return company ? 30 : 34;
}

function configureMarketTrackLoop(track,{company=false}={}){
  if(!track)return;

  const firstSet=track.querySelector(".market-ticker-set");
  const windowEl=track.closest(".market-ticker-window");

  if(!firstSet || !windowEl)return;

  const baseWidth=Math.max(1,Math.ceil(firstSet.getBoundingClientRect().width));
  const viewportWidth=Math.max(
    1,
    Math.ceil(windowEl.getBoundingClientRect().width)
  );

  /*
    Ekran geniş olsa bile boşluk oluşmaması için bir veri setini,
    görünen alan + bir tam loop genişliğini kaplayacak kadar çoğalt.
    Animasyon ise yalnızca BİR veri seti kadar ilerler; böylece bitiş
    ile başlangıç geometrik olarak aynı noktaya denk gelir.
  */
  const neededCopies=Math.max(
    2,
    Math.ceil((viewportWidth+baseWidth)/baseWidth)+1
  );

  while(track.children.length<neededCopies){
    const clone=firstSet.cloneNode(true);
    clone.setAttribute("aria-hidden","true");
    track.appendChild(clone);
  }

  while(track.children.length>neededCopies){
    track.lastElementChild?.remove();
  }

  const duration=Math.max(
    18,
    baseWidth/marketTrackSpeedPxPerSecond(company)
  );

  track.style.setProperty("--market-loop-distance",`${baseWidth}px`);
  track.style.setProperty("--market-loop-duration",`${duration.toFixed(2)}s`);
}

function commitMarketTrackContent(track,items,{company=false}={}){
  if(!track)return;

  const safeItems=Array.isArray(items)?items:[];
  const signature=marketTrackSignature(safeItems,{company});

  if(!safeItems.length){
    track.innerHTML=
      '<span class="market-ticker-set"><span class="market-ticker-item market-ticker-loading">Piyasa verisi yükleniyor…</span></span>';
    track.style.removeProperty("--market-loop-distance");
    track.style.removeProperty("--market-loop-duration");

    marketTrackState.set(track,{
      signature,
      items:safeItems,
      company,
      pending:null
    });
    return;
  }

  const html=safeItems
    .map(item=>marketTickerItemHtml(item,{company}))
    .join("");

  track.innerHTML=
    `<span class="market-ticker-set">${html}</span>`;

  /*
    DOM ölçümü ilk frame'de kesinleşsin. Sonra gerekli kopya sayısını
    ve gerçek loop mesafesini hesapla.
  */
  requestAnimationFrame(()=>{
    configureMarketTrackLoop(track,{company});
  });

  marketTrackState.set(track,{
    signature,
    items:safeItems,
    company,
    pending:null
  });

  if(!track.dataset.marketLoopBound){
    track.dataset.marketLoopBound="1";

    track.addEventListener("animationiteration",()=>{
      const state=marketTrackState.get(track);
      if(!state?.pending)return;

      const pending=state.pending;
      commitMarketTrackContent(
        track,
        pending.items,
        {company:pending.company}
      );
    });
  }
}

function fillMarketTrack(track,items,{company=false}={}){
  if(!track)return;

  const safeItems=Array.isArray(items)?items:[];
  const signature=marketTrackSignature(safeItems,{company});
  const state=marketTrackState.get(track);

  if(!state){
    commitMarketTrackContent(track,safeItems,{company});
    return;
  }

  if(state.signature===signature){
    return;
  }

  /*
    Yeni piyasa verisini animasyonun ortasında DOM'a basmak kayışı bir anda
    başa sarıyordu. Veri varsa, yeni rakamları bir sonraki loop sınırına
    kadar beklet; o noktada değişim görsel olarak fark edilmez.
    Reduced-motion veya ilk yükleme durumunda doğrudan uygula.
  */
  if(
    !state.items?.length ||
    !safeItems.length ||
    marketTrackReducedMotion()
  ){
    commitMarketTrackContent(track,safeItems,{company});
    return;
  }

  state.pending={
    items:safeItems,
    company,
    signature
  };
  marketTrackState.set(track,state);
}

let marketTrackResizeTimer=null;
window.addEventListener("resize",()=>{
  if(marketTrackResizeTimer){
    clearTimeout(marketTrackResizeTimer);
  }

  marketTrackResizeTimer=setTimeout(()=>{
    marketTrackResizeTimer=null;

    document
      .querySelectorAll(".market-ticker-track")
      .forEach(track=>{
        const state=marketTrackState.get(track);
        if(!state?.items?.length)return;
        configureMarketTrackLoop(track,{
          company:Boolean(state.company)
        });
      });

    renderStockTickerScaleControl();
    applyStockTickerScale({reconfigure:false});
  },160);
});

function renderStockTicker(data=marketDataSnapshot){
  const ticker=document.getElementById("market-ticker");
  const indexTrack=ticker?.querySelector('[data-market-track="indices"]');
  const companyTrack=ticker?.querySelector('[data-market-track="companies"]');

  if(!ticker || !indexTrack || !companyTrack)return;

  ticker.hidden=!stockTickerVisible;
  document.body.classList.toggle("market-ticker-visible",stockTickerVisible);

  if(!stockTickerVisible){
    indexTrack.replaceChildren();
    companyTrack.replaceChildren();
    return;
  }

  const indices=
    Array.isArray(data?.indices)
      ? data.indices
      : Array.isArray(data?.stocks)
        ? data.stocks
        : [];

  const companies=
    Array.isArray(data?.companies)
      ? data.companies
      : [];

  fillMarketTrack(indexTrack,indices,{company:false});
  fillMarketTrack(companyTrack,companies,{company:true});

  ticker.dataset.stale=data?.stale?"1":"0";

  requestAnimationFrame(()=>{
    applyStockTickerScale({reconfigure:false});
  });
}

function renderMarketData(data=marketDataSnapshot){
  if(data)marketDataSnapshot=data;
  renderFxRates(marketDataSnapshot);
  renderStockTicker(marketDataSnapshot);
}

async function refreshMarketData(force=false){
  if(!fxRatesVisible && !stockTickerVisible)return null;
  if(!force && document.visibilityState!=="visible")return marketDataSnapshot;
  if(marketFetchInFlight)return marketFetchInFlight;

  const url=new URL(MARKET_API);
  url.searchParams.set("fx",fxRatesVisible?"1":"0");
  url.searchParams.set("indices",stockTickerVisible?"1":"0");
  url.searchParams.set("companies",stockTickerVisible?"1":"0");

  marketFetchInFlight=(async()=>{
    try{
      const controller=new AbortController();
      const timeout=setTimeout(()=>controller.abort(),8000);
      let response;
      try{
        response=await fetch(url.href,{cache:"no-store",signal:controller.signal});
      }finally{
        clearTimeout(timeout);
      }

      if(!response.ok)throw new Error(`market_http_${response.status}`);
      const payload=await response.json();
      if(!payload?.ok)throw new Error("market_invalid_payload");

      const data={
        fx:Array.isArray(payload.fx)?payload.fx:[],
        indices:Array.isArray(payload.indices)
          ? payload.indices
          : Array.isArray(payload.stocks)
            ? payload.stocks
            : [],
        companies:Array.isArray(payload.companies)?payload.companies:[],
        generatedAt:Number(payload.generatedAt)||Date.now(),
        source:String(payload.source||""),
        stale:false
      };

      const enrichedData=fxRatesVisible
        ? await enrichMarketDataWithGold(data)
        : data;

      marketDataSnapshot=enrichedData;
      writeMarketDataCache(enrichedData);
      renderMarketData(enrichedData);
      return enrichedData;
    }catch(error){
      console.warn("Flöw market data:",error);
      const cached=marketDataSnapshot||readMarketDataCache();
      if(cached){
        marketDataSnapshot={...cached,stale:true};
        renderMarketData(marketDataSnapshot);
      }
      return marketDataSnapshot;
    }finally{
      marketFetchInFlight=null;
    }
  })();

  return marketFetchInFlight;
}

function restartMarketRefreshTimer(){
  if(marketRefreshTimer){
    clearInterval(marketRefreshTimer);
    marketRefreshTimer=null;
  }
  if(!fxRatesVisible && !stockTickerVisible)return;
  marketRefreshTimer=setInterval(()=>refreshMarketData(false),MARKET_REFRESH_MS);
}

function applyMarketVisibility({refresh=true}={}){
  renderMarketPreferences();
  renderMarketData(marketDataSnapshot);

  if(fxRatesVisible || stockTickerVisible){
    restartMarketRefreshTimer();
    if(refresh)refreshMarketData(true);
  }else if(marketRefreshTimer){
    clearInterval(marketRefreshTimer);
    marketRefreshTimer=null;
  }
}

function setFxRatesVisible(enabled){
  fxRatesVisible=Boolean(enabled);
  saveBooleanUiPreference(FX_RATES_VISIBLE_KEY,fxRatesVisible);
  applyMarketVisibility();
}

function setStockTickerVisible(enabled){
  stockTickerVisible=Boolean(enabled);
  saveBooleanUiPreference(STOCK_TICKER_VISIBLE_KEY,stockTickerVisible);
  applyMarketVisibility();
  requestAnimationFrame(()=>{
    applyStockTickerScale({reconfigure:false});
  });
}

function initMarketData(){
  marketDataSnapshot=readMarketDataCache();
  ensureGoldFxRow();
  renderMarketPreferences();
  renderMarketData(marketDataSnapshot);
  applyStockTickerScale({reconfigure:false});
  restartMarketRefreshTimer();
  if(fxRatesVisible || stockTickerVisible)refreshMarketData(true);
}

function updateClock(){
  const now=new Date();
  document.getElementById("clock-time").textContent=
    now.toLocaleTimeString("tr-TR",{hour:"2-digit",minute:"2-digit"});
  document.getElementById("clock-date").textContent=
    now.toLocaleDateString("tr-TR",{weekday:"long",day:"2-digit",month:"long",year:"numeric"});
}

let cursorHideTimer = null;

function setFullscreenIcon(){
  const btn=document.getElementById("fullscreen-button");
  const active=!!document.fullscreenElement;
  btn.textContent="⤢︎";
  btn.title=active?"Tam ekrandan çık":"Tam ekran";
  btn.setAttribute("aria-label",btn.title);
}

function anyControlPanelOpen(){
  return Boolean(
    document.getElementById("control-menu-panel")?.classList.contains("open") ||
    document.getElementById("time-range-panel")?.classList.contains("open") ||
    document.getElementById("keyword-filter-panel")?.classList.contains("open") ||
    document.getElementById("keyword-watch-panel")?.classList.contains("open") ||
    document.getElementById("stats-overlay")?.classList.contains("open") ||
    document.getElementById("source-viewer-overlay")?.classList.contains("open") ||
    document.getElementById("menu-overlay")?.classList.contains("open")
  );
}

/*
  Hamburger tray açıkken haber navigasyonu çalışmaya devam eder.
  Sadece gerçek modal/quick paneller swipe/klavye navigasyonunu engeller.
*/
function navigationBlockingPanelOpen(){
  return Boolean(
    document.getElementById("time-range-panel")?.classList.contains("open") ||
    document.getElementById("keyword-filter-panel")?.classList.contains("open") ||
    document.getElementById("keyword-watch-panel")?.classList.contains("open") ||
    document.getElementById("stats-overlay")?.classList.contains("open") ||
    document.getElementById("source-viewer-overlay")?.classList.contains("open")
  );
}

function showFullscreenButton(){
  const fs=document.getElementById("fullscreen-button");
  const hub=document.getElementById("control-menu-button");
  const feedTabs=document.getElementById("feed-tabs");

  document.body.classList.remove("cursor-idle");

  fs?.classList.add("is-visible");
  hub?.classList.add("is-visible");
  feedTabs?.classList.add("is-visible");

  clearTimeout(cursorHideTimer);
  cursorHideTimer=setTimeout(()=>{
    if(anyControlPanelOpen())return;

    fs?.classList.remove("is-visible");
    hub?.classList.remove("is-visible");
    feedTabs?.classList.remove("is-visible");

    document.body.classList.add("cursor-idle");
  },2000);
}

function handlePointerActivity(e){
  if(e.pointerType==="mouse"){
    showFullscreenButton();
  }
}

async function toggleFullscreen(){
  try{
    if(!document.fullscreenElement){
      await document.documentElement.requestFullscreen();
    }else{
      await document.exitFullscreen();
    }
  }catch(err){
    console.error("Fullscreen:",err);
  }
}

window.addEventListener("pointermove",handlePointerActivity,{passive:true});
window.addEventListener("mousemove",showFullscreenButton,{passive:true});

/*
  Sayfa açıldıktan sonra fare hiç hareket etmese bile imleç 2 saniye sonra
  kaybolur. İlk hareket showFullscreenButton() ile hem imleci hem kontrolleri
  yeniden görünür yapar.
*/
cursorHideTimer=setTimeout(()=>{
  if(!anyControlPanelOpen()){
    document.body.classList.add("cursor-idle");
  }
},2000);


let pipCanvas=null;
let pipVideo=null;
let pipStream=null;
let pipAnimationFrame=null;
let pipAnimationTimer=null;
let pipActive=false;
let pipCurrent=null;
let pipTransition=null;
const pipImageCache=new Map();

function pipSupportMode(){
  const hasCanvasStream=
    typeof HTMLCanvasElement.prototype.captureStream==="function";

  if(!hasCanvasStream)return "none";

  if(
    typeof HTMLVideoElement.prototype.requestPictureInPicture==="function"
  ){
    return "standard";
  }

  const probe=document.createElement("video");

  if(
    typeof probe.webkitSetPresentationMode==="function" &&
    typeof probe.webkitSupportsPresentationMode==="function" &&
    probe.webkitSupportsPresentationMode("picture-in-picture")
  ){
    return "webkit";
  }

  return "none";
}


async function getPiPImage(url){
  if(!url)return null;
  if(pipImageCache.has(url))return pipImageCache.get(url);

  const promise=(async()=>{
    const proxied=
      `${IMAGE_PROXY_API}?url=${encodeURIComponent(url)}`;

    try{
      const r=await fetch(proxied,{
        mode:"cors",
        credentials:"omit",
        cache:"default"
      });

      if(!r.ok)throw new Error("image "+r.status);

      const blob=await r.blob();

      if(typeof createImageBitmap==="function"){
        return await createImageBitmap(blob);
      }

      return await new Promise((resolve,reject)=>{
        const img=new Image();
        const objectUrl=URL.createObjectURL(blob);

        img.onload=()=>{
          URL.revokeObjectURL(objectUrl);
          resolve(img);
        };

        img.onerror=()=>{
          URL.revokeObjectURL(objectUrl);
          reject(new Error("image decode"));
        };

        img.src=objectUrl;
      });
    }catch(e){
      console.warn("PiP image:",e);
      return null;
    }
  })();

  pipImageCache.set(url,promise);
  return promise;
}

function wrapCanvasText(ctx,text,maxWidth,maxLines=3){
  const words=String(text||"").split(/\s+/);
  const lines=[];
  let line="";

  for(const word of words){
    const test=line ? line+" "+word : word;

    if(ctx.measureText(test).width<=maxWidth){
      line=test;
    }else{
      if(line)lines.push(line);
      line=word;
      if(lines.length===maxLines-1)break;
    }
  }

  if(line && lines.length<maxLines)lines.push(line);

  if(
    lines.length===maxLines &&
    words.join(" ").length>lines.join(" ").length
  ){
    let last=lines[maxLines-1];

    while(
      last.length>2 &&
      ctx.measureText(last+"…").width>maxWidth
    ){
      last=last.slice(0,-1);
    }

    lines[maxLines-1]=last.trim()+"…";
  }

  return lines;
}

function drawPiPStory(ctx,story,img,offsetX=0,offsetY=0){
  if(!pipCanvas)return;

  const W=pipCanvas.width;
  const H=pipCanvas.height;

  ctx.save();
  ctx.translate(offsetX,offsetY);
  ctx.beginPath();
  ctx.rect(0,0,W,H);
  ctx.clip();

  ctx.fillStyle="#090909";
  ctx.fillRect(0,0,W,H);

  if(img){
    const iw=img.width||img.videoWidth||W;
    const ih=img.height||img.videoHeight||H;
    const scale=Math.max(W/iw,H/ih);
    const dw=iw*scale;
    const dh=ih*scale;

    ctx.drawImage(
      img,
      (W-dw)/2,
      (H-dh)/2,
      dw,
      dh
    );
  }

  const grad=ctx.createLinearGradient(0,H*.34,0,H);
  grad.addColorStop(0,"rgba(0,0,0,0)");
  grad.addColorStop(1,"rgba(0,0,0,.92)");
  ctx.fillStyle=grad;
  ctx.fillRect(0,0,W,H);

  ctx.textAlign="right";
  ctx.textBaseline="alphabetic";
  ctx.shadowColor="rgba(0,0,0,.65)";
  ctx.shadowBlur=7;

  ctx.font='700 18px "Comfortaa", Arial, sans-serif';
  ctx.fillStyle="rgba(255,255,255,.88)";
  ctx.fillText(story?.flowCategory||"",W-28,H-132);

  ctx.font='700 20px "Comfortaa", Arial, sans-serif';
  ctx.fillStyle="#fff";
  ctx.fillText(story?.source||"",W-28,H-102);

  ctx.font='700 34px "Comfortaa", Arial, sans-serif';
  const lines=wrapCanvasText(
    ctx,
    story?.title||"Flöw",
    W-56,
    2
  );

  let y=H-58-(lines.length-1)*40;

  for(const line of lines){
    ctx.fillText(line,W-28,y);
    y+=40;
  }

  ctx.shadowBlur=0;
  ctx.restore();
}


function drawPiPAd(ctx,item,offsetX=0,offsetY=0){
  if(!pipCanvas || !item)return;

  const W=pipCanvas.width;
  const H=pipCanvas.height;
  const media=item.media;

  ctx.save();
  ctx.translate(offsetX,offsetY);
  ctx.beginPath();
  ctx.rect(0,0,W,H);
  ctx.clip();

  ctx.fillStyle="#000";
  ctx.fillRect(0,0,W,H);

  if(media){
    const iw=
      media.videoWidth ||
      media.naturalWidth ||
      media.width ||
      W;

    const ih=
      media.videoHeight ||
      media.naturalHeight ||
      media.height ||
      H;

    if(iw>0 && ih>0){
      /*
        Tarayıcıdaki reklam görünümü object-fit: contain kullanıyor.
        PiP de aynı davranışı izler.
      */
      const scale=Math.min(W/iw,H/ih);
      const dw=iw*scale;
      const dh=ih*scale;

      try{
        ctx.drawImage(
          media,
          (W-dw)/2,
          (H-dh)/2,
          dw,
          dh
        );
      }catch(e){}
    }
  }

  /*
    Reklam ibaresi PiP içinde de tarayıcıdaki sade görünümü takip eder:
    çerçevesiz, arka plansız, Comfortaa.
  */
  ctx.textAlign="right";
  ctx.textBaseline="top";
  ctx.shadowColor="rgba(0,0,0,.7)";
  ctx.shadowBlur=6;
  ctx.font='700 18px "Comfortaa", Arial, sans-serif';
  ctx.fillStyle="rgba(255,255,255,.78)";
  ctx.fillText("Reklam",W-24,22);
  ctx.shadowBlur=0;

  ctx.restore();
}

function drawPiPItem(ctx,item,offsetX=0,offsetY=0){
  if(!item)return;

  if(item.kind==="ad"){
    drawPiPAd(
      ctx,
      item,
      offsetX,
      offsetY
    );
    return;
  }

  drawPiPStory(
    ctx,
    item.story,
    item.image,
    offsetX,
    offsetY
  );
}

function pipVector(direction,dir){
  const forward=dir>0;
  const sign=forward?1:-1;

  switch(direction){
    case "down":
      return {x:0,y:-sign};
    case "left":
      return {x:sign,y:0};
    case "right":
      return {x:-sign,y:0};
    case "up":
    default:
      return {x:0,y:sign};
  }
}

function easePiP(t){
  return 1-Math.pow(1-t,3);
}

function drawPiPScene(now=performance.now()){
  if(!pipCanvas)return;

  const ctx=pipCanvas.getContext("2d");
  const W=pipCanvas.width;
  const H=pipCanvas.height;

  if(pipTransition){
    const duration=700;
    const raw=Math.min(
      1,
      Math.max(0,(now-pipTransition.startedAt)/duration)
    );
    const p=easePiP(raw);
    const vector=pipTransition.vector;

    const newX=vector.x*W*(1-p);
    const newY=vector.y*H*(1-p);
    const oldX=-vector.x*W*p;
    const oldY=-vector.y*H*p;

    ctx.clearRect(0,0,W,H);

    drawPiPItem(
      ctx,
      pipTransition.from,
      oldX,
      oldY
    );

    drawPiPItem(
      ctx,
      pipTransition.to,
      newX,
      newY
    );

    if(raw>=1){
      pipCurrent=pipTransition.to;
      pipTransition=null;
    }
  }else if(pipCurrent){
    ctx.clearRect(0,0,W,H);
    drawPiPItem(
      ctx,
      pipCurrent
    );
  }else{
    ctx.fillStyle="#090909";
    ctx.fillRect(0,0,W,H);
  }
}

function stopPiPRenderLoop(){
  if(pipAnimationFrame){
    cancelAnimationFrame(pipAnimationFrame);
    pipAnimationFrame=null;
  }

  if(pipAnimationTimer){
    clearTimeout(pipAnimationTimer);
    pipAnimationTimer=null;
  }
}

function schedulePiPRender(){
  stopPiPRenderLoop();

  const tick=()=>{
    if(!pipActive)return;

    drawPiPScene();

    const liveAdVideo=
      pipCurrent?.kind==="ad" &&
      pipCurrent?.ad?.type==="video" &&
      pipCurrent?.media &&
      !pipCurrent.media.paused &&
      !pipCurrent.media.ended;

    if(pipTransition || liveAdVideo){
      pipAnimationFrame=requestAnimationFrame(tick);
    }else{
      pipAnimationTimer=setTimeout(tick,500);
    }
  };

  pipAnimationFrame=requestAnimationFrame(tick);
}

async function preparePiPStory(story){
  if(!story)return null;

  const loadedImage=story.image
    ? await getPiPImage(story.image)
    : null;

  const image=
    loadedImage ||
    pipCurrent?.image ||
    null;

  return {
    kind:"story",
    story,
    image
  };
}


async function preparePiPAd(ad){
  if(!ad)return null;

  let media=null;

  if(ad.type==="video"){
    if(
      adVideo &&
      !adVideo.hidden &&
      adVideo.readyState>=2
    ){
      media=adVideo;
    }
  }else{
    if(
      adImage &&
      !adImage.hidden &&
      adImage.complete &&
      adImage.naturalWidth>0
    ){
      media=adImage;
    }

    /*
      Normal reklam görseli henüz DOM nesnesinden alınamıyorsa PiP için
      Worker image proxy üzerinden güvenli bir kopya hazırlamayı dene.
    */
    if(!media && ad.src){
      media=await getPiPImage(ad.src);
    }
  }

  return {
    kind:"ad",
    ad,
    media
  };
}

async function setPiPInitialAd(ad){
  const prepared=await preparePiPAd(ad);
  if(!prepared)return;

  pipCurrent=prepared;
  pipTransition=null;
  drawPiPScene();
}

async function startPiPAdTransition(ad,dir=1){
  if(!pipActive || !ad)return;

  const to=await preparePiPAd(ad);

  if(!pipActive || !to)return;

  let from=pipCurrent;

  if(!from){
    from=await preparePiPStory(
      state.stories[state.index]
    );
  }

  if(!from){
    pipCurrent=to;
    pipTransition=null;
    schedulePiPRender();
    return;
  }

  pipTransition={
    from,
    to,
    vector:pipVector(
      transitionDirection,
      dir
    ),
    startedAt:performance.now()
  };

  schedulePiPRender();
}

async function setPiPInitialStory(story){
  const prepared=await preparePiPStory(story);
  if(!prepared)return;

  pipCurrent=prepared;
  pipTransition=null;
  drawPiPScene();
}

async function startPiPTransition(fromStory,toStory,dir){
  if(!pipActive || !toStory)return;

  const to=await preparePiPStory(toStory);

  if(!pipActive || !to)return;

  let from=pipCurrent;

  /*
    Reklam PiP'te görünüyorsa çıkış geçişinin "from" tarafı reklamın kendisidir.
    Haber -> haber geçişlerinde ise eski doğrulama davranışı korunur.
  */
  if(
    !from ||
    (
      from.kind!=="ad" &&
      mediaKey(from.story)!==mediaKey(fromStory)
    )
  ){
    from=await preparePiPStory(fromStory);
  }

  if(!from){
    pipCurrent=to;
    pipTransition=null;
    schedulePiPRender();
    return;
  }

  pipTransition={
    from,
    to,
    vector:pipVector(
      transitionDirection,
      dir
    ),
    startedAt:performance.now()
  };

  schedulePiPRender();
}

async function ensurePiPVideo(){
  if(!pipCanvas){
    pipCanvas=document.createElement("canvas");
    pipCanvas.width=960;
    pipCanvas.height=540;
  }

  if(pipVideo)return pipVideo;

  pipVideo=document.createElement("video");
  pipVideo.muted=true;
  pipVideo.defaultMuted=true;
  pipVideo.volume=0;
  pipVideo.autoplay=true;
  pipVideo.playsInline=true;
  pipVideo.disablePictureInPicture=false;
  pipVideo.setAttribute("playsinline","");
  pipVideo.setAttribute("webkit-playsinline","");
  pipVideo.setAttribute("aria-hidden","true");
  pipVideo.style.position="fixed";
  pipVideo.style.width="2px";
  pipVideo.style.height="2px";
  pipVideo.style.opacity=".01";
  pipVideo.style.pointerEvents="none";
  pipVideo.style.right="0";
  pipVideo.style.bottom="0";
  pipVideo.style.zIndex="-1";

  document.body.appendChild(pipVideo);

  pipStream=pipCanvas.captureStream(30);
  pipVideo.srcObject=pipStream;

  pipVideo.addEventListener(
    "leavepictureinpicture",
    ()=>{
      pipActive=false;
      stopPiPRenderLoop();
    }
  );

  pipVideo.addEventListener(
    "webkitpresentationmodechanged",
    ()=>{
      const active=
        pipVideo.webkitPresentationMode==="picture-in-picture";

      pipActive=active;

      if(active){
        schedulePiPRender();
      }else{
        stopPiPRenderLoop();
      }
    }
  );

  return pipVideo;
}

async function exitPiP(){
  if(
    document.pictureInPictureElement &&
    typeof document.exitPictureInPicture==="function"
  ){
    await document.exitPictureInPicture();
    return true;
  }

  if(
    pipVideo &&
    pipVideo.webkitPresentationMode==="picture-in-picture" &&
    typeof pipVideo.webkitSetPresentationMode==="function"
  ){
    pipVideo.webkitSetPresentationMode("inline");
    return true;
  }

  return false;
}

async function togglePiP(){
  const mode=pipSupportMode();

  if(mode==="none"){
    status(
      "Bu tarayıcı web sayfasından başlatılan Picture-in-Picture özelliğini desteklemiyor. Tarayıcının kendi video PiP kontrolü varsa onu kullanabilirsiniz."
    );
    return;
  }

  try{
    if(await exitPiP())return;

    const video=await ensurePiPVideo();
    const story=state.stories[state.index];

    if(adActive && adHasEntered && currentAd){
      await setPiPInitialAd(currentAd);
    }else{
      await setPiPInitialStory(story);
    }

    await video.play();

    if(mode==="standard"){
      await video.requestPictureInPicture();
      pipActive=true;
      schedulePiPRender();
      return;
    }

    if(mode==="webkit"){
      video.webkitSetPresentationMode("picture-in-picture");
      pipActive=true;
      schedulePiPRender();
    }
  }catch(err){
    console.error("Video PiP:",err);
    pipActive=false;
    stopPiPRenderLoop();

    status(
      "Picture-in-Picture açılamadı. Tarayıcı bu oturumda PiP isteğine izin vermedi."
    );
  }
}



function isExactIddqdInput(value=""){
  return String(value||"")===IDDQD_CODE;
}

function iddqdStoriesForCategory(category){
  const list=rawStories.filter(story=>
    story &&
    !story.flowForeign &&
    String(story.flowCategory||"")===category
  );

  return orderStoriesForFeed(list,"agenda");
}

function ensureIddqdCells(){
  const grid=document.getElementById("iddqd-grid");
  if(!grid)return [];

  const existing=[...grid.querySelectorAll(".iddqd-cell")];
  if(existing.length===IDDQD_CATEGORIES.length){
    return existing;
  }

  grid.replaceChildren();

  for(const category of IDDQD_CATEGORIES){
    const cell=document.createElement("section");
    cell.className="iddqd-cell";
    cell.dataset.category=category;

    const link=document.createElement("a");
    link.className="iddqd-card";
    link.target="_blank";
    link.rel="noopener noreferrer";
    link.setAttribute("aria-label",`${category} haberini aç`);

    const image=document.createElement("img");
    image.className="iddqd-image";
    image.alt="";
    image.draggable=false;
    image.referrerPolicy="no-referrer";

    const shade=document.createElement("div");
    shade.className="iddqd-shade";
    shade.setAttribute("aria-hidden","true");

    const copy=document.createElement("div");
    copy.className="iddqd-copy";

    const categoryEl=document.createElement("div");
    categoryEl.className="iddqd-category";
    categoryEl.textContent=category;

    const title=document.createElement("h2");
    title.className="iddqd-title";

    const meta=document.createElement("div");
    meta.className="iddqd-meta";

    copy.append(categoryEl,title,meta);
    link.append(image,shade,copy);
    cell.append(link);
    grid.append(cell);
  }

  return [...grid.querySelectorAll(".iddqd-cell")];
}

function setIddqdCellStory(cell,category,story){
  if(!cell)return;

  const link=cell.querySelector(".iddqd-card");
  const image=cell.querySelector(".iddqd-image");
  const title=cell.querySelector(".iddqd-title");
  const meta=cell.querySelector(".iddqd-meta");

  cell.classList.toggle("is-empty",!story);

  if(!story){
    if(link){
      link.removeAttribute("href");
      link.removeAttribute("title");
    }
    if(image){
      image.removeAttribute("src");
      image.style.visibility="hidden";
      image.onerror=null;
    }
    if(title)title.textContent="Bu kategoride gösterilecek haber yok.";
    if(meta)meta.textContent="";
    return;
  }

  if(link){
    if(story.link){
      link.href=story.link;
      link.title="Haberi yeni sekmede aç";
    }else{
      link.removeAttribute("href");
      link.removeAttribute("title");
    }
  }

  if(title)title.textContent=String(story.title||"").trim();

  if(meta){
    const parts=[
      String(story.source||"").trim(),
      timeText(story.published)
    ].filter(Boolean);
    meta.textContent=parts.join(" · ");
  }

  if(image){
    const direct=String(story.image||"").trim();
    const proxy=storyImageProxyUrl(story);
    image.style.visibility=direct||proxy ? "visible" : "hidden";
    image.dataset.fallbackUsed="0";
    image.onerror=()=>{
      if(
        image.dataset.fallbackUsed!=="1" &&
        proxy &&
        image.src!==proxy
      ){
        image.dataset.fallbackUsed="1";
        image.src=proxy;
        return;
      }
      image.style.visibility="hidden";
    };

    if(direct){
      image.src=direct;
    }else if(proxy){
      image.src=proxy;
    }else{
      image.removeAttribute("src");
    }
  }
}

function renderIddqdGrid({advance=false}={}){
  const cells=ensureIddqdCells();
  if(!cells.length)return;

  IDDQD_CATEGORIES.forEach((category,index)=>{
    const stories=iddqdStoriesForCategory(category);

    if(!stories.length){
      iddqdCategoryPositions.set(category,0);
      setIddqdCellStory(cells[index],category,null);
      return;
    }

    const previous=Number(iddqdCategoryPositions.get(category))||0;
    const position=advance
      ? (previous+1)%stories.length
      : Math.min(previous,stories.length-1);

    iddqdCategoryPositions.set(category,position);
    setIddqdCellStory(cells[index],category,stories[position]);
  });
}

function scheduleIddqdRotation(){
  clearTimeout(iddqdRotationTimer);
  iddqdRotationTimer=null;

  if(!iddqdModeActive)return;

  const delay=Math.max(6000,Math.max(5,showDurationSeconds)*1000);
  iddqdRotationTimer=setTimeout(()=>{
    if(!iddqdModeActive)return;
    renderIddqdGrid({advance:true});
    scheduleIddqdRotation();
  },delay);
}

function syncIddqdLogo(){
  const logo=document.getElementById("logo");
  if(!logo)return;

  logo.src=iddqdModeActive
    ? ADHD_MODE_LOGO_SRC
    : DEFAULT_HEADER_LOGO_SRC;

  logo.alt=iddqdModeActive
    ? "ADHD mode"
    : "Flöw";
}

function enterIddqdMode(){
  if(iddqdModeActive)return;

  iddqdModeActive=true;
  iddqdCategoryPositions.clear();

  clearTimeout(state.timer);
  state.timer=null;
  state.timerDeadline=0;
  state.timerRemainingMs=0;

  closeFloraPopover({resume:false});
  closeStatsOverlay();
  closeMenu();
  closeQuickPanels();
  closeControlMenu();

  slides.forEach(slide=>stopSlideMedia(slide));

  const grid=document.getElementById("iddqd-grid");
  grid?.setAttribute("aria-hidden","false");
  document.body.classList.add("iddqd-mode");
  syncIddqdLogo();

  renderIddqdGrid();
  renderKeywordFilterControl();
  scheduleIddqdRotation();
  showFullscreenButton();
}

function exitIddqdMode(){
  if(!iddqdModeActive)return;

  iddqdModeActive=false;
  clearTimeout(iddqdRotationTimer);
  iddqdRotationTimer=null;
  iddqdCategoryPositions.clear();

  const grid=document.getElementById("iddqd-grid");
  grid?.setAttribute("aria-hidden","true");
  document.body.classList.remove("iddqd-mode");
  syncIddqdLogo();

  closeKeywordFilterPanel();
  closeControlMenu();
  renderKeywordFilterControl();

  const story=state.stories[state.index]||null;
  if(story){
    setStoryStageVisible(true);
    fill(slides[state.active],story,{prepareMedia:false});
    slides[state.active].className="slide active";
    activateSlideMedia(slides[state.active],story);
    updateKeywordAlert(story);
    timer();
  }else{
    applyFilters();
  }

  showFullscreenButton();
}

function runTrustedKeywordFilterButtonAction(mode,event){
  const input=document.getElementById("keyword-filter-input");
  const exact=isExactIddqdInput(input?.value||"");

  /*
    The easter egg gate is set only by a real user click on the actual
    Show/Hide buttons. Enter key, synthetic .click(), URL flags, storage and
    direct applyKeywordFilter() calls cannot open or close this mode.
  */
  iddqdTrustedActionGate=
    event?.isTrusted && exact && (mode==="show" || mode==="hide")
      ? mode
      : "";

  try{
    return applyKeywordFilter(mode);
  }finally{
    iddqdTrustedActionGate="";
  }
}

function renderKeywordFilterControl(){
  const input=document.getElementById("keyword-filter-input");
  const show=document.getElementById("keyword-filter-show");
  const hide=document.getElementById("keyword-filter-hide");
  const trigger=document.getElementById("keyword-filter-button");

  if(input && document.activeElement!==input){
    input.value=iddqdModeActive
      ? IDDQD_CODE
      : keywordFilterState.text;
  }

  const normalActive=
    parseKeywordList(keywordFilterState.text).length>0 &&
    keywordFilterState.mode!=="off";

  const active=iddqdModeActive || normalActive;

  show?.classList.toggle(
    "active",
    iddqdModeActive ||
    (normalActive && keywordFilterState.mode==="show")
  );

  hide?.classList.toggle(
    "active",
    !iddqdModeActive &&
    normalActive &&
    keywordFilterState.mode==="hide"
  );

  show?.setAttribute(
    "aria-pressed",
    iddqdModeActive ||
    (normalActive && keywordFilterState.mode==="show")
      ? "true"
      : "false"
  );

  hide?.setAttribute(
    "aria-pressed",
    !iddqdModeActive &&
    normalActive &&
    keywordFilterState.mode==="hide"
      ? "true"
      : "false"
  );

  trigger?.classList.toggle("tool-active",active);

  if(trigger){
    trigger.title=iddqdModeActive
      ? "Anahtar kelime filtresi"
      : normalActive
        ? `Anahtar kelime filtresi: ${keywordFilterState.mode==="show"?"Göster":"Gizle"}`
        : "Anahtar kelime filtresi";
    trigger.setAttribute("aria-label",trigger.title);
  }
}

function applyKeywordFilter(mode){
  const input=document.getElementById("keyword-filter-input");
  const rawText=String(input?.value||"");
  const exactIddqd=isExactIddqdInput(rawText);

  if(iddqdModeActive){
    if(
      exactIddqd &&
      mode==="hide" &&
      iddqdTrustedActionGate==="hide"
    ){
      exitIddqdMode();
      return "iddqd-exit";
    }

    /* While active, no other filter action can alter or exit the mode. */
    renderKeywordFilterControl();
    return "iddqd-locked";
  }

  if(exactIddqd){
    if(
      mode==="show" &&
      iddqdTrustedActionGate==="show"
    ){
      enterIddqdMode();
      return "iddqd-enter";
    }

    /* IDDQD is never treated as an ordinary show/hide keyword filter. */
    renderKeywordFilterControl();
    return "iddqd-denied";
  }

  const text=rawText.trim();
  const keywords=parseKeywordList(text);

  keywordFilterState={
    text,
    mode:
      keywords.length &&
      (mode==="show" || mode==="hide")
        ? mode
        : "off"
  };

  saveKeywordFilterState();
  renderKeywordFilterControl();
  closeKeywordFilterPanel();
  applyFilters();
  showFullscreenButton();
  return "filter-applied";
}

function clearKeywordFilter(){
  const input=document.getElementById("keyword-filter-input");

  if(iddqdModeActive){
    if(input)input.value="";
    setTimeout(()=>{
      document.getElementById("keyword-filter-input")?.focus();
    },0);
    return "iddqd-locked";
  }

  if(input)input.value="";

  keywordFilterState={
    text:"",
    mode:"off"
  };

  saveKeywordFilterState();
  renderKeywordFilterControl();
  applyFilters();
  showFullscreenButton();

  setTimeout(()=>{
    document.getElementById("keyword-filter-input")?.focus();
  },0);
  return "filter-cleared";
}

function renderKeywordWatchControl(){
  const input=document.getElementById("keyword-watch-input");
  const apply=document.getElementById("keyword-watch-apply");
  const trigger=document.getElementById("keyword-watch-button");
  const active=currentKeywordWatchKeywords().length>0;

  if(input && document.activeElement!==input){
    input.value=keywordWatchText;
  }

  apply?.classList.toggle("active",active);
  apply?.setAttribute(
    "aria-pressed",
    active?"true":"false"
  );

  trigger?.classList.toggle("tool-active",active);
  if(trigger){
    trigger.title=active
      ? "Anahtar kelime takibi açık"
      : "Anahtar kelime takibi";
    trigger.setAttribute("aria-label",trigger.title);
  }
}

function applyKeywordWatch(){
  const input=document.getElementById("keyword-watch-input");
  keywordWatchText=String(input?.value||"").trim();

  saveKeywordWatchText();
  renderKeywordWatchControl();
  closeKeywordWatchPanel();

  updateKeywordAlert(
    state.stories[state.index]||null
  );

  showFullscreenButton();
}

function clearKeywordWatch(){
  const input=document.getElementById("keyword-watch-input");
  if(input)input.value="";

  keywordWatchText="";
  saveKeywordWatchText();
  renderKeywordWatchControl();

  updateKeywordAlert(
    state.stories[state.index]||null
  );

  showFullscreenButton();

  setTimeout(()=>{
    document.getElementById("keyword-watch-input")?.focus();
  },0);
}

function renderTimeRangeControl(){
  const option=currentTimeRangeOption();
  const order=currentFeedOrderOption();
  const current=document.getElementById("time-range-current");
  const trigger=document.getElementById("time-range-button");

  if(current)current.textContent=`${order.label} · ${option.label}`;

  if(trigger){
    trigger.title=`Akış: ${order.label} · ${option.label}`;
    trigger.setAttribute("aria-label",trigger.title);
  }

  document.querySelectorAll(".time-range-option").forEach(button=>{
    const active=button.dataset.hours===option.value;
    button.classList.toggle("active",active);
    button.setAttribute("aria-pressed",active?"true":"false");
  });

  document.querySelectorAll(".feed-order-option").forEach(button=>{
    const active=button.dataset.orderMode===feedOrderMode;
    button.classList.toggle("active",active);
    button.setAttribute("aria-pressed",active?"true":"false");
  });
}

function setFeedOrderMode(value){
  const next=normalizeFeedOrderMode(value);
  if(next===feedOrderMode)return;

  feedOrderMode=next;
  saveFeedOrderMode();
  renderTimeRangeControl();

  /* Mod değişince kullanıcı seçiminin sonucu net görülsün: yeni listenin başı. */
  filterReturnStoryKey="";
  applyFilters({resetToStart:true});
}

function setTimeRange(value){
  const next=normalizeTimeRangeValue(value);
  if(next===timeRangeValue)return;

  timeRangeValue=next;
  saveTimeRange();
  renderTimeRangeControl();

  /*
    Kaynak/kategori filtrelerinde olduğu gibi applyFilters kullanılır.
    Böylece dar bir zaman aralığı yüzünden kaybolan mevcut haber, aralık
    yeniden genişletildiğinde kullanıcı başka habere geçmediyse geri gelir.
  */
  applyFilters();
}

function renderCustomRssList(){
  const list=document.getElementById("custom-rss-list");
  if(!list)return;

  list.replaceChildren();

  if(!customRssFeeds.length){
    const empty=document.createElement("div");
    empty.className="custom-rss-empty";
    empty.textContent="Henüz özel RSS kaynağı eklenmedi.";
    list.appendChild(empty);
    return;
  }

  customRssFeeds.forEach((feed,index)=>{
    const row=document.createElement("div");
    row.className="custom-rss-row";

    const text=document.createElement("div");
    text.className="custom-rss-url";
    text.textContent=feed.url;
    text.title=feed.url;

    const remove=document.createElement("button");
    remove.type="button";
    remove.className="custom-rss-remove";
    remove.dataset.customRssRemove=String(index);
    remove.setAttribute("aria-label","RSS kaynağını kaldır");
    remove.title="RSS kaynağını kaldır";
    remove.textContent="×";

    row.append(text,remove);
    list.appendChild(row);
  });
}

function setCustomRssFeedback(message="",isError=false){
  const feedback=document.getElementById("custom-rss-feedback");
  if(!feedback)return;

  feedback.textContent=message;
  feedback.classList.toggle("error",Boolean(isError));
  feedback.hidden=!message;
}

async function reloadAfterCustomRssChange(){
  if(newsLoadInFlight){
    try{await newsLoadInFlight}catch(e){}
  }

  sourcePreferencesApplied=false;
  await load();
}

function telemetryCustomRssAddFailed(reason){
  telemetryQueueEvent("custom_rss_add_failed",{
    story:null,
    mode:String(reason||"unknown"),
    value_num:customRssFeeds.length,
    meta:{feed_count:customRssFeeds.length}
  });
}

function renderNearDuplicateSetting(){
  const button=document.getElementById("near-duplicate-setting");
  const stateEl=button?.querySelector(".media-setting-state");
  if(!button)return;

  button.classList.toggle("active",nearDuplicateDedupEnabled);
  button.setAttribute("aria-pressed",nearDuplicateDedupEnabled?"true":"false");
  if(stateEl)stateEl.textContent=nearDuplicateDedupEnabled?"Açık":"Kapalı";
}

function setNearDuplicateDedupEnabled(value){
  const next=Boolean(value);
  if(next===nearDuplicateDedupEnabled)return;

  nearDuplicateDedupEnabled=next;
  saveNearDuplicateDedupPreference();
  renderNearDuplicateSetting();

  /* Daha önce planlanan preload eski seçim kuralına ait olabilir. */
  plannedForwardStory=null;
  scheduleNextStoryPreload();
}

async function addCustomRssFromInput(){
  const input=document.getElementById("custom-rss-input");
  const addButton=document.getElementById("custom-rss-add");
  if(!input)return;

  const url=normalizeCustomRssUrl(input.value);

  if(!url){
    setCustomRssFeedback("Geçerli bir http/https RSS adresi girin.",true);
    telemetryCustomRssAddFailed("invalid_url");
    return;
  }

  if(customRssFeeds.some(feed=>feed.url===url)){
    setCustomRssFeedback("Bu RSS kaynağı zaten ekli.",true);
    telemetryCustomRssAddFailed("duplicate");
    return;
  }

  if(customRssFeeds.length>=CUSTOM_RSS_MAX_FEEDS){
    setCustomRssFeedback(`En fazla ${CUSTOM_RSS_MAX_FEEDS} özel RSS kaynağı eklenebilir.`,true);
    telemetryCustomRssAddFailed("limit");
    return;
  }

  input.disabled=true;
  if(addButton)addButton.disabled=true;
  setCustomRssFeedback("RSS kontrol ediliyor…");

  try{
    const preview=await fetchCustomRssFeed({url});

    if(!preview.length){
      setCustomRssFeedback("RSS okundu ancak kullanılabilir haber bulunamadı.",true);
      telemetryCustomRssAddFailed("no_items");
      return;
    }

    customRssFeeds.push({url});

    if(!saveCustomRssFeeds()){
      customRssFeeds.pop();
      setCustomRssFeedback("Özel RSS listesi tarayıcıya kaydedilemedi.",true);
      telemetryCustomRssAddFailed("storage_error");
      return;
    }

    input.value="";
    renderCustomRssList();
    setCustomRssFeedback(`RSS kaynağı eklendi · ${preview.length} haber bulundu.`);
    telemetryQueueEvent("custom_rss_add",{
      story:null,
      mode:"success",
      value_num:customRssFeeds.length,
      meta:{feed_count:customRssFeeds.length,item_count:preview.length}
    });

    await reloadAfterCustomRssChange();
  }catch(error){
    console.warn("Custom RSS validation:",url,error);
    setCustomRssFeedback(
      customRssErrorMessage(error),
      true
    );
    telemetryCustomRssAddFailed(String(error?.code||"fetch_error"));
  }finally{
    input.disabled=false;
    if(addButton)addButton.disabled=false;
  }
}

const PREFERENCE_TRANSFER_FORMAT="thefloew-preferences";
const PREFERENCE_TRANSFER_VERSION=1;

function preferenceTransferKeys(){
  return [
    PREFS_KEY,
    FOREIGN_SOURCE_PREFS_KEY,
    SHOW_SECONDS_KEY,
    TIME_RANGE_KEY,
    FEED_ORDER_KEY,
    KEYWORD_FILTER_KEY,
    KEYWORD_WATCH_KEY,
    WEATHER_PREFS_KEY,
    CUSTOM_RSS_STORAGE_KEY,
    NEAR_DUPLICATE_PREF_KEY,
    FX_RATES_VISIBLE_KEY,
    STOCK_TICKER_VISIBLE_KEY,
    STOCK_TICKER_SCALE_KEY
  ];
}

function setPreferenceTransferFeedback(message="",isError=false){
  const el=document.getElementById("preference-transfer-feedback");
  if(!el)return;
  el.textContent=message;
  el.dataset.state=isError?"error":"ok";
  el.hidden=!message;
}

function exportPreferences(){
  try{
    /* En güncel source/category durumu dosyaya girmeden hemen önce yazılsın. */
    savePreferences();
    saveForeignSourcePreferences();
    saveCustomRssFeeds();

    const settings={};
    for(const key of preferenceTransferKeys()){
      const value=localStorage.getItem(key);
      if(value!==null)settings[key]=value;
    }

    const payload={
      format:PREFERENCE_TRANSFER_FORMAT,
      version:PREFERENCE_TRANSFER_VERSION,
      exportedAt:new Date().toISOString(),
      appVersion:window.__floewAppVersion||"",
      settings
    };

    const blob=new Blob(
      [JSON.stringify(payload,null,2)],
      {type:"application/json;charset=utf-8"}
    );
    const url=URL.createObjectURL(blob);
    const a=document.createElement("a");
    a.href=url;
    a.download=`floew-tercihler-${new Date().toISOString().slice(0,10)}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(()=>URL.revokeObjectURL(url),600);
    setPreferenceTransferFeedback("Tercihler dosyası hazırlandı.");
  }catch(error){
    console.warn("Preference export:",error);
    setPreferenceTransferFeedback("Tercihler dışa aktarılamadı.",true);
  }
}

async function importPreferencesFile(file){
  if(!file)return;

  try{
    const text=await file.text();
    const payload=JSON.parse(text);

    if(
      payload?.format!==PREFERENCE_TRANSFER_FORMAT ||
      Number(payload?.version)!==PREFERENCE_TRANSFER_VERSION ||
      !payload?.settings ||
      typeof payload.settings!=="object" ||
      Array.isArray(payload.settings)
    ){
      throw new Error("invalid_format");
    }

    const allowed=new Set(preferenceTransferKeys());

    /* İçe aktarma, tercih kümesini dosyadaki haline birebir taşır. */
    for(const key of allowed){
      if(Object.prototype.hasOwnProperty.call(payload.settings,key)){
        const value=payload.settings[key];
        if(typeof value!=="string")throw new Error("invalid_value");
        localStorage.setItem(key,value);
      }else{
        localStorage.removeItem(key);
      }
    }

    setPreferenceTransferFeedback("Tercihler içe aktarıldı. Flöw yeniden yükleniyor…");
    setTimeout(()=>location.reload(),650);
  }catch(error){
    console.warn("Preference import:",error);
    setPreferenceTransferFeedback("Bu dosya geçerli bir Flöw tercih dosyası değil.",true);
  }
}

function bindEnhancementUi(){
  renderCustomRssList();
  renderNearDuplicateSetting();

  document.getElementById("duration-play")?.addEventListener("click",e=>{
    e.stopPropagation();
    setAutoAdvancePaused(false);
  });

  document.getElementById("duration-pause")?.addEventListener("click",e=>{
    e.stopPropagation();
    setAutoAdvancePaused(true);
  });

  document.getElementById("near-duplicate-setting")?.addEventListener("click",e=>{
    e.stopPropagation();
    setNearDuplicateDedupEnabled(!nearDuplicateDedupEnabled);
  });

  document.getElementById("fx-rates-setting")?.addEventListener("click",e=>{
    e.stopPropagation();
    setFxRatesVisible(!fxRatesVisible);
    telemetryQueueEvent("fx_rates_toggle",{story:null,mode:fxRatesVisible?"on":"off"});
  });

  document.getElementById("stock-ticker-setting")?.addEventListener("click",e=>{
    e.stopPropagation();
    setStockTickerVisible(!stockTickerVisible);
    telemetryQueueEvent("stock_ticker_toggle",{story:null,mode:stockTickerVisible?"on":"off"});
  });

  document.getElementById("stock-ticker-size-minus")?.addEventListener("click",e=>{
    e.stopPropagation();
    setStockTickerScale(stockTickerScale-STOCK_TICKER_SCALE_STEP);
  });

  document.getElementById("stock-ticker-size-plus")?.addEventListener("click",e=>{
    e.stopPropagation();
    setStockTickerScale(stockTickerScale+STOCK_TICKER_SCALE_STEP);
  });

  document.getElementById("preferences-export")?.addEventListener("click",e=>{
    e.stopPropagation();
    exportPreferences();
  });

  document.getElementById("preferences-import")?.addEventListener("click",e=>{
    e.stopPropagation();
    document.getElementById("preferences-import-file")?.click();
  });

  document.getElementById("preferences-import-file")?.addEventListener("change",e=>{
    e.stopPropagation();
    const file=e.target.files?.[0]||null;
    e.target.value="";
    importPreferencesFile(file);
  });

  document.getElementById("custom-rss-add")?.addEventListener("click",e=>{
    e.stopPropagation();
    addCustomRssFromInput();
  });

  document.getElementById("custom-rss-input")?.addEventListener("keydown",e=>{
    e.stopPropagation();
    if(e.key==="Enter"){
      e.preventDefault();
      addCustomRssFromInput();
    }
  });

  document.getElementById("custom-rss-list")?.addEventListener("click",async e=>{
    const button=e.target.closest?.("[data-custom-rss-remove]");
    if(!button)return;

    e.stopPropagation();
    const index=Number(button.dataset.customRssRemove);
    if(!Number.isInteger(index) || !customRssFeeds[index])return;

    customRssFeeds.splice(index,1);
    saveCustomRssFeeds();
    renderCustomRssList();
    setCustomRssFeedback("RSS kaynağı kaldırıldı.");
    telemetryQueueEvent("custom_rss_remove",{
      story:null,
      mode:"remove",
      value_num:customRssFeeds.length,
      meta:{feed_count:customRssFeeds.length}
    });
    await reloadAfterCustomRssChange();
  });
}

bindEnhancementUi();

function renderAutoAdvanceSetting(){
  const play=document.getElementById("duration-play");
  const pause=document.getElementById("duration-pause");

  if(play){
    play.classList.toggle("active",!autoAdvancePaused);
    play.setAttribute("aria-pressed",autoAdvancePaused?"false":"true");
  }

  if(pause){
    pause.classList.toggle("active",autoAdvancePaused);
    pause.setAttribute("aria-pressed",autoAdvancePaused?"true":"false");
  }
}

function setAutoAdvancePaused(paused){
  autoAdvancePaused=Boolean(paused);
  clearTimeout(state.timer);
  state.timer=null;
  state.timerDeadline=0;
  state.timerRemainingMs=0;
  renderAutoAdvanceSetting();

  if(!autoAdvancePaused && state.stories.length){
    timer();
  }
}


function renderDurationSetting(){
  const value=document.getElementById("duration-value");
  const minus=document.getElementById("duration-minus");
  const plus=document.getElementById("duration-plus");

  if(value)value.textContent=`${showDurationSeconds} sn`;
  if(minus)minus.disabled=showDurationSeconds<=5;
  if(plus)plus.disabled=showDurationSeconds>=60;
  renderAutoAdvanceSetting();
}

function setShowDuration(value){
  const next=Math.min(
    60,
    Math.max(5,Math.round(Number(value)||DEFAULT_SHOW_SECONDS))
  );

  if(next===showDurationSeconds)return;

  showDurationSeconds=next;
  saveShowDuration();
  renderDurationSetting();

  if(state.stories.length){
    timer();
  }
}

document.getElementById("duration-minus")?.addEventListener("click",e=>{
  e.stopPropagation();
  setShowDuration(showDurationSeconds-1);
});

document.getElementById("duration-plus")?.addEventListener("click",e=>{
  e.stopPropagation();
  setShowDuration(showDurationSeconds+1);
});

renderDurationSetting();
renderTimeRangeControl();
renderKeywordFilterControl();
syncIddqdLogo();
renderKeywordWatchControl();
renderFeedMode();

document.getElementById("keyword-filter-clear")?.addEventListener("click",e=>{
  e.stopPropagation();
  clearKeywordFilter();
});

document.getElementById("keyword-filter-show")?.addEventListener("click",e=>{
  e.stopPropagation();
  runTrustedKeywordFilterButtonAction("show",e);
});

document.getElementById("keyword-filter-hide")?.addEventListener("click",e=>{
  e.stopPropagation();
  runTrustedKeywordFilterButtonAction("hide",e);
});

document.getElementById("keyword-filter-input")?.addEventListener("keydown",e=>{
  e.stopPropagation();

  if(e.key==="Enter"){
    e.preventDefault();

    /* IDDQD only responds to the physical Show/Hide buttons. */
    if(isExactIddqdInput(e.currentTarget?.value||""))return;

    applyKeywordFilter(
      keywordFilterState.mode==="hide"
        ? "hide"
        : "show"
    );
  }
});

document.getElementById("keyword-watch-clear")?.addEventListener("click",e=>{
  e.stopPropagation();
  clearKeywordWatch();
});

document.getElementById("keyword-watch-apply")?.addEventListener("click",e=>{
  e.stopPropagation();
  applyKeywordWatch();
});

document.getElementById("keyword-watch-input")?.addEventListener("keydown",e=>{
  e.stopPropagation();

  if(e.key==="Enter"){
    e.preventDefault();
    applyKeywordWatch();
  }
});

document.querySelectorAll(".feed-tab").forEach(bindFeedTabButton);

document.querySelectorAll(".feed-order-option").forEach(button=>{
  button.addEventListener("pointerdown",e=>e.stopPropagation());
  button.addEventListener("pointerup",e=>e.stopPropagation());
  button.addEventListener("click",e=>{
    e.stopPropagation();
    setFeedOrderMode(button.dataset.orderMode||"algorithmic");
  });
});

document.querySelectorAll(".time-range-option").forEach(button=>{
  button.addEventListener("pointerdown",e=>e.stopPropagation());
  button.addEventListener("pointerup",e=>e.stopPropagation());
  button.addEventListener("click",e=>{
    e.stopPropagation();
    setTimeRange(button.dataset.hours||"all");
  });
});


function hideCookieNotice(){
  const notice=document.getElementById("cookie-notice");
  if(notice)notice.hidden=true;
}

function updateAnalyticsConsentNotice(){
  const notice=document.getElementById("cookie-notice");
  if(!notice)return;

  let acceptedLocally=false;
  try{
    acceptedLocally=
      localStorage.getItem(COOKIE_NOTICE_KEY)==="accepted";
  }catch(e){}

  if(ga4CollectionEnabled){
    /*
      "denied" analitik tercihi korunur, ancak Reddet seçimi banner'ı
      sonraki site girişlerinde kalıcı olarak kapatmaz.
    */
    if(getGa4Consent()==="granted"){
      notice.hidden=true;
      return;
    }
  }else if(acceptedLocally){
    notice.hidden=true;
    return;
  }

  notice.dataset.mode="consent";
  notice.hidden=false;
}

function showCookieNoticeIfNeeded(){
  updateAnalyticsConsentNotice();
}

function rememberCookieAcceptance(){
  try{
    localStorage.setItem(
      COOKIE_NOTICE_KEY,
      "accepted"
    );
  }catch(e){}
}

function forgetCookieAcceptance(){
  try{
    localStorage.removeItem(COOKIE_NOTICE_KEY);
  }catch(e){}
}

document.getElementById("cookie-close")?.addEventListener("pointerdown",e=>e.stopPropagation());
document.getElementById("cookie-close")?.addEventListener("pointerup",e=>e.stopPropagation());
document.getElementById("cookie-close")?.addEventListener("click",e=>{
  e.stopPropagation();
  forgetCookieAcceptance();
  if(ga4CollectionEnabled)setGa4Consent("denied");
  hideCookieNotice();
});

document.getElementById("cookie-reject")?.addEventListener("pointerdown",e=>e.stopPropagation());
document.getElementById("cookie-reject")?.addEventListener("pointerup",e=>e.stopPropagation());
document.getElementById("cookie-reject")?.addEventListener("click",e=>{
  e.stopPropagation();
  forgetCookieAcceptance();
  if(ga4CollectionEnabled)setGa4Consent("denied");
  hideCookieNotice();
});

document.getElementById("cookie-accept")?.addEventListener("pointerdown",e=>e.stopPropagation());
document.getElementById("cookie-accept")?.addEventListener("pointerup",e=>e.stopPropagation());
document.getElementById("cookie-accept")?.addEventListener("click",e=>{
  e.stopPropagation();
  rememberCookieAcceptance();
  if(ga4CollectionEnabled)setGa4Consent("granted");
  hideCookieNotice();
});


const WEATHER_GEOCODING_API="https://geocoding-api.open-meteo.com/v1/search";
const WEATHER_FORECAST_API="https://api.open-meteo.com/v1/forecast";
const WEATHER_REFRESH_MS=15*60*1000;
let weatherRefreshTimer=null;
let weatherInitialized=false;

function weatherSymbol(code,isDay=true){
  const c=Number(code);

  /*
    U+FE0E (text presentation selector) keeps weather symbols monochrome/text
    on mobile platforms which would otherwise substitute colored emoji.
  */
  if(c===0)return isDay?"☀︎":"☾︎";
  if(c===1||c===2)return isDay?"◐︎":"☁︎";
  if(c===3)return "☁︎";
  if(c===45||c===48)return "≋";
  if([51,53,55,56,57].includes(c))return "☂︎";
  if([61,63,65,66,67,80,81,82].includes(c))return "☂︎";
  if([71,73,75,77,85,86].includes(c))return "❄︎";
  if([95,96,99].includes(c))return "⚡︎";
  return "◌︎";
}

function weatherCityAbbreviation(value){
  const raw=String(value||"")
    .trim()
    .split(",")[0]
    .trim();

  if(!raw)return "";

  const compact=raw.replace(/\s+/g,"");
  return Array
    .from(compact.toLocaleUpperCase("tr-TR"))
    .slice(0,3)
    .join("");
}

function renderWeatherCityLabel(){
  const city=document.getElementById("weather-city-label");
  if(!city)return;

  const fullLabel=
    weatherPreferences.label||
    weatherPreferences.city||
    "";

  const cityName=
    weatherPreferences.city||
    fullLabel;

  const mobile=window.matchMedia?.("(max-width:700px)")?.matches;

  city.textContent=
    mobile
      ? weatherCityAbbreviation(cityName)
      : fullLabel;

  city.title=fullLabel;
}

function renderWeatherUnitOptions(){
  document.querySelectorAll(".weather-unit-option").forEach(btn=>{
    const active=btn.dataset.unit===weatherPreferences.unit;
    btn.classList.toggle("active",active);
    btn.setAttribute("aria-pressed",active?"true":"false");
  });
}

function renderWeatherInput(){
  const input=document.getElementById("weather-city");
  if(input)input.value=weatherPreferences.city||"İstanbul";
  renderWeatherUnitOptions();
}

function setWeatherFeedback(message="",stateName=""){
  const el=document.getElementById("weather-feedback");
  if(!el)return;
  el.textContent=message;
  el.dataset.state=stateName;
}

async function geocodeWeatherCity(city){
  const q=String(city||"").trim();
  if(!q)throw new Error("Şehir adı girin.");

  const controller=new AbortController();
  const timeout=setTimeout(()=>controller.abort(),8000);

  try{
    const url=
      `${WEATHER_GEOCODING_API}?name=${encodeURIComponent(q)}&count=5&language=tr&format=json`;

    const response=await fetch(url,{
      method:"GET",
      mode:"cors",
      credentials:"omit",
      cache:"default",
      signal:controller.signal,
      headers:{"Accept":"application/json"}
    });

    if(!response.ok){
      throw new Error(`Konum HTTP ${response.status}`);
    }

    const data=await response.json();
    const results=Array.isArray(data?.results)
      ? data.results.filter(item=>
          Number.isFinite(Number(item.latitude)) &&
          Number.isFinite(Number(item.longitude))
        )
      : [];

    if(!results.length){
      throw new Error("Şehir bulunamadı.");
    }

    results.sort(
      (a,b)=>(Number(b.population)||0)-(Number(a.population)||0)
    );

    const place=results[0];

    return {
      city:String(place.name||q),
      label:[
        place.name,
        place.admin1 && place.admin1!==place.name
          ? place.admin1
          : ""
      ].filter(Boolean).join(", ") || String(place.name||q),
      lat:Number(place.latitude),
      lon:Number(place.longitude)
    };
  }finally{
    clearTimeout(timeout);
  }
}

async function ensureWeatherCoordinates(){
  if(
    Number.isFinite(weatherPreferences.lat) &&
    Number.isFinite(weatherPreferences.lon)
  ){
    return;
  }

  const place=await geocodeWeatherCity(
    weatherPreferences.city||"İstanbul"
  );

  weatherPreferences={
    ...weatherPreferences,
    ...place
  };

  saveWeatherPreferences();
  renderWeatherInput();
}

async function fetchCurrentWeather(){
  try{
    await ensureWeatherCoordinates();

    const controller=new AbortController();
    const timeout=setTimeout(()=>controller.abort(),8000);

    try{
      const params=new URLSearchParams({
        latitude:String(weatherPreferences.lat),
        longitude:String(weatherPreferences.lon),
        current:"temperature_2m,weather_code,is_day",
        temperature_unit:weatherPreferences.unit,
        timezone:"auto"
      });

      const response=await fetch(
        `${WEATHER_FORECAST_API}?${params.toString()}`,
        {
          method:"GET",
          mode:"cors",
          credentials:"omit",
          cache:"no-store",
          signal:controller.signal,
          headers:{"Accept":"application/json"}
        }
      );

      if(!response.ok){
        throw new Error(`Hava HTTP ${response.status}`);
      }

      const data=await response.json();
      const current=data?.current;

      if(
        !current ||
        !Number.isFinite(Number(current.temperature_2m))
      ){
        throw new Error("Hava durumu alınamadı.");
      }

      const box=document.getElementById("weather-current");
      const icon=document.getElementById("weather-icon");
      const temp=document.getElementById("weather-temp");
      const city=document.getElementById("weather-city-label");

      if(icon){
        icon.textContent=weatherSymbol(
          current.weather_code,
          Number(current.is_day)!==0
        );
      }

      if(temp){
        const unit=weatherPreferences.unit==="fahrenheit"
          ? "°F"
          : "°C";

        temp.textContent=
          `${Math.round(Number(current.temperature_2m))}${unit}`;
      }

      if(city){
        renderWeatherCityLabel();
      }

      if(box)box.hidden=false;

      setWeatherFeedback(
        `${weatherPreferences.label||weatherPreferences.city} için hava durumu güncellendi.`,
        "ok"
      );
    }finally{
      clearTimeout(timeout);
    }
  }catch(err){
    console.warn("Weather:",err);

    setWeatherFeedback(
      err?.name==="AbortError"
        ? "Hava durumu isteği zaman aşımına uğradı."
        : (err?.message||"Hava durumu alınamadı."),
      "error"
    );
  }
}

async function applyWeatherCity(){
  const input=document.getElementById("weather-city");
  const query=String(input?.value||"").trim();

  if(!query){
    setWeatherFeedback("Şehir adı girin.","error");
    return;
  }

  setWeatherFeedback("Şehir aranıyor...","loading");

  try{
    const place=await geocodeWeatherCity(query);

    weatherPreferences={
      ...weatherPreferences,
      ...place
    };

    saveWeatherPreferences();
    renderWeatherInput();
    await fetchCurrentWeather();
  }catch(err){
    console.warn("Weather city:",err);

    setWeatherFeedback(
      err?.name==="AbortError"
        ? "Şehir araması zaman aşımına uğradı."
        : (err?.message||"Şehir bulunamadı."),
      "error"
    );
  }
}

function initWeather(){
  if(weatherInitialized)return;
  weatherInitialized=true;

  renderWeatherInput();

  document.getElementById("weather-apply")?.addEventListener("click",e=>{
    e.stopPropagation();
    applyWeatherCity();
  });

  const weatherMobileMedia=window.matchMedia?.("(max-width:700px)");
  if(weatherMobileMedia){
    const refreshWeatherCityLabel=()=>renderWeatherCityLabel();

    if(typeof weatherMobileMedia.addEventListener==="function"){
      weatherMobileMedia.addEventListener("change",refreshWeatherCityLabel);
    }else if(typeof weatherMobileMedia.addListener==="function"){
      weatherMobileMedia.addListener(refreshWeatherCityLabel);
    }
  }

  document.getElementById("weather-city")?.addEventListener("keydown",e=>{
    if(e.key==="Enter"){
      e.preventDefault();
      e.stopPropagation();
      applyWeatherCity();
    }
  });

  document.querySelectorAll(".weather-unit-option").forEach(btn=>{
    btn.addEventListener("click",async e=>{
      e.stopPropagation();

      const unit=btn.dataset.unit==="fahrenheit"
        ? "fahrenheit"
        : "celsius";

      if(unit===weatherPreferences.unit)return;

      weatherPreferences.unit=unit;
      saveWeatherPreferences();
      renderWeatherUnitOptions();
      await fetchCurrentWeather();
    });
  });

  fetchCurrentWeather();

  if(weatherRefreshTimer){
    clearInterval(weatherRefreshTimer);
  }

  weatherRefreshTimer=setInterval(
    fetchCurrentWeather,
    WEATHER_REFRESH_MS
  );
}

/*
  Çerez ve hava durumu başlangıç haber yüklemesinden tamamen ayrıdır.
  Böylece harici hava servisi yavaşlasa veya hata verse bile haber yükleme
  akışını etkileyemez.
*/
window.addEventListener("floew:ready",()=>{
  showCookieNoticeIfNeeded();
  initWeather();
},{once:true});

function renderDirectionOptions(){
  document.querySelectorAll(".direction-option").forEach(btn=>{
    const active=btn.dataset.direction===transitionDirection;
    btn.classList.toggle("active",active);
    btn.setAttribute("aria-pressed",active?"true":"false");
  });
}

document.querySelectorAll(".direction-option").forEach(btn=>{
  btn.addEventListener("click",e=>{
    e.stopPropagation();
    transitionDirection=btn.dataset.direction||"up";
    savePreferences();
    renderDirectionOptions();
  });
});

renderDirectionOptions();
renderVideoSetting();
renderVideoOnlySetting();

document.getElementById("video-setting")?.addEventListener("click",e=>{
  e.stopPropagation();
  videoEnabled=!videoEnabled;
  savePreferences();
  applyVideoSetting();
});

document.getElementById("video-only-setting")?.addEventListener("click",e=>{
  e.stopPropagation();
  videoOnlyEnabled=!videoOnlyEnabled;
  savePreferences();
  applyVideoOnlySetting();
});

const PUBLIC_STATS_API=`${ANALYTICS_WORKER_BASE}/stats/public`;
let publicStatsRange="7d";
let controlMenuOpen=false;
let aboutActiveTab="stats";
const aboutDocumentCache=new Map();
const ABOUT_LEGAL_DOCS={
  terms:{title:"Kullanım koşulları",path:"docs/KULLANIM.txt"},
  privacy:{title:"Gizlilik",path:"docs/GIZLILIK.txt"},
  cookies:{title:"Çerezler",path:"docs/CEREZLER.txt"}
};

function appendStructuredAboutInlineText(target,text){
  const source=String(text??"");
  const italicPattern=/\*([^*\n]+)\*/g;
  let lastIndex=0;
  let match;

  while((match=italicPattern.exec(source))){
    if(match.index>lastIndex){
      target.appendChild(document.createTextNode(source.slice(lastIndex,match.index)));
    }
    const emphasis=document.createElement("em");
    emphasis.className="about-doc-emphasis";
    emphasis.textContent=match[1];
    target.appendChild(emphasis);
    lastIndex=italicPattern.lastIndex;
  }

  if(lastIndex<source.length){
    target.appendChild(document.createTextNode(source.slice(lastIndex)));
  }
}

function renderStructuredAboutDocumentText(target,text){
  if(!target)return;
  target.replaceChildren();

  const clean=String(text||"").replace(/\r\n?/g,"\n").trim();
  if(!clean){
    target.textContent="Bu belge şu anda boş.";
    return;
  }

  const fragment=document.createDocumentFragment();

  for(const rawLine of clean.split("\n")){
    const line=rawLine.trim();

    if(!line){
      const spacer=document.createElement("div");
      spacer.className="about-doc-spacer";
      fragment.appendChild(spacer);
      continue;
    }

    if(/^#(?!#)/.test(line)){
      const heading=document.createElement("h2");
      heading.className="about-doc-heading";
      appendStructuredAboutInlineText(heading,line.replace(/^#\s*/,""));
      fragment.appendChild(heading);
      continue;
    }

    if(/^##+/.test(line)){
      const strong=document.createElement("div");
      strong.className="about-doc-strong";
      appendStructuredAboutInlineText(strong,line.replace(/^##+\s*/,""));
      fragment.appendChild(strong);
      continue;
    }

    const paragraph=document.createElement("div");
    paragraph.className="about-doc-line";
    appendStructuredAboutInlineText(paragraph,rawLine.trimEnd());
    fragment.appendChild(paragraph);
  }

  target.appendChild(fragment);
}

function appendFaqAnswerLine(parent,rawLine){
  const line=String(rawLine||"").trim();

  if(!line){
    const spacer=document.createElement("div");
    spacer.className="about-doc-spacer";
    parent.appendChild(spacer);
    return;
  }

  if(/^#(?!#)/.test(line)){
    const strong=document.createElement("div");
    strong.className="about-doc-strong";
    strong.textContent=line.replace(/^#\s*/,"");
    parent.appendChild(strong);
    return;
  }

  const paragraph=document.createElement("div");
  paragraph.className="about-doc-line";
  paragraph.textContent=String(rawLine||"").trimEnd();
  parent.appendChild(paragraph);
}

function setFaqAccordionOpen(item,open){
  const button=item?.querySelector(".faq-accordion-button");
  const panel=item?.querySelector(".faq-accordion-panel");
  if(!button || !panel)return;

  const next=Boolean(open);
  item.classList.toggle("open",next);
  button.setAttribute("aria-expanded",next?"true":"false");
  panel.setAttribute("aria-hidden",next?"false":"true");

  const chevron=item.querySelector(".faq-accordion-chevron");
  if(chevron)chevron.textContent=next?"▲":"▼";

  if(next){
    panel.style.maxHeight=`${Math.max(1,panel.scrollHeight)}px`;
    panel.style.opacity="1";
  }else{
    panel.style.maxHeight="0px";
    panel.style.opacity="0";
  }
}

function renderFaqAccordion(target,text){
  if(!target)return;
  target.replaceChildren();

  const clean=String(text||"").replace(/\r\n?/g,"\n").trim();
  if(!clean){
    target.textContent="Bu belge şu anda boş.";
    return;
  }

  const lines=clean.split("\n");
  const fragment=document.createDocumentFragment();
  const intro=document.createElement("div");
  intro.className="faq-accordion-intro";

  let current=null;
  let faqIndex=0;

  const flushCurrent=()=>{
    if(!current)return;

    const item=document.createElement("section");
    item.className="faq-accordion-item";

    const button=document.createElement("button");
    button.type="button";
    button.className="faq-accordion-button";
    button.setAttribute("aria-expanded","false");

    const answerId=`faq-answer-${faqIndex++}`;
    button.setAttribute("aria-controls",answerId);

    const question=document.createElement("span");
    question.className="faq-accordion-question";
    question.textContent=current.question;

    const chevron=document.createElement("span");
    chevron.className="faq-accordion-chevron";
    chevron.setAttribute("aria-hidden","true");
    chevron.textContent="▼︎";

    button.append(question,chevron);

    const panel=document.createElement("div");
    panel.id=answerId;
    panel.className="faq-accordion-panel";
    panel.setAttribute("aria-hidden","true");
    panel.style.maxHeight="0px";
    panel.style.opacity="0";

    const body=document.createElement("div");
    body.className="faq-accordion-body";
    current.answer.forEach(line=>appendFaqAnswerLine(body,line));
    panel.appendChild(body);

    button.addEventListener("click",event=>{
      event.preventDefault();
      event.stopPropagation();
      setFaqAccordionOpen(
        item,
        button.getAttribute("aria-expanded")!=="true"
      );
    });

    item.append(button,panel);
    fragment.appendChild(item);
    current=null;
  };

  for(const rawLine of lines){
    const line=rawLine.trim();

    if(/^##(?:\s|$)/.test(line)){
      flushCurrent();
      current={
        question:line.replace(/^##\s*/,"").trim(),
        answer:[]
      };
      continue;
    }

    if(current){
      current.answer.push(rawLine);
    }else{
      appendFaqAnswerLine(intro,rawLine);
    }
  }

  flushCurrent();

  if(intro.childNodes.length){
    fragment.insertBefore(intro,fragment.firstChild);
  }

  target.appendChild(fragment);
}

async function loadAboutDocument(path,target,{structured=false,accordion=false}={}){
  if(!path || !target)return;
  target.textContent="İçerik yükleniyor...";
  try{
    let text=aboutDocumentCache.get(path);
    if(typeof text!=="string"){
      const response=await fetch(new URL(path,document.baseURI),{cache:"no-store"});
      if(!response.ok)throw new Error(`HTTP ${response.status}`);
      text=await response.text();
      aboutDocumentCache.set(path,text);
    }

    if(accordion){
      renderFaqAccordion(target,text);
    }else if(structured){
      renderStructuredAboutDocumentText(target,text);
    }else{
      target.textContent=text.trim()||"Bu belge şu anda boş.";
    }
  }catch(error){
    target.textContent=`İçerik yüklenemedi. (${error?.message||error})`;
  }
}

function closeAboutDocumentViewer(){
  const viewer=document.getElementById("about-doc-viewer");
  viewer?.classList.remove("open");
  viewer?.setAttribute("aria-hidden","true");
}

function openAboutDocumentViewer(kind){
  const config=ABOUT_LEGAL_DOCS[kind];
  if(!config)return;
  const viewer=document.getElementById("about-doc-viewer");
  const title=document.getElementById("about-doc-viewer-title");
  const content=document.getElementById("about-doc-viewer-content");
  if(title)title.textContent=config.title;
  viewer?.classList.add("open");
  viewer?.setAttribute("aria-hidden","false");
  loadAboutDocument(config.path,content,{structured:true});
}

function activateAboutTab(name="stats",{load=true}={}){
  const valid=["stats","report","faq","legal","ads","contact"];
  aboutActiveTab=valid.includes(name)?name:"stats";
  closeAboutDocumentViewer();

  document.querySelectorAll(".about-tab").forEach(tab=>{
    const active=tab.dataset.aboutTab===aboutActiveTab;
    tab.classList.toggle("active",active);
    tab.setAttribute("aria-selected",active?"true":"false");
  });
  document.querySelectorAll(".about-panel").forEach(panel=>{
    panel.classList.toggle("active",panel.dataset.aboutPanel===aboutActiveTab);
  });

  if(!load)return;
  if(aboutActiveTab==="stats")loadPublicStats(publicStatsRange);
  else if(aboutActiveTab==="faq")loadAboutDocument("docs/SSS.txt",document.querySelector('[data-about-panel="faq"] [data-about-doc]'),{structured:true,accordion:true});
  else if(aboutActiveTab==="ads")loadAboutDocument("docs/REKLAM.txt",document.querySelector('[data-about-panel="ads"] [data-about-doc]'),{structured:true});
  else if(aboutActiveTab==="contact")loadAboutDocument("docs/ILETISIM.txt",document.querySelector('[data-about-panel="contact"] [data-about-doc]'));
}


function closeControlMenu(){
  controlMenuOpen=false;
  const panel=document.getElementById("control-menu-panel");
  const button=document.getElementById("control-menu-button");
  panel?.classList.remove("open");
  panel?.setAttribute("aria-hidden","true");
  panel?.setAttribute("inert","");
  button?.classList.remove("open");
  button?.setAttribute("aria-expanded","false");
  queueUiFlowResumeCheck();
}

function openControlMenu(){
  closeQuickPanels();
  closeMenu();
  closeStatsOverlay();

  pauseFlowForUi();
  controlMenuOpen=true;
  const panel=document.getElementById("control-menu-panel");
  const button=document.getElementById("control-menu-button");
  panel?.classList.add("open");
  panel?.setAttribute("aria-hidden","false");
  panel?.removeAttribute("inert");
  button?.classList.add("open");
  button?.setAttribute("aria-expanded","true");
  showFullscreenButton();
}

function toggleControlMenu(){
  if(controlMenuOpen){
    closeControlMenu();
    showFullscreenButton();
  }else{
    openControlMenu();
  }
}

function closeStatsOverlay(){
  const overlay=document.getElementById("stats-overlay");
  closeAboutDocumentViewer();
  overlay?.classList.remove("open");
  overlay?.setAttribute("aria-hidden","true");
  queueUiFlowResumeCheck();
}

function publicStatsEscape(value){
  return String(value??"")
    .replace(/&/g,"&amp;")
    .replace(/</g,"&lt;")
    .replace(/>/g,"&gt;")
    .replace(/"/g,"&quot;");
}

function publicStatsNumber(value){
  return new Intl.NumberFormat("tr-TR").format(Number(value)||0);
}

function publicStatsDuration(ms){
  const sec=Math.max(0,Math.round((Number(ms)||0)/1000));
  if(sec<60)return `${sec} sn`;
  return `${Math.floor(sec/60)} dk ${sec%60} sn`;
}

function renderPublicStats(data){
  const summary=document.getElementById("public-stats-summary");
  const flora=document.getElementById("public-stats-flora");
  const categories=document.getElementById("public-stats-categories");
  const statusEl=document.getElementById("public-stats-status");

  const o=data?.overview||{};

  if(summary){
    summary.innerHTML=[
      ["Haber görüntüleme",publicStatsNumber(o.views)],
      ["Farklı haber",publicStatsNumber(o.stories)],
      ["Kaynağa gidiş",publicStatsNumber(o.source_opens)],
      ["Ort. ekranda kalma",publicStatsDuration(o.avg_dwell_ms)]
    ].map(([label,value])=>`
      <div class="public-stat-card">
        <span>${publicStatsEscape(label)}</span>
        <strong>${publicStatsEscape(value)}</strong>
      </div>
    `).join("");
  }

  if(flora){
    const rows=(data?.flora||[]).slice(0,5);
    flora.innerHTML=rows.length
      ? rows.map((row,index)=>`
          <a class="public-stat-story" ${row.link?`href="${publicStatsEscape(row.link)}" target="_blank" rel="noopener noreferrer"`:""}>
            <span class="public-stat-rank">${index+1}</span>
            <span class="public-stat-story-copy">
              <strong>${publicStatsEscape(row.title||"Başlıksız haber")}</strong>
              <small>${publicStatsEscape(row.source||"")}${row.category?` · ${publicStatsEscape(row.category)}`:""}</small>
            </span>
            <span class="public-stat-flora">${Number(row.flora||0).toFixed(1)}</span>
          </a>
        `).join("")
      : `<div class="public-stats-empty">Flöra için henüz yeterli veri yok.</div>`;
  }

  if(categories){
    const foreignStats=data?.stream==="foreign";
    const secondaryHeading=
      document.getElementById("public-stats-secondary-heading");
    const detailLink=
      document.getElementById("public-stats-detail-link");

    if(secondaryHeading){
      secondaryHeading.textContent=
        foreignStats
          ? "En çok görüntülenen yabancı kaynaklar"
          : "En çok ilgi gören kategoriler";
    }

    if(detailLink){
      detailLink.style.display=
        foreignStats
          ? "none"
          : "";
    }

    const rows=
      foreignStats
        ? (data?.sources||[]).slice(0,6).map(row=>({
            label:row.source,
            views:row.views
          }))
        : (data?.categories||[]).slice(0,6).map(row=>({
            label:row.category,
            views:row.views
          }));

    const max=Math.max(1,...rows.map(row=>Number(row.views)||0));
    categories.innerHTML=rows.length
      ? rows.map(row=>{
          const value=Number(row.views)||0;
          return `
            <div class="public-stat-category">
              <span>${publicStatsEscape(row.label||"Bilinmiyor")}</span>
              <i><b style="width:${Math.max(2,value/max*100)}%"></b></i>
              <small>${publicStatsNumber(value)}</small>
            </div>
          `;
        }).join("")
      : `<div class="public-stats-empty">${foreignStats?"Henüz yabancı kaynak verisi yok.":"Henüz kategori verisi yok."}</div>`;
  }

  if(statusEl){
    statusEl.textContent=
      `${data?.label||""} · ${new Date(data?.generatedAt||Date.now()).toLocaleString("tr-TR")}`;
  }
}

async function loadPublicStats(range=publicStatsRange){
  publicStatsRange=range;
  const statsStream=
    feedMode==="foreign"
      ? "foreign"
      : "main";

  document.querySelectorAll(".public-stats-tab").forEach(tab=>{
    tab.classList.toggle(
      "active",
      tab.dataset.statsRange===range
    );
  });

  const title=document.getElementById("public-stats-title");
  const subtitle=document.getElementById("public-stats-subtitle");

  if(title){
    title.textContent=
      statsStream==="foreign"
        ? "Yabancı İstatistikleri"
        : "Flöw İstatistikleri";
  }

  if(subtitle){
    subtitle.textContent=
      statsStream==="foreign"
        ? "Yabancı kaynaklarda son dönemde neler ilgi görüyor?"
        : "Flöw'de son dönemde neler ilgi görüyor?";
  }

  const statusEl=document.getElementById("public-stats-status");
  if(statusEl)statusEl.textContent="İstatistikler hazırlanıyor...";

  try{
    const response=await fetch(
      `${PUBLIC_STATS_API}?range=${encodeURIComponent(range)}&stream=${encodeURIComponent(statsStream)}`,
      {cache:"no-store"}
    );
    const data=await response.json();
    if(!response.ok || !data?.ok){
      throw new Error(data?.error||`HTTP ${response.status}`);
    }
    renderPublicStats(data);
  }catch(error){
    const summary=document.getElementById("public-stats-summary");
    const flora=document.getElementById("public-stats-flora");
    const categories=document.getElementById("public-stats-categories");

    if(summary)summary.innerHTML="";
    if(flora)flora.innerHTML=
      `<div class="public-stats-empty">İstatistikler henüz hazır değil.</div>`;
    if(categories)categories.innerHTML="";
    if(statusEl)statusEl.textContent=
      `Veri alınamadı: ${error?.message||error}`;
  }
}

function openStatsOverlay(){
  pauseFlowForUi();
  closeFloraPopover({resume:false});
  closeQuickPanels();
  closeMenu();

  const overlay=document.getElementById("stats-overlay");
  overlay?.classList.add("open");
  overlay?.setAttribute("aria-hidden","false");
  showFullscreenButton();
  activateAboutTab("stats");

  try{
    telemetryQueueEvent("public_stats_open",{
      value_text:publicStatsRange
    });
  }catch(e){}
}

function closeKeywordFilterPanel(){
  const panel=document.getElementById("keyword-filter-panel");
  panel?.classList.remove("open");
  panel?.setAttribute("aria-hidden","true");
  queueUiFlowResumeCheck();
}

function closeKeywordWatchPanel(){
  const panel=document.getElementById("keyword-watch-panel");
  panel?.classList.remove("open");
  panel?.setAttribute("aria-hidden","true");
  queueUiFlowResumeCheck();
}

function closeQuickPanels(except=""){
  if(except!=="time")closeTimeRangePanel();
  if(except!=="filter")closeKeywordFilterPanel();
  if(except!=="watch")closeKeywordWatchPanel();
}

function openTimeRangePanel(){
  pauseFlowForUi();
  closeMenu();
  closeStatsOverlay();
  closeQuickPanels("time");

  const panel=document.getElementById("time-range-panel");
  panel?.classList.add("open");
  panel?.setAttribute("aria-hidden","false");

  renderTimeRangeControl();
  showFullscreenButton();
}

function closeTimeRangePanel(){
  const panel=document.getElementById("time-range-panel");
  panel?.classList.remove("open");
  panel?.setAttribute("aria-hidden","true");
  queueUiFlowResumeCheck();
}

function toggleTimeRangePanel(){
  const panel=document.getElementById("time-range-panel");
  if(!panel)return;

  if(panel.classList.contains("open")){
    closeTimeRangePanel();
    showFullscreenButton();
  }else{
    openTimeRangePanel();
  }
}

function openKeywordFilterPanel(){
  pauseFlowForUi();
  closeMenu();
  closeStatsOverlay();
  closeQuickPanels("filter");

  const panel=document.getElementById("keyword-filter-panel");
  panel?.classList.add("open");
  panel?.setAttribute("aria-hidden","false");
  renderKeywordFilterControl();
  showFullscreenButton();

  setTimeout(()=>{
    const input=document.getElementById("keyword-filter-input");
    input?.focus();
    input?.select();
  },0);
}

function toggleKeywordFilterPanel(){
  const panel=document.getElementById("keyword-filter-panel");
  if(!panel)return;

  if(panel.classList.contains("open")){
    closeKeywordFilterPanel();
    showFullscreenButton();
  }else{
    openKeywordFilterPanel();
  }
}

function openKeywordWatchPanel(){
  pauseFlowForUi();
  closeMenu();
  closeStatsOverlay();
  closeQuickPanels("watch");

  const panel=document.getElementById("keyword-watch-panel");
  panel?.classList.add("open");
  panel?.setAttribute("aria-hidden","false");
  renderKeywordWatchControl();
  showFullscreenButton();

  setTimeout(()=>{
    const input=document.getElementById("keyword-watch-input");
    input?.focus();
    input?.select();
  },0);
}

function toggleKeywordWatchPanel(){
  const panel=document.getElementById("keyword-watch-panel");
  if(!panel)return;

  if(panel.classList.contains("open")){
    closeKeywordWatchPanel();
    showFullscreenButton();
  }else{
    openKeywordWatchPanel();
  }
}

function openMenu(){
  pauseFlowForUi();
  closeFloraPopover({resume:false});
  closeStatsOverlay();
  closeQuickPanels();

  const overlay=document.getElementById("menu-overlay");
  overlay.classList.add("open");
  overlay.setAttribute("aria-hidden","false");
  showFullscreenButton();
}

function closeMenu(){
  const overlay=document.getElementById("menu-overlay");
  overlay.classList.remove("open");
  overlay.setAttribute("aria-hidden","true");
  queueUiFlowResumeCheck();
}

document.getElementById("control-menu-button")?.addEventListener("pointerdown",e=>e.stopPropagation());
document.getElementById("control-menu-button")?.addEventListener("pointerup",e=>e.stopPropagation());
document.getElementById("control-menu-button")?.addEventListener("click",e=>{
  e.stopPropagation();
  toggleControlMenu();
});

document.getElementById("control-menu-panel")?.addEventListener("pointerdown",e=>e.stopPropagation());
document.getElementById("control-menu-panel")?.addEventListener("pointerup",e=>e.stopPropagation());
document.getElementById("control-menu-panel")?.addEventListener("click",e=>e.stopPropagation());

document.getElementById("menu-button").addEventListener("pointerdown",e=>e.stopPropagation());
document.getElementById("menu-button").addEventListener("pointerup",e=>e.stopPropagation());
document.getElementById("menu-button").addEventListener("click",e=>{
  e.stopPropagation();
  openMenu();
});

document.getElementById("info-button")?.addEventListener("pointerdown",e=>e.stopPropagation());
document.getElementById("info-button")?.addEventListener("pointerup",e=>e.stopPropagation());
document.getElementById("info-button")?.addEventListener("click",e=>{
  e.stopPropagation();
  openStatsOverlay();
});

document.getElementById("time-range-button")?.addEventListener("pointerdown",e=>e.stopPropagation());
document.getElementById("time-range-button")?.addEventListener("pointerup",e=>e.stopPropagation());
document.getElementById("time-range-button")?.addEventListener("click",e=>{
  e.stopPropagation();
  toggleTimeRangePanel();
});

document.getElementById("time-range-panel")?.addEventListener("pointerdown",e=>e.stopPropagation());
document.getElementById("time-range-panel")?.addEventListener("pointerup",e=>e.stopPropagation());
document.getElementById("time-range-panel")?.addEventListener("click",e=>e.stopPropagation());

document.getElementById("keyword-filter-button")?.addEventListener("pointerdown",e=>e.stopPropagation());
document.getElementById("keyword-filter-button")?.addEventListener("pointerup",e=>e.stopPropagation());
document.getElementById("keyword-filter-button")?.addEventListener("click",e=>{
  e.stopPropagation();
  toggleKeywordFilterPanel();
});

document.getElementById("keyword-watch-button")?.addEventListener("pointerdown",e=>e.stopPropagation());
document.getElementById("keyword-watch-button")?.addEventListener("pointerup",e=>e.stopPropagation());
document.getElementById("keyword-watch-button")?.addEventListener("click",e=>{
  e.stopPropagation();
  toggleKeywordWatchPanel();
});

for(const panelId of ["keyword-filter-panel","keyword-watch-panel"]){
  const panel=document.getElementById(panelId);
  panel?.addEventListener("pointerdown",e=>e.stopPropagation());
  panel?.addEventListener("pointerup",e=>e.stopPropagation());
  panel?.addEventListener("click",e=>e.stopPropagation());
}

document.getElementById("stats-close")?.addEventListener("click",closeStatsOverlay);

document.getElementById("about-doc-viewer-close")?.addEventListener("click",e=>{
  e.stopPropagation();
  closeAboutDocumentViewer();
});

document.querySelectorAll(".about-tab").forEach(tab=>{
  tab.addEventListener("click",e=>{
    e.stopPropagation();
    activateAboutTab(tab.dataset.aboutTab||"stats");
  });
});

document.querySelectorAll(".about-legal-button").forEach(button=>{
  button.addEventListener("click",e=>{
    e.stopPropagation();
    openAboutDocumentViewer(button.dataset.legalDoc||"");
  });
});

document.getElementById("stats-overlay")?.addEventListener("click",e=>{
  if(e.target.id==="stats-overlay")closeStatsOverlay();
});

document.querySelectorAll(".public-stats-tab").forEach(tab=>{
  tab.addEventListener("click",()=>{
    loadPublicStats(tab.dataset.statsRange||"7d");
  });
});

document.getElementById("menu-close").addEventListener("click",closeMenu);

document.getElementById("menu-overlay").addEventListener("click",e=>{
  if(e.target.id==="menu-overlay")closeMenu();
});


/* =====================================================================
   V31.76.0 — Preferences layout / market size / larger story actions
   ===================================================================== */

function upgradeAppearancePreferencesV3176(){
  const motionPanel=document.getElementById("motion-panel");
  if(!motionPanel)return;

  const motionTab=document.querySelector('.menu-tab[data-tab="motion"]');
  const weatherTab=document.querySelector('.menu-tab[data-tab="weather"]');
  const weatherPanel=document.querySelector('.menu-panel[data-panel="weather"]');

  if(
    weatherTab?.classList.contains("active") ||
    weatherPanel?.classList.contains("active")
  ){
    document
      .querySelectorAll(".menu-tab")
      .forEach(tab=>tab.classList.remove("active"));

    document
      .querySelectorAll(".menu-panel")
      .forEach(panel=>panel.classList.remove("active"));

    motionTab?.classList.add("active");
    motionPanel.classList.add("active");
  }

  const label=motionPanel.querySelector(".motion-label");
  const directionList=motionPanel.querySelector(".direction-list");

  if(
    label &&
    directionList &&
    !motionPanel.querySelector(".floew-appearance-direction")
  ){
    const directionGroup=document.createElement("div");
    directionGroup.className=
      "floew-appearance-direction floew-appearance-item";

    motionPanel.insertBefore(directionGroup,label);
    directionGroup.append(label,directionList);
  }

  if(label){
    label.textContent="Haber geçiş yönü";
    label.classList.add("floew-setting-heading");
  }

  const weatherSettings=weatherPanel?.querySelector(".weather-settings");
  if(weatherSettings){
    weatherSettings.classList.add(
      "floew-appearance-weather",
      "floew-appearance-item"
    );
    motionPanel.appendChild(weatherSettings);
  }

  weatherTab?.remove();
  weatherPanel?.remove();

  [...motionPanel.children].forEach(child=>{
    child.classList.add("floew-appearance-item");
  });

  updateFilterCount();
}

function bindStatsFloraInternalViewer(){
  const detail=document.getElementById("public-stats-detail-link");
  if(!detail || detail.dataset.floewInternalBound)return;

  detail.dataset.floewInternalBound="1";
  detail.removeAttribute("target");
  detail.removeAttribute("rel");

  detail.addEventListener("click",event=>{
    event.preventDefault();
    event.stopPropagation();
    openInternalPageViewer(
      detail.getAttribute("href")||"flora.html",
      "Flöra"
    );
  });
}

function refreshOpenFaqAccordionHeights(){
  document
    .querySelectorAll(".faq-accordion-item.open")
    .forEach(item=>{
      const panel=item.querySelector(".faq-accordion-panel");
      if(panel){
        panel.style.maxHeight=`${Math.max(1,panel.scrollHeight)}px`;
      }
    });
}

document.querySelector("#settings-menu .menu-tabs")?.addEventListener("click",event=>{
  const tab=event.target?.closest?.(".menu-tab");
  if(!tab || tab.classList.contains("active"))return;

  const nextPanel=document.querySelector(`[data-panel="${tab.dataset.tab}"]`);
  if(!nextPanel)return;

  /* Her sekme tıklamasında bütün panel koleksiyonunu dolaşma. Yalnız o anda
     açık olan iki düğümü değiştir; görünüm ve animasyon aynen kalır. */
  document.querySelector("#settings-menu .menu-tab.active")?.classList.remove("active");
  document.querySelector("#settings-menu .menu-panel.active")?.classList.remove("active");
  tab.classList.add("active");
  nextPanel.classList.add("active");
  updateFilterCount();
});


upgradeAppearancePreferencesV3176();
bindStatsFloraInternalViewer();

window.addEventListener("resize",()=>{
  refreshOpenFaqAccordionHeights();
},{passive:true});


function currentFlowRemainingTime(){
  if(state.timerDeadline){
    return Math.max(250,state.timerDeadline-Date.now());
  }
  return state.timerRemainingMs || Math.max(5,showDurationSeconds)*1000;
}

function anyUiPauseSurfaceOpen(){
  return Boolean(
    floraPopoverOpen ||
    document.getElementById("control-menu-panel")?.classList.contains("open") ||
    document.getElementById("time-range-panel")?.classList.contains("open") ||
    document.getElementById("keyword-filter-panel")?.classList.contains("open") ||
    document.getElementById("keyword-watch-panel")?.classList.contains("open") ||
    document.getElementById("stats-overlay")?.classList.contains("open") ||
    document.getElementById("menu-overlay")?.classList.contains("open")
  );
}

function pauseFlowForUi(){
  if(uiFlowPauseActive || sourceViewerOpen)return;

  uiFlowPauseActive=true;
  uiFlowPauseRemainingMs=currentFlowRemainingTime();

  clearTimeout(state.timer);
  state.timer=null;
  state.timerDeadline=0;
  state.timerRemainingMs=uiFlowPauseRemainingMs;

  clearTimeout(mouseFlowResumeTimer);
  mouseFlowResumeTimer=null;
  mouseFlowPaused=false;
}

function resumeFlowFromUiIfClear(){
  if(
    !uiFlowPauseActive ||
    sourceViewerOpen ||
    anyUiPauseSurfaceOpen()
  )return;

  const remaining=
    uiFlowPauseRemainingMs ||
    state.timerRemainingMs ||
    Math.max(5,showDurationSeconds)*1000;

  uiFlowPauseActive=false;
  uiFlowPauseRemainingMs=0;

  if(
    !autoAdvancePaused &&
    !adActive &&
    !state.busy &&
    state.stories.length
  ){
    timer(remaining);
  }
}

function queueUiFlowResumeCheck(){
  queueMicrotask(resumeFlowFromUiIfClear);
}

function sourceViewerProxyUrl(articleUrl){
  try{
    const u=new URL(SOURCE_VIEW_API);
    u.searchParams.set("url",articleUrl);
    return u.href;
  }catch(e){
    return "";
  }
}

function sourceViewerRemainingTime(){
  if(state.timerDeadline){
    return Math.max(250,state.timerDeadline-Date.now());
  }

  return state.timerRemainingMs || Math.max(5,showDurationSeconds)*1000;
}

function pauseFlowForSourceViewer(){
  sourceViewerRemainingMs=sourceViewerRemainingTime();

  clearTimeout(state.timer);
  state.timer=null;
  state.timerDeadline=0;
  state.timerRemainingMs=sourceViewerRemainingMs;

  clearTimeout(mouseFlowResumeTimer);
  mouseFlowResumeTimer=null;
  mouseFlowPaused=false;
}

function applyInternalViewerTweaks(frame){
  if(
    !frame ||
    !sourceViewerDirectMode ||
    !/\/flora\.html(?:[?#]|$)/i.test(sourceViewerArticleUrl)
  )return;

  try{
    const doc=frame.contentDocument;
    if(!doc)return;

    if(!doc.getElementById("floew-embedded-overrides")){
      const style=doc.createElement("style");
      style.id="floew-embedded-overrides";
      style.textContent=`
        html,body{
          -webkit-text-size-adjust:100% !important;
          text-size-adjust:100% !important;
          font-variant-emoji:text;
        }
      `;
      (doc.head||doc.documentElement).appendChild(style);
    }

    const candidates=[
      doc.querySelector(".flora-brand img"),
      doc.getElementById("logo"),
      doc.querySelector("img.site-logo"),
      doc.querySelector("img.brand-logo"),
      ...doc.querySelectorAll('header img[src*="logo" i]')
    ].filter(Boolean);

    const logo=candidates.find(el=>{
      if(el.dataset?.floewEmbeddedSized==="1")return false;
      const rect=el.getBoundingClientRect?.();
      return rect && rect.width>=32 && rect.height>=12;
    });

    if(logo){
      const brand=logo.closest?.(".flora-brand");
      const target=brand||logo;
      const rect=target.getBoundingClientRect?.();

      if(rect?.width){
        target.style.setProperty(
          "width",
          `${Math.max(16,Math.round(rect.width/2))}px`,
          "important"
        );
        target.style.setProperty("max-width","50%","important");
      }

      if(brand){
        logo.style.setProperty("width","100%","important");
      }else{
        logo.style.setProperty("height","auto","important");
      }

      logo.dataset.floewEmbeddedSized="1";
    }
  }catch(e){
    /* Same-origin erişimi mümkün değilse sayfayı olduğu gibi bırak. */
  }
}

function setSourceViewerFrame(articleUrl,{direct=false}={}){
  const safe=String(articleUrl||"").trim();
  if(!/^https?:\/\//i.test(safe))return false;

  const frame=document.getElementById("source-viewer-frame");
  const external=document.getElementById("source-viewer-external");
  const urlLabel=document.getElementById("source-viewer-url");
  const status=document.getElementById("source-viewer-status");
  const directMode=Boolean(direct);
  const targetUrl=directMode ? safe : sourceViewerProxyUrl(safe);

  if(!frame || !targetUrl)return false;

  sourceViewerArticleUrl=safe;
  sourceViewerDirectMode=directMode;

  if(external){
    external.href=safe;
    external.hidden=directMode;
    external.setAttribute("aria-hidden",directMode?"true":"false");
  }

  if(urlLabel){
    if(directMode){
      urlLabel.textContent="Flöw";
    }else{
      try{
        const u=new URL(safe);
        urlLabel.textContent=u.hostname.replace(/^www\./i,"");
      }catch(e){
        urlLabel.textContent="";
      }
    }
  }

  if(status){
    status.hidden=false;
    status.textContent=directMode
      ? "Sayfa yükleniyor…"
      : "Kaynak yükleniyor…";
  }

  frame.src=targetUrl;
  return true;
}

function openSourceViewer(articleUrl,sourceName="",options={}){
  const safe=String(articleUrl||"").trim();
  if(!/^https?:\/\//i.test(safe))return false;

  if(!sourceViewerOpen){
    pauseFlowForSourceViewer();
  }

  sourceViewerOpen=true;
  uiFlowPauseActive=false;
  uiFlowPauseRemainingMs=0;

  closeFloraPopover({resume:false});
  closeStatsOverlay();
  closeQuickPanels();
  closeControlMenu();
  closeMenu();

  const overlay=document.getElementById("source-viewer-overlay");
  const title=document.getElementById("source-viewer-title");

  if(title){
    title.textContent=String(sourceName||"Kaynak").trim() || "Kaynak";
  }

  overlay?.classList.add("open");
  overlay?.setAttribute("aria-hidden","false");
  document.body.classList.add("source-viewer-open");

  setSourceViewerFrame(safe,{direct:Boolean(options?.direct)});
  showFullscreenButton();

  setTimeout(()=>{
    document.getElementById("source-viewer-close")?.focus();
  },0);

  return true;
}

function openInternalPageViewer(path,title="Flöw"){
  let url="";
  try{
    url=new URL(path,document.baseURI).href;
  }catch(e){
    return false;
  }

  return openSourceViewer(
    url,
    title,
    {direct:true}
  );
}

function closeSourceViewer(){
  if(!sourceViewerOpen)return;

  const overlay=document.getElementById("source-viewer-overlay");
  const frame=document.getElementById("source-viewer-frame");
  const external=document.getElementById("source-viewer-external");
  const status=document.getElementById("source-viewer-status");
  const remaining=sourceViewerRemainingMs || state.timerRemainingMs || Math.max(5,showDurationSeconds)*1000;

  sourceViewerOpen=false;
  sourceViewerArticleUrl="";
  sourceViewerDirectMode=false;

  overlay?.classList.remove("open");
  overlay?.setAttribute("aria-hidden","true");
  document.body.classList.remove("source-viewer-open");

  if(frame)frame.src="about:blank";
  if(external){
    external.hidden=false;
    external.removeAttribute("aria-hidden");
  }
  if(status)status.hidden=false;

  sourceViewerRemainingMs=0;

  if(
    !autoAdvancePaused &&
    !adActive &&
    !state.busy &&
    state.stories.length
  ){
    timer(remaining);
  }

  showFullscreenButton();
}

document.querySelectorAll(".source-link").forEach(link=>{
  link.addEventListener("pointerdown",e=>e.stopPropagation());
  link.addEventListener("pointerup",e=>e.stopPropagation());
  link.addEventListener("click",e=>{
    e.preventDefault();
    e.stopPropagation();

    const story=state.stories[state.index]||null;
    const href=link.getAttribute("href")||story?.link||"";
    const sourceName=story?.source||link.closest(".slide")?.querySelector(".source")?.textContent||"Kaynak";

    openSourceViewer(href,sourceName);
  });
});

document.getElementById("source-viewer-close")?.addEventListener("click",e=>{
  e.preventDefault();
  e.stopPropagation();
  closeSourceViewer();
});

document.getElementById("source-viewer-overlay")?.addEventListener("pointerdown",e=>{
  e.stopPropagation();
});

document.getElementById("source-viewer-frame")?.addEventListener("load",()=>{
  const status=document.getElementById("source-viewer-status");
  const frame=document.getElementById("source-viewer-frame");
  if(status)status.hidden=true;
  applyInternalViewerTweaks(frame);
});

window.addEventListener("message",e=>{
  const frame=document.getElementById("source-viewer-frame");
  if(
    !sourceViewerOpen ||
    sourceViewerDirectMode ||
    !frame ||
    e.source!==frame.contentWindow ||
    !e.data ||
    e.data.type!=="floew-source-nav"
  )return;

  const next=String(e.data.url||"").trim();
  if(/^https?:\/\//i.test(next)){
    setSourceViewerFrame(next);
  }
});

document.addEventListener("keydown",e=>{
  if(e.key==="Escape"){
    closeSourceViewer();
    closeMenu();
    closeStatsOverlay();
    closeQuickPanels();
    showFullscreenButton();
  }
});

document.getElementById("pip-button").addEventListener("pointerdown",e=>{
  e.stopPropagation();
});
document.getElementById("pip-button").addEventListener("pointerup",e=>{
  e.stopPropagation();
});
document.getElementById("pip-button").addEventListener("click",e=>{
  e.stopPropagation();
  togglePiP();
});

document.getElementById("fullscreen-button").addEventListener("pointerdown",e=>{
  e.stopPropagation();
});
document.getElementById("fullscreen-button").addEventListener("pointerup",e=>{
  e.stopPropagation();
});
document.getElementById("fullscreen-button").addEventListener("click",e=>{
  e.stopPropagation();
  toggleFullscreen();
});
document.addEventListener("fullscreenchange",setFullscreenIcon);

window.addEventListener("wheel",e=>{
  if(e.target.closest && e.target.closest("#feed-tabs"))return;
  if(e.target.closest && e.target.closest("#fullscreen-button"))return;
  if(e.target.closest && e.target.closest("#control-menu-button"))return;
  if(e.target.closest && e.target.closest("#control-menu-panel"))return;
  if(e.target.closest && e.target.closest("#info-button"))return;
  if(e.target.closest && e.target.closest("#stats-overlay"))return;
  if(e.target.closest && e.target.closest("#source-viewer-overlay"))return;
  if(e.target.closest && e.target.closest("#menu-button"))return;
  if(e.target.closest && e.target.closest("#time-range-button"))return;
  if(e.target.closest && e.target.closest("#time-range-panel"))return;
  if(e.target.closest && e.target.closest("#keyword-filter-button"))return;
  if(e.target.closest && e.target.closest("#keyword-filter-panel"))return;
  if(e.target.closest && e.target.closest("#keyword-watch-button"))return;
  if(e.target.closest && e.target.closest("#keyword-watch-panel"))return;
  if(e.target.closest && e.target.closest("#pip-button"))return;
  if(e.target.closest && e.target.closest("#menu-overlay"))return;
  e.preventDefault();
  if(Math.abs(e.deltaY)>=5)move(e.deltaY>0?1:-1);
},{passive:false});

window.addEventListener("keydown",e=>{
  const menuOpen=
    document.getElementById("menu-overlay")?.classList.contains("open");

  const statsOpen=
    document.getElementById("stats-overlay")?.classList.contains("open");

  const sourceViewerIsOpen=
    document.getElementById("source-viewer-overlay")?.classList.contains("open");

  const timeOpen=
    document.getElementById("time-range-panel")?.classList.contains("open");

  const keywordFilterOpen=
    document.getElementById("keyword-filter-panel")?.classList.contains("open");

  const keywordWatchOpen=
    document.getElementById("keyword-watch-panel")?.classList.contains("open");

  if(menuOpen || statsOpen || sourceViewerIsOpen || timeOpen || keywordFilterOpen || keywordWatchOpen)return;

  const target=e.target;
  const typingTarget=Boolean(
    target &&
    (
      target.isContentEditable ||
      /^(INPUT|TEXTAREA|SELECT|BUTTON)$/.test(target.tagName||"")
    )
  );

  if(e.key==="ArrowDown"||e.key==="PageDown"){e.preventDefault();move(1)}
  else if(e.key==="ArrowUp"||e.key==="PageUp"){e.preventDefault();move(-1)}
  else if(
    (e.key===" " || e.code==="Space") &&
    !e.repeat &&
    !typingTarget
  ){
    e.preventDefault();
    move(1,{origin:"keyboard_space"});
  }
  else if(e.key==="f"||e.key==="F"){toggleFullscreen()}
});


function resetTouchAdDragState(options={}){
  touchAdDragActive=false;
  touchAdDragDirection=0;
  touchAdDragTargetIndex=-1;
  touchAdDragTargetSlide=null;
  touchAdDragDy=0;
  touchAdDragLastY=0;
  touchAdDragLastT=0;
  touchAdDragVelocityY=0;
  if(!options.keepCommit){
    touchAdDragCommitted=null;
  }
}

function clearTouchAdDragVisuals(options={}){
  if(adOverlay){
    adOverlay.classList.remove("touch-dragging");
    adOverlay.style.removeProperty("transform");
    adOverlay.style.removeProperty("transition");
  }

  slides.forEach((slide,index)=>{
    slide.classList.remove("ad-touch-target");
    slide.style.removeProperty("transform");
    slide.style.removeProperty("transition");
    slide.style.removeProperty("z-index");

    if(options.restoreClasses!==false){
      slide.className=index===state.active ? "slide active" : "slide";
    }
  });
}

function adDragTargetForDirection(direction){
  if(!adActive || !adHasEntered)return null;

  if(historicalAdContext){
    const index=direction<0
      ? historicalAdContext.beforeIndex
      : historicalAdContext.afterIndex;

    return Number.isInteger(index)
      ? {index,fromHistory:true}
      : null;
  }

  if(direction<0){
    return Number.isInteger(state.index)
      ? {index:state.index,fromHistory:true}
      : null;
  }

  if(state.historyPos<state.history.length-1){
    const index=state.history[state.historyPos+1];
    return Number.isInteger(index)
      ? {index,fromHistory:true}
      : null;
  }

  const index=nextStoryIndexForPreload();
  return index>=0
    ? {index,fromHistory:false}
    : null;
}

function prepareTouchAdDragTarget(direction){
  const target=adDragTargetForDirection(direction);
  if(!target)return false;

  const sameDirection=
    touchAdDragActive &&
    touchAdDragDirection===direction &&
    touchAdDragTargetIndex===target.index &&
    touchAdDragTargetSlide;

  if(sameDirection)return true;

  /* Yön değiştiğinde eski preview slaytını temizle. */
  clearTouchAdDragVisuals();

  const story=state.stories[target.index];
  if(!story)return false;

  const targetSlide=
    target.index===state.index
      ? slides[state.active]
      : slides[1-state.active];

  if(target.index!==state.index){
    preloadStoryAssets(story);
    preloadImage(story.image).catch(()=>{});
    prepareTransitionSlide(targetSlide,story);

    const image=targetSlide.querySelector(".slide-image");
    if(image){
      lockSmartFocalPoint(image,story,180).catch(()=>{});
    }
  }

  touchAdDragActive=true;
  touchAdDragDirection=direction;
  touchAdDragTargetIndex=target.index;
  touchAdDragTargetSlide=targetSlide;

  targetSlide.classList.add("ad-touch-target");
  targetSlide.style.zIndex="1189";
  adOverlay?.classList.add("touch-dragging");
  return true;
}

function updateTouchAdDrag(dy,e){
  if(!adActive || !adHasEntered || !adOverlay)return false;

  const direction=dy<0 ? 1 : -1;
  const height=Math.max(1,window.innerHeight||document.documentElement.clientHeight||1);

  if(!prepareTouchAdDragTarget(direction))return false;

  const targetSlide=touchAdDragTargetSlide;
  if(!targetSlide)return false;

  const now=performance.now();
  if(touchAdDragLastT>0){
    const dt=Math.max(1,now-touchAdDragLastT);
    touchAdDragVelocityY=(e.clientY-touchAdDragLastY)/dt;
  }
  touchAdDragLastY=e.clientY;
  touchAdDragLastT=now;
  touchAdDragDy=dy;

  const clamped=Math.max(-height,Math.min(height,dy));
  const targetOffset=direction>0 ? height : -height;

  adOverlay.style.transition="none";
  targetSlide.style.transition="none";
  adOverlay.style.transform=`translate3d(0,${clamped}px,0)`;
  targetSlide.style.transform=`translate3d(0,${targetOffset+clamped}px,0)`;
  return true;
}

function animateTouchAdPair(adY,targetY,duration=250){
  return new Promise(resolve=>{
    if(!adOverlay || !touchAdDragTargetSlide){resolve();return;}

    const targetSlide=touchAdDragTargetSlide;
    let done=false;
    const finish=()=>{
      if(done)return;
      done=true;
      adOverlay.removeEventListener("transitionend",onEnd);
      clearTimeout(timeout);
      resolve();
    };
    const onEnd=e=>{
      if(e.target===adOverlay && e.propertyName==="transform")finish();
    };
    const timeout=setTimeout(finish,duration+120);

    adOverlay.addEventListener("transitionend",onEnd);
    const transition=`transform ${duration}ms cubic-bezier(.22,.61,.36,1)`;
    adOverlay.style.transition=transition;
    targetSlide.style.transition=transition;

    requestAnimationFrame(()=>{
      adOverlay.style.transform=`translate3d(0,${adY}px,0)`;
      targetSlide.style.transform=`translate3d(0,${targetY}px,0)`;
    });
  });
}

async function cancelTouchAdDrag(){
  if(!touchAdDragActive)return;

  const direction=touchAdDragDirection || (touchAdDragDy<0?1:-1);
  const height=Math.max(1,window.innerHeight||document.documentElement.clientHeight||1);

  await animateTouchAdPair(
    0,
    direction>0 ? height : -height,
    210
  );

  clearTouchAdDragVisuals();
  resetTouchAdDragState();
}

async function finishTouchAdDrag(){
  if(!touchAdDragActive)return false;

  const height=Math.max(1,window.innerHeight||document.documentElement.clientHeight||1);
  const distance=Math.abs(touchAdDragDy);
  const velocity=Math.abs(touchAdDragVelocityY);
  const threshold=Math.max(TOUCH_DRAG_MIN_COMMIT_PX,height*TOUCH_DRAG_COMMIT_RATIO);
  const direction=touchAdDragDirection;

  const strongGesture=
    distance>=threshold ||
    (distance>=24 && velocity>=TOUCH_DRAG_VELOCITY_PX_MS);

  const canSkip=
    adActive &&
    adHasEntered &&
    (state.swipeTouch || performance.now()>=adSkipEnabledAt);

  if(!strongGesture || !canSkip || touchAdDragTargetIndex<0){
    await cancelTouchAdDrag();
    return true;
  }

  const targetIndex=touchAdDragTargetIndex;

  await animateTouchAdPair(
    direction>0 ? -height : height,
    0,
    250
  );

  /* Reklam bu 250 ms içinde doğal olarak bittiyse eski gesture state'ini
     yeni ekrana taşımıyoruz. */
  if(!adActive || !adHasEntered){
    clearTouchAdDragVisuals();
    resetTouchAdDragState();
    return true;
  }

  touchAdDragCommitted={
    direction:direction<0?-1:1,
    targetIndex
  };

  /*
    Mevcut reklam promise/history mekanizmasını kullan. requestAdSkip sonucu
    resolve olduğunda transitionFromAdTo/transitionAdBackToCurrent commit
    bilgisini görüp ikinci bir animasyon yapmadan state'i tamamlayacak.
  */
  const accepted=requestAdSkip(direction);
  if(!accepted){
    touchAdDragCommitted=null;
    await cancelTouchAdDrag();
  }

  return true;
}

function consumeTouchAdCommit(nextIndex,dir){
  const commit=touchAdDragCommitted;
  if(!commit)return false;
  if(commit.direction!==(dir<0?-1:1))return false;
  if(Number.isInteger(nextIndex) && commit.targetIndex!==nextIndex)return false;

  touchAdDragCommitted=null;
  return true;
}

async function finalizeCommittedAdDragToStory(nextIndex,dir=1){
  const story=state.stories[nextIndex];
  if(!story)return false;

  state.busy=true;
  clearTimeout(state.timer);
  state.timer=null;

  const previousSlide=slides[state.active];
  const targetSlide=
    nextIndex===state.index
      ? previousSlide
      : slides[1-state.active];

  if(nextIndex!==state.index){
    if(!slidePreloadedForStory(targetSlide,story)){
      prepareTransitionSlide(targetSlide,story);
    }
    targetSlide.className="slide active";
    previousSlide.className="slide";
    stopSlideMedia(previousSlide);
    state.active=1-state.active;
    state.index=nextIndex;
  }else{
    previousSlide.className="slide active";
  }

  clearTouchAdDragVisuals({restoreClasses:false});
  activateSlideMedia(slides[state.active],story);
  updateKeywordAlert(story);

  clearFlowTransitionClasses(adOverlay);
  hideAdOverlay();
  adActive=false;
  adHasEntered=false;
  adSkipRequestedDirection=0;
  adSkipEnabledAt=0;
  adPlaybackFinish=null;
  currentAd=null;
  historicalAdContext=null;
  resetTouchAdDragState();
  state.busy=false;
  timer();
  return true;
}

function resetTouchDragState(){
  state.touchDragActive=false;
  state.touchDragDirection=0;
  state.touchDragTargetIndex=-1;
  state.touchDragFromHistory=false;
  state.touchDragDy=0;
  state.touchDragLastY=0;
  state.touchDragLastT=0;
  state.touchDragVelocityY=0;
}

function clearTouchDragVisuals(){
  slides.forEach(slide=>{
    slide.classList.remove("touch-dragging");
    slide.style.removeProperty("transform");
    slide.style.removeProperty("transition");
    slide.style.removeProperty("z-index");
  });
}

function touchDragTargetForDirection(direction){
  if(direction<0){
    if(Boolean(adRecordBeforeCurrent()) || state.historyPos<=0)return null;
    const index=state.history[state.historyPos-1];
    return Number.isInteger(index)
      ? {index,fromHistory:true}
      : null;
  }

  if(Boolean(adRecordAfterCurrent()) || adBreakDue())return null;

  if(state.historyPos<state.history.length-1){
    const index=state.history[state.historyPos+1];
    return Number.isInteger(index)
      ? {index,fromHistory:true}
      : null;
  }

  const index=nextStoryIndexForPreload();
  return index>=0
    ? {index,fromHistory:false}
    : null;
}

function prepareTouchDragTarget(direction){
  const target=touchDragTargetForDirection(direction);
  const standby=slides[1-state.active];

  if(!target){
    state.touchDragActive=true;
    state.touchDragDirection=direction;
    state.touchDragTargetIndex=-1;
    state.touchDragFromHistory=false;
    clearTimeout(state.timer);
    state.timer=null;
    slides[state.active].classList.add("touch-dragging");
    standby.className="slide touch-dragging";
    standby.style.removeProperty("transform");
    standby.style.removeProperty("transition");
    return false;
  }

  if(
    state.touchDragActive &&
    state.touchDragDirection===direction &&
    state.touchDragTargetIndex===target.index
  ){
    return true;
  }

  const story=state.stories[target.index];
  if(!story)return false;

  state.touchDragActive=true;
  state.touchDragDirection=direction;
  state.touchDragTargetIndex=target.index;
  state.touchDragFromHistory=target.fromHistory;

  clearTimeout(state.timer);
  state.timer=null;

  preloadStoryAssets(story);
  preloadImage(story.image).catch(()=>{});
  prepareTransitionSlide(standby,story);

  const image=standby.querySelector(".slide-image");
  if(image){
    lockSmartFocalPoint(image,story,180).catch(()=>{});
  }

  standby.className="slide touch-dragging";
  standby.style.zIndex="3";
  slides[state.active].classList.add("touch-dragging");
  slides[state.active].style.zIndex="4";
  return true;
}

function updateTouchStoryDrag(dy,e){
  const direction=dy<0 ? 1 : -1;
  const height=Math.max(1,window.innerHeight||document.documentElement.clientHeight||1);
  const current=slides[state.active];
  const standby=slides[1-state.active];

  prepareTouchDragTarget(direction);

  const now=performance.now();
  if(state.touchDragLastT>0){
    const dt=Math.max(1,now-state.touchDragLastT);
    state.touchDragVelocityY=(e.clientY-state.touchDragLastY)/dt;
  }
  state.touchDragLastY=e.clientY;
  state.touchDragLastT=now;
  state.touchDragDy=dy;

  if(state.touchDragTargetIndex<0){
    const resisted=Math.max(-height*.18,Math.min(height*.18,dy*.24));
    current.style.transform=`translate3d(0,${resisted}px,0)`;
    current.style.transition="none";
    return;
  }

  const clamped=Math.max(-height,Math.min(height,dy));
  const standbyOffset=direction>0 ? height : -height;

  current.style.transition="none";
  standby.style.transition="none";
  current.style.transform=`translate3d(0,${clamped}px,0)`;
  standby.style.transform=`translate3d(0,${standbyOffset+clamped}px,0)`;
}

function animateTouchDragPair(current,standby,currentY,standbyY,duration=260){
  return new Promise(resolve=>{
    let done=false;
    const finish=()=>{
      if(done)return;
      done=true;
      current.removeEventListener("transitionend",onEnd);
      clearTimeout(timeout);
      resolve();
    };
    const onEnd=e=>{
      if(e.target===current && e.propertyName==="transform")finish();
    };
    const timeout=setTimeout(finish,duration+100);

    current.addEventListener("transitionend",onEnd);
    const transition=`transform ${duration}ms cubic-bezier(.22,.61,.36,1)`;
    current.style.transition=transition;
    standby.style.transition=transition;

    requestAnimationFrame(()=>{
      current.style.transform=`translate3d(0,${currentY}px,0)`;
      standby.style.transform=`translate3d(0,${standbyY}px,0)`;
    });
  });
}

async function cancelTouchStoryDrag(){
  const current=slides[state.active];
  const standby=slides[1-state.active];
  const height=Math.max(1,window.innerHeight||document.documentElement.clientHeight||1);
  const direction=state.touchDragDirection || (state.touchDragDy<0?1:-1);

  state.busy=true;
  await animateTouchDragPair(
    current,
    standby,
    0,
    direction>0 ? height : -height,
    220
  );

  current.className="slide active";
  standby.className="slide";
  clearTouchDragVisuals();
  resetTouchDragState();
  state.busy=false;
  timer();
}

async function commitTouchStoryDrag(direction){
  const targetIndex=state.touchDragTargetIndex;
  const fromHistory=state.touchDragFromHistory;
  const before=state.stories[state.index]||null;
  const story=state.stories[targetIndex]||null;

  if(!story || targetIndex<0){
    await cancelTouchStoryDrag();
    return;
  }

  const current=slides[state.active];
  const standby=slides[1-state.active];
  const height=Math.max(1,window.innerHeight||document.documentElement.clientHeight||1);

  state.busy=true;
  clearTimeout(state.timer);
  state.timer=null;

  startPiPTransition(before,story,direction);
  activateSlideMedia(standby,story);

  await animateTouchDragPair(
    current,
    standby,
    direction>0 ? -height : height,
    0,
    260
  );

  standby.className="slide active";
  current.className="slide";
  stopSlideMedia(current);
  clearTouchDragVisuals();

  state.active=1-state.active;
  state.index=targetIndex;

  if(direction>0){
    if(fromHistory){
      state.historyPos=Math.min(state.history.length-1,state.historyPos+1);
    }else{
      state.history.push(targetIndex);
      state.historyPos=state.history.length-1;
      plannedForwardStory=null;
    }
    newsShownSinceAd++;
    maybeScheduleUpcomingAdPreload();
    telemetryQueueEvent("story_forward",{
      direction:1,
      origin:"touch_drag"
    });
  }else{
    state.historyPos=Math.max(0,state.historyPos-1);
    telemetryQueueEvent("story_back",{
      direction:-1,
      origin:"touch_drag"
    });
  }

  updateKeywordAlert(story);
  telemetryStoryChanged(before,"touch_drag",direction);
  resetTouchDragState();
  state.busy=false;
  timer();
}

async function finishTouchStoryDrag(){
  if(!state.touchDragActive){
    resetTouchDragState();
    return false;
  }

  const height=Math.max(1,window.innerHeight||document.documentElement.clientHeight||1);
  const distance=Math.abs(state.touchDragDy);
  const velocity=Math.abs(state.touchDragVelocityY);
  const threshold=Math.max(TOUCH_DRAG_MIN_COMMIT_PX,height*TOUCH_DRAG_COMMIT_RATIO);
  const direction=state.touchDragDirection;

  const strongGesture=
    distance>=threshold ||
    (distance>=24 && velocity>=TOUCH_DRAG_VELOCITY_PX_MS);

  const shouldCommit=
    state.touchDragTargetIndex>=0 &&
    strongGesture;

  if(shouldCommit){
    await commitTouchStoryDrag(direction);
  }else{
    const shouldDeferToNormalNavigation=
      strongGesture &&
      (
        (direction>0 && (Boolean(adRecordAfterCurrent()) || adBreakDue())) ||
        (direction<0 && Boolean(adRecordBeforeCurrent()))
      );

    if(shouldDeferToNormalNavigation){
      /* Reklam/history durağı için önce 220 ms geri-sekme animasyonu oynatmak
         ilk swipe'ın yutulduğu hissini veriyordu. Görsel state'i anında temizle
         ve aynı gesture'ın gerçek hedefini hemen başlat. */
      clearTouchDragVisuals();
      resetTouchDragState();
      move(direction,{origin:"touch_drag"});
    }else{
      await cancelTouchStoryDrag();
    }
  }

  return true;
}

let touchFeedDragActive=false;
let touchFeedDragDirection=0;
let touchFeedDragTargetMode="";
let touchFeedDragTargetList=null;
let touchFeedDragTargetIndex=-1;
let touchFeedDragDx=0;
let touchFeedDragLastX=0;
let touchFeedDragLastT=0;
let touchFeedDragVelocityX=0;

function resetTouchFeedDragState(){
  touchFeedDragActive=false;
  touchFeedDragDirection=0;
  touchFeedDragTargetMode="";
  touchFeedDragTargetList=null;
  touchFeedDragTargetIndex=-1;
  touchFeedDragDx=0;
  touchFeedDragLastX=0;
  touchFeedDragLastT=0;
  touchFeedDragVelocityX=0;
}

function clearTouchFeedDragVisuals(){
  slides.forEach(slide=>{
    slide.classList.remove("touch-dragging");
    slide.style.removeProperty("transform");
    slide.style.removeProperty("transition");
    slide.style.removeProperty("z-index");
  });
}

function touchFeedDragTarget(direction){
  const order=currentFeedModeOrder();
  const current=order.indexOf(feedMode);
  const targetIndex=current+direction;
  if(current<0 || targetIndex<0 || targetIndex>=order.length)return null;

  const mode=order[targetIndex];
  const list=storiesForFeedMode(mode);
  if(!list.length)return {mode,list,index:-1};

  const preferredKey=feedModeStoryKeys[mode];
  let index=preferredKey
    ? list.findIndex(story=>storyIdentity(story)===preferredKey)
    : -1;
  if(index<0)index=0;

  return {mode,list,index};
}

function prepareTouchFeedDragTarget(direction){
  if(
    touchFeedDragActive &&
    touchFeedDragDirection===direction &&
    touchFeedDragTargetMode
  ){
    return touchFeedDragTargetIndex>=0;
  }

  const target=touchFeedDragTarget(direction);
  const standby=slides[1-state.active];

  touchFeedDragActive=true;
  touchFeedDragDirection=direction;

  if(!target || target.index<0){
    touchFeedDragTargetMode=target?.mode||"";
    touchFeedDragTargetList=target?.list||null;
    touchFeedDragTargetIndex=-1;
    standby.className="slide touch-dragging";
    slides[state.active].classList.add("touch-dragging");
    return false;
  }

  touchFeedDragTargetMode=target.mode;
  touchFeedDragTargetList=target.list;
  touchFeedDragTargetIndex=target.index;

  const story=target.list[target.index];
  preloadStoryAssets(story);
  preloadImage(story.image).catch(()=>{});
  prepareTransitionSlide(standby,story);

  const image=standby.querySelector(".slide-image");
  if(image){
    lockSmartFocalPoint(image,story,180).catch(()=>{});
  }

  standby.className="slide touch-dragging";
  standby.style.zIndex="3";
  slides[state.active].classList.add("touch-dragging");
  slides[state.active].style.zIndex="4";
  return true;
}

function updateTouchFeedDrag(dx,e){
  const direction=dx<0 ? 1 : -1;
  const width=Math.max(1,window.innerWidth||document.documentElement.clientWidth||1);
  const current=slides[state.active];
  const standby=slides[1-state.active];

  const hasTarget=prepareTouchFeedDragTarget(direction);

  const now=performance.now();
  if(touchFeedDragLastT>0){
    const dt=Math.max(1,now-touchFeedDragLastT);
    touchFeedDragVelocityX=(e.clientX-touchFeedDragLastX)/dt;
  }
  touchFeedDragLastX=e.clientX;
  touchFeedDragLastT=now;
  touchFeedDragDx=dx;

  if(!hasTarget){
    const resisted=Math.max(-width*.14,Math.min(width*.14,dx*.22));
    current.style.transition="none";
    current.style.transform=`translate3d(${resisted}px,0,0)`;
    return;
  }

  const clamped=Math.max(-width,Math.min(width,dx));
  const standbyOffset=direction>0 ? width : -width;

  current.style.transition="none";
  standby.style.transition="none";
  current.style.transform=`translate3d(${clamped}px,0,0)`;
  standby.style.transform=`translate3d(${standbyOffset+clamped}px,0,0)`;
}

function animateTouchFeedPair(current,standby,currentX,standbyX,duration=260){
  return new Promise(resolve=>{
    let done=false;
    const finish=()=>{
      if(done)return;
      done=true;
      current.removeEventListener("transitionend",onEnd);
      clearTimeout(timeout);
      resolve();
    };
    const onEnd=event=>{
      if(event.target===current && event.propertyName==="transform")finish();
    };
    const timeout=setTimeout(finish,duration+100);
    current.addEventListener("transitionend",onEnd);

    const transition=`transform ${duration}ms cubic-bezier(.22,.61,.36,1)`;
    current.style.transition=transition;
    standby.style.transition=transition;

    requestAnimationFrame(()=>{
      current.style.transform=`translate3d(${currentX}px,0,0)`;
      standby.style.transform=`translate3d(${standbyX}px,0,0)`;
    });
  });
}

async function cancelTouchFeedDrag(){
  if(!touchFeedDragActive)return;

  const current=slides[state.active];
  const standby=slides[1-state.active];
  const width=Math.max(1,window.innerWidth||document.documentElement.clientWidth||1);
  const direction=touchFeedDragDirection || (touchFeedDragDx<0?1:-1);

  state.busy=true;
  await animateTouchFeedPair(
    current,
    standby,
    0,
    direction>0 ? width : -width,
    220
  );

  current.className="slide active";
  standby.className="slide";
  clearTouchFeedDragVisuals();
  resetTouchFeedDragState();
  state.busy=false;
  timer();
}

async function commitTouchFeedDrag(direction){
  const targetMode=touchFeedDragTargetMode;
  const list=touchFeedDragTargetList;
  const targetIndex=touchFeedDragTargetIndex;
  const story=list?.[targetIndex]||null;

  if(!targetMode || !story){
    await cancelTouchFeedDrag();
    return;
  }

  const previousMode=feedMode;
  const beforeStory=state.stories[state.index]||null;
  const current=slides[state.active];
  const standby=slides[1-state.active];
  const width=Math.max(1,window.innerWidth||document.documentElement.clientWidth||1);

  state.busy=true;
  clearTimeout(state.timer);
  state.timer=null;

  activateSlideMedia(standby,story);
  await animateTouchFeedPair(
    current,
    standby,
    direction>0 ? -width : width,
    0,
    260
  );

  feedModeStoryKeys[previousMode]=storyIdentity(beforeStory);
  feedMode=targetMode;
  filterReturnStoryKey="";

  if(previousMode==="source" && targetMode!=="source")clearTemporarySourceTab();
  if(previousMode==="category" && targetMode!=="category")clearTemporaryCategoryTab();

  standby.className="slide active";
  current.className="slide";
  stopSlideMedia(current);
  clearTouchFeedDragVisuals();

  state.active=1-state.active;
  state.stories=list;
  state.index=targetIndex;
  state.history=[targetIndex];
  state.historyPos=0;
  clearAdNavigationHistory();
  historicalAdContext=null;

  renderFeedMode();
  closeQuickPanels();
  clearStatus();
  setStoryStageVisible(true);
  updateKeywordAlert(story);
  renderOptions();
  showFullscreenButton();

  resetTouchFeedDragState();
  state.busy=false;
  timer();
  scheduleAdjacentFeedPreload(120);
}

async function finishTouchFeedDrag(){
  if(!touchFeedDragActive){
    resetTouchFeedDragState();
    return false;
  }

  const width=Math.max(1,window.innerWidth||document.documentElement.clientWidth||1);
  const distance=Math.abs(touchFeedDragDx);
  const velocity=Math.abs(touchFeedDragVelocityX);
  const threshold=Math.max(TOUCH_DRAG_MIN_COMMIT_PX,width*TOUCH_DRAG_COMMIT_RATIO);
  const direction=touchFeedDragDirection;
  const strongGesture=
    distance>=threshold ||
    (distance>=24 && velocity>=TOUCH_DRAG_VELOCITY_PX_MS);

  if(touchFeedDragTargetIndex>=0 && strongGesture){
    await commitTouchFeedDrag(direction);
  }else{
    const emptyBreaking=
      strongGesture &&
      touchFeedDragTargetMode==="breaking" &&
      touchFeedDragTargetIndex<0;

    await cancelTouchFeedDrag();

    if(emptyBreaking){
      status("Son 20 dakikada Son dakika, Türkiye, Dünya veya Siyaset haberi bulunamadı.");
    }
  }

  return true;
}

let suppressHeadlineActionClickUntil=0;

document.addEventListener("click",event=>{
  if(
    performance.now()<suppressHeadlineActionClickUntil &&
    event.target?.closest?.(".headline-actions")
  ){
    event.preventDefault();
    event.stopImmediatePropagation();
  }
},{capture:true});

window.addEventListener("pointerdown",e=>{
  if(e.button!==0)return;

  state.pointerId=null;
  state.swipeHandled=false;
  state.swipeTouch=false;

  if(
    e.pointerType==="touch" ||
    (
      window.matchMedia?.("(pointer: coarse)")?.matches &&
      e.pointerType!=="mouse"
    )
  ){
    showFullscreenButton();
  }
  if(e.target.closest && e.target.closest("#feed-tabs"))return;
  if(e.target.closest && e.target.closest("#fullscreen-button"))return;
  if(e.target.closest && e.target.closest("#control-menu-button"))return;
  if(e.target.closest && e.target.closest("#control-menu-panel"))return;
  if(e.target.closest && e.target.closest("#info-button"))return;
  if(e.target.closest && e.target.closest("#stats-overlay"))return;
  if(e.target.closest && e.target.closest("#source-viewer-overlay"))return;
  if(e.target.closest && e.target.closest("#menu-button"))return;
  if(e.target.closest && e.target.closest("#time-range-button"))return;
  if(e.target.closest && e.target.closest("#time-range-panel"))return;
  if(e.target.closest && e.target.closest("#keyword-filter-button"))return;
  if(e.target.closest && e.target.closest("#keyword-filter-panel"))return;
  if(e.target.closest && e.target.closest("#keyword-watch-button"))return;
  if(e.target.closest && e.target.closest("#keyword-watch-panel"))return;
  if(e.target.closest && e.target.closest("#pip-button"))return;
  if(e.target.closest && e.target.closest("#menu-overlay"))return;
  state.x=e.clientX;state.y=e.clientY;state.t=performance.now();
  state.pointerId=e.pointerId;
  resetTouchDragState();
  resetTouchFeedDragState();
  if(!touchAdDragCommitted){
    resetTouchAdDragState();
  }
  touchFeedDragLastX=e.clientX;
  touchFeedDragLastT=state.t;
  state.touchDragLastY=e.clientY;
  state.touchDragLastT=state.t;
  touchAdDragLastY=e.clientY;
  touchAdDragLastT=state.t;
  try{e.target?.setPointerCapture?.(e.pointerId);}catch(_){}
  state.swipeTouch=
    e.pointerType==="touch" ||
    (
      window.matchMedia?.("(pointer: coarse)")?.matches &&
      e.pointerType!=="mouse"
    );
},{capture:true});

/*
  Mobil doğrudan manipülasyon:
  Dikey harekette haber parmakla birlikte hareket eder; kullanıcı parmağını
  bırakmadan yönü tersine çevirebilir. Yatay swipe sekme değiştirmeyi korur.
*/
window.addEventListener("pointermove",e=>{
  if(
    !state.swipeTouch ||
    state.pointerId===null ||
    e.pointerId!==state.pointerId ||
    state.busy
  )return;

  if(navigationBlockingPanelOpen())return;

  const dx=e.clientX-state.x;
  const dy=e.clientY-state.y;
  const absX=Math.abs(dx);
  const absY=Math.abs(dy);

  if(adActive){
    if(
      !state.swipeHandled &&
      (touchAdDragActive || (absY>=TOUCH_DRAG_START_PX && absY>=absX))
    ){
      e.preventDefault();
      updateTouchAdDrag(dy,e);
    }
    return;
  }

  /* Reklam bir sonraki gerçek duraksa mobil swipe'ı önce direnç/cancel
     animasyonuna sokma. Hareket eşiği geçildiği anda aynı gesture reklam
     geçişini başlatır; pointerup bu gesture'ı ikinci kez işlemez. */
  if(
    !state.touchDragActive &&
    !state.swipeHandled &&
    absY>=TOUCH_DRAG_START_PX &&
    absY>=absX
  ){
    const direction=dy<0 ? 1 : -1;
    const adIsNext=
      direction>0
        ? (adBreakDue() || Boolean(adRecordAfterCurrent()))
        : Boolean(adRecordBeforeCurrent());

    if(adIsNext){
      e.preventDefault();
      state.swipeHandled=true;
      clearTouchDragVisuals();
      resetTouchDragState();
      void move(direction,{origin:"touch_ad_entry"});
      return;
    }
  }

  if(
    !state.touchDragActive &&
    !state.swipeHandled &&
    (
      touchFeedDragActive ||
      (absX>=TOUCH_DRAG_START_PX && absX>absY*1.1)
    )
  ){
    e.preventDefault();
    updateTouchFeedDrag(dx,e);
    return;
  }

  if(
    !state.swipeHandled &&
    (state.touchDragActive || (absY>=TOUCH_DRAG_START_PX && absY>=absX))
  ){
    e.preventDefault();
    updateTouchStoryDrag(dy,e);
  }
},{passive:false,capture:true});

window.addEventListener("pointercancel",e=>{
  if(e.pointerId!==state.pointerId)return;

  if(touchFeedDragActive){
    cancelTouchFeedDrag();
  }else if(touchAdDragActive){
    cancelTouchAdDrag();
  }else if(state.touchDragActive){
    cancelTouchStoryDrag();
  }else{
    resetTouchFeedDragState();
    resetTouchDragState();
    resetTouchAdDragState();
  }

  state.pointerId=null;
  state.swipeHandled=false;
  state.swipeTouch=false;
},{capture:true});

window.addEventListener("pointerup",e=>{
  if(e.button!==0)return;

  /* Yatay akış sekmeleri de dikey haberler gibi parmağı doğrudan takip eder. */
  if(
    touchFeedDragActive &&
    e.pointerId===state.pointerId
  ){
    finishTouchFeedDrag();
    state.pointerId=null;
    state.swipeHandled=false;
    state.swipeTouch=false;
    return;
  }

  /* Reklam da haberlerle aynı direct-drag davranışını kullanır. */
  if(
    touchAdDragActive &&
    e.pointerId===state.pointerId
  ){
    finishTouchAdDrag();
    state.pointerId=null;
    state.swipeHandled=false;
    state.swipeTouch=false;
    return;
  }

  /* Pointer capture desteklenmeyen bir cihazda parmak bir kontrolün üstünde
     bırakılmış olsa bile aktif doğrudan sürüklemeyi mutlaka sonlandır. */
  if(
    state.touchDragActive &&
    e.pointerId===state.pointerId
  ){
    suppressHeadlineActionClickUntil=performance.now()+450;
    finishTouchStoryDrag();
    state.pointerId=null;
    state.swipeHandled=false;
    state.swipeTouch=false;
    return;
  }

  if(e.target.closest && e.target.closest("#feed-tabs"))return;
  if(document.getElementById("menu-overlay").classList.contains("open"))return;
  if(document.getElementById("stats-overlay")?.classList.contains("open"))return;
  if(e.target.closest && e.target.closest("#fullscreen-button"))return;
  if(e.target.closest && e.target.closest("#control-menu-button"))return;
  if(e.target.closest && e.target.closest("#control-menu-panel"))return;
  if(e.target.closest && e.target.closest("#info-button"))return;
  if(e.target.closest && e.target.closest("#menu-button"))return;
  if(e.target.closest && e.target.closest("#time-range-button"))return;
  if(e.target.closest && e.target.closest("#time-range-panel"))return;
  if(e.target.closest && e.target.closest("#keyword-filter-button"))return;
  if(e.target.closest && e.target.closest("#keyword-filter-panel"))return;
  if(e.target.closest && e.target.closest("#keyword-watch-button"))return;
  if(e.target.closest && e.target.closest("#keyword-watch-panel"))return;
  if(e.target.closest && e.target.closest("#pip-button"))return;
  if(e.target.closest && e.target.closest("#menu-overlay"))return;

  if(
    state.swipeHandled &&
    e.pointerId===state.pointerId
  ){
    suppressHeadlineActionClickUntil=performance.now()+450;
    state.pointerId=null;
    state.swipeHandled=false;
    state.swipeTouch=false;
    return;
  }

  if(navigationBlockingPanelOpen()){
    closeQuickPanels();
    showFullscreenButton();
    return;
  }

  const dx=e.clientX-state.x;
  const dy=e.clientY-state.y;
  const dt=performance.now()-state.t;

  /*
    Yatay swipe = sekmeler arasında komşu akışa geçiş.

      Son dakika <-> Gündem <-> Yabancı

    Sağa kaydırma soldaki sekmeye, sola kaydırma sağdaki sekmeye gider.
    Dikey swipe haber navigasyonudur.
  */
  if(
    Math.abs(dx)>=SWIPE &&
    Math.abs(dx)>Math.abs(dy) &&
    dt<=1000
  ){
    const order=currentFeedModeOrder();
    const currentModeIndex=order.indexOf(feedMode);
    const targetModeIndex=
      currentModeIndex + (dx<0 ? 1 : -1);

    if(
      targetModeIndex>=0 &&
      targetModeIndex<order.length
    ){
      switchFeedMode(
        order[targetModeIndex]
      );
    }
  }else if(
    Math.abs(dy)>=SWIPE &&
    Math.abs(dy)>=Math.abs(dx) &&
    dt<=1000
  ){
    move(dy<0?1:-1);
  }else if(
    e.pointerType!=="touch" &&
    !(
      window.matchMedia?.("(pointer: coarse)")?.matches &&
      e.pointerType!=="mouse"
    ) &&
    dt<=1000 &&
    Math.abs(dx)<10 &&
    Math.abs(dy)<10
  ){
    move(1);
  }

  state.pointerId=null;
  state.swipeHandled=false;
  state.swipeTouch=false;
},{capture:true});

window.addEventListener("dragstart",e=>e.preventDefault());

window.addEventListener(
  "resize",
  refreshAdsLayoutIfNeeded,
  {passive:true}
);

window.addEventListener(
  "orientationchange",
  refreshAdsLayoutIfNeeded,
  {passive:true}
);

const FLOEW_TEXT_PRESENTATION_SYMBOLS=new Set([
  "☰","⤢","⧉","⏲","⌖","ⓘ","⚙","↑","↓","−","▶","⏸",
  "↗","→","▲","▼","⤴","⚑","⎋","☀","☾","◐","☁","☂","❄","⚡","◌"
]);

function forceTextPresentationSymbols(root=document){
  const scope=root?.querySelectorAll ? root : document;
  const nodes=[
    ...(scope===document ? [] : [scope]),
    ...scope.querySelectorAll(
      'button,a,[role="button"],#weather-icon,.faq-accordion-chevron,.flora-story-popover-mark'
    )
  ];

  for(const el of nodes){
    if(!(el instanceof Element) || el.closest?.(".fx-flag"))continue;

    const walker=document.createTreeWalker(el,NodeFilter.SHOW_TEXT);
    const texts=[];
    while(walker.nextNode())texts.push(walker.currentNode);

    let hasSymbol=false;
    for(const textNode of texts){
      const chars=Array.from(textNode.nodeValue||"");
      let changed=false;
      const next=[];

      for(let i=0;i<chars.length;i++){
        const char=chars[i];
        next.push(char);
        if(
          FLOEW_TEXT_PRESENTATION_SYMBOLS.has(char) &&
          chars[i+1]!=="︎"
        ){
          next.push("︎");
          changed=true;
          hasSymbol=true;
        }else if(FLOEW_TEXT_PRESENTATION_SYMBOLS.has(char)){
          hasSymbol=true;
        }
      }

      if(changed)textNode.nodeValue=next.join("");
    }

    if(hasSymbol && el.childElementCount===0){
      el.classList.add("floew-text-symbol");
    }
  }
}

forceTextPresentationSymbols();

if(window.MutationObserver){
  let symbolRefreshQueued=false;
  const symbolObserver=new MutationObserver(()=>{
    if(symbolRefreshQueued)return;
    symbolRefreshQueued=true;
    queueMicrotask(()=>{
      symbolRefreshQueued=false;
      forceTextPresentationSymbols();
    });
  });
  symbolObserver.observe(document.body,{subtree:true,childList:true,characterData:true});
}

updateClock();
setInterval(updateClock,1000);
initMarketData();

if(new URLSearchParams(location.search).get("pip")==="1"){
  document.body.classList.add("pip-mode");
}
window.FloewAds={
  refresh:()=>loadAdsCatalog(),
  status:()=>({
    version:window.__floewAppVersion,
    testMode:ADS_TEST_MODE,
    interval:ADS_INTERVAL_NEWS,
    newsShownSinceAd,
    adActive,
    layout:getAdsLayout(),
    catalogLayout:adCatalogLayout,
    catalog:adCatalog.map(item=>({
      name:item.name,
      type:item.type,
      src:item.src
    }))
  }),
  test:async()=>{
    await loadAdsCatalog();
    const result=await playAdBreak();

    if(!result?.shown)return false;

    if(result.direction<0){
      await transitionAdBackToCurrent(-1);
    }else{
      await move(1,{skipAd:true,fromAd:true});
    }

    return true;
  }
};

async function runAdTestOnce(){
  if(!ADS_TEST_MODE || adTestRan)return;
  if(!state.stories.length)return;

  adTestRan=true;
  clearTimeout(state.timer);

  await loadAdsCatalog();

  if(!adCatalog.length){
    status(
      "Reklam testi: Worker ads/ dizininde desteklenen reklam bulamadı."
    );
    timer();
    return;
  }

  status(
    `Reklam testi: ${adCatalog.length} dosya bulundu. Reklam oynatılıyor...`
  );

  await new Promise(resolve=>setTimeout(resolve,700));
  clearStatus();

  const result=await playAdBreak();

  if(!result?.shown){
    status(
      "Reklam testi: dosya listelendi ancak medya yüklenemedi."
    );
    timer();
    return;
  }

  if(result.direction<0){
    await transitionAdBackToCurrent(-1);
  }else{
    await move(1,{skipAd:true,fromAd:true});
  }
}


/* ========================================================================
   FLÖW ANALYTICS / FLÖRA — V31.16.0
   ------------------------------------------------------------------------
   Three physically separate D1 stores are used by the Worker:
   CONTENT_DB  -> public content / Flöra statistics
   AUDIENCE_DB -> private visitor + session statistics
   BEHAVIOR_DB -> private raw interaction events

   The frontend batches telemetry so normal news rendering never waits for it.
   ======================================================================== */

const ANALYTICS_BASE=ANALYTICS_WORKER_BASE;
const TRACK_API=`${ANALYTICS_BASE}/track`;
const ANALYTICS_CONFIG_API=`${ANALYTICS_BASE}/analytics/config`;
const GA4_CONSENT_KEY="thefloew.ga4Consent.v1";
let ga4MeasurementId="";
let ga4CollectionEnabled=false;
let ga4Initialized=false;

function getGa4Consent(){
  try{
    const value=localStorage.getItem(GA4_CONSENT_KEY);
    return value==="granted"||value==="denied"
      ? value
      : "";
  }catch(e){
    return "";
  }
}

function setGa4Consent(value){
  const normalized=value==="granted"
    ? "granted"
    : "denied";

  try{
    localStorage.setItem(
      GA4_CONSENT_KEY,
      normalized
    );
  }catch(e){}

  if(normalized==="granted"){
    initGa4();
  }else if(window.gtag){
    window.gtag("consent","update",{
      ad_storage:"denied",
      ad_user_data:"denied",
      ad_personalization:"denied",
      analytics_storage:"denied"
    });
  }
}

function ga4DataLayerInit(){
  window.dataLayer=window.dataLayer||[];
  window.gtag=window.gtag||function(){
    window.dataLayer.push(arguments);
  };
}

function initGa4(){
  if(
    ga4Initialized ||
    !ga4CollectionEnabled ||
    !ga4MeasurementId ||
    getGa4Consent()!=="granted"
  ){
    return;
  }

  ga4Initialized=true;
  ga4DataLayerInit();

  /*
    Basic consent mode: Google tag is not loaded at all before opt-in.
    Once consent is granted, initialize the four Consent Mode v2 signals.
  */
  window.gtag("consent","default",{
    ad_storage:"denied",
    ad_user_data:"denied",
    ad_personalization:"denied",
    analytics_storage:"denied"
  });

  window.gtag("consent","update",{
    ad_storage:"granted",
    ad_user_data:"granted",
    ad_personalization:"granted",
    analytics_storage:"granted"
  });

  window.gtag("js",new Date());
  window.gtag("config",ga4MeasurementId,{
    send_page_view:true,
    allow_google_signals:true
  });

  const script=document.createElement("script");
  script.async=true;
  script.src=
    `https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(ga4MeasurementId)}`;
  document.head.appendChild(script);
}

async function loadGa4Config(){
  try{
    const response=await fetch(
      ANALYTICS_CONFIG_API,
      {
        method:"GET",
        mode:"cors",
        credentials:"omit",
        cache:"default",
        headers:{"Accept":"application/json"}
      }
    );

    if(!response.ok)return;

    const data=await response.json();
    const measurementId=String(
      data?.ga4?.measurementId||""
    ).trim();

    ga4CollectionEnabled=Boolean(
      data?.ga4?.enabled &&
      /^G-[A-Z0-9]+$/i.test(measurementId)
    );

    ga4MeasurementId=
      ga4CollectionEnabled
        ? measurementId
        : "";

    if(
      ga4CollectionEnabled &&
      getGa4Consent()==="granted"
    ){
      initGa4();
    }

    updateAnalyticsConsentNotice();
  }catch(e){
    console.warn("GA4 config:",e);
  }
}

function ga4TrackAdEvent(eventType,data={}){
  if(
    !ga4Initialized ||
    !window.gtag ||
    getGa4Consent()!=="granted"
  ){
    return;
  }

  const eventMap={
    ad_view:"floew_ad_view",
    ad_skip:"floew_ad_skip",
    ad_complete:"floew_ad_complete",
    ad_return:"floew_ad_return",
    ad_repeat_view:"floew_ad_repeat_view"
  };

  const name=eventMap[eventType];
  if(!name)return;

  const meta=data?.meta||{};

  const params={
    ad_id:String(meta.ad_id||"").slice(0,100),
    ad_brand:String(meta.brand||"").slice(0,100),
    ad_campaign:String(meta.campaign||"").slice(0,100),
    ad_creative:String(meta.creative||"").slice(0,100),
    ad_orientation:String(meta.orientation||meta.layout||"").slice(0,100),
    ad_type:String(meta.type||data?.mode||"").slice(0,100)
  };

  const dwell=Number(
    meta.duration_ms ?? data?.value_num
  );

  if(
    Number.isFinite(dwell) &&
    dwell>0 &&
    (
      eventType==="ad_skip" ||
      eventType==="ad_complete"
    )
  ){
    params.ad_dwell_ms=Math.round(dwell);
  }

  window.gtag("event",name,params);
}

const FLOEW_VISITOR_KEY="thefloew.analyticsVisitor.v1";
const FLOEW_SESSION_KEY="thefloew.analyticsSession.v1";
const TELEMETRY_FLUSH_MS=30000;
const TELEMETRY_MAX_BATCH=50;

function telemetryId(){
  try{
    if(crypto?.randomUUID)return crypto.randomUUID();
  }catch(e){}
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;
}

function getTelemetryVisitorId(){
  try{
    let id=localStorage.getItem(FLOEW_VISITOR_KEY);
    if(!id){
      id=telemetryId();
      localStorage.setItem(FLOEW_VISITOR_KEY,id);
    }
    return id;
  }catch(e){
    return telemetryId();
  }
}

function getTelemetrySession(){
  const now=Date.now();
  try{
    const raw=sessionStorage.getItem(FLOEW_SESSION_KEY);
    if(raw){
      const parsed=JSON.parse(raw);
      if(parsed?.id && Number.isFinite(parsed.startedAt)){
        return parsed;
      }
    }
    const created={id:telemetryId(),startedAt:now};
    sessionStorage.setItem(FLOEW_SESSION_KEY,JSON.stringify(created));
    return created;
  }catch(e){
    return {id:telemetryId(),startedAt:now};
  }
}

const telemetryVisitorId=getTelemetryVisitorId();
const telemetrySession=getTelemetrySession();
let telemetryQueue=[];
let telemetryFlushTimer=null;
let telemetryCurrentView=null;
let telemetryMoveOrigin="";
let telemetryAdStartedAt=0;
let telemetryLastWatchKey="";
let telemetrySequence=0;
let telemetrySourceFilterSession=null;
let telemetryAutoPauseStartedAt=autoAdvancePaused?performance.now():0;
const telemetryAdSeenCount=new Map();

function telemetryAdPayload(ad=currentAd){
  if(!ad)return {};

  const orientation=
    ad.layout==="ver" || ad.layout==="hor"
      ? ad.layout
      : getAdsLayout();

  return {
    ad_id:String(ad.ad_id||ad.id||ad.name||"").slice(0,120),
    brand:String(ad.brand||"").slice(0,240),
    campaign:String(ad.campaign||"").slice(0,300),
    creative:String(ad.creative||ad.name||"").slice(0,500),
    filename:String(ad.name||"").slice(0,500),
    type:String(ad.type||"").slice(0,40),
    orientation,
    layout:orientation,
    device_type:detectDeviceType(),
    local_hour:new Date().getHours(),
    timezone:Intl.DateTimeFormat().resolvedOptions().timeZone||""
  };
}


const telemetryActivity={
  pointer_moves:0,
  pointer_distance_px:0,
  clicks:0,
  wheel_events:0,
  wheel_delta:0,
  key_events:0,
  touch_events:0,
  focus_events:0,
  blur_events:0,
  visibility_changes:0
};

let telemetryLastPointer=null;

function detectDeviceType(){
  const ua=navigator.userAgent||"";

  if(
    /Android TV|GoogleTV|SmartTV|SMART-TV|HbbTV|Tizen|Web0S|webOS|NetCast|AFT[A-Z0-9]*|BRAVIA|CrKey|Chromecast/i.test(ua)
  ){
    return "tv";
  }

  const coarse=matchMedia?.("(pointer: coarse)")?.matches;
  const width=Math.min(
    screen?.width||innerWidth||0,
    screen?.height||innerHeight||0
  );

  if(coarse && width && width<768)return "mobile";
  if(coarse && width && width<1200)return "tablet";
  return "desktop";
}

function detectBrowser(){
  const ua=navigator.userAgent||"";
  if(/Edg\//.test(ua))return "Edge";
  if(/OPR\//.test(ua))return "Opera";
  if(/Firefox\//.test(ua))return "Firefox";
  if(/Chrome\//.test(ua) && !/Edg\//.test(ua))return "Chrome";
  if(/Safari\//.test(ua) && !/Chrome\//.test(ua))return "Safari";
  return "Other";
}

function detectOS(){
  const ua=navigator.userAgent||"";
  const platform=navigator.platform||"";
  if(/Windows/i.test(ua)||/Win/i.test(platform))return "Windows";
  if(/Android/i.test(ua))return "Android";
  if(/iPhone|iPad|iPod/i.test(ua))return "iOS";
  if(/Mac/i.test(platform)||/Mac OS/i.test(ua))return "macOS";
  if(/Linux/i.test(platform)||/Linux/i.test(ua))return "Linux";
  return "Other";
}

function telemetryClientSnapshot(){
  const c=navigator.connection||navigator.mozConnection||navigator.webkitConnection||{};
  return {
    visitor_id:telemetryVisitorId,
    session_id:telemetrySession.id,
    session_started_at:telemetrySession.startedAt,
    app_version:window.__floewAppVersion,
    page:location.pathname||"/",
    href:location.href,
    referrer:document.referrer||"",
    language:navigator.language||"",
    languages:Array.from(navigator.languages||[]),
    timezone:Intl.DateTimeFormat().resolvedOptions().timeZone||"",
    user_agent:navigator.userAgent||"",
    platform:navigator.platform||"",
    browser:detectBrowser(),
    os:detectOS(),
    device_type:detectDeviceType(),
    screen_w:screen?.width||0,
    screen_h:screen?.height||0,
    viewport_w:innerWidth||0,
    viewport_h:innerHeight||0,
    dpr:devicePixelRatio||1,
    color_depth:screen?.colorDepth||0,
    hardware_concurrency:navigator.hardwareConcurrency||0,
    device_memory:navigator.deviceMemory||0,
    touch_points:navigator.maxTouchPoints||0,
    connection_type:c.effectiveType||"",
    downlink:Number(c.downlink)||0,
    rtt:Number(c.rtt)||0,
    save_data:Boolean(c.saveData),
    cookies_enabled:Boolean(navigator.cookieEnabled),
    online:Boolean(navigator.onLine)
  };
}

function telemetryStoryPayload(story){
  if(!story)return null;

  /* Özel RSS içerik kimlikleri merkezi analytics'e taşınmaz. */
  if(story.customRss){
    return {
      key:"",
      title:"",
      source:"",
      category:"",
      link:"",
      published:"",
      custom_rss:true
    };
  }

  return {
    key:storyIdentity(story),
    title:String(story.title||""),
    source:String(story.source||""),
    category:String(story.flowCategory||story.category||""),
    link:String(story.link||""),
    published:String(story.published||"")
  };
}

const CUSTOM_RSS_EVENT_MAP={
  story_view:"custom_rss_story_view",
  story_leave:"custom_rss_story_leave",
  story_back:"custom_rss_story_back",
  story_forward:"custom_rss_story_forward",
  source_open:"custom_rss_source_open",
  video_start:"custom_rss_video_start",
  video_complete:"custom_rss_video_complete",
  video_error:"custom_rss_video_error"
};

function telemetryQueueEvent(eventType,data={}){
  const hasExplicitStory=Object.prototype.hasOwnProperty.call(data,"story");
  const storyPayload=hasExplicitStory
    ? data.story
    : telemetryStoryPayload(state.stories[state.index]);
  const isCustomRss=Boolean(storyPayload?.custom_rss);
  const mappedEventType=isCustomRss
    ? (CUSTOM_RSS_EVENT_MAP[eventType]||eventType)
    : eventType;
  const meta={
    ...(data.meta&&typeof data.meta==="object"?data.meta:{}),
    ...(isCustomRss?{
      custom_rss:true,
      custom_rss_feed_count:customRssFeeds.length
    }:{})
  };

  const event={
    id:telemetryId(),
    seq:++telemetrySequence,
    event:mappedEventType,
    ts:Date.now(),
    visitor_id:telemetryVisitorId,
    session_id:telemetrySession.id,
    feed_mode:feedMode,
    story:storyPayload,
    ...data,
    meta
  };

  if(isCustomRss && mappedEventType==="custom_rss_story_leave"){
    event.value_num=Math.max(0,Number(data.dwell_ms)||0);
  }

  telemetryQueue.push(event);

  if(event.event.startsWith("ad_")){
    ga4TrackAdEvent(event.event,event);
  }

  if(telemetryQueue.length>=TELEMETRY_MAX_BATCH){
    telemetryFlush();
  }else{
    scheduleTelemetryFlush();
  }
}

function scheduleTelemetryFlush(){
  clearTimeout(telemetryFlushTimer);
  telemetryFlushTimer=setTimeout(
    ()=>telemetryFlush(),
    TELEMETRY_FLUSH_MS
  );
}

function telemetryFlush(useBeacon=false){
  if(!telemetryQueue.length)return;

  clearTimeout(telemetryFlushTimer);
  telemetryFlushTimer=null;

  const events=telemetryQueue.splice(0,TELEMETRY_MAX_BATCH);
  const payload=JSON.stringify({
    client:telemetryClientSnapshot(),
    events
  });

  if(useBeacon && navigator.sendBeacon){
    try{
      const ok=navigator.sendBeacon(
        TRACK_API,
        new Blob([payload],{type:"application/json"})
      );
      if(ok){
        if(telemetryQueue.length)telemetryFlush(true);
        return;
      }
    }catch(e){}
  }

  fetch(TRACK_API,{
    method:"POST",
    mode:"cors",
    credentials:"omit",
    keepalive:true,
    headers:{"Content-Type":"application/json"},
    body:payload
  }).catch(()=>{});

  if(telemetryQueue.length)scheduleTelemetryFlush();
}

function telemetryStartStory(story,origin="initial"){
  if(!story)return;

  rememberSeenStory(story);

  const key=storyIdentity(story);
  if(
    telemetryCurrentView &&
    telemetryCurrentView.key===key
  ){
    return;
  }

  telemetryCurrentView={
    key,
    story,
    startedAt:performance.now(),
    targetMs:Math.max(5,showDurationSeconds)*1000,
    origin,
    watchMatched:false
  };

  if(feedMode==="source" && telemetrySourceFilterSession){
    telemetrySourceFilterSession.storiesViewed++;
  }

  telemetryQueueEvent("story_view",{
    story:telemetryStoryPayload(story),
    origin,
    target_ms:telemetryCurrentView.targetMs
  });
}

function telemetryFinishStory(reason="unknown",direction=0){
  const view=telemetryCurrentView;
  if(!view)return;

  const dwell=Math.max(
    0,
    Math.round(performance.now()-view.startedAt)
  );

  const completed=reason==="auto";
  const manualSkip=
    reason==="manual_forward" &&
    dwell < view.targetMs*.92;

  telemetryQueueEvent("story_leave",{
    story:telemetryStoryPayload(view.story),
    dwell_ms:dwell,
    target_ms:view.targetMs,
    origin:view.origin,
    reason,
    direction:Number(direction)||0,
    completed,
    manual_skip:manualSkip
  });

  telemetryCurrentView=null;
  telemetryLastWatchKey="";
}

function telemetryStoryChanged(before,reason,direction=0){
  const after=state.stories[state.index]||null;
  const beforeKey=storyIdentity(before);
  const afterKey=storyIdentity(after);

  if(beforeKey && beforeKey!==afterKey){
    telemetryFinishStory(reason,direction);
  }

  if(after && (!telemetryCurrentView || telemetryCurrentView.key!==afterKey)){
    telemetryStartStory(after,reason);
  }
}

function telemetryInteractionSummary(){
  const values={...telemetryActivity};
  const meaningful=Object.values(values).some(v=>Number(v)>0);
  if(!meaningful)return;

  telemetryQueueEvent("interaction_summary",{
    meta:values
  });

  for(const key of Object.keys(telemetryActivity)){
    telemetryActivity[key]=0;
  }
}

/* Session + page start */
telemetryQueueEvent("session_start",{
  value_text:document.visibilityState,
  meta:{
    title:document.title,
    navigation_type:performance.getEntriesByType?.("navigation")?.[0]?.type||"",
    history_length:history.length
  }
});
telemetryQueueEvent("page_view",{
  value_text:location.pathname||"/"
});
telemetryQueueEvent("custom_rss_state",{
  story:null,
  mode:customRssFeeds.length?"configured":"none",
  value_num:customRssFeeds.length,
  meta:{feed_count:customRssFeeds.length}
});

/* Wrap initial/refresh loading so the first visible story is measured. */
const __floewLoad=load;
load=async function(...args){
  const hadView=Boolean(telemetryCurrentView);
  const before=state.stories[state.index]||null;
  const result=await __floewLoad.apply(this,args);
  const after=state.stories[state.index]||null;

  if(!hadView && after){
    telemetryStartStory(after,"initial");
  }else if(
    before &&
    after &&
    storyIdentity(before)!==storyIdentity(after)
  ){
    telemetryStoryChanged(before,"refresh",0);
  }

  return result;
};

/* Navigation origin and story dwell. */
const __floewMove=move;
move=async function(dir,options={}){
  const prevOrigin=telemetryMoveOrigin;
  telemetryMoveOrigin=
    options?.origin ||
    (options?.fromAd
      ? "ad_exit"
      : (dir<0 ? "manual_back" : "manual_forward"));

  if(dir<0){
    telemetryQueueEvent("story_back",{
      direction:-1,
      origin:telemetryMoveOrigin
    });
  }else if(telemetryMoveOrigin==="manual_forward"){
    telemetryQueueEvent("story_forward",{
      direction:1,
      origin:telemetryMoveOrigin
    });
  }

  try{
    return await __floewMove.call(this,dir,options);
  }finally{
    telemetryMoveOrigin=prevOrigin;
  }
};

const __floewTransitionTo=transitionTo;
transitionTo=async function(nextIndex,fromHistory,dir){
  const before=state.stories[state.index]||null;
  const reason=
    telemetryMoveOrigin ||
    (dir<0?"manual_back":"manual_forward");

  const result=await __floewTransitionTo.apply(this,arguments);
  telemetryStoryChanged(before,reason,dir);
  return result;
};

const __floewTransitionFromAdTo=transitionFromAdTo;
transitionFromAdTo=async function(nextIndex,fromHistory,dir=1){
  const before=state.stories[state.index]||null;
  const result=await __floewTransitionFromAdTo.apply(this,arguments);

  const after=state.stories[state.index]||null;
  if(after){
    if(
      telemetryCurrentView &&
      before &&
      storyIdentity(before)!==storyIdentity(after)
    ){
      telemetryFinishStory("ad_exit",dir);
    }
    telemetryStartStory(after,"ad_exit");
  }

  return result;
};

const __floewTransitionAdIn=transitionAdIn;
transitionAdIn=async function(dir=adEntryDirection){
  const ok=await __floewTransitionAdIn.apply(this,arguments);

  if(ok){
    telemetryFinishStory("ad",dir);
    telemetryAdStartedAt=performance.now();

    const meta=telemetryAdPayload(currentAd);
    const adKey=meta.ad_id||meta.filename||"unknown-ad";
    const seen=telemetryAdSeenCount.get(adKey)||0;
    const isHistoricalReturn=Boolean(historicalAdContext);

    telemetryQueueEvent("ad_view",{
      story:null,
      value_text:currentAd?.name||"",
      mode:currentAd?.type||"",
      meta
    });

    /*
      History üzerinden reklama geri gelmek, rastgele tekrar gösterimden
      ayrı tutulur. Bu event "geri dönüp yeniden izledi" metriğinin temelidir.
    */
    if(isHistoricalReturn){
      telemetryQueueEvent("ad_return",{
        story:null,
        value_text:currentAd?.name||"",
        mode:currentAd?.type||"",
        meta:{
          ...meta,
          return_direction:dir<0?-1:1
        }
      });
    }else if(seen>0){
      telemetryQueueEvent("ad_repeat_view",{
        story:null,
        value_text:currentAd?.name||"",
        mode:currentAd?.type||"",
        meta
      });
    }

    telemetryAdSeenCount.set(
      adKey,
      seen+1
    );
  }

  return ok;
};

const __floewPlayAdBreak=playAdBreak;
playAdBreak=async function(options={}){
  const startedAt=performance.now();
  const result=await __floewPlayAdBreak.apply(this,arguments);

  if(result?.shown){
    const duration=Math.max(
      0,
      Math.round(performance.now()-(telemetryAdStartedAt||startedAt))
    );
    telemetryQueueEvent(
      result.skipped ? "ad_skip" : "ad_complete",
      {
        story:null,
        value_text:result.ad?.name||"",
        value_num:duration,
        mode:result.ad?.type||"",
        meta:{
          ...telemetryAdPayload(result.ad),
          duration_ms:duration,
          direction:result.direction
        }
      }
    );
  }
  telemetryAdStartedAt=0;
  return result;
};

const __floewTransitionAdBackToCurrent=transitionAdBackToCurrent;
transitionAdBackToCurrent=async function(dir=-1){
  const result=await __floewTransitionAdBackToCurrent.apply(this,arguments);
  telemetryStartStory(state.stories[state.index],"ad_back");
  return result;
};

/* Filters can replace the visible story without a slide transition. */
const __floewApplyFilters=applyFilters;
applyFilters=function(...args){
  const before=state.stories[state.index]||null;
  const result=__floewApplyFilters.apply(this,args);
  const after=state.stories[state.index]||null;

  if(
    before &&
    after &&
    storyIdentity(before)!==storyIdentity(after)
  ){
    telemetryFinishStory("filter_change",0);
    telemetryStartStory(after,"filter_change");
  }

  return result;
};

function telemetryCloseSourceFilter(reason="close"){
  const session=telemetrySourceFilterSession;
  if(!session)return;

  const duration=Math.max(0,Math.round(performance.now()-session.startedAt));
  telemetryQueueEvent("source_filter_close",{
    story:null,
    value_text:session.name,
    value_num:duration,
    mode:reason,
    meta:{
      source_key:session.key,
      duration_ms:duration,
      stories_viewed:session.storiesViewed
    }
  });
  telemetrySourceFilterSession=null;
}

const __floewActivateTemporarySourceFeed=activateTemporarySourceFeed;
activateTemporarySourceFeed=function(sourceName){
  const name=String(sourceName||"").trim();
  const key=sourceKey(name);
  const alreadyActive=
    feedMode==="source" &&
    temporarySourceFilter?.key===key;

  if(!name || !key || alreadyActive){
    return __floewActivateTemporarySourceFeed.apply(this,arguments);
  }

  if(telemetrySourceFilterSession){
    telemetryCloseSourceFilter("source_change");
  }

  telemetrySourceFilterSession={
    name,
    key,
    startedAt:performance.now(),
    storiesViewed:0
  };

  const result=__floewActivateTemporarySourceFeed.apply(this,arguments);

  if(feedMode==="source" && temporarySourceFilter?.key===key){
    const visibleStory=state.stories[state.index]||null;
    if(
      telemetrySourceFilterSession &&
      telemetrySourceFilterSession.storiesViewed===0 &&
      sourceKey(visibleStory?.source)===key
    ){
      telemetrySourceFilterSession.storiesViewed=1;
    }

    telemetryQueueEvent("source_filter_open",{
      story:null,
      value_text:name,
      mode:"source",
      meta:{source_key:key}
    });
  }else{
    telemetrySourceFilterSession=null;
  }

  return result;
};

/* Tabs */
const __floewSwitchFeedMode=switchFeedMode;
switchFeedMode=function(nextMode){
  const beforeMode=feedMode;
  const beforeStory=state.stories[state.index]||null;
  const result=__floewSwitchFeedMode.apply(this,arguments);

  if(beforeMode==="source" && feedMode!=="source"){
    telemetryCloseSourceFilter("tab_change");
  }

  if(feedMode!==beforeMode){
    telemetryQueueEvent("tab_change",{
      value_text:`${beforeMode}->${feedMode}`,
      mode:feedMode
    });
    const after=state.stories[state.index]||null;
    if(
      beforeStory &&
      after &&
      storyIdentity(beforeStory)!==storyIdentity(after)
    ){
      telemetryFinishStory("tab_change",0);
      telemetryStartStory(after,"tab_change");
    }
  }else if(
    nextMode==="breaking" &&
    beforeMode==="agenda"
  ){
    telemetryQueueEvent("breaking_empty",{
      value_text:"no_recent_stories"
    });
  }

  return result;
};

/* Source/category preference changes */
const __floewToggleSource=toggleSource;
toggleSource=function(key){
  const wasOn=filters.sources.has(key);
  const result=__floewToggleSource.apply(this,arguments);
  telemetryQueueEvent("source_toggle",{
    value_text:String(key||""),
    mode:wasOn?"off":"on"
  });
  return result;
};

const __floewToggleCategory=toggleCategory;
toggleCategory=function(cat){
  const wasOn=filters.categories.has(cat);
  const result=__floewToggleCategory.apply(this,arguments);
  telemetryQueueEvent("category_toggle",{
    value_text:String(cat||""),
    mode:wasOn?"off":"on"
  });
  return result;
};

const __floewSetTimeRange=setTimeRange;
setTimeRange=function(value){
  const before=timeRangeValue;
  const result=__floewSetTimeRange.apply(this,arguments);
  if(before!==timeRangeValue){
    telemetryQueueEvent("time_range_change",{
      value_text:timeRangeValue,
      meta:{before,after:timeRangeValue}
    });
  }
  return result;
};

const __floewSetShowDuration=setShowDuration;
setShowDuration=function(value){
  const before=showDurationSeconds;
  const result=__floewSetShowDuration.apply(this,arguments);
  if(before!==showDurationSeconds){
    telemetryQueueEvent("duration_change",{
      value_num:showDurationSeconds,
      meta:{before,after:showDurationSeconds}
    });
  }
  return result;
};

const __floewSetAutoAdvancePaused=setAutoAdvancePaused;
setAutoAdvancePaused=function(paused){
  const before=autoAdvancePaused;
  const result=__floewSetAutoAdvancePaused.apply(this,arguments);

  if(before!==autoAdvancePaused){
    if(autoAdvancePaused){
      telemetryAutoPauseStartedAt=performance.now();
      telemetryQueueEvent("auto_advance_pause",{story:null,mode:"pause"});
    }else{
      const duration=telemetryAutoPauseStartedAt
        ? Math.max(0,Math.round(performance.now()-telemetryAutoPauseStartedAt))
        : 0;
      telemetryAutoPauseStartedAt=0;
      telemetryQueueEvent("auto_advance_resume",{
        story:null,
        mode:"resume",
        value_num:duration,
        meta:{pause_duration_ms:duration}
      });
    }
  }

  return result;
};

/* Keyword filter/watch — explicit keyword text is stored in private behavior DB. */
const __floewApplyKeywordFilter=applyKeywordFilter;
applyKeywordFilter=function(mode){
  const input=document.getElementById("keyword-filter-input");
  const text=String(input?.value||"").trim();
  const keywords=parseKeywordList(text);
  const result=__floewApplyKeywordFilter.apply(this,arguments);

  /* The easter-egg code is intentionally not written into keyword telemetry. */
  if(String(result||"").startsWith("iddqd-")){
    return result;
  }

  telemetryQueueEvent(
    keywordFilterState.mode==="show" ? "filter_show" :
    keywordFilterState.mode==="hide" ? "filter_hide" :
    "filter_off",
    {
      keyword_text:text,
      keyword_count:keywords.length,
      mode:keywordFilterState.mode
    }
  );
  return result;
};

const __floewClearKeywordFilter=clearKeywordFilter;
clearKeywordFilter=function(){
  const before=keywordFilterState.text;
  const result=__floewClearKeywordFilter.apply(this,arguments);

  if(String(result||"").startsWith("iddqd-")){
    return result;
  }

  telemetryQueueEvent("filter_clear",{
    keyword_text:before,
    keyword_count:parseKeywordList(before).length
  });
  return result;
};

const __floewApplyKeywordWatch=applyKeywordWatch;
applyKeywordWatch=function(){
  const input=document.getElementById("keyword-watch-input");
  const text=String(input?.value||"").trim();
  const keywords=parseKeywordList(text);
  const result=__floewApplyKeywordWatch.apply(this,arguments);
  telemetryQueueEvent(
    keywords.length ? "watch_enable" : "watch_off",
    {
      keyword_text:text,
      keyword_count:keywords.length,
      mode:keywords.length?"on":"off"
    }
  );
  return result;
};

const __floewClearKeywordWatch=clearKeywordWatch;
clearKeywordWatch=function(){
  const before=keywordWatchText;
  const result=__floewClearKeywordWatch.apply(this,arguments);
  telemetryQueueEvent("watch_clear",{
    keyword_text:before,
    keyword_count:parseKeywordList(before).length
  });
  return result;
};

const __floewUpdateKeywordAlert=updateKeywordAlert;
updateKeywordAlert=function(story){
  const result=__floewUpdateKeywordAlert.apply(this,arguments);
  const frame=document.getElementById("keyword-alert-frame");
  const key=storyIdentity(story);
  if(
    story &&
    frame?.classList.contains("active") &&
    key &&
    telemetryLastWatchKey!==key
  ){
    telemetryLastWatchKey=key;
    const matches=String(frame.dataset.matches||"");
    telemetryQueueEvent("watch_match",{
      story:telemetryStoryPayload(story),
      keyword_text:matches,
      keyword_count:parseKeywordList(matches).length
    });
  }
  return result;
};

/* Source click is a strong Flöra engagement signal. */
document.querySelectorAll(".source-link").forEach(link=>{
  link.addEventListener("click",()=>{
    const story=state.stories[state.index]||null;
    telemetryQueueEvent("source_open",{
      story:telemetryStoryPayload(story),
      value_text:story?.source||""
    });
  });
});

/* UI controls */
const __floewOpenMenu=openMenu;
openMenu=function(){
  telemetryQueueEvent("menu_open");
  return __floewOpenMenu.apply(this,arguments);
};

const __floewToggleFullscreen=toggleFullscreen;
toggleFullscreen=async function(){
  const result=await __floewToggleFullscreen.apply(this,arguments);
  telemetryQueueEvent("fullscreen_toggle",{
    mode:document.fullscreenElement?"on":"off"
  });
  return result;
};

const __floewTogglePiP=togglePiP;
togglePiP=async function(){
  const result=await __floewTogglePiP.apply(this,arguments);
  telemetryQueueEvent("pip_toggle");
  return result;
};

document.querySelectorAll(".direction-option").forEach(btn=>{
  btn.addEventListener("click",()=>{
    telemetryQueueEvent("direction_change",{
      value_text:btn.dataset.direction||"up"
    });
  });
});

document.getElementById("video-setting")?.addEventListener("click",()=>{
  setTimeout(()=>{
    telemetryQueueEvent("video_setting",{
      mode:videoEnabled?"on":"off"
    });
  },0);
});

document.getElementById("video-only-setting")?.addEventListener("click",()=>{
  setTimeout(()=>{
    telemetryQueueEvent("video_only_setting",{
      mode:videoOnlyEnabled?"on":"off"
    });
  },0);
});

/* Video engagement */
document.querySelectorAll(".slide-video").forEach(video=>{
  let trackedKey="";
  video.addEventListener("playing",()=>{
    const story=state.stories[state.index]||null;
    const key=storyIdentity(story);
    if(key && key!==trackedKey){
      trackedKey=key;
      telemetryQueueEvent("video_start",{
        story:telemetryStoryPayload(story)
      });
    }
  });
  video.addEventListener("ended",()=>{
    const story=state.stories[state.index]||null;
    telemetryQueueEvent("video_complete",{
      story:telemetryStoryPayload(story)
    });
  });
  video.addEventListener("error",()=>{
    const story=state.stories[state.index]||null;
    telemetryQueueEvent("video_error",{
      story:telemetryStoryPayload(story)
    });
  });
});

/* Raw-but-batched movement / interaction counters */
window.addEventListener("pointermove",e=>{
  telemetryActivity.pointer_moves++;
  if(telemetryLastPointer){
    const dx=e.clientX-telemetryLastPointer.x;
    const dy=e.clientY-telemetryLastPointer.y;
    telemetryActivity.pointer_distance_px+=Math.round(Math.hypot(dx,dy));
  }
  telemetryLastPointer={x:e.clientX,y:e.clientY};
},{passive:true});

window.addEventListener("click",()=>{
  telemetryActivity.clicks++;
},{passive:true});

window.addEventListener("wheel",e=>{
  telemetryActivity.wheel_events++;
  telemetryActivity.wheel_delta+=Math.round(Math.abs(e.deltaY||e.deltaX||0));
},{passive:true});

window.addEventListener("keydown",()=>{
  telemetryActivity.key_events++;
},{passive:true});

window.addEventListener("touchstart",()=>{
  telemetryActivity.touch_events++;
},{passive:true});

window.addEventListener("focus",()=>{
  telemetryActivity.focus_events++;
  telemetryQueueEvent("window_focus");
},{passive:true});

window.addEventListener("blur",()=>{
  telemetryActivity.blur_events++;
  telemetryQueueEvent("window_blur");
},{passive:true});

document.addEventListener("visibilitychange",()=>{
  telemetryActivity.visibility_changes++;
  telemetryQueueEvent("visibility_change",{
    value_text:document.visibilityState
  });
});

window.addEventListener("resize",()=>{
  telemetryQueueEvent("viewport_change",{
    meta:{
      viewport_w:innerWidth,
      viewport_h:innerHeight,
      orientation:innerWidth>=innerHeight?"landscape":"portrait"
    }
  });
},{passive:true});

window.addEventListener("online",()=>{
  telemetryQueueEvent("network_state",{mode:"online"});
});
window.addEventListener("offline",()=>{
  telemetryQueueEvent("network_state",{mode:"offline"});
});

window.addEventListener("error",e=>{
  telemetryQueueEvent("client_error",{
    value_text:String(e.message||"error"),
    meta:{
      filename:String(e.filename||""),
      lineno:Number(e.lineno)||0,
      colno:Number(e.colno)||0
    }
  });
});

window.addEventListener("unhandledrejection",e=>{
  telemetryQueueEvent("client_rejection",{
    value_text:String(e.reason?.message||e.reason||"rejection").slice(0,500)
  });
});

setInterval(()=>{
  telemetryInteractionSummary();
  telemetryQueueEvent("session_heartbeat",{
    value_num:Date.now()-telemetrySession.startedAt,
    meta:{
      visibility:document.visibilityState,
      story_key:state.stories[state.index]?.customRss
        ? ""
        : storyIdentity(state.stories[state.index])
    }
  });
},30000);

window.addEventListener("pagehide",()=>{
  telemetryFinishStory("pagehide",0);
  if(telemetrySourceFilterSession){
    telemetryCloseSourceFilter("pagehide");
  }
  if(autoAdvancePaused && telemetryAutoPauseStartedAt){
    const duration=Math.max(0,Math.round(performance.now()-telemetryAutoPauseStartedAt));
    telemetryQueueEvent("auto_advance_pause_end",{
      story:null,
      mode:"pagehide",
      value_num:duration,
      meta:{pause_duration_ms:duration}
    });
    telemetryAutoPauseStartedAt=0;
  }
  telemetryInteractionSummary();
  telemetryQueueEvent("session_end",{
    value_num:Date.now()-telemetrySession.startedAt
  });
  telemetryFlush(true);
});

window.addEventListener("beforeunload",()=>{
  telemetryFlush(true);
});

window.FloewAnalytics={
  flush:()=>telemetryFlush(),
  visitorId:telemetryVisitorId,
  sessionId:telemetrySession.id,
  status:()=>({
    queued:telemetryQueue.length,
    currentStory:telemetryCurrentView?.key||"",
    endpoint:TRACK_API
  })
};


let screenWakeLock=null;
let wakeLockRetryArmed=false;

function desktopWakeLockEligible(){
  return Boolean(
    navigator.wakeLock?.request &&
    window.matchMedia?.("(hover: hover) and (pointer: fine)")?.matches
  );
}

async function requestDesktopWakeLock(){
  if(
    !desktopWakeLockEligible() ||
    document.visibilityState!=="visible" ||
    screenWakeLock
  ) return;

  try{
    const lock=await navigator.wakeLock.request("screen");
    screenWakeLock=lock;
    wakeLockRetryArmed=false;
    lock.addEventListener("release",()=>{
      if(screenWakeLock===lock)screenWakeLock=null;
    },{once:true});
  }catch(error){
    /* Bazı tarayıcılar ilk kullanıcı etkileşimine kadar isteği reddedebilir. */
    wakeLockRetryArmed=true;
  }
}

function retryDesktopWakeLockAfterGesture(){
  if(wakeLockRetryArmed || !screenWakeLock){
    requestDesktopWakeLock();
  }
}

window.addEventListener("pointerdown",retryDesktopWakeLockAfterGesture,{passive:true});
window.addEventListener("keydown",retryDesktopWakeLockAfterGesture,{passive:true});

document.addEventListener("visibilitychange",()=>{
  if(document.visibilityState==="visible"){
    requestDesktopWakeLock();
  }
});

window.addEventListener("pagehide",()=>{
  try{screenWakeLock?.release?.()}catch(e){}
  screenWakeLock=null;
});

setTimeout(requestDesktopWakeLock,0);

setFullscreenIcon();
startAdsCatalogRefresh();
load();
loadInlineFloraScores();
loadGa4Config();
setInterval(load,REFRESH_MS);

/*
  Mobil tarayıcı arka plandan dönerken veya Wi-Fi/hücresel ağ değiştirirken
  ilk istek browser tarafından iptal edilmiş olabilir. Akış boşsa bağlantı
  geri geldiğinde otomatik olarak yeniden dene.
*/
window.addEventListener("online",()=>{
  if(!state.stories.length){
    resetInitialNewsRetry();
    load();
  }
});

window.addEventListener("pageshow",()=>{
  if(!state.stories.length){
    load();
  }
});

document.addEventListener("visibilitychange",()=>{
  if(document.visibilityState==="visible"){
    if(!state.stories.length)load();
    if(fxRatesVisible || stockTickerVisible)refreshMarketData(true);
  }
});
setInterval(
  ()=>loadInlineFloraScores(true),
  FLORA_SCORES_REFRESH_MS
);

if(window.__floewInitialReady){
  showCookieNoticeIfNeeded();
  initWeather();
}

document.getElementById("status-close")?.addEventListener("click", function(e){
  e.stopPropagation();
  clearStatus();
});
