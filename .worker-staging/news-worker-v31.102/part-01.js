const WORKER_VERSION = "31.102";
const VIDEO_RESOLVER_VERSION = "20260825-6";
const NEWS_BATCH_COUNT = 12;
const MAX_ARTICLE_HTML_CHARS = 700_000;
const NEWS_CATEGORY_BATCH_LIMIT = 24;
const NEWS_SOURCE_CATEGORY_LIMIT = 4;

/*
  v31.99 — /news CPU protection.

  Client requests intentionally carry cache-busting query params and JSONP
  callbacks. Those must not force the Worker to download + parse the same RSS
  catalog again. We therefore keep a canonical internal batch cache and a
  slightly longer parsed-source cache. Source TTLs are deterministically
  staggered so all ~20 feeds in one batch do not expire at the same instant.
*/
const NEWS_BATCH_CACHE_SECONDS = 30;
const NEWS_WIDGET_STALE_SECONDS = 6 * 60 * 60;
const NEWS_WIDGET_FALLBACK_LIMIT = 20;
const NEWS_SOURCE_CACHE_MIN_SECONDS = 90;
const NEWS_SOURCE_CACHE_SPREAD_SECONDS = 90;
const NEWS_RSS_MAX_BYTES = 1_500_000;
const NEWS_RSS_SCAN_BLOCK_LIMIT = 42;
const NEWS_CACHE_SCHEMA = "20260928-1";

function newsStableHash(value = "") {
  let hash = 2166136261;
  const text = String(value || "");

  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }

  return hash >>> 0;
}

function newsSourceCacheSeconds(source = {}) {
  return (
    NEWS_SOURCE_CACHE_MIN_SECONDS +
    (newsStableHash(source.url || source.name || "") %
      Math.max(1, NEWS_SOURCE_CACHE_SPREAD_SECONDS + 1))
  );
}

function newsSourceCacheRequest(source = {}) {
  const key = new URL("https://floew.internal/news-source");
  key.searchParams.set("schema", NEWS_CACHE_SCHEMA);
  key.searchParams.set("url", String(source.url || ""));
  return new Request(key.href);
}

function newsBatchCacheRequest(batch) {
  const key = new URL("https://floew.internal/news-batch");
  key.searchParams.set("schema", NEWS_CACHE_SCHEMA);
  key.searchParams.set("batch", String(batch));
  return new Request(key.href);
}

function newsWidgetStaleCacheRequest(batch) {
  const key = new URL("https://floew.internal/news-widget-stale");
  key.searchParams.set("schema", NEWS_CACHE_SCHEMA);
  key.searchParams.set("batch", String(batch));
  return new Request(key.href);
}

function isWidgetNewsRequest(request, url, rawBatch) {
  if (url.searchParams.get("widget") === "1") return true;
  if (rawBatch === null) return true;

  /*
    Native WidgetKit URLSession requests normally identify themselves through
    CFNetwork rather than the Safari/WKWebView UA used by the main app. Keep
    this as a compatibility path so existing widget builds do not need an
    immediate URL change.
  */
  const ua = String(request.headers.get("User-Agent") || "");
  return /FloewWidget|FloewWidgetExtension|\bCFNetwork\b/i.test(ua);
}

async function cachedNewsJson(cache, cacheRequest) {
  try {
    const response = await cache.match(cacheRequest);
    if (!response) return "";
    const text = await response.text();
    return text && text.charCodeAt(0) === 91 ? text : "";
  } catch (error) {
    console.warn("News cache read failed:", error);
    return "";
  }
}

async function widgetNewsFallbackRows() {
  /*
    Absolute last resort for a brand-new deployment before any normal /news
    request has populated the long-lived snapshot. Resolve ONE ordinary RSS
    source only; never fan out across the catalog from a widget invocation.
  */
  const source =
    SOURCES.find(item =>
      !item.disabled &&
      item.kind !== "video-index" &&
      !item.foreign &&
      item.name === "TRT Haber"
    ) ||
    SOURCES.find(item =>
      !item.disabled &&
      item.kind !== "video-index" &&
      !item.foreign
    );

  if (!source) return [];

  try {
    const rows = await fetchSource(source);
    return Array.isArray(rows) ? rows.slice(0, NEWS_WIDGET_FALLBACK_LIMIT) : [];
  } catch (error) {
    console.warn("Widget news fallback failed:", error);
    return [];
  }
}

function newsBatchResponse(
  json,
  batch,
  callback,
  corsHeaders,
  cacheStatus = "MISS"
) {
  const sharedHeaders = {
    ...corsHeaders,
    "Cache-Control": "no-store",
    "X-TheFloew-Batch": String(batch),
    "X-TheFloew-Batch-Count": String(NEWS_BATCH_COUNT),
    "X-Floew-News-Cache": cacheStatus,
    "X-Floew-Worker-Version": WORKER_VERSION
  };

  if (callback) {
    return new Response(`${callback}(${json});`, {
      status: 200,
      headers: {
        ...sharedHeaders,
        "Content-Type": "application/javascript; charset=utf-8"
      }
    });
  }

  return new Response(json, {
    status: 200,
    headers: {
      ...sharedHeaders,
      "Content-Type": "application/json; charset=utf-8"
    }
  });
}

/*
  Cache writes are best-effort. A failed background cache.put must never turn
  an otherwise successful Worker invocation into an uncaught exception.
*/
function safeWaitUntil(ctx, promise, label = "background") {
  if (!ctx || typeof ctx.waitUntil !== "function") return;

  try {
    ctx.waitUntil(
      Promise.resolve(promise).catch(error => {
        console.warn(`Background task failed: ${label}`, error);
      })
    );
  } catch (error) {
    console.warn(`Background task registration failed: ${label}`, error);
  }
}

const SOURCES = [
  // Genel haber kaynakları
  { name: "BBC Türkçe", url: "https://feeds.bbci.co.uk/turkce/rss.xml", fixedCategory: null, defaultCategory: "#Dünya" },
  { name: "DW Türkçe", url: "https://rss.dw.com/rdf/rss-tur-all", fixedCategory: null, defaultCategory: "#Dünya" },
  { name: "Sputnik Türkiye", url: "https://tr.sputniknews.com/export/rss2/archive/index.xml", fixedCategory: null, defaultCategory: "#Dünya" },
  { name: "Aydınlık", url: "https://www.aydinlik.com.tr/feed", fixedCategory: null, defaultCategory: "#Türkiye" },
  { name: "BHA", url: "https://bha.net.tr/rss", fixedCategory: null, defaultCategory: "#Türkiye" },
  { name: "Birgün", url: "https://www.birgun.net/rss/home", fixedCategory: null, defaultCategory: "#Türkiye" },
  { name: "Bloomberg HT", url: "https://www.bloomberght.com/rss", fixedCategory: null, defaultCategory: "#Türkiye" },
  { name: "Capital", url: "https://www.capital.com.tr/rss/all", fixedCategory: "#Ekonomi" },
  { name: "Forbes", url: "https://www.forbes.com.tr/rss", fixedCategory: "#Ekonomi" },
  { name: "CNBC-e", url: "https://www.cnbce.com/rss", fixedCategory: null, defaultCategory: "#Dünya" },
  { name: "Diken", url: "https://www.diken.com.tr/feed/", fixedCategory: null, defaultCategory: "#Türkiye" },
  { name: "Halk TV", url: "https://halktv.com.tr/service/rss.php", fixedCategory: null, defaultCategory: "#Türkiye" },
  { name: "Independent Türkçe", url: "https://www.indyturk.com/rss.xml", fixedCategory: null, defaultCategory: "#Dünya" },
  { name: "Teyit.org", url: "https://teyit.org/feed?lang=tr", fixedCategory: "#Türkiye" },

 // Anadolu Ajansı
  { name: "Anadolu Ajansı", url: "https://www.aa.com.tr/tr/rss/default?cat=guncel", fixedCategory: null, defaultCategory: "#Türkiye" },
  { name: "Anadolu Ajansı", url: "https://www.aa.com.tr/tr/teyithatti/rss/video", fixedCategory: null, defaultCategory: "#Türkiye" },
  { name: "Anadolu Ajansı", url: "https://www.aa.com.tr/tr/teyithatti/rss/news?cat=politika", fixedCategory: "#Dünya" },
  { name: "Anadolu Ajansı", url: "https://www.aa.com.tr/tr/teyithatti/rss/news?cat=aktuel", fixedCategory: "#Dünya" },
  { name: "Anadolu Ajansı", url: "https://www.aa.com.tr/tr/teyithatti/rss/news?cat=bilim-teknoloji", fixedCategory: "#Teknoloji" },
  { name: "Anadolu Ajansı", url: "https://www.aa.com.tr/tr/teyithatti/rss/news?cat=ekonomi", fixedCategory: "#Ekonomi" },
  { name: "Anadolu Ajansı", url: "https://www.aa.com.tr/tr/teyithatti/rss/news?cat=kultur-sanat", fixedCategory: "#Kültür-Sanat" },

 // Sözcü
  { name: "Sözcü", url: "https://www.sozcu.com.tr/feeds-son-dakika", fixedCategory: null, defaultCategory: "#Türkiye", fixedBreaking: true },
  { name: "Sözcü", url: "https://www.sozcu.com.tr/feeds-haberler", fixedCategory: null, defaultCategory: "#Türkiye" },
  { name: "Sözcü", url: "https://www.sozcu.com.tr/feeds-rss-category-yasam", fixedCategory: "#Yaşam" },
  { name: "Sözcü", url: "https://www.sozcu.com.tr/feeds-rss-category-ekonomi", fixedCategory: "#Ekonomi" },
  { name: "Sözcü", url: "https://www.sozcu.com.tr/feeds-rss-category-dunya", fixedCategory: "#Dünya" },
  { name: "Sözcü", url: "https://www.sozcu.com.tr/feeds-rss-category-saglik", fixedCategory: "#Sağlık" },
  { name: "Sözcü", url: "https://www.sozcu.com.tr/feeds-rss-category-borsa", fixedCategory: "#Ekonomi" },
  { name: "Sözcü", url: "https://www.sozcu.com.tr/feeds-rss-category-basketbol", fixedCategory: "#Spor" },
  { name: "Sözcü", url: "https://www.sozcu.com.tr/feeds-rss-category-kultur-sanat", fixedCategory: "#Kültür-Sanat" },
  { name: "Sözcü", url: "https://www.sozcu.com.tr/feeds-rss-category-otomotiv", fixedCategory: "#Otomotiv" },
  { name: "Sözcü", url: "https://www.sozcu.com.tr/feeds-rss-category-bilim-teknoloji", fixedCategory: "#Teknoloji" },
  { name: "Sözcü", url: "https://www.sozcu.com.tr/feeds-rss-category-finans", fixedCategory: "#Ekonomi" },
  { name: "Sözcü", url: "https://www.sozcu.com.tr/feeds-rss-category-spor", fixedCategory: "#Spor" },
  { name: "Sözcü", url: "https://www.sozcu.com.tr/feeds-rss-category-magazin", fixedCategory: "#Magazin" },

  // Habertürk
  { name: "Habertürk", url: "https://www.haberturk.com/rss", fixedCategory: null, defaultCategory: "#Türkiye" },
  { name: "Habertürk", url: "https://www.haberturk.com/rss/ekonomi.xml", fixedCategory: "#Ekonomi" },
  { name: "Habertürk", url: "https://www.haberturk.com/rss/magazin.xml", fixedCategory: "#Magazin" },
  { name: "Habertürk", url: "https://www.haberturk.com/rss/kategori/medya.xml", fixedCategory: "#Televizyon" },
  { name: "Habertürk", url: "https://www.haberturk.com/rss/kategori/kadin.xml", fixedCategory: "#Yaşam" },
  { name: "Habertürk", url: "https://www.haberturk.com/rss/kategori/siyaset.xml", fixedCategory: "#Siyaset" },
  { name: "Habertürk", url: "https://www.haberturk.com/rss/kategori/tatil.xml", fixedCategory: null, defaultCategory: "#Türkiye" },
  { name: "Habertürk", url: "https://www.haberturk.com/rss/spor.xml", fixedCategory: "#Spor" },
  { name: "Habertürk", url: "https://www.haberturk.com/rss/kategori/saglik.xml", fixedCategory: "#Sağlık" },
  { name: "Habertürk", url: "https://www.haberturk.com/rss/kategori/dunya.xml", fixedCategory: "#Dünya" },
  { name: "Habertürk", url: "https://www.haberturk.com/rss/kategori/yasam.xml", fixedCategory: "#Yaşam" },
  { name: "Habertürk", url: "https://www.haberturk.com/rss/kategori/kultur-sanat.xml", fixedCategory: "#Kültür-Sanat" },
  { name: "Habertürk", url: "https://www.haberturk.com/rss/kategori/sinema.xml", fixedCategory: "#Sinema" },
  { name: "Habertürk", url: "https://www.haberturk.com/rss/kategori/teknoloji.xml", fixedCategory: "#Teknoloji" },
  { name: "Habertürk", url: "https://www.haberturk.com/rss/kategori/otomobil.xml", fixedCategory: "#Otomotiv" },
  { name: "Habertürk", url: "https://www.haberturk.com/rss/kategori/kitap.xml", fixedCategory: "#Edebiyat" },

   // NTV
  { name: "NTV", url: "https://www.ntv.com.tr/gundem.rss", fixedCategory: null, defaultCategory: "#Türkiye" },
  { name: "NTV", url: "https://www.ntv.com.tr/turkiye.rss", fixedCategory: "#Türkiye", defaultCategory: "#Türkiye" },
  { name: "NTV", url: "https://www.ntv.com.tr/dunya.rss", fixedCategory: "#Dünya" },
  { name: "NTV", url: "https://www.ntv.com.tr/ekonomi.rss", fixedCategory: "#Ekonomi" },
  { name: "NTV", url: "https://www.ntv.com.tr/spor.rss", fixedCategory: "#Spor", disabled: true },
  { name: "NTV", url: "https://www.ntv.com.tr/teknoloji.rss", fixedCategory: "#Teknoloji" },
  { name: "NTV", url: "https://www.ntv.com.tr/yasam.rss", fixedCategory: "#Yaşam" },
  { name: "NTV", url: "https://www.ntv.com.tr/seyahat.rss", fixedCategory: "#Gezi", disabled: true },
  { name: "NTV", url: "https://www.ntv.com.tr/saglik.rss", fixedCategory: "#Sağlık" },
  { name: "NTV", url: "https://www.ntv.com.tr/sanat.rss", fixedCategory: "#Kültür-Sanat", disabled: true },
  { name: "NTV", url: "https://www.ntv.com.tr/otomobil.rss", fixedCategory: "#Otomotiv" },
  { name: "NTV", url: "https://www.ntv.com.tr/egitim.rss", fixedCategory: "#Yaşam" },

  // Cumhuriyet
  { name: "Cumhuriyet", url: "http://www.cumhuriyet.com.tr/rss/3.xml", fixedCategory: "#Türkiye", defaultCategory: "#Türkiye" },
  { name: "Cumhuriyet", url: "http://www.cumhuriyet.com.tr/rss/6.xml", fixedCategory: "#Kültür-Sanat" },
  { name: "Cumhuriyet", url: "http://www.cumhuriyet.com.tr/rss/9.xml", fixedCategory: "#Yaşam" },
  { name: "Cumhuriyet", url: "http://www.cumhuriyet.com.tr/rss/17.xml", fixedCategory: "#Magazin" },
  { name: "Cumhuriyet", url: "http://www.cumhuriyet.com.tr/rss/24.xml", fixedCategory: "#Tarih" },
  { name: "Cumhuriyet", url: "http://www.cumhuriyet.com.tr/rss/14.xml", fixedCategory: "#Gezi" },
  { name: "Cumhuriyet", url: "http://www.cumhuriyet.com.tr/rss/16.xml", fixedCategory: "#Televizyon" },
  { name: "Cumhuriyet", url: "http://www.cumhuriyet.com.tr/rss/11.xml", fixedCategory: "#Sağlık" },
  { name: "Cumhuriyet", url: "http://www.cumhuriyet.com.tr/rss/10.xml", fixedCategory: "#Teknoloji" },

  // Hürriyet
  { name: "Hürriyet", url: "http://www.hurriyet.com.tr/rss/anasayfa", fixedCategory: null, defaultCategory: "#Türkiye" },
  { name: "Hürriyet", url: "http://www.hurriyet.com.tr/rss/gundem", fixedCategory: "#Türkiye", defaultCategory: "#Türkiye" },
  { name: "Hürriyet", url: "http://www.hurriyet.com.tr/rss/ekonomi", fixedCategory: "#Ekonomi" },
  { name: "Hürriyet", url: "http://www.hurriyet.com.tr/rss/magazin", fixedCategory: "#Magazin" },
  { name: "Hürriyet", url: "http://www.hurriyet.com.tr/rss/spor", fixedCategory: "#Spor" },
  { name: "Hürriyet", url: "http://www.hurriyet.com.tr/rss/dunya", fixedCategory: "#Dünya" },
  { name: "Hürriyet", url: "http://www.hurriyet.com.tr/rss/teknoloji", fixedCategory: "#Teknoloji" },
  { name: "Hürriyet", url: "http://www.hurriyet.com.tr/rss/saglik", fixedCategory: "#Sağlık", disabled: true },

  // Milliyet
  { name: "Milliyet", url: "https://www.milliyet.com.tr/rss/rssnew/sondakikarss.xml", fixedCategory: null, defaultCategory: "#Türkiye", fixedBreaking: true },
  { name: "Milliyet", url: "http://www.milliyet.com.tr/rss/rssNew/gundemRss.xml", fixedCategory: "#Türkiye", defaultCategory: "#Türkiye" , disabled: true },
  { name: "Milliyet", url: "http://www.milliyet.com.tr/rss/rssNew/magazinRss.xml", fixedCategory: "#Magazin" , disabled: true },
  { name: "Milliyet", url: "http://www.milliyet.com.tr/rss/rssNew/kitapRss.xml", fixedCategory: "#Edebiyat" , disabled: true },
  { name: "Milliyet", url: "http://www.milliyet.com.tr/rss/rssNew/dunyaRss.xml", fixedCategory: "#Dünya" , disabled: true },
  { name: "Milliyet", url: "http://www.milliyet.com.tr/rss/rssNew/ekonomiRss.xml", fixedCategory: "#Ekonomi" , disabled: true },
  { name: "Milliyet", url: "http://www.milliyet.com.tr/rss/rssNew/siyasetRss.xml", fixedCategory: "#Siyaset" , disabled: true },
  { name: "Milliyet", url: "http://www.milliyet.com.tr/rss/rssNew/otomobilRss.xml", fixedCategory: "#Otomotiv" , disabled: true },
  { name: "Milliyet", url: "http://www.milliyet.com.tr/rss/rssNew/teknolojiRss.xml", fixedCategory: "#Teknoloji" , disabled: true },
  { name: "Milliyet", url: "http://www.milliyet.com.tr/rss/rssNew/milliyettatilRss.xml", fixedCategory: "#Gezi" , disabled: true },
  { name: "Milliyet", url: "http://www.milliyet.com.tr/rss/rssNew/aileRss.xml", fixedCategory: "#Yaşam" , disabled: true },
  { name: "Milliyet", url: "http://www.milliyet.com.tr/rss/rssNew/saglikRss.xml", fixedCategory: "#Sağlık" , disabled: true },

  // CNN Türk
  { name: "CNN Türk", url: "https://www.cnnturk.com/feed/rss/all/news", fixedCategory: null, defaultCategory: "#Türkiye" },
  { name: "CNN Türk", url: "https://www.cnnturk.com/feed/rss/turkiye/news", fixedCategory: "#Türkiye", defaultCategory: "#Türkiye" },
  { name: "CNN Türk", url: "https://www.cnnturk.com/feed/rss/dunya/news", fixedCategory: "#Dünya" },
  { name: "CNN Türk", url: "https://www.cnnturk.com/feed/rss/kultur-sanat/news", fixedCategory: "#Kültür-Sanat" },
  { name: "CNN Türk", url: "https://www.cnnturk.com/feed/rss/bilim-teknoloji/news", fixedCategory: "#Teknoloji" },
  { name: "CNN Türk", url: "https://www.cnnturk.com/feed/rss/yasam/news", fixedCategory: "#Yaşam" },
  { name: "CNN Türk", url: "https://www.cnnturk.com/feed/rss/magazin/news", fixedCategory: "#Magazin" },
  { name: "CNN Türk", url: "https://www.cnnturk.com/feed/rss/ekonomi/news", fixedCategory: "#Ekonomi" },
  { name: "CNN Türk", url: "https://www.cnnturk.com/feed/rss/spor/news", fixedCategory: "#Spor" },
  { name: "CNN Türk", url: "https://www.cnnturk.com/feed/rss/saglik/news", fixedCategory: "#Sağlık" },
  { name: "CNN Türk", url: "https://www.cnnturk.com/feed/rss/otomobil/news", fixedCategory: "#Otomotiv" },
  { name: "CNN Türk", url: "https://www.cnnturk.com/feed/rss/seyahat/news", fixedCategory: "#Gezi" },

  // CNN Türk Video
  { name: "CNN Türk", url: "https://www.cnnturk.com/feed/rss/all/video", fixedCategory: null, defaultCategory: "#Türkiye" },
  { name: "CNN Türk", url: "https://www.cnnturk.com/feed/rss/turkiye/video", fixedCategory: "#Türkiye", defaultCategory: "#Türkiye" },
  { name: "CNN Türk", url: "https://www.cnnturk.com/feed/rss/dunya/video", fixedCategory: "#Dünya" },
  { name: "CNN Türk", url: "https://www.cnnturk.com/feed/rss/kultur-sanat/video", fixedCategory: "#Kültür-Sanat" },
  { name: "CNN Türk", url: "https://www.cnnturk.com/feed/rss/bilim-teknoloji/video", fixedCategory: "#Teknoloji" },
  { name: "CNN Türk", url: "https://www.cnnturk.com/feed/rss/yasam/video", fixedCategory: "#Yaşam" },
  { name: "CNN Türk", url: "https://www.cnnturk.com/feed/rss/magazin/video", fixedCategory: "#Magazin" },
  { name: "CNN Türk", url: "https://www.cnnturk.com/feed/rss/ekonomi/video", fixedCategory: "#Ekonomi" },
  { name: "CNN Türk", url: "https://www.cnnturk.com/feed/rss/spor/video", fixedCategory: "#Spor" },
  { name: "CNN Türk", url: "https://www.cnnturk.com/feed/rss/saglik/video", fixedCategory: "#Sağlık" },
  { name: "CNN Türk", url: "https://www.cnnturk.com/feed/rss/otomobil/video", fixedCategory: "#Otomotiv" },
  { name: "CNN Türk", url: "https://www.cnnturk.com/feed/rss/seyahat/video", fixedCategory: "#Gezi" },

  // Mynet
  { name: "Mynet", url: "https://www.mynet.com/magazin/rss", fixedCategory: "#Magazin", disabled: true },
  { name: "Mynet", url: "http://sinema.mynet.com/rss/RSS-enyeniler/rss.xml", fixedCategory: "#Sinema", disabled: true },
  { name: "Mynet", url: "http://spor.mynet.com/rss", fixedCategory: "#Spor" },
  { name: "Mynet", url: "http://www.mynet.com/haber/rss/sondakika", fixedCategory: null, defaultCategory: "#Türkiye", fixedBreaking: true },
  { name: "Mynet", url: "http://www.mynet.com/haber/rss/gununozeti/", fixedCategory: null, defaultCategory: "#Türkiye" },
  { name: "Mynet", url: "http://www.mynet.com/haber/rss/kategori/politika/", fixedCategory: "#Siyaset" },
  { name: "Mynet", url: "http://www.mynet.com/haber/rss/kategori/teknoloji/", fixedCategory: "#Teknoloji" },
  { name: "Mynet", url: "http://www.mynet.com/haber/rss/kategori/dunya/", fixedCategory: "#Dünya" },
  { name: "Mynet", url: "http://www.mynet.com/haber/rss/kategori/yasam/", fixedCategory: "#Yaşam" },
  { name: "Mynet", url: "http://www.mynet.com/haber/rss/kategori/magazin/", fixedCategory: "#Magazin", disabled: true },
  { name: "Mynet", url: "http://www.mynet.com/haber/rss/kategori/saglik/", fixedCategory: "#Sağlık" },

  // TRT Haber
  { name: "TRT Haber", url: "https://www.trthaber.com/manset_articles.rss", fixedCategory: null, defaultCategory: "#Türkiye" },
  { name: "TRT Haber", url: "https://www.trthaber.com/sondakika_articles.rss", fixedCategory: null, defaultCategory: "#Türkiye", fixedBreaking: true },
  { name: "TRT Haber", url: "https://www.trthaber.com/turkiye_articles.rss", fixedCategory: "#Türkiye" },
  { name: "TRT Haber", url: "https://www.trthaber.com/dunya_articles.rss", fixedCategory: "#Dünya" },
  { name: "TRT Haber", url: "https://www.trthaber.com/ekonomi_articles.rss", fixedCategory: "#Ekonomi" },
  { name: "TRT Haber", url: "https://www.trthaber.com/spor_articles.rss", fixedCategory: "#Spor" },
  { name: "TRT Haber", url: "https://www.trthaber.com/kultur_sanat_articles.rss", fixedCategory: "#Kültür-Sanat" },
  { name: "TRT Haber", url: "https://www.trthaber.com/bilim_teknoloji_articles.rss", fixedCategory: "#Teknoloji" },

  // Teknoloji / otomotiv
  { name: "ShiftDelete.Net", url: "https://shiftdelete.net/feed", fixedCategory: "#Teknoloji" },
  { name: "CHIP Online", url: "https://www.chip.com.tr/rss", fixedCategory: "#Teknoloji" },
  { name: "Motor1 Türkiye", url: "https://tr.motor1.com/rss/news/all/", fixedCategory: "#Otomotiv" },
  { name: "LOG", url: "https://www.log.com.tr/feed/", fixedCategory: "#Teknoloji" },
  { name: "Teknopat", url: "https://www.technopat.net/feed/", fixedCategory: "#Teknoloji" },

  // Onedio'nun resmi kategori RSS akışları
  { name: "Onedio", url: "https://onedio.com/Publisher/publisher-yasam.rss", fixedCategory: "#Yaşam" },
  { name: "Onedio", url: "https://onedio.com/Publisher/publisher-seyahat.rss", fixedCategory: "#Gezi" },
  { name: "Onedio", url: "https://onedio.com/Publisher/publisher-saglik.rss", fixedCategory: "#Sağlık" },
  { name: "Onedio", url: "https://onedio.com/Publisher/publisher-dizi+%26+film.rss", fixedCategory: "#Sinema" },
  { name: "Onedio", url: "https://onedio.com/Publisher/publisher-spor.rss", fixedCategory: "#Spor" },
  { name: "Onedio", url: "https://onedio.com/Publisher/publisher-ekonomi.rss", fixedCategory: "#Ekonomi" },
  { name: "Onedio", url: "https://onedio.com/Publisher/publisher-tv.rss", fixedCategory: "#Televizyon" },
  { name: "Onedio", url: "https://onedio.com/Publisher/publisher-teknoloji.rss", fixedCategory: "#Teknoloji" },
  { name: "Onedio", url: "https://onedio.com/Publisher/publisher-magazin.rss", fixedCategory: "#Magazin" },
  { name: "Onedio", url: "https://onedio.com/Publisher/publisher-genel+kultur.rss", fixedCategory: "#Kültür-Sanat" },

  // Sabah
  { name: "Sabah", url: "https://www.sabah.com.tr/rss/sondakika.xml", fixedCategory: null, defaultCategory: "#Türkiye", fixedBreaking: true },
  { name: "Sabah", url: "https://www.sabah.com.tr/rss/gundem.xml", fixedCategory: null, defaultCategory: "#Türkiye" },
  { name: "Sabah", url: "https://www.sabah.com.tr/rss/dunya.xml", fixedCategory: "#Dünya" },
  { name: "Sabah", url: "https://www.sabah.com.tr/rss/yasam.xml", fixedCategory: "#Yaşam" },
  { name: "Sabah", url: "https://www.sabah.com.tr/rss/teknoloji.xml", fixedCategory: "#Teknoloji" },
  { name: "Sabah", url: "https://www.sabah.com.tr/rss/otomobil.xml", fixedCategory: "#Otomotiv" },
  { name: "Sabah", url: "https://www.sabah.com.tr/rss/saglik.xml", fixedCategory: "#Sağlık" },
  { name: "Sabah", url: "https://www.sabah.com.tr/rss/kultur-sanat.xml", fixedCategory: "#Kültür-Sanat" },
  { name: "Sabah", url: "https://www.sabah.com.tr/rss/spor.xml", fixedCategory: "#Spor" },
  { name: "Sabah", url: "https://www.sabah.com.tr/rss/turizm.xml", fixedCategory: "#Gezi" },

  // Takvim
  { name: "Takvim", url: "https://www.takvim.com.tr/rss/guncel.xml", fixedCategory: null, defaultCategory: "#Türkiye" },
  { name: "Takvim", url: "https://www.takvim.com.tr/rss/son24saat.xml", fixedCategory: null, defaultCategory: "#Türkiye" },
  { name: "Takvim", url: "https://www.takvim.com.tr/rss/video.xml", fixedCategory: null, defaultCategory: "#Türkiye" },
  { name: "Takvim", url: "https://www.takvim.com.tr/rss/saklambac.xml", fixedCategory: "#Magazin" },
  { name: "Takvim", url: "https://www.takvim.com.tr/rss/yasam.xml", fixedCategory: "#Yaşam" },
  { name: "Takvim", url: "https://www.takvim.com.tr/rss/otomobil.xml", fixedCategory: "#Otomotiv" },
  { name: "Takvim", url: "https://www.takvim.com.tr/rss/ekonomi.xml", fixedCategory: "#Ekonomi" },
  { name: "Takvim", url: "https://www.takvim.com.tr/rss/spor.xml", fixedCategory: "#Spor" },
  { name: "Takvim", url: "https://www.takvim.com.tr/rss/televizyon.xml", fixedCategory: "#Televizyon" },

  // Star
  { name: "Star", url: "https://www.star.com.tr/rss/rss.asp", fixedCategory: null, defaultCategory: "#Türkiye", fixedBreaking: true },
  { name: "Star", url: "https://www.star.com.tr/rss/rss.asp?cid=13", fixedCategory: null, defaultCategory: "#Türkiye" },
  { name: "Star", url: "https://www.star.com.tr/rss/rss.asp?cid=19", fixedCategory: "#Kültür-Sanat" },
  { name: "Star", url: "https://www.star.com.tr/rss/rss.asp?cid=15", fixedCategory: "#Ekonomi" },
  { name: "Star", url: "https://www.star.com.tr/rss/rss.asp?cid=170", fixedCategory: "#Otomotiv" },
  { name: "Star", url: "https://www.star.com.tr/rss/rss.asp?cid=17", fixedCategory: "#Dünya" },
  { name: "Star", url: "https://www.star.com.tr/rss/rss.asp?cid=16", fixedCategory: "#Spor" },
  { name: "Star", url: "https://www.star.com.tr/rss/rss.asp?cid=125", fixedCategory: "#Sağlık" },

  // Sinema / televizyon
  { name: "Beyazperde", url: "https://www.beyazperde.com/rss/film-haberleri.xml", fixedCategory: "#Sinema" },
  { name: "Beyazperde", url: "https://www.beyazperde.com/rss/diziler-haberleri.xml", fixedCategory: "#Televizyon" },

  // Bilim, sağlık, tarih ve edebiyat: özel akışlar önce, genel akış sonra.
  { name: "Evrim Ağacı", url: "https://evrimagaci.org/kategori/saglik-bilimleri-869/rss.xml", fixedCategory: "#Sağlık" },
  { name: "Evrim Ağacı", url: "https://evrimagaci.org/kategori/tarih-1376/rss.xml", fixedCategory: "#Tarih" },
  { name: "Evrim Ağacı", url: "https://evrimagaci.org/kategori/edebiyat-1720/rss.xml", fixedCategory: "#Edebiyat" },
  { name: "Evrim Ağacı", url: "https://evrimagaci.org/rss.xml", fixedCategory: "#Bilim" },
  { name: "Independent Bilim", url: "https://www.indyturk.com/taxonomy/term/48791/%2A/feed", fixedCategory: "#Bilim" },

  // Kültür / müzik / edebiyat için WordPress RSS akışları. Kaynak hata verirse
  // fetchSource bunu sessizce atlar; diğer kaynakların akışı etkilenmez.
  { name: "Bant Mag.", url: "https://bantmag.com/feed/", fixedCategory: null, defaultCategory: "#Müzik" },
  { name: "Bir Baba Indie", url: "https://www.birbabaindie.com/feed/", fixedCategory: null, defaultCategory: "#Müzik" },
  { name: "Edebiyat Haber", url: "https://www.edebiyathaber.net/feed/", fixedCategory: "#Edebiyat" },
  { name: "2Yaka", url: "https://2yaka.org/feed/", fixedCategory: "#Edebiyat" },
  { name: "Cazkolik", url: "https://cazkolik.com/rss.xml", fixedCategory: "#Müzik" },
  { name: "Deli Kasap", url: "https://www.delikasap.org/feed/", fixedCategory: "#Müzik" },

  // Moda / yaşam dergileri ve iyi yaşam yayınları
  { name: "ELLE Türkiye", url: "https://www.elle.com.tr/rss", fixedCategory: null, defaultCategory: "#Moda" },
  { name: "Marie Claire Türkiye", url: "https://www.marieclaire.com.tr/feed/", fixedCategory: null, defaultCategory: "#Moda" },
  { name: "İstanbul Life", url: "https://istanbullife.com.tr/feed/", fixedCategory: null, defaultCategory: "#Yaşam" },
  { name: "Live To Bloom", url: "https://livetobloom.com/feed/", fixedCategory: null, defaultCategory: "#Sağlık" },
  { name: "Elele", url: "https://www.elele.com.tr/export/rss", fixedCategory: null, defaultCategory: "#Yaşam" },
  { name: "Bigumigu", url: "https://bigumigu.com/feed/", fixedCategory: "#Yaşam", disabled: true },

  // Tarih / arkeoloji
  { name: "Arkeofili", url: "https://arkeofili.substack.com/feed", fixedCategory: "#Tarih" },

  // İşin Detayı
  { name: "İşin Detayı", url: "https://www.isindetayi.com/rss/moda", fixedCategory: "#Moda" },
  { name: "İşin Detayı", url: "https://www.isindetayi.com/rss/saglik", fixedCategory: "#Sağlık" },
  { name: "İşin Detayı", url: "https://www.isindetayi.com/rss/turizm", fixedCategory: "#Gezi" },
  { name: "İşin Detayı", url: "https://www.isindetayi.com/rss/yasam", fixedCategory: "#Yaşam" },
  { name: "Basket Dergisi", url: "https://basketdergisi.com/feed", fixedCategory: "#Spor" },

  // Yabancı akış — yalnız "Yabancı" sekmesinde gösterilir.
  { name: "Al Jazeera", url: "https://www.aljazeera.com/xml/rss/all.xml", fixedCategory: "#Yabancı", foreign: true },
  { name: "DW", url: "https://rss.dw.com/rdf/rss-en-top", fixedCategory: "#Yabancı", foreign: true },
  { name: "France 24", url: "https://www.france24.com/en/rss", fixedCategory: "#Yabancı", foreign: true },
  { name: "Euronews", url: "https://www.euronews.com/rss", fixedCategory: "#Yabancı", foreign: true },
  { name: "Sky News", url: "https://feeds.skynews.com/feeds/rss/world.xml", fixedCategory: "#Yabancı", foreign: true },
  { name: "BBC News", url: "https://feeds.bbci.co.uk/news/world/rss.xml", fixedCategory: "#Yabancı", foreign: true },
  { name: "The New York Times", url: "https://www.nytimes.com/svc/collections/v1/publish/https://www.nytimes.com/section/world/rss.xml", fixedCategory: "#Yabancı", foreign: true },
  { name: "NPR", url: "https://feeds.npr.org/1004/rss.xml", fixedCategory: "#Yabancı", foreign: true },
  { name: "NBC News", url: "https://feeds.nbcnews.com/nbcnews/public/news", fixedCategory: "#Yabancı", foreign: true },
  { name: "Los Angeles Times", url: "https://www.latimes.com/world-nation/rss2.0.xml", fixedCategory: "#Yabancı", foreign: true },
  { name: "The New York Times", url: "https://rss.nytimes.com/services/xml/rss/nyt/World.xml", fixedCategory: "#Yabancı", foreign: true },
  { name: "The Guardian", url: "https://www.theguardian.com/world/rss", fixedCategory: "#Yabancı", foreign: true },
  { name: "The Independent", url: "http://www.independent.co.uk/news/world/rss", fixedCategory: "#Yabancı", foreign: true },
  { name: "Financial Times", url: "https://www.ft.com/world?format=rss", fixedCategory: "#Yabancı", foreign: true },
  { name: "The Sun", url: "https://www.thesun.co.uk/news/worldnews/feed/", fixedCategory: "#Yabancı", foreign: true, disabled: true },
  { name: "The Mirror", url: "https://www.mirror.co.uk/news/world-news/?service=rss", fixedCategory: "#Yabancı", foreign: true },
  { name: "Le Monde", url: "https://www.lemonde.fr/en/international/rss_full.xml", fixedCategory: "#Yabancı", foreign: true },
  { name: "Global News", url: "https://globalnews.ca/world/feed/", fixedCategory: "#Yabancı", foreign: true },
  { name: "South China Morning Post", url: "https://www.scmp.com/rss/91/feed/", fixedCategory: "#Yabancı", foreign: true },
  { name: "The Sydney Morning Herald", url: "https://www.smh.com.au/rss/world.xml", fixedCategory: "#Yabancı", foreign: true },
  { name: "The Japan Times", url: "https://www.japantimes.co.jp/feed/", fixedCategory: "#Yabancı", foreign: true },
  { name: "CNBC", url: "https://www.cnbc.com/id/100727362/device/rss/rss.html", fixedCategory: "#Yabancı", foreign: true },
  { name: "Financial Times", url: "https://www.ft.com/rss/home/international", fixedCategory: "#Yabancı", foreign: true },
  { name: "The Wall Street Journal", url: "https://feeds.content.dowjones.io/public/rss/RSSWorldNews", fixedCategory: "#Yabancı", foreign: true },
  { name: "The Verge", url: "https://www.theverge.com/rss/index.xml", fixedCategory: "#Yabancı", foreign: true },
  { name: "TechCrunch", url: "https://techcrunch.com/feed/", fixedCategory: "#Yabancı", foreign: true },
  { name: "WIRED", url: "https://www.wired.com/feed/rss", fixedCategory: "#Yabancı", foreign: true },
  { name: "Vox", url: "https://www.vox.com/rss/world-politics/index.xml", fixedCategory: "#Yabancı", foreign: true },
  { name: "RT", url: "https://www.rt.com/rss/news/", fixedCategory: "#Yabancı", foreign: true },
  { name: "Sputnik", url: "https://sputnikglobe.com/export/rss2/archive/index.xml", fixedCategory: "#Yabancı", foreign: true },
  ,
  // v31.74 — Dedicated video discovery.
  // These complement (not replace) the normal RSS feeds.
  {
    name: "Halk TV",
    url: "https://halktv.com.tr/video-galeri",
    kind: "video-index",
    videoIndex: "halktv",
    fixedCategory: null,
    defaultCategory: "#Türkiye"
  },
  {
    name: "NTV",
    url: "https://www.ntv.com.tr/",
    kind: "video-index",
    videoIndex: "ntv",
    fixedCategory: null,
    defaultCategory: "#Türkiye"
  },
  {
    name: "NTV",
    url: "https://www.ntv.com.tr/turkiye",
    kind: "video-index",
    videoIndex: "ntv",
    fixedCategory: "#Türkiye",
    defaultCategory: "#Türkiye"
  },
  {
    name: "NTV",
    url: "https://www.ntv.com.tr/video/",
    kind: "video-index",
    videoIndex: "ntv",
    fixedCategory: null,
    defaultCategory: "#Türkiye"
  }

];

const C = {
  BREAKING: "#SonDakika",
  LIFE: "#Yaşam",
  TURKEY: "#Türkiye",
  WORLD: "#Dünya",
  POLITICS: "#Siyaset",
  ECONOMY: "#Ekonomi",
  MAGAZINE: "#Magazin",
  TECHNOLOGY: "#Teknoloji",
  CULTURE: "#Kültür-Sanat",
  CINEMA: "#Sinema",
  AUTOMOTIVE: "#Otomotiv",
  LITERATURE: "#Edebiyat",
  MUSIC: "#Müzik",
  TELEVISION: "#Televizyon",
  SPORTS: "#Spor",
  HEALTH: "#Sağlık",
  SCIENCE: "#Bilim",
  FASHION: "#Moda",
  HISTORY: "#Tarih",
  TRAVEL: "#Gezi",
  FOREIGN: "#Yabancı"
};

function normalize(value = "") {
  return String(value)
    .toLocaleLowerCase("tr-TR")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/ı/g, "i")
    .replace(/ğ/g, "g")
    .replace(/ü/g, "u")
    .replace(/ş/g, "s")
    .replace(/ö/g, "o")
    .replace(/ç/g, "c")
    .replace(/\s+/g, " ")
    .trim();
}

function decodeEntities(text = "") {
  return String(text)
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&#(\d+);/g, (_, n) => {
      try { return String.fromCodePoint(Number(n)); } catch { return ""; }
    })
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => {
      try { return String.fromCodePoint(parseInt(n, 16)); } catch { return ""; }
    });
}

function cleanText(value = "") {
  return decodeEntities(
    String(value)
      /*
       * RSS açıklamaları sıklıkla CDATA içinde gelir:
       * <![CDATA[<p>Metin...</p>]]>
       *
       * HTML etiketlerini temizlemeden önce CDATA sınırlarını kaldırıyoruz.
       * Aksi halde kapanıştaki "]]>" düz metin olarak açıklamanın sonunda
       * kalabiliyordu.
       */
      .replace(/<!\[CDATA\[/gi, "")
      .replace(/\]\]>/g, "")
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]*>/g, " ")
      .replace(/\s+/g, " ")
      .trim()
  );
}

function getTagRaw(xml, tag) {
  const re = new RegExp(
    `<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tag}>`,
    "i"
  );
  return xml.match(re)?.[1] || "";
}

function getTag(xml, tag) {
  return cleanText(getTagRaw(xml, tag));
}

function getFirstTag(xml, tags) {
  for (const tag of tags) {
    const value = getTag(xml, tag);
    if (value) return value;
  }
  return "";
}

function getAttr(tag = "", name = "") {
  const re = new RegExp(
    `${name}\\s*=\\s*["']([^"']+)["']`,
    "i"
  );
  return tag.match(re)?.[1] || "";
}

function absoluteUrl(value = "", base = "") {
  const cleaned = decodeEntities(String(value || ""))
    .replace(/\\\//g, "/")
    .trim();

  if (!cleaned) return "";

  try {
    return new URL(cleaned, base || undefined).href;
  } catch {
    return "";
  }
}

function looksLikeVideoUrl(value = "", type = "") {
  const u = String(value || "").toLowerCase();
  const t = String(type || "").toLowerCase();

  return (
    t.startsWith("video/") ||
    t.includes("mpegurl") ||
    /\.(?:mp4|m4v|webm|ogv|mov)(?:[?#]|$)/i.test(u) ||
    /\.m3u8(?:[?#]|$)/i.test(u)
  );
}

function getFeedVideo(item, baseUrl = "") {
  /*
    v31.82 — RSS-level media is allowed to bypass /video ONLY when the feed
    gives concrete native-media evidence. `medium="video"` by itself is not
    enough: several publishers use it for HTML player/document URLs. The
    frontend treats story.video as a native <video> source, so passing an HTML
    player here makes the resolver impossible to reach.
  */
  const mediaTags =
    item.match(/<media:content\b[^>]*>/gi) || [];

  for (const tag of mediaTags) {
    const url = getAttr(tag, "url");
    const type = getAttr(tag, "type");

    if (url && looksLikeVideoUrl(url, type)) {
      return {
        url: absoluteUrl(url, baseUrl),
        type: type || ""
      };
    }
  }

  const enclosureTags =
    item.match(/<enclosure\b[^>]*>/gi) || [];

  for (const tag of enclosureTags) {
    const url = getAttr(tag, "url");
    const type = getAttr(tag, "type");

    if (url && looksLikeVideoUrl(url, type)) {
      return {
        url: absoluteUrl(url, baseUrl),
        type: type || ""
      };
    }
  }

  const videoTags =
    item.match(/<video\b[^>]*>/gi) || [];

  for (const tag of videoTags) {
    const url = getAttr(tag, "src");
    const type = getAttr(tag, "type");

    if (url && looksLikeVideoUrl(url, type)) {
      return {
        url: absoluteUrl(url, baseUrl),
        type: type || ""
      };
    }
  }

  const sourceTags =
    item.match(/<source\b[^>]*>/gi) || [];

  for (const tag of sourceTags) {
    const url = getAttr(tag, "src");
    const type = getAttr(tag, "type");

    if (url && looksLikeVideoUrl(url, type)) {
      return {
        url: absoluteUrl(url, baseUrl),
        type: type || ""
      };
    }
  }

  return null;
}

const IMAGE_TRACKING_PIXEL_LIMIT_PX = 16;

function imageNumberAttr(tag = "", name = "") {
  const raw = getAttr(tag, name);
  const value = Number.parseFloat(
    String(raw || "").replace(/[^\d.]/g, "")
  );
  return Number.isFinite(value) ? value : 0;
}

function imageStyleDimension(
  style = "",
  property = ""
) {
  const match = String(style || "").match(
    new RegExp(
      `(?:^|[;{\\s])${property}\\s*:\\s*(\\d+(?:\\.\\d+)?)px`,
      "i"
    )
  );

  if (!match) return 0;

  const value = Number.parseFloat(match[1]);
  return Number.isFinite(value) ? value : 0;
}

function imageLooksTinyOrTracking(
  value = "",
  tag = ""
) {
  const url = String(value || "").toLowerCase();
  const width = imageNumberAttr(tag, "width");
  const height = imageNumberAttr(tag, "height");
  const style = String(
    getAttr(tag, "style") || ""
  ).toLowerCase();

  const styleWidth =
    imageStyleDimension(style, "width");
  const styleHeight =
    imageStyleDimension(style, "height");

  /*
    True tracking pixels/placeholders stay a hard reject.
    The broader 500 px rule is handled separately as a quality preference,
    so a feed that only has a 400 px image does not become image-less.
  */
  if (
    (width > 0 &&
      width <= IMAGE_TRACKING_PIXEL_LIMIT_PX) ||
    (height > 0 &&
      height <= IMAGE_TRACKING_PIXEL_LIMIT_PX) ||
    (styleWidth > 0 &&
      styleWidth <= IMAGE_TRACKING_PIXEL_LIMIT_PX) ||
    (styleHeight > 0 &&
      styleHeight <= IMAGE_TRACKING_PIXEL_LIMIT_PX)
  ) {
    return true;
  }

  return (
    /(?:^|[\/_.?=&-])1x1(?:[\/_.?=&-]|$)/i.test(url) ||
    /(?:pixel|spacer|blank|clear(?:\.gif)?|beacon|tracking|tracker|transparent)/i.test(url)
  );
}

function srcsetBestCandidate(
  value = "",
  baseUrl = "",
  tag = ""
) {
  const entries = String(value || "")
    .split(",")
    .map(part => part.trim())
    .filter(Boolean);

  let best = null;

  const tagWidth = imageNumberAttr(tag, "width");
  const tagHeight = imageNumberAttr(tag, "height");

  for (const entry of entries) {
    const parts = entry
      .split(/\s+/)
      .filter(Boolean);

    const rawUrl = parts[0] || "";
    const descriptor = parts[1] || "";
    const absolute = absoluteUrl(rawUrl, baseUrl);

    if (!absolute) continue;

    let score = 1;
    let width = 0;
    let height = 0;

    const widthMatch =
      descriptor.match(/^(\d+(?:\.\d+)?)w$/i);

    const densityMatch =
      descriptor.match(/^(\d+(?:\.\d+)?)x$/i);

    if (widthMatch) {
      width = Number(widthMatch[1]) || 0;
      score = width || 1;

      if (
        tagWidth > 0 &&
        tagHeight > 0 &&
        width > 0
      ) {
        height = Math.round(
          width * (tagHeight / tagWidth)
        );
      }
    } else if (densityMatch) {
      const density = Number(densityMatch[1]) || 1;
      score = density * 1000;

      if (tagWidth > 0) {
        width = Math.round(tagWidth * density);
      }

      if (tagHeight > 0) {
        height = Math.round(tagHeight * density);
      }
    } else {
      width = tagWidth;
      height = tagHeight;
    }

    if (!best || score > best.score) {
      best = {
        url: absolute,
        score,
        width,
        height
      };
    }
  }

  return best;
}


function getImage(item, baseUrl = "") {
  const candidates = [];

  const add = (
    rawUrl = "",
    tag = "",
    baseScore = 0,
    extraScore = 0,
    dimensionHint = null,
    kind = "generic"
  ) => {
    const url = absoluteUrl(rawUrl, baseUrl);
    if (!url) return;

    /*
      Keep only the true spacer/tracking-pixel filter.
      There is deliberately NO 500 px rule anymore.
    */
    if (imageLooksTinyOrTracking(url, tag)) {
      return;
    }

    const tagWidth = imageNumberAttr(tag, "width");
    const tagHeight = imageNumberAttr(tag, "height");

    const width =
      Number(dimensionHint?.width) > 0
        ? Number(dimensionHint.width)
        : tagWidth;

    const height =
      Number(dimensionHint?.height) > 0
        ? Number(dimensionHint.height)
        : tagHeight;

    let score = baseScore + extraScore;

    /*
      Dimensions are only a positive quality signal.
      Small images are not rejected by a fixed threshold; a larger
      candidate simply outranks a smaller candidate when both exist.
    */
    if (width > 0 && height > 0) {
      score += Math.min(
        220,
        Math.log10(
          Math.max(1, width * height)
        ) * 28
      );
    } else if (width > 0 || height > 0) {
      score += Math.min(
        120,
        Math.log10(
          Math.max(1, width || height)
        ) * 32
      );
    }

    candidates.push({
      url,
      score,
      width,
      height,
      kind
    });
  };

  /*
    IMPORTANT:
    media:thumbnail is intentionally NOT parsed at all.
    Flöw will no longer use RSS thumbnail images under any condition.
  */

  // Explicit RSS media content is the strongest feed-level candidate.
  for (
    const tag of
    item.match(/<media:content\b[^>]*>/gi) || []
  ) {
    const url = getAttr(tag, "url");
    const type = getAttr(tag, "type");
    const medium =
      getAttr(tag, "medium").toLowerCase();

    if (
      url &&
      medium !== "video" &&
      !looksLikeVideoUrl(url, type)
    ) {
      add(
        url,
        tag,
        420,
        0,
        null,
        "media-content"
      );
    }
  }

  // Image enclosures are usually original or high-quality assets.
  for (
    const tag of
    item.match(/<enclosure\b[^>]*>/gi) || []
  ) {
    const url = getAttr(tag, "url");
    const type = getAttr(tag, "type");

    if (
      url &&
      !looksLikeVideoUrl(url, type)
    ) {
      add(
        url,
        tag,
        390,
        0,
        null,
        "enclosure"
      );
    }
  }

  /*
    Embedded HTML can expose the real high-resolution image in lazy-load
    attributes or srcset even when ordinary src is a smaller derivative.
  */
  for (
    const tag of
    item.match(/<img\b[^>]*>/gi) || []
  ) {
    for (
      const attr of [
        "data-src",
        "data-lazy-src",
        "data-original",
        "data-image",
        "data-url"
      ]
    ) {
      const value = getAttr(tag, attr);

      if (value) {
        add(
          value,
          tag,
          340,
          80,
          null,
          "lazy"
        );
      }
    }

    for (
      const attr of [
        "data-srcset",
        "data-lazy-srcset",
        "srcset"
