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
]
    ) {
      const value = getAttr(tag, attr);
      if (!value) continue;

      const best =
        srcsetBestCandidate(
          value,
          baseUrl,
          tag
        );

      if (best?.url) {
        add(
          best.url,
          tag,
          430,
          130,
          best,
          "srcset"
        );
      }
    }

    const src = getAttr(tag, "src");

    if (src) {
      add(
        src,
        tag,
        210,
        0,
        null,
        "img-src"
      );
    }
  }

  /*
    picture/source srcset commonly contains the largest publisher variant.
  */
  for (
    const tag of
    item.match(/<source\b[^>]*>/gi) || []
  ) {
    const type =
      getAttr(tag, "type").toLowerCase();

    if (
      type &&
      !type.startsWith("image/")
    ) {
      continue;
    }

    for (
      const attr of [
        "data-srcset",
        "data-lazy-srcset",
        "srcset"
      ]
    ) {
      const value = getAttr(tag, attr);
      if (!value) continue;

      const best =
        srcsetBestCandidate(
          value,
          baseUrl,
          tag
        );

      if (best?.url) {
        add(
          best.url,
          tag,
          450,
          150,
          best,
          "picture-source"
        );
      }
    }
  }

  if (!candidates.length) {
    return "";
  }

  candidates.sort(
    (a, b) =>
      b.score - a.score ||
      (b.width * b.height) -
        (a.width * a.height)
  );

  return candidates[0]?.url || "";
}

function getRssImageFallback(item, source = {}) {
  /*
    Some otherwise-valid RSS feeds expose the article image only through
    classic <image> fields or media:thumbnail. Those feeds used to vanish
    completely because parseRSS requires an image.

    This function is intentionally a LOW-PRIORITY fallback. getImage() still
    gets first choice, so media:content, enclosure, srcset and normal embedded
    <img> candidates continue to win whenever they exist. This prevents the
    old low-resolution-thumbnail regression while keeping image-only feeds
    from being dropped wholesale.
  */
  const baseUrl = source.url || "";
  const candidates = [];

  const add = (raw = "", tag = "", score = 0, kind = "fallback") => {
    const value = cleanText(raw) || String(raw || "").trim();
    if (!value) return;

    const url = absoluteUrl(value, baseUrl);
    if (!url) return;
    if (imageLooksTinyOrTracking(url, tag)) return;

    const width = imageNumberAttr(tag, "width");
    const height = imageNumberAttr(tag, "height");
    let finalScore = score;

    if (width > 0 && height > 0) {
      finalScore += Math.min(180, Math.log10(Math.max(1, width * height)) * 24);
    } else if (width > 0 || height > 0) {
      finalScore += Math.min(90, Math.log10(Math.max(1, width || height)) * 24);
    }

    candidates.push({ url, score: finalScore, width, height, kind });
  };

  // Classic RSS item image: <image>URL</image> or <image><url>URL</url></image>.
  const imageRaw = getTagRaw(item, "image");
  if (imageRaw) {
    const nestedUrl =
      getFirstTag(imageRaw, ["url", "src", "loc", "href"]);
    const directValue = cleanText(imageRaw);

    if (nestedUrl) add(nestedUrl, imageRaw, 260, "rss-image-nested");
    if (directValue) add(directValue, imageRaw, 250, "rss-image");
  }

  // Attribute-based variants such as <image url="..."/>.
  for (const tag of item.match(/<image\b[^>]*>/gi) || []) {
    const raw =
      getAttr(tag, "url") ||
      getAttr(tag, "src") ||
      getAttr(tag, "href");
    if (raw) add(raw, tag, 245, "rss-image-attribute");
  }

  // A few feeds use generic thumbnail tags without the media namespace.
  for (const tag of item.match(/<thumbnail\b[^>]*>/gi) || []) {
    const raw =
      getAttr(tag, "url") ||
      getAttr(tag, "src") ||
      getAttr(tag, "href");
    if (raw) add(raw, tag, 185, "thumbnail");
  }

  // Last resort only: media:thumbnail. Prefer the largest advertised one.
  for (const tag of item.match(/<media:thumbnail\b[^>]*>/gi) || []) {
    const raw = getAttr(tag, "url");
    if (raw) add(raw, tag, 160, "media-thumbnail");
  }

  // Podcast-style image attributes occasionally appear in general feeds.
  for (const tag of item.match(/<itunes:image\b[^>]*>/gi) || []) {
    const raw = getAttr(tag, "href") || getAttr(tag, "url");
    if (raw) add(raw, tag, 140, "itunes-image");
  }

  if (!candidates.length) return "";

  candidates.sort(
    (a, b) =>
      b.score - a.score ||
      (b.width * b.height) - (a.width * a.height)
  );

  return candidates[0]?.url || "";
}

function htmlAttr(tag = "", name = "") {
  const re = new RegExp(
    `(?:^|\\s)${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`,
    "i"
  );
  const match = tag.match(re);
  return decodeEntities(
    match?.[1] ?? match?.[2] ?? match?.[3] ?? ""
  );
}

function normalizeYouTubeEmbed(value = "") {
  try {
    const u = new URL(value);
    const host = u.hostname.toLowerCase();
    let id = "";

    if (host === "youtu.be") {
      id = u.pathname.split("/").filter(Boolean)[0] || "";
    } else if (
      host.endsWith("youtube.com") ||
      host.endsWith("youtube-nocookie.com")
    ) {
      if (u.pathname.startsWith("/embed/")) {
        id = u.pathname.split("/")[2] || "";
      } else if (u.pathname.startsWith("/shorts/")) {
        id = u.pathname.split("/")[2] || "";
      } else {
        id = u.searchParams.get("v") || "";
      }
    }

    if (!/^[A-Za-z0-9_-]{6,20}$/.test(id)) return "";

    const p = new URL(
      `https://www.youtube-nocookie.com/embed/${id}`
    );
    p.searchParams.set("autoplay", "1");
    p.searchParams.set("mute", "1");
    p.searchParams.set("controls", "0");
    p.searchParams.set("disablekb", "1");
    p.searchParams.set("fs", "0");
    p.searchParams.set("rel", "0");
    p.searchParams.set("playsinline", "1");
    p.searchParams.set("iv_load_policy", "3");
    p.searchParams.set("cc_load_policy", "0");
    p.searchParams.set("loop", "1");
    p.searchParams.set("playlist", id);
    return p.href;
  } catch {
    return "";
  }
}

function normalizeVimeoEmbed(value = "") {
  try {
    const u = new URL(value);
    const host = u.hostname.toLowerCase();

    if (
      host !== "vimeo.com" &&
      host !== "www.vimeo.com" &&
      host !== "player.vimeo.com"
    ) return "";

    const match = u.pathname.match(/(?:\/video)?\/(\d{5,12})/);
    const id = match?.[1] || "";
    if (!id) return "";

    const p = new URL(`https://player.vimeo.com/video/${id}`);
    p.searchParams.set("autoplay", "1");
    p.searchParams.set("muted", "1");
    p.searchParams.set("background", "1");
    p.searchParams.set("loop", "1");
    p.searchParams.set("controls", "0");
    p.searchParams.set("title", "0");
    p.searchParams.set("byline", "0");
    p.searchParams.set("portrait", "0");
    p.searchParams.set("keyboard", "0");
    p.searchParams.set("dnt", "1");
    return p.href;
  } catch {
    return "";
  }
}


function normalizeDailymotionEmbed(value = "") {
  try {
    const u = new URL(value);
    const host = u.hostname.toLowerCase();

    const isDailymotion =
      host === "dailymotion.com" ||
      host === "www.dailymotion.com" ||
      host === "geo.dailymotion.com" ||
      host.endsWith(".dailymotion.com");

    if (!isDailymotion) return "";

    let id = u.searchParams.get("video") || "";
    let playerId = "";

    if (!id) {
      const match = u.pathname.match(
        /(?:\/video\/|\/embed\/video\/)([A-Za-z0-9]+)/
      );
      id = match?.[1] || "";
    }

    const playerMatch = u.pathname.match(
      /\/player\/([A-Za-z0-9_-]+)\.(?:html|js)$/i
    );
    playerId = playerMatch?.[1] || "";

    if (!/^[A-Za-z0-9]{5,24}$/.test(id)) return "";

    /*
      Flöw yalnız programatik olarak kontrol edebildiği Dailymotion Player
      yapılarını kabul eder. Player ID yoksa autoplay/mute/loop/ses kontrolü
      tüm cihazlarda garanti edilemeyeceği için bu adayı kullanma.
    */
    if (!/^[A-Za-z0-9_-]{3,40}$/.test(playerId)) return "";

    const p = new URL(
      `https://geo.dailymotion.com/player/${playerId}.html`
    );
    p.searchParams.set("video", id);
    p.searchParams.set("autoplay", "true");
    p.searchParams.set("mute", "true");
    p.searchParams.set("loop", "true");
    p.searchParams.set("scaleMode", "fill");
    return p.href;
  } catch {
    return "";
  }
}


/*
  Dailymotion'ın standart embed biçimleri özel Player ID taşımaz:
    - https://www.dailymotion.com/embed/video/<videoId>
    - https://www.dailymotion.com/video/<videoId>
    - https://geo.dailymotion.com/player.html?video=<videoId>
    - https://dai.ly/<videoId>

  normalizeDailymotionEmbed() bilinçli olarak yalnız programatik SDK kontrolü
  yapılabilen özel Player ID'li URL'leri kabul eder. Haber gövdesinde açıkça
  bulunan standart Dailymotion player'larını ise SDK'ya sokmadan plain iframe
  olarak oynatmak için bu daha gevşek normalizer kullanılır.
*/
function normalizeDailymotionIframeFallback(value = "", baseUrl = "") {
  const absolute = absoluteUrl(value, baseUrl);
  if (!absolute) return "";

  try {
    const u = new URL(absolute);
    const host = u.hostname.toLowerCase();
    const isDailymotion =
      host === "dailymotion.com" ||
      host === "www.dailymotion.com" ||
      host === "geo.dailymotion.com" ||
      host.endsWith(".dailymotion.com") ||
      host === "dai.ly" ||
      host.endsWith(".dai.ly");

    if (!isDailymotion) return "";

    let id =
      u.searchParams.get("video") ||
      u.searchParams.get("videoId") ||
      u.searchParams.get("video_id") ||
      "";

    if (!id) {
      const match = u.pathname.match(
        /(?:\/video\/|\/embed\/video\/|^\/)([A-Za-z0-9]{5,24})(?:[\/?#]|$)/i
      );
      id = match?.[1] || "";
    }

    if (!/^[A-Za-z0-9]{5,24}$/.test(id)) return "";

    const p = new URL(`https://www.dailymotion.com/embed/video/${id}`);
    p.searchParams.set("autoplay", "1");
    p.searchParams.set("mute", "1");
    p.searchParams.set("loop", "1");
    p.searchParams.set("queue-enable", "false");
    p.searchParams.set("sharing-enable", "false");
    return p.href;
  } catch {
    return "";
  }
}

function normalizeKnownEmbed(value = "", baseUrl = "") {
  const absolute = absoluteUrl(value, baseUrl);
  if (!absolute) return null;

  const youtube = normalizeYouTubeEmbed(absolute);
  if (youtube) {
    return {
      kind: "embed",
      provider: "youtube",
      url: youtube
    };
  }

  const vimeo = normalizeVimeoEmbed(absolute);
  if (vimeo) {
    return {
      kind: "embed",
      provider: "vimeo",
      url: vimeo
    };
  }

  const dailymotion = normalizeDailymotionEmbed(absolute);
  if (dailymotion) {
    return {
      kind: "embed",
      provider: "dailymotion",
      url: dailymotion
    };
  }

  /*
    Halk TV og:video alanında bazen gerçek MP4/HLS yerine kendi HTML
    player sayfasını (\/video-embed\/<id>) video/mp4 diye bildiriyor.
    Bu URL <video> kaynağı değil, iframe içine yüklenmesi gereken embed
    belgesidir. Generic embed renderer bunu doğrudan oynatabilir.
  */
  try {
    const u = new URL(absolute);
    const host = u.hostname.toLowerCase();
    if (
      (host === "halktv.com.tr" || host === "www.halktv.com.tr") &&
      /^\/video-embed\/\d+(?:\/)?$/i.test(u.pathname)
    ) {
      return {
        kind: "embed",
        provider: "halktv",
        url: u.href
      };
    }
  } catch {}

  return null;
}

function videoTitleTokens(value = "") {
  const stop = new Set([
    "son", "dakika", "haber", "haberi", "haberin", "iste", "detay", "detaylar",
    "aciklandi", "aciklama", "yeni", "canli", "video", "izle", "gundem",
    "icin", "ile", "ve", "bir", "bu", "da", "de", "mi", "mu", "ne", "sonra"
  ]);

  return normalize(cleanText(value))
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter(token => token.length >= 3 && !stop.has(token));
}

function videoTitleMatch(a = "", b = "") {
  const left = [...new Set(videoTitleTokens(a))];
  const right = [...new Set(videoTitleTokens(b))];
  if (!left.length || !right.length) return { common: 0, score: 0, left: left.length, right: right.length };

  const rightSet = new Set(right);
  const common = left.filter(token => rightSet.has(token)).length;
  const smaller = Math.max(1, Math.min(left.length, right.length));

  return {
    common,
    score: common / smaller,
    left: left.length,
    right: right.length
  };
}

function primaryVideoContentScope(html = "", expectedTitle = "") {
  const candidates = [];

  for (const pattern of [
    /<article\b[^>]*>[\s\S]*?<\/article>/gi,
    /<main\b[^>]*>[\s\S]*?<\/main>/gi,
    /<(?:section|div)\b[^>]*(?:id|class)=["'][^"']*(?:article[-_ ]?(?:body|content)|story[-_ ]?(?:body|content)|news[-_ ]?(?:body|content)|detail[-_ ]?content|content[-_ ]?detail)[^"']*["'][^>]*>[\s\S]*?<\/(?:section|div)>/gi
  ]) {
    for (const match of html.match(pattern) || []) {
      if (match.length < 700) continue;

      const headingMatch = match.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i);
      const heading = headingMatch ? cleanText(headingMatch[1]) : "";
      const titleMatch = expectedTitle && heading
        ? videoTitleMatch(expectedTitle, heading)
        : { common: 0, score: 0 };

      candidates.push({
        html: match,
        score: (titleMatch.score * 1000) + (titleMatch.common * 80),
        length: match.length
      });
    }
  }

  if (!candidates.length) return html;

  /*
    Aynı sayfada hem gerçek haber gövdesi hem "önerilenler"/video galerisi
    bulunabiliyor. Başlık gönderildiyse önce h1'i o başlığa en çok benzeyen
    kapsamı seç; eşitlikte daha büyük içerik bloğu tercih edilir.
  */
  candidates.sort((a, b) =>
    (b.score - a.score) || (b.length - a.length)
  );

  return candidates[0].html;
}


function decodeNextPayloadText(value = "") {
  return String(value || "")
    .replace(/&quot;/gi, '"')
    .replace(/&#34;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/gi, "&")
    .replace(/\\u0026/gi, "&")
    .replace(/\\u003d/gi, "=")
    .replace(/\\u003a/gi, ":")
    .replace(/\\u002f/gi, "/")
    .replace(/\\u0022/gi, '"')
    .replace(/\\u0027/gi, "'")
    .replace(/\\"/g, '"')
    .replace(/\\+\//g, "/");
}

function nextLocalObjectContext(payload = "", index = 0, length = 0) {
  const open = payload.lastIndexOf("{", index);
  const close = payload.indexOf("}", index + length);

  if (open >= 0 && close >= 0 && close > open && close - open <= 8000) {
    return payload.slice(open, close + 1);
  }

  return payload.slice(
    Math.max(0, index - 1000),
    Math.min(payload.length, index + length + 1000)
  );
}

function extractNtvNextVideoCandidates(html = "", baseUrl = "", expectedTitle = "") {
  let pageUrl;
  try {
    pageUrl = new URL(baseUrl);
  } catch {
    return [];
  }

  const host = pageUrl.hostname.toLowerCase();
  if (host !== "ntv.com.tr" && host !== "www.ntv.com.tr") return [];

  const isGalleryPage =
    /\/galeri-/i.test(pageUrl.pathname);

  const isDedicatedVideoPage =
    /(?:^|\/)video(?:\/|-)/i.test(pageUrl.pathname);

  const slideMatch =
    isGalleryPage
      ? pageUrl.pathname.match(/\/(\d+)\/?$/)
      : null;

  const slideIndex =
    slideMatch
      ? Number(slideMatch[1])
      : null;

  const numericContentId =
    pageUrl.pathname.match(
      /-(\d{6,})(?:\/\d+)?\/?$/
    )?.[1] || "";

  const opaqueContentId =
    pageUrl.pathname.match(
      /,([A-Za-z0-9_-]{8,})\/?$/
    )?.[1] || "";

  const contentId =
    numericContentId ||
    opaqueContentId;

  const scripts = html.match(/<script\b[^>]*>[\s\S]*?<\/script>/gi) || [];
  const payloads = [];

  for (const script of scripts) {
    if (!/__next_f\.push|__NEXT_DATA__|next-router|flight/i.test(script)) continue;
    const body = script
      .replace(/^<script\b[^>]*>/i, "")
      .replace(/<\/script>$/i, "");
    const decoded = decodeNextPayloadText(body);
    if (decoded.length >= 30) payloads.push(decoded);
  }

  if (!payloads.length) return [];
  const candidates = [];

  function titleStats(context = "") {
    if (!expectedTitle) {
      return {
        common: 0,
        score: 0,
        bonus: 0
      };
    }

    const relation =
      videoTitleMatch(
        expectedTitle,
        cleanText(context)
      );

    return {
      ...relation,
      bonus:
        Math.round(
          relation.score * 220 +
          relation.common * 22
        )
    };
  }

  function contextMatchesSlide(context = "") {
    if (!Number.isFinite(slideIndex)) return false;
    const n = String(slideIndex);
    return [
      new RegExp(`["]?(?:slide|slideIndex|page|pageIndex|index|order|position|sequence|currentSlide|currentPage)["]?\\s*[:=]\\s*${n}(?:\\D|$)`, "i"),
      new RegExp(`\\/${n}(?:["'\\\\]|$)`)
    ].some(pattern => pattern.test(context));
  }

  function pushCandidate({ url, type = "", key = "", context = "", source = "ntv-next" }) {
    const absolute = absoluteUrl(url, baseUrl);
    if (!absolute || !/^https?:\/\//i.test(absolute)) return;
    if (/\.(?:jpe?g|png|gif|webp|avif|svg|css|js|json|xml|pdf)(?:[?#]|$)/i.test(absolute)) return;

    /*
      NTV Next/Flight payloadlarında VideoObject.contentUrl bazen gerçek medya
      yerine haber sayfasının kendisini gösteriyor. Bu URL'yi video adayı kabul
      etmek /video sonucunda HTML belgesini native video gibi döndürebiliyordu.
    */
    try {
      const candidateUrl = new URL(absolute);
      const normalizePath = value =>
        (String(value || "").replace(/\/+$/, "") || "/");
      const sameArticleDocument =
        candidateUrl.origin === pageUrl.origin &&
        normalizePath(candidateUrl.pathname) ===
          normalizePath(pageUrl.pathname);
      const explicitMediaUrl =
        /\.(?:mp4|m4v|webm|m3u8)(?:[?#]|$)/i.test(absolute);

      if (sameArticleDocument && !explicitMediaUrl) return;
    } catch {
      return;
    }

    const slideMatched = contextMatchesSlide(context);
    const contentMatched = Boolean(contentId && context.includes(contentId));
    const lowerKey = String(key || "").toLowerCase();
    const title = titleStats(context);
    const explicitMediaUrl =
      /\.(?:mp4|m4v|webm|m3u8)(?:[?#]|$)/i.test(absolute);
    const typedMedia =
      /^(?:video\/)|mpegurl/i.test(String(type || ""));
    const strongVideoSemantic = Boolean(
      explicitMediaUrl &&
      (
        typedMedia ||
        /playback|stream|hls|mp4|video_url|videourl|rawvideourl/.test(lowerKey) ||
        /videoobject|videoplayer|playerconfig|playback|stream|hls|mpegurl|contenttype["']?\s*[:=]\s*["']video/i.test(context)
      )
    );
    let score = 760;

    if (/contenturl|playback|stream|hls|mp4|video_url|videourl/.test(lowerKey)) score += 120;
    if (/embed/.test(lowerKey)) score += 95;
    if (/\.(?:mp4|m4v|webm|m3u8)(?:[?#]|$)/i.test(absolute)) score += 80;
    if (/["']?(?:type|mediaType|contentType)["']?\s*[:=]\s*["']video/i.test(context)) score += 90;
    if (slideMatched) score += 320;
    if (contentMatched) score += 150;
    if (isDedicatedVideoPage) score += 90;
    score += title.bonus;

    const existing = candidates.find(item => item.url === absolute);
    const next = {
      url,
      type,
      key,
      score,
      source,
      slideMatched,
      contentMatched,
      titleCommon: Number(title.common || 0),
      titleScore: Number(title.score || 0),
      strongVideoSemantic
    };
    if (!existing) candidates.push(next);
    else if (score > existing.score) Object.assign(existing, next);
  }

  const dailymotionPlayerIds = [];
  for (const payload of payloads) {
    for (const match of payload.matchAll(/https?:\/\/geo\.dailymotion\.com\/(?:libs\/)?player\/([A-Za-z0-9_-]{3,40})\.(?:js|html)/gi)) {
      const id = match[1];
      if (id && !dailymotionPlayerIds.includes(id)) dailymotionPlayerIds.push(id);
    }
  }

  const keyUrlPattern = /["']?(videoUrl|videoURL|video_url|contentUrl|contentURL|playbackUrl|playbackURL|streamUrl|streamURL|hlsUrl|hlsURL|mp4Url|mp4URL|embedUrl|embedURL|sourceUrl|sourceURL)["']?\s*[:=]\s*["'](https?:\/\/[^"'\\\s<>]+)["']/gi;

  for (const payload of payloads) {
    let match;
    while ((match = keyUrlPattern.exec(payload))) {
      const context = nextLocalObjectContext(payload, match.index, match[0].length);
      const typeMatch = context.match(/["']?(?:mimeType|contentType|encodingFormat|type)["']?\s*[:=]\s*["'](video\/[^"']+|application\/(?:x-)?mpegurl)["']/i);
      pushCandidate({
        url: match[2],
        type: typeMatch?.[1] || "",
        key: match[1],
        context
      });
    }

    for (const raw of payload.match(/https?:\/\/[^"'\\\s<>]+?\.(?:mp4|m4v|webm|m3u8)(?:\?[^"'\\\s<>]*)?/gi) || []) {
      const at = payload.indexOf(raw);
      const context = nextLocalObjectContext(payload, at, raw.length);
      pushCandidate({ url: raw, key: "rawVideoUrl", context, source: "ntv-next-raw" });
    }

    if (dailymotionPlayerIds.length === 1) {
      const playerId = dailymotionPlayerIds[0];
      const videoIdPattern = /["']?(?:videoId|videoID|video_id|data-video|dailymotionVideoId)["']?\s*[:=]\s*["']([A-Za-z0-9]{5,24})["']/gi;
      let idMatch;
      while ((idMatch = videoIdPattern.exec(payload))) {
        const context = nextLocalObjectContext(payload, idMatch.index, idMatch[0].length);
        if (!/dailymotion|daily-motion|dm-player/i.test(context) && !contextMatchesSlide(context)) continue;
        const dm = new URL(`https://geo.dailymotion.com/player/${playerId}.html`);
        dm.searchParams.set("video", idMatch[1]);
        pushCandidate({
          url: dm.href,
          key: "dailymotionVideoId",
          context,
          source: "ntv-next-dailymotion"
        });
      }
    }
  }

  /*
    Bazı NTV sayfalarında gerçek medya URL'si Next/Flight script seçiminin
    dışında, fakat HTML içinde escaped/raw olarak bulunuyor. Tüm HTML'i decode
    edip yalnız açık .mp4/.m3u8 benzeri medya URL'lerini ek aday olarak tara.
  */
  const decodedHtml = decodeNextPayloadText(html);
  const rawHtmlVideoPattern =
    /https?:\/\/[^"'\\\s<>]+?\.(?:mp4|m4v|webm|m3u8)(?:\?[^"'\\\s<>]*)?/gi;

  let rawHtmlMatch;
  while ((rawHtmlMatch = rawHtmlVideoPattern.exec(decodedHtml))) {
    const context = nextLocalObjectContext(
      decodedHtml,
      rawHtmlMatch.index,
      rawHtmlMatch[0].length
    );

    pushCandidate({
      url: rawHtmlMatch[0],
      key: "rawVideoUrl",
      context,
      source: "ntv-html-raw"
    });
  }

  if (!candidates.length) return [];
  candidates.sort((a, b) => b.score - a.score);

  if (isGalleryPage) {
    const slideCandidates =
      candidates.filter(
        item => item.slideMatched
      );

    const pool =
      slideCandidates.length
        ? slideCandidates
        : candidates;

    const best = pool[0];
    const second = pool[1];

    if (
      pool.length > 1 &&
      second &&
      best.score - second.score < 110
    ) {
      return [];
    }

    if (
      !best.slideMatched &&
      pool.length > 1
    ) {
      return [];
    }

    if (
      !best.slideMatched &&
      best.score < 950
    ) {
      return [];
    }

    return [best];
  }

  const best = candidates[0];
  const second = candidates[1];

  /*
    Regular NTV pages often keep the media URL only in Next/Flight payloads.
    A normal article must have either title/content binding or one uniquely
    strong media candidate. Dedicated /video/ pages are themselves a strong
    video context but still keep ambiguity protection.
  */
  const semanticBound =
    best.contentMatched ||
    best.titleCommon >= 2 ||
    best.titleScore >= 0.34;

  if (second) {
    const gap =
      best.score -
      second.score;

    const titleGap =
      best.titleScore -
      second.titleScore;

    const bestIsExplicitMedia =
      /\.(?:mp4|m4v|webm|m3u8)(?:[?#]|$)/i.test(best.url);

    const secondIsExplicitMedia =
      /\.(?:mp4|m4v|webm|m3u8)(?:[?#]|$)/i.test(second.url);

    const sameStoryMediaVariants =
      bestIsExplicitMedia &&
      secondIsExplicitMedia &&
      (
        (best.contentMatched && second.contentMatched) ||
        (best.titleCommon >= 2 && second.titleCommon >= 2) ||
        (best.titleScore >= 0.34 && second.titleScore >= 0.34)
      );

    if (
      !sameStoryMediaVariants &&
      gap < (
        isDedicatedVideoPage
          ? 125
          : 145
      ) &&
      titleGap < 0.12
    ) {
      return [];
    }
  }

  if (isDedicatedVideoPage) {
    const explicitBest =
      looksLikeVideoUrl(best.url, best.type) ||
      Boolean(normalizeKnownEmbed(best.url, baseUrl));

    if (
      !explicitBest ||
      best.score < 880
    ) {
      return [];
    }

    return [best];
  }

  /*
    A normal NTV article can contain an inline video without a /video/ slug
    (health/category feeds are a common example). If title/content IDs are
    absent from the tiny Flight object around the URL, one uniquely strong
    explicit media candidate is still sufficient. Ambiguous candidate sets
    remain rejected above.
  */
  const uniquelyStrongExplicit = Boolean(
    best.strongVideoSemantic &&
    (
      !second ||
      best.score - second.score >= 100 ||
      !second.strongVideoSemantic
    )
  );

  if (
    (!semanticBound && !uniquelyStrongExplicit) ||
    best.score < (uniquelyStrongExplicit ? 820 : 930)
  ) {
    return [];
  }

  return [best];
}


function decodePlayerConfigText(value = "") {
  return decodeEntities(String(value || ""))
    .replace(/\\u0026/gi, "&")
    .replace(/\\u003d/gi, "=")
    .replace(/\\u003a/gi, ":")
    .replace(/\\u002f/gi, "/")
    .replace(/\\u0022/gi, '"')
    .replace(/\\u0027/gi, "'")
    .replace(/\\"/g, '"')
    .replace(/\\+\//g, "/")
    .trim();
}

function extractSabahVideoJsCandidates(
  html = "",
  baseUrl = "",
  expectedTitle = ""
) {
  let pageUrl;

  try {
    pageUrl = new URL(baseUrl);
  } catch {
    return [];
  }

  const host = pageUrl.hostname.toLowerCase();

  /* Sabah and Takvim share the Turkuvaz/VideoJS delivery family. */
  if (
    host !== "sabah.com.tr" &&
    host !== "www.sabah.com.tr" &&
    host !== "takvim.com.tr" &&
    host !== "www.takvim.com.tr"
  ) {
    return [];
  }

  const scoped = primaryVideoContentScope(
    html,
    expectedTitle
  );

  const articleHtml =
    scoped && scoped !== html
      ? scoped
      : "";

  const h1Index = html.search(/<h1\b/i);

  const nearTitleHtml =
    h1Index >= 0
      ? html.slice(
          Math.max(0, h1Index - 60_000),
          Math.min(html.length, h1Index + 280_000)
        )
      : "";

  const groups = new Map();

  function titleRelationBonus(context = "") {
    if (!expectedTitle || !context) return 0;

    const relation = videoTitleMatch(
      expectedTitle,
      cleanText(context)
    );

    return Math.round(
      relation.score * 160 +
      relation.common * 16
    );
  }

  function groupFor(id, baseScore, context = "") {
    let group = groups.get(id);

    if (!group) {
      group = {
        id,
        baseScore,
        titleBonus: titleRelationBonus(context),
        candidates: []
      };
      groups.set(id, group);
    } else {
      group.baseScore = Math.max(group.baseScore, baseScore);
      group.titleBonus = Math.max(
        group.titleBonus,
        titleRelationBonus(context)
      );
    }

    return group;
  }
function obviousNonVideoUrl(value = "") {
    try {
      const u = new URL(value);

      return /\.(?:jpe?g|png|gif|webp|avif|svg|css|js|json|xml|pdf|woff2?|ttf|ico)(?:[?#]|$)/i
        .test(u.pathname + u.search);
    } catch {
      return true;
    }
  }

  function looksLikeAdContext(context = "") {
    const text = String(context || "").toLowerCase();

    return (
      /\b(?:vast|preroll|pre-roll|midroll|mid-roll|postroll|post-roll|advert|advertisement|reklam|ima3?|adtag|ad_tag|adschedule|adserver)\b/i
        .test(text) &&
      !/\b(?:content|news|article|haber|mainvideo|main-video)\b/i
        .test(text)
    );
  }

  function addCandidate({
    groupId,
    value,
    type = "",
    score = 0,
    source = "",
    context = ""
  }) {
    const cleaned = decodePlayerConfigText(value);
    const url = absoluteUrl(cleaned, baseUrl);

    if (!url || !/^https?:\/\//i.test(url)) return;
    if (obviousNonVideoUrl(url)) return;
    if (looksLikeAdContext(context)) return;

    const semanticType = String(type || "").trim();
    const lowerUrl = url.toLowerCase();

    const strongVideoUrl =
      looksLikeVideoUrl(url, semanticType) ||
      /^video\//i.test(semanticType) ||
      /mpegurl/i.test(semanticType) ||
      (
        /(?:tmgrup|sabah|video|media|stream|cdn)/i
          .test(new URL(url).hostname) &&
        /(?:video|stream|playback|master|manifest|hls|media)/i
          .test(new URL(url).pathname + new URL(url).search)
      );

    if (!strongVideoUrl) return;

    let candidateScore = score;

    if (/mpegurl|m3u8/i.test(semanticType + " " + lowerUrl)) {
      candidateScore += 35;
    } else if (/video\/mp4|\.mp4(?:[?#]|$)/i.test(semanticType + " " + lowerUrl)) {
      candidateScore += 22;
    }

    if (/tmgrup\.com\.tr|sabah\.com\.tr/i.test(url)) {
      candidateScore += 28;
    }

    const group = groupFor(
      groupId,
      candidateScore,
      context
    );

    const existing = group.candidates.find(
      item => item.url === url
    );

    const next = {
      url,
      type: semanticType,
      score: candidateScore,
      source
    };

    if (!existing) {
      group.candidates.push(next);
    } else if (candidateScore > existing.score) {
      Object.assign(existing, next);
    }
  }

  function walkPlayerConfig(
    value,
    {
      groupId,
      baseScore,
      context = "",
      inheritedType = "",
      path = ""
    }
  ) {
    if (!value) return;

    if (Array.isArray(value)) {
      for (let i = 0; i < value.length; i++) {
        walkPlayerConfig(
          value[i],
          {
            groupId,
            baseScore,
            context,
            inheritedType,
            path: `${path}[${i}]`
          }
        );
      }
      return;
    }

    if (typeof value !== "object") return;

    const localType = String(
      value.type ||
      value.mimeType ||
      value.contentType ||
      value.encodingFormat ||
      inheritedType ||
      ""
    );

    const allowedKeys = new Set([
      "src",
      "file",
      "source",
      "video",
      "videourl",
      "video_url",
      "contenturl",
      "content_url",
      "playbackurl",
      "playback_url",
      "streamurl",
      "stream_url",
      "hlsurl",
      "hls_url",
      "mp4url",
      "mp4_url",
      "manifesturl",
      "manifest_url"
    ]);

    for (const [key, child] of Object.entries(value)) {
      const lowerKey = String(key).toLowerCase();

      if (
        typeof child === "string" &&
        allowedKeys.has(lowerKey)
      ) {
        addCandidate({
          groupId,
          value: child,
          type: localType,
          score: baseScore,
          source: `sabah-videojs-config:${lowerKey}`,
          context
        });
      }

      if (
        child &&
        typeof child === "object"
      ) {
        walkPlayerConfig(
          child,
          {
            groupId,
            baseScore,
            context,
            inheritedType: localType,
            path: path
              ? `${path}.${key}`
              : key
          }
        );
      }
    }
  }

  function parseJsonishConfig(
    raw,
    groupId,
    baseScore,
    context
  ) {
    const decoded = decodePlayerConfigText(raw);
    if (!decoded) return;

    const attempts = [
      decoded,
      decoded
        .replace(/'/g, '"')
        .replace(/,\s*([}\]])/g, "$1")
    ];

    for (const candidate of attempts) {
      try {
        const parsed = JSON.parse(candidate);

        walkPlayerConfig(
          parsed,
          {
            groupId,
            baseScore,
            context
          }
        );

        return;
      } catch {}
    }

    /*
      Video.js options are frequently JS object literals rather than strict
      JSON. Regex fallback is deliberately restricted to this confirmed
      player-config context.
    */
    const normalized = decoded
      .replace(/\\+\//g, "/");

    const urlKeyPattern =
      /["']?(src|file|source|videoUrl|video_url|contentUrl|content_url|playbackUrl|playback_url|streamUrl|stream_url|hlsUrl|hls_url|mp4Url|mp4_url|manifestUrl|manifest_url)["']?\s*:\s*["']((?:https?:)?\/\/[^"'<>]+)["']/gi;

    let match;

    while ((match = urlKeyPattern.exec(normalized))) {
      const around = normalized.slice(
        Math.max(0, match.index - 600),
        Math.min(
          normalized.length,
          match.index + match[0].length + 600
        )
      );

      const typeMatch = around.match(
        /["']?(?:type|mimeType|contentType|encodingFormat)["']?\s*:\s*["']([^"']+)["']/i
      );

      addCandidate({
        groupId,
        value: match[2],
        type: typeMatch?.[1] || "",
        score: baseScore,
        source: `sabah-videojs-config:${String(match[1]).toLowerCase()}`,
        context: context + " " + around
      });
    }
  }

  function scanVideoTags(scope, label, baseScore) {
    if (!scope) return;

    let index = 0;
    const completeBlocks =
      scope.match(/<video\b[^>]*>[\s\S]*?<\/video>/gi) ||
      [];

    const completeOpenings = new Set(
      completeBlocks
        .map(block => block.match(/<video\b[^>]*>/i)?.[0] || "")
        .filter(Boolean)
    );

    for (
      const block of
      completeBlocks
    ) {
      const opening =
        block.match(/<video\b[^>]*>/i)?.[0] ||
        "";

      const className = htmlAttr(opening, "class");
      const id = htmlAttr(opening, "id");

      const strongMarker =
        /video-js|vjs-|videojs|video-player|videoplayer/i
          .test(className + " " + id + " " + opening) ||
        /tmgrup\.com\.tr\/videojs/i.test(block);

      if (!strongMarker) {
        index++;
        continue;
      }

      const groupId =
        `${label}:video:${index}`;

      for (const attr of [
        "data-setup",
        "data-options",
        "data-config",
        "data-player-config",
        "data-video-config",
        "data-settings"
      ]) {
        const raw = htmlAttr(opening, attr);

        if (raw) {
          parseJsonishConfig(
            raw,
            groupId,
            baseScore + 80,
            block.slice(0, 12_000)
          );
        }
      }

      /*
        Some templates put source/src values directly on custom data attrs.
      */
      for (const attr of [
        "src",
        "data-src",
        "data-video-src",
        "data-source",
        "data-file",
        "data-url",
        "data-stream-url",
        "data-hls-url",
        "data-playback-url"
      ]) {
        const raw = htmlAttr(opening, attr);

        if (raw) {
          addCandidate({
            groupId,
            value: raw,
            type: htmlAttr(opening, "type"),
            score: baseScore + 70,
            source: `sabah-videojs-tag:${attr}`,
            context: block.slice(0, 12_000)
          });
        }
      }

      for (
        const sourceTag of
        block.match(/<source\b[^>]*>/gi) ||
        []
      ) {
        const raw =
          htmlAttr(sourceTag, "src") ||
          htmlAttr(sourceTag, "data-src");

        if (!raw) continue;

        addCandidate({
          groupId,
          value: raw,
          type: htmlAttr(sourceTag, "type"),
          score: baseScore + 75,
          source: "sabah-videojs-source",
          context: block.slice(0, 12_000)
        });
      }

      index++;
    }

    /*
      Self-closing / client-populated video tags.
    */
    for (
      const opening of
      scope.match(/<video\b[^>]*>/gi) ||
      []
    ) {
      /*
        A normal <video>...</video> element was already handled above.
        This pass is only for genuinely unclosed/client-populated video tags.
      */
      if (completeOpenings.has(opening)) {
        continue;
      }

      const markerText =
        [
          htmlAttr(opening, "class"),
          htmlAttr(opening, "id"),
          opening
        ].join(" ");

      if (
        !/video-js|vjs-|videojs|video-player|videoplayer/i
          .test(markerText)
      ) {
        continue;
      }

      const groupId =
        `${label}:opening:${index++}`;

      for (const attr of [
        "data-setup",
        "data-options",
        "data-config",
        "data-player-config",
        "data-video-config",
        "data-settings"
      ]) {
        const raw = htmlAttr(opening, attr);

        if (raw) {
          parseJsonishConfig(
            raw,
            groupId,
            baseScore + 72,
            opening
          );
        }
      }
    }
  }

  function scanVideoJsScripts(
    scope,
    label,
    baseScore
  ) {
    if (!scope) return;

    let scriptIndex = 0;

    for (
      const block of
      scope.match(/<script\b[^>]*>[\s\S]*?<\/script>/gi) ||
      []
    ) {
      if (
        !/videojs\s*\(|video-js|tmgrup\.com\.tr\/videojs|(?:player|video)(?:Options|Config|Settings)|sources\s*:/i
          .test(block)
      ) {
        scriptIndex++;
        continue;
      }

      if (
        /\b(?:recommend|related|onerilen|önerilen|playlist-next|next-video)\b/i
          .test(block) &&
        !expectedTitle
      ) {
        scriptIndex++;
        continue;
      }

      const body = decodePlayerConfigText(
        block
          .replace(/^<script\b[^>]*>/i, "")
          .replace(/<\/script>$/i, "")
      );

      const groupId =
        `${label}:script:${scriptIndex++}`;

      /*
        First parse object-ish chunks around sources/options/config markers.
      */
      for (const marker of [
        /sources\s*:\s*(\[[\s\S]{0,12000}?\])/gi,
        /(?:playerOptions|videoOptions|playerConfig|videoConfig|playerSettings|videoSettings)\s*=\s*(\{[\s\S]{0,16000}?\});?/gi,
        /videojs\s*\([^,]+,\s*(\{[\s\S]{0,16000}?\})\s*(?:,|\))/gi
      ]) {
        let match;

        while ((match = marker.exec(body))) {
          parseJsonishConfig(
            match[1],
            groupId,
            baseScore + 55,
            body.slice(
              Math.max(0, match.index - 2500),
              Math.min(
                body.length,
                match.index + match[0].length + 2500
              )
            )
          );
        }
      }

      /*
        Generic key:value fallback, but only inside a script already proven to
        be Video.js/Turkuvaz-player related.
      */
      parseJsonishConfig(
        body,
        groupId,
        baseScore,
        body.slice(0, 30_000)
      );

      /*
        Escaped/raw direct media URL fallback.
      */
      for (
        const raw of
        body.match(
          /(?:https?:)?\/\/[^"'\\\s<>]+?\.(?:mp4|m4v|webm|m3u8)(?:\?[^"'\\\s<>]*)?/gi
        ) || []
      ) {
        const at = body.indexOf(raw);

        const around = body.slice(
          Math.max(0, at - 600),
          Math.min(body.length, at + raw.length + 600)
        );

        const typeMatch = around.match(
          /["']?(?:type|mimeType|contentType)["']?\s*:\s*["']([^"']+)["']/i
        );

        addCandidate({
          groupId,
          value: raw,
          type: typeMatch?.[1] || "",
          score: baseScore - 10,
          source: "sabah-videojs-raw",
          context: around
        });
      }
    }
  }

  /*
    Strong article scope wins. Otherwise inspect only the title neighborhood.
    Full-page scan is limited to scripts with an explicit Turkuvaz Video.js
    marker and receives a lower score.
  */
  if (articleHtml) {
    scanVideoTags(
      articleHtml,
      "article",
      1090
    );

    scanVideoJsScripts(
      articleHtml,
      "article",
      1030
    );
  }

  if (nearTitleHtml) {
    scanVideoTags(
      nearTitleHtml,
      "near-title",
      articleHtml ? 940 : 1040
    );

    scanVideoJsScripts(
      nearTitleHtml,
      "near-title",
      articleHtml ? 900 : 980
    );
  }

  /*
    Last-resort full-page Turkuvaz scripts only. If article/near-title scan
    already produced a candidate group, do NOT rescan the same player as a
    second group; that would falsely trigger the ambiguity guard.
  */
  if (!groups.size) {
    let pageScriptIndex = 0;

    for (
      const block of
      html.match(/<script\b[^>]*>[\s\S]*?<\/script>/gi) ||
      []
    ) {
      if (
        !/tmgrup\.com\.tr\/videojs|videojs\s*\(/i
          .test(block)
      ) {
        pageScriptIndex++;
        continue;
      }

      scanVideoJsScripts(
        block,
        `page-${pageScriptIndex++}`,
        790
      );
    }
  }

  const rankedGroups =
    [...groups.values()]
      .map(group => {
        const ranked =
          group.candidates
            .slice()
            .sort(
              (a, b) =>
                b.score - a.score
            );

        const best = ranked[0];

        return {
          ...group,
          best,
          groupScore:
            (best?.score || 0) +
            group.titleBonus
        };
      })
      .filter(group => group.best)
      .sort(
        (a, b) =>
          b.groupScore -
          a.groupScore
      );

  if (!rankedGroups.length) {
    return [];
  }

  const bestGroup =
    rankedGroups[0];

  const secondGroup =
    rankedGroups[1];

  /*
    Multiple source variants inside one Video.js player are expected; they
    are one group. Ambiguity is only between DIFFERENT player groups.
  */
  if (
    secondGroup &&
    bestGroup.groupScore -
      secondGroup.groupScore < 115
  ) {
    return [];
  }

  /*
    Low-confidence full-page player could be a recommendation carousel.
  */
  if (
    bestGroup.groupScore < 900
  ) {
    return [];
  }

  const best =
    bestGroup.best;

  return [{
    url: best.url,
    type: best.type || "",
    score:
      bestGroup.groupScore,
    source:
      best.source ||
      "turkuvaz-videojs"
  }];
}


function extractHaberturkHopePlayerCandidates(
  html = "",
  baseUrl = "",
  expectedTitle = ""
) {
  let pageUrl;

  try {
    pageUrl = new URL(baseUrl);
  } catch {
    return [];
  }

  const host = pageUrl.hostname.toLowerCase();

  if (
    host !== "haberturk.com" &&
    host !== "www.haberturk.com"
  ) {
    return [];
  }

  if (
    !/hope-video-loader|hopeplayer|HopeVideoLoader|hopeVideo(?:\.Collect)?/i
      .test(html)
  ) {
    return [];
  }

  const scoped =
    primaryVideoContentScope(
      html,
      expectedTitle
    );

  const articleHtml =
    scoped && scoped !== html
      ? scoped
      : "";

  const h1Index =
    html.search(/<h1\b/i);

  const nearTitleHtml =
    h1Index >= 0
      ? html.slice(
          Math.max(
            0,
            h1Index - 70_000
          ),
          Math.min(
            html.length,
            h1Index + 320_000
          )
        )
      : "";

  function trimRecommendationTail(scope = "") {
    if (!scope) return "";

    const markers = [
      /(?:ÖNERİLEN|ONERILEN)\s+(?:VİDEO|VIDEO)/i,
      /(?:İLGİLİ|ILGILI)\s+(?:HABER|VİDEO|VIDEO)/i,
      /EN\s+ÇOK\s+OKUNAN/i,
      /SIRADAKİ\s+(?:VİDEO|VIDEO)/i,
      /(?:RELATED|RECOMMENDED)\s+(?:VIDEO|NEWS)/i
    ];

    let cut = scope.length;
    for (const marker of markers) {
      const match = marker.exec(scope);
      if (match && match.index > 0) cut = Math.min(cut, match.index);
    }

    return scope.slice(0, cut);
  }

  const safeArticleHtml = trimRecommendationTail(articleHtml);
  const safeNearTitleHtml = trimRecommendationTail(nearTitleHtml);

  const groups = new Map();

  function decodeHopeText(
    value = ""
  ) {
    return decodeEntities(
      String(value || "")
    )
      .replace(/\\u0026/gi, "&")
      .replace(/\\u003d/gi, "=")
      .replace(/\\u003a/gi, ":")
      .replace(/\\u002f/gi, "/")
      .replace(/\\u0022/gi, '"')
      .replace(/\\u0027/gi, "'")
      .replace(/\\"/g, '"')
      .replace(/\\+\//g, "/")
      .trim();
  }

  function isLiveTvStream(
    value = ""
  ) {
    try {
      const u = new URL(value);

      const h =
        u.hostname.toLowerCase();

      const p =
        (
          u.pathname +
          u.search
        ).toLowerCase();

      return (
        h ===
          "ciner-live.daioncdn.net" ||
        h.startsWith("ciner-live.") ||
        /\/haberturktv(?:\/|\.|$)/i
          .test(p)
      );
    } catch {
      return true;
    }
  }

  function adOnlyContext(
    context = ""
  ) {
    const text =
      String(context || "")
        .toLowerCase();

    return (
      /\b(?:vast|preroll|pre-roll|midroll|mid-roll|postroll|post-roll|advert|advertisement|reklam|adtag|ad_tag|adschedule|adserver|ima3?)\b/i
        .test(text) &&
      !/\b(?:article|haber|news|content|mainvideo|main-video|hopevideo)\b/i
        .test(text)
    );
  }

  function titleBonus(
    context = ""
  ) {
    if (
      !expectedTitle ||
      !context
    ) {
      return 0;
    }

    const relation =
      videoTitleMatch(
        expectedTitle,
        cleanText(context)
      );

    return Math.round(
      relation.score * 170 +
      relation.common * 18
    );
  }

  function ensureGroup(
    id,
    score,
    context
  ) {
    let group =
      groups.get(id);

    if (!group) {
      group = {
        id,
        score,
        titleBonus:
          titleBonus(context),
        candidates: []
      };

      groups.set(
        id,
        group
      );
    } else {
      group.score =
        Math.max(
          group.score,
          score
        );

      group.titleBonus =
        Math.max(
          group.titleBonus,
          titleBonus(context)
        );
    }

    return group;
  }

  function addMedia({
    groupId,
    value,
    type = "",
    score,
    source,
    context = ""
  }) {
    const cleaned =
      decodeHopeText(value);

    const url =
      absoluteUrl(
        cleaned,
        baseUrl
      );

    if (
      !url ||
      !/^https?:\/\//i.test(url) ||
      isLiveTvStream(url) ||
      adOnlyContext(context)
    ) {
      return;
    }

    let parsed;

    try {
      parsed = new URL(url);
    } catch {
      return;
    }

    const path =
      (
        parsed.pathname +
        parsed.search
      ).toLowerCase();

    if (
      /\/(?:ads?|advert|advertisement|reklam)(?:\/|_|-|\.|$)/i
        .test(path) ||
      /(?:preroll|pre-roll|midroll|mid-roll|postroll|post-roll|vast|adtag|ad_tag)/i
        .test(path)
    ) {
      return;
    }

    if (
      /\.(?:jpe?g|png|gif|webp|avif|svg|css|js|json|xml|pdf|woff2?|ttf|ico)(?:[?#]|$)/i
        .test(path)
    ) {
      return;
    }

    const semanticType =
      String(type || "")
        .trim();

    const isDirect =
      looksLikeVideoUrl(
        url,
        semanticType
      ) ||
      /^video\//i.test(
        semanticType
      ) ||
      /mpegurl/i.test(
        semanticType
      ) ||
      /\.(?:m3u8|mp4|m4v|webm)(?:[?#]|$)/i
        .test(url) ||
      (
        /daioncdn\.net$/i
          .test(parsed.hostname) &&
        /(?:content|video|media|stream|master|manifest|playlist|playback)/i
          .test(path)
      );

    if (!isDirect) return;

    let finalScore = score;

    if (
      /daioncdn\.net$/i
        .test(parsed.hostname)
    ) {
      finalScore += 35;
    }

    if (
      /m3u8|mpegurl/i
        .test(
          url + " " +
          semanticType
        )
    ) {
      finalScore += 35;
    } else if (
      /mp4|video\/mp4/i
        .test(
          url + " " +
          semanticType
        )
    ) {
      finalScore += 20;
    }

    const group =
      ensureGroup(
        groupId,
        finalScore,
        context
      );

    const existing =
      group.candidates.find(
        item =>
          item.url === url
      );

    const candidate = {
      url,
      type:
        semanticType,
      score:
        finalScore,
      source
    };

    if (!existing) {
group.candidates.push(
        candidate
      );
    } else if (
      finalScore >
      existing.score
    ) {
      Object.assign(
        existing,
        candidate
      );
    }
  }

  function parseHopeConfig(
    raw,
    groupId,
    baseScore,
    context = ""
  ) {
    const text =
      decodeHopeText(raw);

    if (!text) return;

    const allowed =
      /^(?:src|file|url|source|stream|videoUrl|video_url|contentUrl|content_url|playbackUrl|playback_url|streamUrl|stream_url|hlsUrl|hls_url|mp4Url|mp4_url|manifestUrl|manifest_url|playlistUrl|playlist_url|mediaUrl|media_url)$/i;

    function walk(
      value,
      inheritedType = ""
    ) {
      if (!value) return;

      if (Array.isArray(value)) {
        for (
          const child of value
        ) {
          walk(
            child,
            inheritedType
          );
        }
        return;
      }

      if (
        typeof value !==
        "object"
      ) {
        return;
      }

      const localType =
        String(
          value.type ||
          value.mimeType ||
          value.contentType ||
          value.encodingFormat ||
          inheritedType ||
          ""
        );

      for (
        const [key, child]
        of Object.entries(value)
      ) {
        if (
          typeof child ===
            "string" &&
          allowed.test(key)
        ) {
          addMedia({
            groupId,
            value: child,
            type:
              localType,
            score:
              baseScore,
            source:
              `haberturk-hope-config:${String(key).toLowerCase()}`,
            context
          });
        }

        if (
          child &&
          typeof child ===
            "object"
        ) {
          walk(
            child,
            localType
          );
        }
      }
    }

    for (
      const attempt of [
        text,
        text
          .replace(/'/g, '"')
          .replace(
            /,\s*([}\]])/g,
            "$1"
          )
      ]
    ) {
      try {
        walk(
          JSON.parse(attempt)
        );
        return;
      } catch {}
    }

    const keyUrlPattern =
      /["']?(src|file|url|source|stream|videoUrl|video_url|contentUrl|content_url|playbackUrl|playback_url|streamUrl|stream_url|hlsUrl|hls_url|mp4Url|mp4_url|manifestUrl|manifest_url|playlistUrl|playlist_url|mediaUrl|media_url)["']?\s*[:=]\s*["']((?:https?:)?\/\/[^"'<>]+)["']/gi;

    let match;

    while (
      (
        match =
          keyUrlPattern.exec(text)
      )
    ) {
      const around =
        text.slice(
          Math.max(
            0,
            match.index - 700
          ),
          Math.min(
            text.length,
            match.index +
            match[0].length +
            700
          )
        );

      const typeMatch =
        around.match(
          /["']?(?:type|mimeType|contentType|encodingFormat)["']?\s*[:=]\s*["']([^"']+)["']/i
        );

      addMedia({
        groupId,
        value:
          match[2],
        type:
          typeMatch?.[1] || "",
        score:
          baseScore,
        source:
          `haberturk-hope-config:${String(match[1]).toLowerCase()}`,
        context:
          context + " " +
          around
      });
    }

    for (
      const mediaUrl of
      text.match(
        /(?:https?:)?\/\/[^"'\\\s<>]+?\.(?:m3u8|mp4|m4v|webm)(?:\?[^"'\\\s<>]*)?/gi
      ) || []
    ) {
      addMedia({
        groupId,
        value:
          mediaUrl,
        score:
          baseScore - 5,
        source:
          "haberturk-hope-raw",
        context
      });
    }
  }

  function scanScope(
    scope,
    label,
    baseScore
  ) {
    if (!scope) return;

    /*
      Güncel Habertürk/HopeVideoJS kurulumlarında medya config'i her zaman
      hope-* isimli elementin üzerinde bulunmuyor. Bazen serialized state veya
      script payload içinde vmcdn.ciner.com.tr HLS adresi olarak geçiyor.
      Scope'un tamamını bir kez config parser'dan geçir; reklam/live stream
      filtreleri addMedia() içinde uygulanmaya devam ediyor.
    */
    if (
      /(?:vmcdn\.ciner\.com\.tr|ciner\.com\.tr|\.m3u8|\.mp4|playbackUrl|streamUrl|hlsUrl|mediaUrl|contentUrl)/i.test(scope)
    ) {
      parseHopeConfig(
        scope,
        `${label}:raw-scope`,
        baseScore + 35,
        scope.slice(0, 45_000)
      );
    }

    let elementIndex = 0;

    for (
      const tag of
      scope.match(/<[^>]+>/gi) ||
      []
    ) {
      if (
        !/hope(?:video|player)|hope-video|hope_player|video-player|video_player/i
          .test(tag)
      ) {
        continue;
      }

      const groupId =
        `${label}:element:${elementIndex++}`;

      for (const attr of [
        "data-src",
        "data-url",
        "data-file",
        "data-source",
        "data-stream",
        "data-video-url",
        "data-content-url",
        "data-playback-url",
        "data-stream-url",
        "data-hls-url",
        "data-mp4-url",
        "data-manifest-url",
        "data-playlist-url",
        "data-media-url"
      ]) {
        const value =
          htmlAttr(
            tag,
            attr
          );

        if (value) {
          addMedia({
            groupId,
            value,
            type:
              htmlAttr(
                tag,
                "data-type"
              ) ||
              htmlAttr(
                tag,
                "type"
              ),
            score:
              baseScore + 80,
            source:
              `haberturk-hope-tag:${attr}`,
            context:
              tag
          });
        }
      }

      for (const attr of [
        "data-setup",
        "data-options",
        "data-config",
        "data-player-config",
        "data-video-config",
        "data-settings",
        "data-json"
      ]) {
        const value =
          htmlAttr(
            tag,
            attr
          );

        if (value) {
          parseHopeConfig(
            value,
            groupId,
            baseScore + 90,
            tag
          );
        }
      }
    }

    let scriptIndex = 0;

    for (
      const block of
      scope.match(
        /<script\b[^>]*>[\s\S]*?<\/script>/gi
      ) || []
    ) {
      if (
        !/hopeVideo|HopeVideoLoader|hopeplayer|hope-video-loader|daioncdn\.net/i
          .test(block)
      ) {
        scriptIndex++;
        continue;
      }

      if (
        !/(?:m3u8|mp4|daioncdn\.net|sources?\s*[:=]|(?:video|content|playback|stream|hls|mp4|manifest|playlist|media)(?:Url|URL|_url)?\s*[:=])/i
          .test(block)
      ) {
        scriptIndex++;
        continue;
      }

      parseHopeConfig(
        block,
        `${label}:script:${scriptIndex++}`,
        baseScore + 45,
        block.slice(0, 30_000)
      );
    }
  }

  if (safeArticleHtml) {
    scanScope(
      safeArticleHtml,
      "article",
      1120
    );
  }

  if (safeNearTitleHtml) {
    scanScope(
      safeNearTitleHtml,
      "near-title",
      safeArticleHtml
        ? 970
        : 1040
    );
  }

  /*
    Do not scan arbitrary full-page HopeVideoJS scripts. Habertürk frequently
    keeps live/recommended players outside the article; those made normal text
    stories look like video stories in "Sadece videolu haberler" mode.
  */

  const ranked =
    [...groups.values()]
      .map(group => {
        const candidates =
          group.candidates
            .slice()
            .sort(
              (a, b) =>
                b.score -
                a.score
            );

        const best =
          candidates[0];

        return {
          ...group,
          best,
          groupScore:
            (best?.score || 0) +
            group.titleBonus
        };
      })
      .filter(
        group => group.best
      )
      .sort(
        (a, b) =>
          b.groupScore -
          a.groupScore
      );

  if (!ranked.length) {
    return [];
  }

  const best =
    ranked[0];

  const second =
    ranked[1];

  if (
    second &&
    best.groupScore -
      second.groupScore < 120
  ) {
    return [];
  }

  if (
    best.groupScore < 930
  ) {
    return [];
  }

  const articleLinked =
    String(best.id || "").startsWith("article:") ||
    (
      String(best.id || "").startsWith("near-title:") &&
      best.titleBonus >= 90
    );

  return [{
    url:
      best.best.url,
    type:
      best.best.type || "",
    score:
      best.groupScore,
    source:
      best.best.source ||
      "haberturk-hope",
    articleLinked,
    videoOnlyEligible: articleLinked
  }];
}


function isCumhuriyetArticleUrl(value = "") {
  try {
    const host =
      new URL(value)
        .hostname
        .toLowerCase();

    return (
      host === "cumhuriyet.com.tr" ||
      host === "www.cumhuriyet.com.tr"
    );
  } catch {
    return false;
  }
}

function dailymotionPartsFromEmbed(
  value = "",
  baseUrl = ""
) {
  const normalized =
    normalizeDailymotionEmbed(
      absoluteUrl(value, baseUrl)
    );

  if (!normalized) return null;

  try {
    const url = new URL(normalized);

    const videoId =
      String(
        url.searchParams.get("video") ||
        ""
      ).trim();

    const playerId =
      url.pathname.match(
        /\/player\/([A-Za-z0-9_-]+)\.html$/i
      )?.[1] || "";

    if (
      !/^[A-Za-z0-9]{5,24}$/.test(videoId) ||
      !/^[A-Za-z0-9_-]{3,40}$/.test(playerId)
    ) {
      return null;
    }

    return {
      videoId,
      playerId,
      url: normalized
    };
  } catch {
    return null;
  }
}

function cumhuriyetLocalDescriptor(
  scope = "",
  index = 0,
  tag = ""
) {
  const explicit =
    cleanText(
      htmlAttr(tag, "title") ||
      htmlAttr(tag, "aria-label") ||
      htmlAttr(tag, "data-title") ||
      ""
    );

  if (
    explicit &&
    !/^dailymotion\s+video\s+player$/i.test(
      explicit
    )
  ) {
    return explicit
      .replace(
        /^dailymotion\s+video\s+player\s*[–—:-]\s*/i,
        ""
      )
      .trim();
  }

  const before =
    scope.slice(
      Math.max(0, index - 3600),
      index
    );

  const local =
    before
      .slice(-2400);

  const metaNames = [
    ...local.matchAll(
      /<meta\b[^>]*(?:itemprop|property|name)=["'](?:name|description|headline|title)["'][^>]*>/gi
    )
  ];

  for (
    let i =
      metaNames.length - 1;
    i >= 0;
    i--
  ) {
    const value =
      htmlAttr(
        metaNames[i][0],
        "content"
      );

    if (value) {
      return cleanText(value);
    }
  }

  const headings = [
    ...local.matchAll(
      /<(?:h2|h3|figcaption)\b[^>]*>([\s\S]*?)<\/(?:h2|h3|figcaption)>/gi
    )
  ];

  if (headings.length) {
    return cleanText(
      headings[
        headings.length - 1
      ][1]
    );
  }

  return "";
}

function extractCumhuriyetDailymotionCandidates(
  html = "",
  baseUrl = "",
  expectedTitle = ""
) {
  if (
    !isCumhuriyetArticleUrl(
      baseUrl
    )
  ) {
    return [];
  }

  const primary =
    primaryVideoContentScope(
      html,
      expectedTitle
    );

  const scopes = [];

  if (
    primary &&
    primary !== html
  ) {
    scopes.push({
      html: primary,
      baseScore: 1120,
      label: "article"
    });
  }

  const h1Index =
    html.search(/<h1\b/i);

  if (h1Index >= 0) {
    scopes.push({
      html:
        html.slice(
          Math.max(
            0,
            h1Index - 35_000
          ),
          Math.min(
            html.length,
            h1Index + 360_000
          )
        ),
      baseScore:
        primary !== html
          ? 970
          : 1080,
      label:
        "near-title"
    });
  }

  if (!scopes.length) {
    return [];
  }

  const byVideoId =
    new Map();

  /*
    Cumhuriyet'in güncel sayfalarında Dailymotion Player Library bazen
    <head> içinde yalnız player ID ile yükleniyor; gerçek video ID ise makale
    gövdesindeki data-video / data-video-id elementinde duruyor. Özel
    Cumhuriyet resolver'ı generic taramadan önce çalıştığı için bu split
    yapıyı burada da birleştirmemiz gerekir.
  */
  const globalDailymotionPlayerIds = [];

  for (
    const tag of
    html.match(/<script\b[^>]*>/gi) || []
  ) {
    const src = htmlAttr(tag, "src");
    if (!src) continue;

    try {
      const scriptUrl = new URL(
        absoluteUrl(src, baseUrl)
      );
      const host = scriptUrl.hostname.toLowerCase();

      if (
        host === "geo.dailymotion.com" ||
        host.endsWith(".dailymotion.com")
      ) {
        const match = scriptUrl.pathname.match(
          /\/(?:libs\/)?player\/([A-Za-z0-9_-]{3,40})\.(?:js|html)$/i
        );
        const playerId = match?.[1] || "";

        if (
          playerId &&
          !globalDailymotionPlayerIds.includes(playerId)
        ) {
          globalDailymotionPlayerIds.push(playerId);
        }
      }
    } catch {}
  }

  function dailymotionPartsFromIds(
    videoId = "",
    playerId = ""
  ) {
    if (
      !/^[A-Za-z0-9]{5,24}$/.test(videoId) ||
      !/^[A-Za-z0-9_-]{3,40}$/.test(playerId)
    ) {
      return null;
    }

    const dm = new URL(
      `https://geo.dailymotion.com/player/${playerId}.html`
    );
    dm.searchParams.set("video", videoId);

    return dailymotionPartsFromEmbed(
      dm.href,
      baseUrl
    );
  }

  function addCandidate({
    parts,
    descriptor = "",
    context = "",
    score = 0,
    order = 0,
    source = ""
  }) {
    if (!parts?.videoId) return;

    const relation =
      expectedTitle &&
      descriptor
        ? videoTitleMatch(
            expectedTitle,
            descriptor
          )
        : {
            common: 0,
            score: 0,
            left: 0,
            right: 0
          };

    let finalScore =
      score -
      Math.min(
        120,
        order * 18
      );

    finalScore +=
      Math.round(
        relation.score * 520 +
        relation.common * 54
      );

    const lower =
      normalize(
        cleanText(context)
      );

    if (
      /(?:en cok okunan|ilgili haber|onerilen|tavsiye|recommended|related|most read|most-read|sidebar|footer)/
        .test(lower)
    ) {
      finalScore -= 520;
    }

    const descriptorLower =
      normalize(descriptor);

    const genericDescriptor =
      !descriptor ||
      /^(?:dailymotion video player|cumhuriyet tv|video)$/
        .test(descriptorLower);

    if (
      !genericDescriptor &&
      relation.left >= 3 &&
      relation.right >= 3 &&
      relation.common < 2 &&
      relation.score < 0.20
    ) {
      finalScore -= 420;
    }

    const candidate = {
      ...parts,
      descriptor,
      relation,
      score: finalScore,
      genericDescriptor,
      source
    };

    const previous =
      byVideoId.get(
        parts.videoId
      );

    if (
      !previous ||
      candidate.score >
        previous.score
    ) {
      byVideoId.set(
        parts.videoId,
        candidate
      );
    }
  }

  for (const scopeInfo of scopes) {
    const scope =
      scopeInfo.html;

    let iframeOrder = 0;

    for (
      const match of
      scope.matchAll(
        /<iframe\b[^>]*>/gi
      )
    ) {
      const tag = match[0];
      const value =
        htmlAttr(tag, "src") ||
        htmlAttr(tag, "data-src") ||
        htmlAttr(
          tag,
          "data-lazy-src"
        );

      const parts =
        dailymotionPartsFromEmbed(
          value,
          baseUrl
        );

      if (!parts) continue;

      const index =
        Number(match.index) || 0;

      const context =
        scope.slice(
          Math.max(
            0,
            index - 4200
          ),
          Math.min(
            scope.length,
            index + 4200
          )
        );

      const descriptor =
        cumhuriyetLocalDescriptor(
          scope,
          index,
          tag
        );

      addCandidate({
        parts,
        descriptor,
        context,
        score:
          scopeInfo.baseScore,
        order:
          iframeOrder++,
        source:
          `cumhuriyet-${scopeInfo.label}-iframe`
      });
    }

    /*
      Dailymotion SEO embed'leri iframe dışında meta itemprop=embedUrl
      taşıyabiliyor. Bunları da aynı yerel başlık bağlamıyla değerlendir.
    */
    let metaOrder = 0;

    for (
      const match of
      scope.matchAll(
        /<meta\b[^>]*itemprop=["']embedUrl["'][^>]*>/gi
      )
    ) {
      const tag =
        match[0];

      const value =
        htmlAttr(
          tag,
          "content"
        );

      const parts =
        dailymotionPartsFromEmbed(
          value,
          baseUrl
        );

      if (!parts) continue;

      const index =
        Number(match.index) || 0;

      const context =
        scope.slice(
          Math.max(
            0,
            index - 3400
          ),
          Math.min(
            scope.length,
            index + 3400
          )
        );

      const descriptor =
        cumhuriyetLocalDescriptor(
          scope,
          index,
          tag
        );

      addCandidate({
        parts,
        descriptor,
        context,
        score:
          scopeInfo.baseScore - 10,
        order:
          metaOrder++,
        source:
          `cumhuriyet-${scopeInfo.label}-videoobject`
      });
    }

    /*
      Split Dailymotion setup: head'de player/<id>.js, article içinde
      data-video="x...". Cumhuriyet'in yeni şablonlarında iframe hiç
      bulunmayabildiği için bu yol kritik. Tek global player ID olduğunda
      article-scope video ID ile güvenle eşleştiriyoruz.
    */
    if (globalDailymotionPlayerIds.length === 1) {
      const playerId = globalDailymotionPlayerIds[0];
      let dataOrder = 0;

      for (
        const match of
        scope.matchAll(
          /<[^>]+\bdata-video(?:-id)?=["'][A-Za-z0-9]{5,24}["'][^>]*>/gi
        )
      ) {
        const tag = match[0];
        const videoId =
          htmlAttr(tag, "data-video") ||
          htmlAttr(tag, "data-video-id");
        const parts = dailymotionPartsFromIds(
          videoId,
          playerId
        );
        if (!parts) continue;

        const index = Number(match.index) || 0;
        const context = scope.slice(
          Math.max(0, index - 4200),
          Math.min(scope.length, index + 4200)
        );
        const descriptor = cumhuriyetLocalDescriptor(
          scope,
          index,
          tag
        );

        addCandidate({
          parts,
          descriptor,
          context,
          score: scopeInfo.baseScore + 35,
          order: dataOrder++,
          source: `cumhuriyet-${scopeInfo.label}-paired-data-video`
        });
      }
    }

    /*
      Bazı şablonlar player script'ini doğrudan article içine koyuyor ve
      video ID'yi aynı script tag'inde taşıyor.
    */
    let scriptOrder = 0;
    for (
      const match of
      scope.matchAll(/<script\b[^>]*>/gi)
    ) {
      const tag = match[0];
      const src = htmlAttr(tag, "src");
      const videoId =
        htmlAttr(tag, "data-video") ||
        htmlAttr(tag, "data-video-id");
      if (!src || !videoId) continue;

      let playerId = "";
      try {
        const scriptUrl = new URL(absoluteUrl(src, baseUrl));
        playerId = scriptUrl.pathname.match(
          /\/(?:libs\/)?player\/([A-Za-z0-9_-]{3,40})\.(?:js|html)$/i
        )?.[1] || "";
      } catch {}

      const parts = dailymotionPartsFromIds(
        videoId,
        playerId
      );
      if (!parts) continue;

      const index = Number(match.index) || 0;
      const context = scope.slice(
        Math.max(0, index - 4200),
        Math.min(scope.length, index + 4200)
      );
      const descriptor = cumhuriyetLocalDescriptor(
        scope,
        index,
tag
      );

      addCandidate({
        parts,
        descriptor,
        context,
        score: scopeInfo.baseScore + 45,
        order: scriptOrder++,
        source: `cumhuriyet-${scopeInfo.label}-script-data-video`
      });
    }
  }

  const candidates =
    [...byVideoId.values()]
      .sort(
        (a, b) =>
          b.score - a.score
      );

  if (!candidates.length) {
    return [];
  }

  const top =
    candidates[0];

  const second =
    candidates[1];

  if (second) {
    const strongSemantic =
      (
        top.relation.common >= 2 &&
        top.relation.score >= 0.34
      ) ||
      top.relation.common >= 3;

    if (!strongSemantic) {
      return [];
    }

    const gap =
      top.score -
      second.score;

    const relationGap =
      top.relation.score -
      second.relation.score;

    const commonGap =
      top.relation.common -
      second.relation.common;

    if (
      gap < 105 &&
      relationGap < 0.12 &&
      commonGap < 1
    ) {
      return [];
    }
  } else {
    /*
      Tek aday varsa başlıktan farklı bir klip başlığı normal olabilir.
      Fakat aday açıkça related/sidebar bağlamından geldiyse zaten skor ciddi
      biçimde düşer; düşük güvenli tek adayı da kabul etmeyiz.
    */
    if (top.score < 760) {
      return [];
    }
  }

  return candidates;
}

function dailymotionStreamUrlSafe(
  value = ""
) {
  if (!isSafeArticleUrl(value)) {
    return false;
  }

  try {
    const host =
      new URL(value)
        .hostname
        .toLowerCase();

    return (
      host === "dailymotion.com" ||
      host.endsWith(
        ".dailymotion.com"
      ) ||
      host === "dmcdn.net" ||
      host.endsWith(
        ".dmcdn.net"
      )
    );
  } catch {
    return false;
  }
}

function bestDailymotionNativeStream(
  metadata
) {
  const qualities =
    metadata?.qualities;

  if (
    !qualities ||
    typeof qualities !== "object"
  ) {
    return null;
  }

  const mp4 = [];
  const hls = [];

  for (
    const [quality, list]
    of Object.entries(
      qualities
    )
  ) {
    if (!Array.isArray(list)) {
      continue;
    }

    const qualityScore =
      Number.parseInt(
        String(quality),
        10
      ) || 0;

    for (const item of list) {
      const url =
        String(
          item?.url || ""
        ).trim();

      const type =
        String(
          item?.type || ""
        ).toLowerCase();

      if (
        !url ||
        !dailymotionStreamUrlSafe(url) ||
        type.includes(
          "lumberjack"
        )
      ) {
        continue;
      }

      const row = {
        url,
        type,
        quality:
          qualityScore,
        bitrate:
          Number(
            item?.bitrate || 0
          )
      };

      if (
        type === "video/mp4" ||
        /\.mp4(?:[?#]|$)/i.test(
          url
        )
      ) {
        mp4.push(row);
      } else if (
        type.includes(
          "mpegurl"
        ) ||
        /\.m3u8(?:[?#]|$)/i.test(
          url
        )
      ) {
        hls.push(row);
      }
    }
  }

  mp4.sort(
    (a, b) =>
      b.quality -
        a.quality ||
      b.bitrate -
        a.bitrate
  );

  hls.sort(
    (a, b) =>
      b.quality -
      a.quality
  );

  const best =
    mp4[0] ||
    hls[0] ||
    null;

  if (!best) return null;

  return {
    url: best.url,
    type:
      mp4[0]
        ? "video/mp4"
        : "application/x-mpegURL"
  };
}

async function fetchDailymotionNativeStream(
  candidate,
  articleUrl,
  expectedTitle,
  signal
) {
  if (!candidate?.videoId) {
    return null;
  }

  const endpoint =
    new URL(
      `https://www.dailymotion.com/player/metadata/video/${encodeURIComponent(candidate.videoId)}`
    );

  endpoint.searchParams.set(
    "embedder",
    articleUrl
  );

  endpoint.searchParams.set(
    "app",
    "com.dailymotion.neon"
  );

  try {
    const response =
      await fetch(
        endpoint.href,
        {
          signal,
          redirect: "follow",
          headers: {
            "Accept":
              "application/json,text/plain;q=0.9,*/*;q=0.5",
            "User-Agent":
              "Mozilla/5.0 (compatible; TheFloewVideoResolver/1.0)"
          }
        }
      );

    if (!response.ok) {
      return null;
    }

    const length =
      Number(
        response.headers.get(
          "Content-Length"
        ) || 0
      );

    if (
      length &&
      length > 2_000_000
    ) {
      return null;
    }

    const metadata =
      await response.json();

    if (metadata?.error) {
      return null;
    }

    const metadataTitle =
      cleanText(
        metadata?.title || ""
      );

    const metaRelation =
      expectedTitle &&
      metadataTitle
        ? videoTitleMatch(
            expectedTitle,
            metadataTitle
          )
        : {
            common: 0,
            score: 0,
            left: 0,
            right: 0
          };

    const candidateRelation =
      candidate.relation || {
        common: 0,
        score: 0,
        left: 0,
        right: 0
      };

    /*
      Hem iframe/VideoObject başlığı hem de gerçek Dailymotion metadata
      başlığı makaleyle açıkça uyuşmuyorsa yanlış videoyu göstermemek için
      görüntü fallback'ine dön.
    */
    const metadataMismatch =
      metaRelation.left >= 3 &&
      metaRelation.right >= 3 &&
      metaRelation.common < 2 &&
      metaRelation.score < 0.20;

    const candidateMismatch =
      candidateRelation.left >= 3 &&
      candidateRelation.right >= 3 &&
      candidateRelation.common < 2 &&
      candidateRelation.score < 0.20;

    if (
      metadataMismatch &&
      candidateMismatch
    ) {
      return null;
    }

    const stream =
      bestDailymotionNativeStream(
        metadata
      );

    if (!stream) {
      return null;
    }

    return {
      kind: "video",
      url: stream.url,
      type: stream.type,
      provider: "native",
      source:
        "cumhuriyet-dailymotion-native",
      confidence:
        candidate.score +
        Math.round(
          metaRelation.score * 180 +
          metaRelation.common * 20
        )
    };
  } catch {
    return null;
  }
}

async function resolveCumhuriyetDailymotionVideo(
  html = "",
  baseUrl = "",
  expectedTitle = "",
  signal = undefined
) {
  if (
    !isCumhuriyetArticleUrl(
      baseUrl
    )
  ) {
    return null;
  }

  const candidates =
    extractCumhuriyetDailymotionCandidates(
      html,
      baseUrl,
      expectedTitle
    );

  if (!candidates.length) {
    return null;
  }

  /*
    Önce native Dailymotion stream'ini çözmeye çalış. Metadata endpoint'i
    değişir/engellenirse, zaten article-scope + başlık kontrollerinden geçmiş
    güçlü Dailymotion adayını iframe embed olarak koru. Böylece geçerli bir
    Cumhuriyet videosu yalnız metadata servisi cevap vermedi diye kaybolmaz.
  */
  const best = candidates[0];
  const native = await fetchDailymotionNativeStream(
    best,
    baseUrl,
    expectedTitle,
    signal
  );

  if (native) return native;

  const embed = normalizeKnownEmbed(best.url, baseUrl);
  if (!embed || embed.provider !== "dailymotion") return null;

  return {
    ...embed,
    /*
      Native stream çözülemediyse bu embed zaten article-scope + başlık
      doğrulamasından geçti. Frontend'in Dailymotion SDK exact-video
      kontrolü bazı geçerli publisher player'larında false-negative
      üretebildiği için bu spesifik fallback'i plain iframe'e zorla.
    */
    forceIframe: true,
    source: "cumhuriyet-dailymotion-iframe-fallback",
    confidence: best.score
  };
}


function isStarOwnedArticleVideoEmbed(value = "", baseUrl = "") {
  try {
    const u = new URL(value, baseUrl);
    const host = u.hostname.toLowerCase();
    if (host !== "star.com.tr" && host !== "www.star.com.tr") return false;
    if (!/^\/video\/embed\/?$/i.test(u.pathname)) return false;

    const raw =
      u.searchParams.get("flv") ||
      u.searchParams.get("file") ||
      u.searchParams.get("src") ||
      u.searchParams.get("video") ||
      "";

    if (!raw) return false;
    let decoded = raw;
    try { decoded = decodeURIComponent(raw); } catch {}

    /* Star'ın makale içi player'ı gerçek dosya adını query'de taşıyor.
       Bu kanıt yoksa aynı-origin generic player'ı kabul etmiyoruz. */
    return /\.(?:mp4|m3u8|m4v|webm)(?:[?#]|$)/i.test(decoded);
  } catch {
    return false;
  }
}

function extractStarArticleIframeCandidates(
  html = "",
  baseUrl = "",
  expectedTitle = ""
) {
  if (!isStarArticleUrl(baseUrl)) return [];

  /*
    Star'da makale videosu h1'den sonra, "ÖNERİLEN VİDEO" bölümünden önce
    yer alıyor. v31.87 h1'in 12 KB öncesinden taramaya başladığı için header /
    site-geneli player'ları da aday havuzuna girebiliyordu. Burada taramayı
    yalnız eşleşen h1'in KAPANIŞINDAN sonra başlatıyoruz.
  */
  const source = starPrimaryArticleVideoScope(String(html || ""));
  if (!source) return [];

  const h1Matches = [...source.matchAll(/<h1\b[^>]*>([\s\S]*?)<\/h1>/gi)];
  if (!h1Matches.length) return [];

  let best = null;
  let bestScore = -1;
  for (const match of h1Matches) {
    const title = cleanText(match[1] || "");
    const relation = expectedTitle && title
      ? videoTitleMatch(expectedTitle, title)
      : { score: 0, common: 0 };
    const score = relation.score * 1000 + relation.common * 80;
    if (score > bestScore) {
      bestScore = score;
      best = { match, relation };
    }
  }

  if (!best) return [];

  /* Başlık verilmişse yanlış article/main bloğunu seçmeye tolerans verme. */
  if (
    expectedTitle &&
    best.relation.score < 0.45 &&
    best.relation.common < 3
  ) {
    return [];
  }

  const h1End = (best.match.index ?? 0) + String(best.match[0] || "").length;
  const scoped = source.slice(h1End);
  const candidates = [];
  let order = 0;

  for (const tag of scoped.match(/<iframe\b[^>]*>/gi) || []) {
    const tagText = String(tag || "");
    const lower = tagText.toLowerCase();

    if (/(?:doubleclick|googlesyndication|googleads|adservice|taboola|outbrain|gemius|scorecardresearch|criteo|adform|adnxs|amazon-adsystem|googletagmanager|reklam|advert|banner)/i.test(lower)) {
      continue;
    }

    let value = "";
    for (const attr of [
      "src",
      "data-src",
      "data-lazy-src",
      "data-embed-url",
      "data-video-url",
      "data-original",
      "data-lazy"
    ]) {
      value = htmlAttr(tagText, attr);
      if (value) break;
    }
    if (!value) continue;

    const absolute = absoluteUrl(value, baseUrl);
    if (!absolute || !isSafeArticleUrl(absolute) || sameDocumentUrl(absolute, baseUrl)) {
      continue;
    }

    const known = normalizeKnownEmbed(absolute, baseUrl);
    const starOwned = isStarOwnedArticleVideoEmbed(absolute, baseUrl);

    /*
      Star'da bilinmeyen same-origin iframe'leri artık video saymıyoruz.
      Yalnız query'sinde gerçek medya dosyasını taşıyan /video/embed player'ı
      veya bilinen üçüncü taraf video provider'ı kabul edilir.
    */
    if (!starOwned && !known) continue;

    let score = 1500 - Math.min(order, 6) * 30;
    if (starOwned) score += 260;
    if (known) score += 140;

    candidates.push({
      url: absolute,
      tag: tagText,
      score,
      source: starOwned
        ? `star-article-flv-iframe:${order}`
        : `star-article-known-iframe:${order}`,
      starOwned,
      known
    });
    order++;
  }

  candidates.sort((a, b) => b.score - a.score);
  return candidates.slice(0, 2);
}

function resolveStarArticleVideo(
  html = "",
  baseUrl = "",
  expectedTitle = ""
) {
  if (!isStarArticleUrl(baseUrl)) return null;

  const candidates = extractStarArticleIframeCandidates(
    html,
    baseUrl,
    expectedTitle
  );

  for (const candidate of candidates) {
    if (candidate.starOwned) {
      /*
        Önemli: Bu URL'yi server-side nested resolver'a sokma. Star embed
        sayfası kendi query'sindeki flv dosyasını oynatmak için hazırlanmış
        article-bound player'dır. Nested tarama önerilen/site-geneli videoya
        kayabiliyordu. Plain iframe olarak frontend'e ver.
      */
      return {
        kind: "embed",
        provider: "generic",
        url: candidate.url,
        forceIframe: true,
        source: candidate.source,
        confidence: candidate.score
      };
    }

    if (candidate.known) {
      return {
        ...candidate.known,
        source: candidate.source,
        confidence: candidate.score
      };
    }
  }

  return null;
}

function extractVideoFromHtml(
  html = "",
  baseUrl = "",
  expectedTitle = "",
  hintedMedia = null
) {
  const direct = [];
  const embeds = [];
  const cumhuriyetPage =
    isCumhuriyetArticleUrl(baseUrl);
  const halkTvPage =
    isHalkTvArticleUrl(baseUrl);
  const starPage =
    isStarArticleUrl(baseUrl);
  const scopedHtml = primaryVideoContentScope(html, expectedTitle);

  /*
    primaryVideoContentScope() tarihsel olarak güvenilir bir yapı bulamazsa
    tüm HTML'i döndürür. Tüm sayfayı article scope gibi taramak önerilenler /
    video galerileri üzerinden yanlış video seçimine yol açabiliyordu.
  */
  const rawArticleHtml =
    scopedHtml && scopedHtml !== html
      ? scopedHtml
      : "";

  const articleHtml =
    starPage && rawArticleHtml
      ? starPrimaryArticleVideoScope(rawArticleHtml)
      : rawArticleHtml;

  const metaTags = html.match(/<meta\b[^>]*>/gi) || [];
  const metaValues = new Map();
  let pageTitle = "";

  for (const tag of metaTags) {
    const key = (
      htmlAttr(tag, "property") ||
      htmlAttr(tag, "name") ||
      htmlAttr(tag, "itemprop")
    ).toLowerCase();

    const content = htmlAttr(tag, "content");

    if (key && content && !metaValues.has(key)) {
      metaValues.set(key, content);
    }

    if (
      !pageTitle &&
      content &&
      (key === "og:title" || key === "twitter:title")
    ) {
      pageTitle = cleanText(content);
    }
  }

  if (!pageTitle) {
    const h1 = (articleHtml || html)
      .match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i);

    pageTitle = h1 ? cleanText(h1[1]) : "";
  }

  const pageRelation = expectedTitle && pageTitle
    ? videoTitleMatch(expectedTitle, pageTitle)
    : null;

  function pushBest(list, candidate) {
    const current = list.find(x => x.url === candidate.url);

    if (current) {
      if (candidate.score > current.score) {
        Object.assign(current, candidate);
      }
      return;
    }

    list.push(candidate);
  }

  function isObviouslyNonVideoUrl(value = "") {
    try {
      const u = new URL(value);

      return /\.(?:jpe?g|png|gif|webp|avif|svg|css|js|json|xml|pdf)(?:[?#]|$)/i
        .test(u.pathname + u.search);
    } catch {
      return true;
    }
  }

  function addDirect(
    value,
    type = "",
    score = 0,
    source = "",
    trustedVideoContext = false
  ) {
    const url = absoluteUrl(value, baseUrl);
    if (!url || !/^https?:\/\//i.test(url)) return;

    const declaredType =
      String(type || "").trim();

    const semanticType =
      declaredType ||
      (trustedVideoContext ? "video/*" : "");

    if (
      !looksLikeVideoUrl(url, semanticType) &&
      !trustedVideoContext
    ) {
      return;
    }

    if (
      trustedVideoContext &&
      isObviouslyNonVideoUrl(url)
    ) {
      return;
    }

    /*
      Güvenilir bir video alanından gelmiş olsa bile haber sayfasının kendi
      URL'si native video değildir. Özellikle NTV VideoObject.contentUrl bu
      biçimde gelebiliyor. Query farklarını önemsemeden aynı document path'ini
      reddet; gerçek .mp4/.m3u8 URL'leri zaten farklı media path'leridir.
    */
    if (trustedVideoContext) {
      try {
        const mediaUrl = new URL(url);
        const articleUrl = new URL(baseUrl);
        const normalizePath = value =>
          (String(value || "").replace(/\/+$/, "") || "/");
        const sameArticleDocument =
          mediaUrl.origin === articleUrl.origin &&
          normalizePath(mediaUrl.pathname) ===
            normalizePath(articleUrl.pathname);
        const explicitMediaUrl =
          /\.(?:mp4|m4v|webm|ogv|mov|m3u8)(?:[?#]|$)/i.test(url);

        if (sameArticleDocument && !explicitMediaUrl) return;
      } catch {}
    }

    pushBest(direct, {
      kind: "video",
      url,
      type: semanticType,
      provider: "native",
      score,
      source
    });
  }

  function addEmbed(value, score = 0, source = "") {
    const embed = normalizeKnownEmbed(value, baseUrl);
    if (!embed) return;

    /*
      Cumhuriyet Dailymotion videoları özel validator + metadata resolver'dan
      geçmeden generic iframe/meta/JSON-LD yoluyla seçilemez.
    */
    if (
      cumhuriyetPage &&
      embed.provider === "dailymotion"
    ) {
      return;
    }

    if (
      halkTvPage &&
      embed.provider === "youtube"
    ) {
      return;
    }

    pushBest(embeds, {
      ...embed,
      score,
      source
    });
  }


  function addDailymotionIframe(
    value,
    score = 0,
    source = ""
  ) {
    const url = normalizeDailymotionIframeFallback(value, baseUrl);
    if (!url) return;

    pushBest(embeds, {
      kind: "embed",
      provider: "generic",
      url,
      forceIframe: true,
      score,
      source
    });
  }

  function addDailymotionVideoIdIframe(
    videoId,
    score = 0,
    source = ""
  ) {
    if (!/^[A-Za-z0-9]{5,24}$/.test(String(videoId || ""))) return;
    addDailymotionIframe(
      `https://www.dailymotion.com/embed/video/${videoId}`,
      score,
      source
    );
  }

  function addPublisherPlayerEmbed(
    value,
    tag = "",
    score = 0,
    source = ""
  ) {
    const absolute = absoluteUrl(value, baseUrl);
    if (!absolute || !isSafeArticleUrl(absolute)) return;

    /* Bilinen provider'lar mevcut, daha sıkı normalizer yolundan geçsin. */
    if (normalizeKnownEmbed(absolute, baseUrl)) return;
    if (sameDocumentUrl(absolute, baseUrl)) return;

    try {
      const u = new URL(absolute);
      const article = new URL(baseUrl);
      const host = u.hostname.toLowerCase();
      const tagText = String(tag || "").toLowerCase();
      const urlText = `${u.pathname} ${u.search}`.toLowerCase();
      const all = `${host} ${urlText} ${tagText}`;

      /* Reklam/ölçüm iframe'leri hiçbir koşulda video player adayı değildir. */
      if (/(?:doubleclick|googlesyndication|googleads|adservice|taboola|outbrain|gemius|scorecardresearch|criteo|adform|adnxs|amazon-adsystem|facebook\.com\/tr|googletagmanager|adserver|\/ads?(?:[\/_?&=-]|$)|banner|advert)/i.test(all)) {
        return;
      }

      const sameOrigin = u.origin === article.origin;
      const urlSignal = /(?:^|[\/_?&=.:-])(?:video|player|embed|stream|media|vod|jwplayer|brightcove|flowplayer|videojs|vjs)(?:[\/_?&=.:-]|$)/i.test(urlText);
      const tagSignal = /(?:allowfullscreen|autoplay|playsinline|picture-in-picture|\bvideo\b|\bplayer\b|\bembed\b|jwplayer|video-js|vjs)/i.test(tagText);

      /*
        Star'ın gerçek makale player URL'si her zaman haber ID'sini taşımıyor.
        v31.85'te bütün same-origin Star player'larında ID zorunlu tutulunca
        doğru videolar da kesilmişti.

        Article scope artık starPrimaryArticleVideoScope() ile ortak
        “ÖNERİLEN VİDEO” modülünden temizleniyor; bu nedenle article-scope
        player'ına ID şartı koymuyoruz. Yalnız primary article scope hiç
        bulunamadığında kullanılan daha gevşek near-title fallback'inde eski
        korelasyon güvenliğini koruyoruz.
      */
      if (
        starPage &&
        sameOrigin &&
        String(source || "").startsWith("near-title-")
      ) {
        const articleId = articleNumericIdentity(baseUrl);
        const correlationText = `${u.href} ${tagText}`;

        if (articleId && !correlationText.includes(articleId)) {
          return;
        }
      }

      /*
        Same-origin publisher wrapper'ında URL veya iframe etiketi player
        sinyali yeterli. Cross-origin bilinmeyen iframe'de ikisini birden iste;
        bu, öneri/reklam widget'larının yanlışlıkla seçilmesini ciddi azaltır.
      */
      if (sameOrigin) {
        if (!urlSignal && !tagSignal) return;
      } else if (!urlSignal || !tagSignal) {
        return;
      }

      pushBest(embeds, {
        kind: "embed",
        provider: "publisher",
        url: u.href,
        score,
        source
      });
    } catch {}
  }

  function addKnownOrDirect(
    value,
    {
      type = "",
      score = 0,
      source = "",
      trustedVideoContext = false
    } = {}
  ) {
    const known = normalizeKnownEmbed(value, baseUrl);

    if (known) {
      addEmbed(value, score, source);
      return;
    }

    addDirect(
      value,
      type,
      score,
      source,
      trustedVideoContext
    );
  }

  const pageMismatch = Boolean(
    pageRelation &&
    pageRelation.left >= 3 &&
    pageRelation.right >= 3 &&
    pageRelation.common < 2 &&
    pageRelation.score < 0.22
  );

  /*
    Bambaşka bir habere redirect olduysak sayfa videolarını reddet.
    RSS item enclosure'ı varsa bu item'a bağlı olduğu için korunabilir.
  */
  if (pageMismatch) {
    if (hintedMedia?.url && !cumhuriyetPage) {
      const known =
        normalizeKnownEmbed(
          String(hintedMedia.url),
          baseUrl
        );

      if (known) {
        return {
          ...known,
          source: "feed-hint-title-mismatch",
          confidence: 1180
        };
      }

      if (
        looksLikeVideoUrl(
          hintedMedia.url,
          hintedMedia.type || "video/*"
        )
      ) {
        return {
          kind: "video",
          url: absoluteUrl(
            hintedMedia.url,
            baseUrl
          ),
          type:
            hintedMedia.type ||
            "video/*",
          provider: "native",
          source: "feed-hint-title-mismatch",
          confidence: 1180
        };
      }
    }

    return null;
  }

  /* RSS video enclosure = en güçlü story-bound sinyal. */
  if (hintedMedia?.url && !cumhuriyetPage) {
    addKnownOrDirect(
      String(hintedMedia.url),
      {
        type:
          String(
            hintedMedia.type ||
            "video/*"
          ),
        score: 1200,
        source: "feed-hint",
        trustedVideoContext: true
      }
    );
  }

  /*
    Star iframe'leri generic candidate havuzuna eklenmez. Star sayfalarında
    önerilen/site-geneli player riski yüksek olduğu için yalnız
    resolveStarArticleVideo() tarafından article-bound olarak çözülür.
  */

  for (const candidate of extractNtvNextVideoCandidates(html, baseUrl, expectedTitle)) {
    addKnownOrDirect(
      candidate.url,
      {
        type: candidate.type || "",
        score: candidate.score,
        source: candidate.source || "ntv-next",
        trustedVideoContext: true
}
    );
  }

  for (
    const candidate of
    extractSabahVideoJsCandidates(
      html,
      baseUrl,
      expectedTitle
    )
  ) {
    addKnownOrDirect(
      candidate.url,
      {
        type:
          candidate.type || "",
        score:
          candidate.score,
        source:
          candidate.source ||
          "turkuvaz-videojs",
        trustedVideoContext:
          true
      }
    );
  }

  for (
    const candidate of
    extractHaberturkHopePlayerCandidates(
      html,
      baseUrl,
      expectedTitle
    )
  ) {
    addKnownOrDirect(
      candidate.url,
      {
        type:
          candidate.type || "",
        score:
          candidate.score,
        source:
          candidate.source ||
          "haberturk-hope",
        trustedVideoContext:
          true
      }
    );
  }

  /*
    Signed CDN URL'lerinde .mp4 bulunmayabilir. og:video:type ayrı meta
    alanındaki MIME bilgisiyle URL'yi birlikte değerlendir.
  */
  const ogVideoType =
    metaValues.get("og:video:type") ||
    metaValues.get("video:type") ||
    "";

  const twitterStreamType =
    metaValues.get(
      "twitter:player:stream:content_type"
    ) || "";

  for (const [key, content] of metaValues.entries()) {
    if (
      key === "og:video" ||
      key === "og:video:url" ||
      key === "og:video:secure_url"
    ) {
      addKnownOrDirect(content, {
        type: ogVideoType,
        score: 1120,
        source: `meta:${key}`,
        trustedVideoContext:
          Boolean(ogVideoType)
      });
    }

    if (key === "twitter:player:stream") {
      addKnownOrDirect(content, {
        type: twitterStreamType,
        score: 1120,
        source:
          "meta:twitter:player:stream",
        trustedVideoContext:
          Boolean(twitterStreamType)
      });
    }

    if (
      key === "contenturl" ||
      key === "video:url" ||
      key === "video:content_url"
    ) {
      addKnownOrDirect(content, {
        type:
          ogVideoType ||
          twitterStreamType,
        score: 1100,
        source: `meta:${key}`,
        trustedVideoContext: true
      });
    }

    if (
      key === "twitter:player" ||
      key === "embedurl"
    ) {
      addEmbed(
        content,
        1080,
        `meta:${key}`
      );
    }
  }

  /*
    Yalnız güvenilir article scope varsa inline DOM player'larını doğrudan
    tara. Scope yoksa aşağıdaki near-title unique fallback kullanılır.
  */
  if (articleHtml) {
    const completeVideoBlocks =
      articleHtml.match(
        /<video\b[^>]*>[\s\S]*?<\/video>/gi
      ) || [];

    for (const block of completeVideoBlocks) {
      const opening =
        block.match(/<video\b[^>]*>/i)?.[0] ||
        "";

      for (const attr of [
        "src",
        "data-src",
        "data-video-src",
        "data-file",
        "data-url",
        "data-lazy-src",
        "data-hls",
        "data-hls-src",
        "data-mp4",
        "data-mp4-src",
        "data-stream",
        "data-stream-url",
        "data-playback-url"
      ]) {
        const value = htmlAttr(opening, attr);

        if (value) {
          addDirect(
            value,
            htmlAttr(opening, "type"),
            1055,
            `article-video-${attr}`,
            true
          );
        }
      }

      for (
        const sourceTag of
        block.match(/<source\b[^>]*>/gi) ||
        []
      ) {
        const sourceType =
          htmlAttr(sourceTag, "type");

        for (const attr of [
          "src",
          "data-src",
          "data-video-src",
          "data-file",
          "data-url",
          "data-lazy-src"
        ]) {
          const value =
            htmlAttr(sourceTag, attr);

          if (value) {
            addDirect(
              value,
              sourceType,
              1050,
              `article-video-source-${attr}`,
              true
            );
          }
        }
      }
    }

    for (
      const tag of
      articleHtml.match(/<video\b[^>]*>/gi) ||
      []
    ) {
      const type = htmlAttr(tag, "type");

      for (const attr of [
        "src",
        "data-src",
        "data-video-src",
        "data-file",
        "data-url",
        "data-lazy-src",
        "data-hls",
        "data-hls-src",
        "data-mp4",
        "data-mp4-src",
        "data-stream",
        "data-stream-url",
        "data-playback-url"
      ]) {
        const value = htmlAttr(tag, attr);

        if (value) {
          addDirect(
            value,
            type,
            1040,
            `article-video-${attr}`,
            true
          );
        }
      }
    }

    /*
      Standalone <source> için yalnız MIME açıkça video/HLS ise güven.
    */
    for (
      const tag of
      articleHtml.match(/<source\b[^>]*>/gi) ||
      []
    ) {
      const type = htmlAttr(tag, "type");

      if (
        !/^video\//i.test(type) &&
        !/mpegurl/i.test(type)
      ) {
        continue;
      }

      for (const attr of [
        "src",
        "data-src",
        "data-video-src",
        "data-file",
        "data-url",
        "data-lazy-src"
      ]) {
        const value = htmlAttr(tag, attr);

        if (value) {
          addDirect(
            value,
            type,
            1025,
            `article-source-${attr}`,
            true
          );
        }
      }
    }

    for (
      const tag of
      articleHtml.match(/<iframe\b[^>]*>/gi) ||
      []
    ) {
      for (const attr of [
        "src",
        "data-src",
        "data-lazy-src",
        "data-embed-url",
        "data-video-url",
        "data-original",
        "data-lazy"
      ]) {
        const value = htmlAttr(tag, attr);

        if (value) {
          /*
            Standart Dailymotion embed'lerinde özel player ID bulunmayabilir.
            Bunlar normalizeKnownEmbed() tarafından kasıtlı olarak reddedilir;
            fakat article scope içindeki açık iframe haberle güçlü biçimde
            bağlıdır. SDK yerine plain iframe fallback olarak koru.
          */
          addDailymotionIframe(
            value,
            1020,
            `article-dailymotion-iframe-${attr}`
          );

          addEmbed(
            value,
            1000,
            `article-iframe-${attr}`
          );
          addPublisherPlayerEmbed(
            value,
            tag,
            975,
            `article-publisher-iframe-${attr}`
          );
        }
      }
    }

    /* AMP video/provider tags. */
    for (
      const tag of
      articleHtml.match(/<amp-video\b[^>]*>/gi) ||
      []
    ) {
      const type = htmlAttr(tag, "type");

      for (const attr of ["src", "data-src"]) {
        const value = htmlAttr(tag, attr);

        if (value) {
          addDirect(
            value,
            type,
            1020,
            `article-amp-video-${attr}`,
            true
          );
        }
      }
    }

    for (
      const tag of
      articleHtml.match(/<amp-youtube\b[^>]*>/gi) ||
      []
    ) {
      const id =
        htmlAttr(tag, "data-videoid") ||
        htmlAttr(tag, "data-video-id");

      if (/^[A-Za-z0-9_-]{6,20}$/.test(id)) {
        addEmbed(
          `https://www.youtube.com/watch?v=${id}`,
          1015,
          "article-amp-youtube"
        );
      }
    }

    for (
      const tag of
      articleHtml.match(/<amp-vimeo\b[^>]*>/gi) ||
      []
    ) {
      const id =
        htmlAttr(tag, "data-videoid") ||
        htmlAttr(tag, "data-video-id");

      if (/^\d{5,12}$/.test(id)) {
        addEmbed(
          `https://vimeo.com/${id}`,
          1015,
          "article-amp-vimeo"
        );
      }
    }
  }


  /*
    Sözcü ve bazı başka yayıncılar iframe'i client-side oluşturmak için
    article içinde yalnız data-video / videoId taşıyan Dailymotion placeholder
    bırakabiliyor. Tag/class/id üzerinde Dailymotion sinyali varsa bu ID
    doğrudan standart iframe'e dönüştürülebilir.
  */
  if (articleHtml) {
    const dmPlaceholderTags =
      articleHtml.match(
        /<[^>]+(?:data-video(?:-id)?|data-dailymotion(?:-video)?|dailymotion-video-id)=["'][A-Za-z0-9]{5,24}["'][^>]*>/gi
      ) || [];

    for (const tag of dmPlaceholderTags) {
      if (!/(?:dailymotion|daily-motion|dm-player|dmplayer|dailymotion-player)/i.test(tag)) {
        continue;
      }

      const videoId =
        htmlAttr(tag, "data-video") ||
        htmlAttr(tag, "data-video-id") ||
        htmlAttr(tag, "data-dailymotion") ||
        htmlAttr(tag, "data-dailymotion-video") ||
        htmlAttr(tag, "dailymotion-video-id");

      addDailymotionVideoIdIframe(
        videoId,
        1035,
        "article-dailymotion-placeholder"
      );
    }

    /*
      Script/JSON içinde Dailymotion adıyla aynı küçük bağlamda bulunan video
      kimliklerini de yakala. Tüm sayfadan körlemesine ID toplama; yalnız
      güvenilir article scope içinde ve açık Dailymotion sinyaliyle eşleştir.
    */
    const dmIdPattern =
      /(?:data-video(?:-id)?|videoId|videoID|video_id|dailymotionVideoId|dailymotion_video_id)["']?\s*[:=]\s*["']([A-Za-z0-9]{5,24})["']/gi;

    for (const match of articleHtml.matchAll(dmIdPattern)) {
      const start = Math.max(0, match.index - 900);
      const end = Math.min(articleHtml.length, match.index + match[0].length + 900);
      const context = articleHtml.slice(start, end);

      if (!/(?:dailymotion|daily-motion|dm-player|dmplayer|dailymotion-player)/i.test(context)) {
        continue;
      }

      addDailymotionVideoIdIframe(
        match[1],
        1028,
        "article-dailymotion-config"
      );
    }
  }

  /*
    Dailymotion Player Library çoğu zaman <head>'de, video ID ise article
    içindeki ayrı elementtedir. Bu iki parçayı eşleştir.
  */
  const dailymotionPlayerIds = [];

  for (
    const tag of
    html.match(/<script\b[^>]*>/gi) ||
    []
  ) {
    const src = htmlAttr(tag, "src");
    if (!src) continue;

    try {
      const scriptUrl =
        new URL(
          absoluteUrl(src, baseUrl)
        );

      const host =
        scriptUrl.hostname.toLowerCase();

      if (
        host === "geo.dailymotion.com" ||
        host.endsWith(".dailymotion.com")
      ) {
        const match =
          scriptUrl.pathname.match(
            /\/(?:libs\/)?player\/([A-Za-z0-9_-]{3,40})\.(?:js|html)$/i
          );

        if (
          match?.[1] &&
          !dailymotionPlayerIds.includes(
            match[1]
          )
        ) {
          dailymotionPlayerIds.push(
            match[1]
          );
        }
      }
    } catch {}
  }

  if (
    articleHtml &&
    dailymotionPlayerIds.length === 1
  ) {
    const playerId =
      dailymotionPlayerIds[0];

    for (
      const tag of
      articleHtml.match(
        /<[^>]+\bdata-video(?:-id)?=["'][A-Za-z0-9]{5,24}["'][^>]*>/gi
      ) || []
    ) {
      const videoId =
        htmlAttr(tag, "data-video") ||
        htmlAttr(tag, "data-video-id");

      if (
        !/^[A-Za-z0-9]{5,24}$/.test(
          videoId
        )
      ) {
        continue;
      }

      const dm = new URL(
        `https://geo.dailymotion.com/player/${playerId}.html`
      );

      dm.searchParams.set(
        "video",
        videoId
      );

      addEmbed(
        dm.href,
        1010,
        "article-dailymotion-paired"
      );
    }

    for (
      const tag of
      articleHtml.match(/<iframe\b[^>]*>/gi) ||
      []
    ) {
      const value =
        htmlAttr(tag, "src") ||
        htmlAttr(tag, "data-src");

      if (!value) continue;

      try {
        const u =
          new URL(
            absoluteUrl(
              value,
              baseUrl
            )
          );

        const host =
          u.hostname.toLowerCase();

        if (
          !host.endsWith(
            "dailymotion.com"
          )
        ) {
          continue;
        }

        const idMatch =
          u.pathname.match(
            /(?:\/video\/|\/embed\/video\/)([A-Za-z0-9]{5,24})/
          );

        const videoId =
          idMatch?.[1] || "";

        if (!videoId) continue;

        const dm = new URL(
          `https://geo.dailymotion.com/player/${playerId}.html`
        );

        dm.searchParams.set(
          "video",
          videoId
        );

        addEmbed(
          dm.href,
          1008,
          "article-dailymotion-upgraded"
        );
      } catch {}
    }
  }

  /*
    Eski same-tag Dailymotion biçimini de koru.
  */
  if (articleHtml) {
    for (
      const tag of
      articleHtml.match(/<script\b[^>]*>/gi) ||
      []
    ) {
      const src = htmlAttr(tag, "src");

      const videoId =
        htmlAttr(tag, "data-video") ||
        htmlAttr(tag, "data-video-id");

      if (!src || !videoId) continue;

      try {
        const scriptUrl =
          new URL(
            absoluteUrl(src, baseUrl)
          );

        const host =
          scriptUrl.hostname.toLowerCase();

        if (
          host === "geo.dailymotion.com" ||
          host.endsWith(".dailymotion.com")
        ) {
          scriptUrl.searchParams.set(
            "video",
            videoId
          );

          addEmbed(
            scriptUrl.href,
            1000,
            "article-dailymotion-script"
          );

          /*
            Generic Dailymotion loader (örn. player.js) özel player ID
            taşımayabilir. Bu durumda video ID yine haber içindeki aynı script
            tag'ine bağlıdır; plain iframe fallback güvenlidir.
          */
          addDailymotionVideoIdIframe(
            videoId,
            1025,
            "article-dailymotion-script-fallback"
          );
        }
      } catch {}
    }
  }

  /*
    JSON-LD VideoObject tüm sayfada güvenilir semantik sinyaldir.
  */
  const ldScripts = html.match(
    /<script\b[^>]*type=["']application\/ld\+json["'][^>]*>[\s\S]*?<\/script>/gi
  ) || [];

  function walkJson(value) {
    if (!value) return;

    if (Array.isArray(value)) {
      for (const item of value) {
        walkJson(item);
      }
      return;
    }

    if (typeof value !== "object") return;

    const rawType = value["@type"];
    const types =
      Array.isArray(rawType)
        ? rawType
        : [rawType];

    const isVideoObject =
      types
        .filter(Boolean)
        .some(
          x =>
            String(x).toLowerCase() ===
            "videoobject"
        );

    if (isVideoObject) {
      const descriptor =
        cleanText(
          value.name ||
          value.headline ||
          value.title ||
          ""
        );

      const relation =
        descriptor &&
        expectedTitle
          ? videoTitleMatch(
              expectedTitle,
              descriptor
            )
          : null;

      if (
        relation &&
        relation.left >= 3 &&
        relation.right >= 3 &&
        relation.common < 2 &&
        relation.score < 0.22
      ) {
        return;
      }

      const relationBonus =
        relation
          ? Math.round(
              relation.score * 180 +
              relation.common * 18
            )
          : 0;

      const score =
        900 + relationBonus;

      const encodingFormat =
        String(
          value.encodingFormat ||
          value.encodingformat ||
          ""
        ).trim();

      const contentUrl =
        value.contentUrl ||
        value.contentURL ||
        value.url;

      const embedUrl =
        value.embedUrl ||
        value.embedURL;

      if (contentUrl) {
        addKnownOrDirect(
          String(contentUrl),
          {
            type: encodingFormat,
            score,
            source:
              "jsonld-content",
            trustedVideoContext:
              true
          }
        );
      }

      if (embedUrl) {
        addEmbed(
          String(embedUrl),
          score,
          "jsonld-embed"
        );
      }
    }

    for (
      const child of
      Object.values(value)
    ) {
      walkJson(child);
    }
  }

  for (const block of ldScripts) {
    const raw =
      block
        .replace(
          /^<script\b[^>]*>/i,
          ""
        )
        .replace(
          /<\/script>$/i,
          ""
        )
        .trim();

    try {
      walkJson(
        JSON.parse(raw)
      );
    } catch {}
  }

  if (articleHtml) {
    /*
      JS player config alanları.
    */
    for (const pattern of [
      /["'](?:contentUrl|contentURL|videoUrl|videoURL|video_url|videoFile|video_file|playbackUrl|playbackURL|streamUrl|streamURL|hlsUrl|hlsURL|file)["']\s*:\s*["']([^"']+)["']/gi,
      /\b(?:data-video-url|data-video-src|data-stream-url|data-hls-url|data-playback-url)=["']([^"']+)["']/gi
    ]) {
      let match;

      while (
        (match =
          pattern.exec(articleHtml))
      ) {
        addKnownOrDirect(
          match[1],
          {
            score: 620,
            source:
              "article-config"
          }
        );
      }
    }

    /*
      Known provider URL inline JS içinde olabilir.
    */
    for (
      const raw of
      articleHtml.match(
        /https?:\\?\/\\?\/[^"'\\\s<>()]+/gi
      ) || []
    ) {
      addEmbed(
        raw.replace(
          /\\\//g,
          "/"
        ),
        590,
        "article-inline-provider"
      );
    }

    for (
      const value of
      articleHtml.match(
        /https?:\\\/\\\/[^"'\\\s<]+?\.(?:mp4|m4v|webm|m3u8)(?:\\?[^"'\\\s<]*)?/gi
      ) || []
    ) {
      addDirect(
        value.replace(
          /\\\//g,
          "/"
        ),
        "",
        560,
        "article-escaped-url"
      );
    }
  }

  /*
    Güvenilir article scope bulunamadıysa veya scope video üretmediyse:
    h1 çevresindeki sınırlı pencereye bak. Yalnız TEK benzersiz aday varsa
    kabul et; iki veya daha fazla aday varsa yanlış video riski nedeniyle
    fallback yapma.
  */
  if (!direct.length && !embeds.length) {
    const h1Index =
      html.search(/<h1\b/i);

    if (h1Index >= 0) {
      const nearTitleHtml =
        html.slice(
          Math.max(
            0,
            h1Index - 50_000
          ),
          Math.min(
            html.length,
            h1Index + 250_000
          )
        );

      const fallback = [];

      function addFallback(candidate) {
        if (!candidate?.url) return;

        if (
          fallback.some(
            x => x.url === candidate.url
          )
        ) {
          return;
        }

        fallback.push(candidate);
      }

      for (
        const tag of
        nearTitleHtml.match(
          /<video\b[^>]*>/gi
        ) || []
      ) {
        const type =
          htmlAttr(tag, "type");

        for (const attr of [
          "src",
          "data-src",
          "data-video-src",
          "data-hls-src",
          "data-mp4-src",
          "data-stream-url",
          "data-playback-url"
        ]) {
          const value =
            htmlAttr(tag, attr);

          if (!value) continue;

          const url =
            absoluteUrl(
              value,
              baseUrl
            );

          if (
            !url ||
            isObviouslyNonVideoUrl(url)
          ) {
            continue;
          }

          addFallback({
            kind: "video",
            url,
            type:
              type ||
              "video/*",
            provider: "native",
            source:
              "near-title-video",
            score: 470
          });
        }
      }

      for (
        const tag of
        nearTitleHtml.match(
          /<iframe\b[^>]*>/gi
        ) || []
      ) {
        for (const attr of [
          "src",
          "data-src",
          "data-lazy-src",
          "data-embed-url",
          "data-video-url"
        ]) {
          const value =
            htmlAttr(tag, attr);

          if (!value) continue;

          const known =
            normalizeKnownEmbed(
              value,
              baseUrl
            );

          if (known) {
            addFallback({
              ...known,
              source:
                "near-title-iframe",
              score: 460
            });
          } else {
            /*
              primary article scope bulunamadığında, başlığın yakınındaki
              güçlü publisher-player iframe'ini düşük puanlı tekil fallback
              olarak değerlendirebilmek için ana embed listesine ekle.
            */
            addPublisherPlayerEmbed(
              value,
              tag,
              455,
              "near-title-publisher-iframe"
            );
          }
        }
      }

      /*
        Dailymotion split player fallback da near-title penceresinde desteklenir.
      */
      if (
        dailymotionPlayerIds.length === 1
      ) {
        const playerId =
          dailymotionPlayerIds[0];

        for (
          const tag of
          nearTitleHtml.match(
            /<[^>]+\bdata-video(?:-id)?=["'][A-Za-z0-9]{5,24}["'][^>]*>/gi
          ) || []
        ) {
          const videoId =
            htmlAttr(
              tag,
              "data-video"
            ) ||
            htmlAttr(
              tag,
              "data-video-id"
            );

          if (
            !/^[A-Za-z0-9]{5,24}$/.test(
              videoId
            )
          ) {
continue;
          }

          const dm =
            new URL(
              `https://geo.dailymotion.com/player/${playerId}.html`
            );

          dm.searchParams.set(
            "video",
            videoId
          );

          const known =
            normalizeKnownEmbed(
              dm.href
            );

          if (known) {
            addFallback({
              ...known,
              source:
                "near-title-dailymotion",
              score: 465
            });
          }
        }
      }

      for (
        const raw of
        nearTitleHtml.match(
          /https?:\\\/\\\/[^"'\\\s<]+?\.(?:mp4|m4v|webm|m3u8)(?:\\?[^"'\\\s<]*)?/gi
        ) || []
      ) {
        const url =
          absoluteUrl(
            raw.replace(
              /\\\//g,
              "/"
            ),
            baseUrl
          );

        if (!url) continue;

        addFallback({
          kind: "video",
          url,
          type: "",
          provider: "native",
          source:
            "near-title-direct",
          score: 450
        });
      }

      if (fallback.length === 1) {
        const only =
          fallback[0];

        if (only.kind === "video") {
          pushBest(
            direct,
            only
          );
        } else {
          pushBest(
            embeds,
            only
          );
        }
      }
    }
  }

  const candidates = [
    ...direct.map(
      item => ({
        ...item,
        finalScore:
          item.score + 90
      })
    ),
    ...embeds.map(
      item => ({
        ...item,
        finalScore:
          item.score
      })
    )
  ].sort(
    (a, b) =>
      b.finalScore -
      a.finalScore
  );

  const best =
    candidates[0];

  if (!best) return null;

  return {
    kind: best.kind,
    url: best.url,
    type:
      best.type || "",
    provider:
      best.provider ||
      (
        best.kind === "video"
          ? "native"
          : ""
      ),
    source:
      best.source || "",
    confidence:
      best.finalScore
  };
}

function isSafeArticleUrl(value = "") {
  try {
    const u = new URL(value);
    if (u.protocol !== "https:" && u.protocol !== "http:") {
      return false;
    }

    const host = u.hostname.toLowerCase();

    if (
      !host ||
      host === "localhost" ||
      host.endsWith(".localhost") ||
      host.endsWith(".local") ||
      host.endsWith(".internal") ||
      host.includes(":")
    ) return false;

    const ipv4 = host.match(
      /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/
    );

    if (ipv4) {
      const parts = ipv4.slice(1).map(Number);
      if (parts.some(x => x < 0 || x > 255)) return false;

      const [a, b] = parts;

      if (
        a === 0 ||
        a === 10 ||
        a === 127 ||
        (a === 169 && b === 254) ||
        (a === 172 && b >= 16 && b <= 31) ||
        (a === 192 && b === 168) ||
        (a === 100 && b >= 64 && b <= 127)
      ) return false;
    }

    return true;
  } catch {
    return false;
  }
}



/* -------------------------------------------------------------------------
   v31.82 — shared media verification / nested-player resolution

   The source catalog is large, but video delivery falls into a handful of
   families. Rather than adding a publisher hack for every source, every
   resolver result now passes through the same final gate:

   - native candidates that actually return HTML are NOT sent to <video>;
   - same-site/player HTML is inspected one level deeper for MP4/HLS/embed;
   - explicit MP4/HLS URLs hidden in JS/config are available as a safe
     fallback when metadata points at a wrapper document;
   - known YouTube/Vimeo/Dailymotion embeds remain untouched.
   ------------------------------------------------------------------------- */

function mediaContentTypeKind(value = "") {
  const type = String(value || "").toLowerCase();
  if (/mpegurl|application\/vnd\.apple\.mpegurl|application\/x-mpegurl/.test(type)) return "hls";
  if (/^video\//.test(type)) return "video";
  if (/text\/html|application\/xhtml\+xml/.test(type)) return "html";
  return "";
}

function isExplicitNativeMediaUrl(value = "") {
  return /\.(?:mp4|m4v|webm|ogv|mov|m3u8)(?:[?#]|$)/i.test(String(value || ""));
}

function sameDocumentUrl(a = "", b = "") {
  try {
    const left = new URL(a);
    const right = new URL(b);
    const path = value => (String(value || "").replace(/\/+$/, "") || "/");
    return left.origin === right.origin && path(left.pathname) === path(right.pathname);
  } catch {
    return false;
  }
}

async function readResponseTextLimited(response, maxBytes = 450_000) {
  const reader = response.body?.getReader?.();
  if (!reader) {
    const text = await response.text();
    return text.slice(0, maxBytes);
  }

  const decoder = new TextDecoder();
  const chunks = [];
  let bytes = 0;

  try {
    while (bytes < maxBytes) {
      const { value, done } = await reader.read();
      if (done) break;
      if (!value) continue;

      const remaining = Math.max(0, maxBytes - bytes);
      if (remaining <= 0) break;

      const chunk = value.byteLength > remaining
        ? value.subarray(0, remaining)
        : value;

      bytes += chunk.byteLength;
      chunks.push(
        decoder.decode(chunk, { stream: true })
      );

      if (value.byteLength > remaining || bytes >= maxBytes) break;
    }

    const tail = decoder.decode();
    if (tail) chunks.push(tail);
  } catch {}

  try { await reader.cancel(); } catch {}
  return chunks.join("").slice(0, maxBytes);
}

/*
  v31.98 — CPU guard for /video.

  "Sadece videolu haberler" çok sayıda /video isteği üretebildiği için,
  açıkça hiçbir video/player izi taşımayan makaleleri pahalı resolver
  zincirine sokmuyoruz. Bu yalnız bir erken-negatif filtredir: gerçek video
  sinyali taşıyan sayfalarda mevcut resolver mantığı aynen çalışmaya devam
  eder. Feed'den gelen doğrudan video hint'i her zaman bu filtreden geçer.
*/
const VIDEO_RESOLVER_SIGNAL_RE = /(?:<video\b|<amp-(?:video|youtube|vimeo)\b|og:video|twitter:player|videoobject|data-(?:video|video-id|video-src|embed-url|hls|hls-src|mp4|mp4-src|stream-url|playback-url)\s*=|(?:youtube(?:-nocookie)?\.com|youtu\.be|vimeo\.com|dailymotion\.com|dai\.ly)\/|\/video-embed\/\d+|\.(?:mp4|m4v|webm|ogv|mov|m3u8)(?:[?&#"'\s<]|$)|(?:videoUrl|videoURL|video_url|playbackUrl|playbackURL|streamUrl|streamURL|hlsUrl|hlsURL|mp4Url|mp4URL)\s*[:=]\s*["']?(?:https?:)?\/\/|(?:twitter\.com|x\.com)\/[A-Za-z0-9_]{1,30}\/status(?:es)?\/\d{10,25})/i;

const X_STATUS_SIGNAL_RE = /(?:(?:twitter\.com|x\.com)\/[A-Za-z0-9_]{1,30}\/status(?:es)?\/\d{10,25}|data-(?:tweet|status)-id\s*=\s*["']\d{10,25}["'])/i;

function articleHasXStatusSignal(html = "") {
  const source = String(html || "");
  if (X_STATUS_SIGNAL_RE.test(source)) return true;

  /* JSON/script payloads commonly escape only the slashes in X URLs. */
  return (
    /(?:twitter\.com|x\.com)/i.test(source) &&
    /status(?:es)?(?:(?:\\u002f)|(?:\\\/)|\/)\d{10,25}/i.test(source)
  );
}

function articleHasVideoResolverSignal(
  html = "",
  hintedMedia = null
) {
  if (hintedMedia?.url) return true;
  return VIDEO_RESOLVER_SIGNAL_RE.test(String(html || ""));
}

function extractExplicitMediaCandidatesAnywhere(
  html = "",
  baseUrl = "",
  expectedTitle = ""
) {
  const decoded = decodeEntities(String(html || ""))
    .replace(/\\u002f/gi, "/")
    .replace(/\\u003a/gi, ":")
    .replace(/\\u0026/gi, "&")
    .replace(/\\\//g, "/")
    .replace(/&amp;/gi, "&");

  const byUrl = new Map();

  function add(raw, index = 0, label = "explicit-media") {
    const url = absoluteUrl(raw, baseUrl);
    if (!url || !isSafeArticleUrl(url) || !isExplicitNativeMediaUrl(url)) return;

    const context = decoded.slice(
      Math.max(0, index - 3500),
      Math.min(decoded.length, index + String(raw || "").length + 3500)
    );

    let score = 680;
    if (/\.m3u8(?:[?#]|$)/i.test(url)) score += 35;
    if (/video|player|playback|stream|hls|source|contenturl|videoobject|manifest/i.test(context)) score += 95;
    if (/(?:related|recommended|önerilen|onerilen|çok okunan|cok okunan|sidebar|footer|advert|reklam|banner)/i.test(context)) score -= 240;

    let relation = { common: 0, score: 0, left: 0, right: 0 };
    if (expectedTitle) {
      relation = videoTitleMatch(expectedTitle, cleanText(context));
      score += Math.round(relation.score * 180 + relation.common * 18);
    }

    const candidate = {
      kind: "video",
      provider: "native",
      url,
      type: /\.m3u8(?:[?#]|$)/i.test(url)
        ? "application/vnd.apple.mpegurl"
        : "",
      source: label,
      confidence: score,
      relation
    };

    const previous = byUrl.get(url);
    if (!previous || score > previous.confidence) byUrl.set(url, candidate);
  }

  const absolutePattern = /https?:\/\/[^"'\\\s<>]+?\.(?:mp4|m4v|webm|ogv|mov|m3u8)(?:\?[^"'\\\s<>]*)?/gi;
  let match;
  while ((match = absolutePattern.exec(decoded))) {
    add(match[0], match.index, "explicit-absolute");
  }

  const quotedPattern = /["']([^"']+?\.(?:mp4|m4v|webm|ogv|mov|m3u8)(?:\?[^"']*)?)["']/gi;
  while ((match = quotedPattern.exec(decoded))) {
    add(match[1], match.index, "explicit-quoted");
  }

  return [...byUrl.values()]
    .sort((a, b) => b.confidence - a.confidence)
    .slice(0, 8);
}

async function probeNativeMediaUrl(
  mediaUrl,
  articleUrl,
  signal
) {
  try {
    const headers = {
      "User-Agent": "Mozilla/5.0 (compatible; TheFloewVideoResolver/1.0)",
      "Accept": "application/vnd.apple.mpegurl,application/x-mpegURL,video/*;q=0.9,text/html;q=0.4,*/*;q=0.2",
      "Range": "bytes=0-4095"
    };
    if (articleUrl) headers.Referer = articleUrl;

    const response = await fetch(mediaUrl, {
      signal,
      redirect: "follow",
      headers
    });

    const contentType = response.headers.get("Content-Type") || "";
    const kind = mediaContentTypeKind(contentType);

    if (!response.ok && response.status !== 206) {
      try { await response.body?.cancel?.(); } catch {}
      return {
        conclusive: false,
        ok: false,
        status: response.status,
        contentType,
        finalUrl: response.url || mediaUrl
      };
    }

    if (kind === "html") {
      const html = await readResponseTextLimited(response, 500_000);
      return {
        conclusive: true,
        ok: false,
        html: true,
        htmlText: html,
        status: response.status,
        contentType,
        finalUrl: response.url || mediaUrl
      };
    }

    const finalUrl = response.url || mediaUrl;
    const isHls =
      kind === "hls" ||
      /\.m3u8(?:[?#]|$)/i.test(finalUrl);

    if (isHls) {
      const manifest = await readResponseTextLimited(response, 180_000);
      if (/^\s*#EXTM3U/im.test(manifest)) {
        return {
          conclusive: true,
          ok: true,
          status: response.status,
          contentType: contentType || "application/vnd.apple.mpegurl",
          finalUrl,
          hls: true
        };
      }
      return {
        conclusive: true,
        ok: false,
        status: response.status,
        contentType,
        finalUrl
      };
    }

    try { await response.body?.cancel?.(); } catch {}

    if (
      kind === "video" ||
      (isExplicitNativeMediaUrl(finalUrl) && !/text\//i.test(contentType))
    ) {
      return {
        conclusive: true,
        ok: true,
        status: response.status,
        contentType,
        finalUrl
      };
    }

    return {
      conclusive: true,
      ok: false,
      status: response.status,
      contentType,
      finalUrl
    };
  } catch (error) {
    return {
      conclusive: false,
      ok: false,
      status: 0,
      contentType: "",
      finalUrl: mediaUrl,
      error: String(error?.message || error || "").slice(0, 250)
    };
  }
}

async function resolveNestedPlayerDocument(
  playerUrl,
  articleUrl,
  expectedTitle,
  signal,
  depth = 0
) {
  if (depth > 1 || !isSafeArticleUrl(playerUrl)) return null;

  let response;
  try {
    response = await fetch(playerUrl, {
      signal,
      redirect: "follow",
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; TheFloewVideoResolver/1.0)",
        "Accept": "text/html,application/xhtml+xml,application/vnd.apple.mpegurl,video/*;q=0.8,*/*;q=0.4",
        ...(articleUrl ? { "Referer": articleUrl } : {})
      }
    });
  } catch {
    return null;
  }

  if (!response.ok) {
    try { await response.body?.cancel?.(); } catch {}
    return null;
  }

  const contentType = response.headers.get("Content-Type") || "";
  const responseKind = mediaContentTypeKind(contentType);
  const finalUrl = response.url || playerUrl;

  if (responseKind === "video") {
    try { await response.body?.cancel?.(); } catch {}
    return {
      kind: "video",
      provider: "native",
      url: finalUrl,
      type: contentType,
      source: "nested-player-native",
      confidence: 1250
    };
  }

  if (responseKind === "hls" || /\.m3u8(?:[?#]|$)/i.test(finalUrl)) {
    const manifest = await readResponseTextLimited(response, 180_000);
    if (/^\s*#EXTM3U/im.test(manifest)) {
      return {
        kind: "video",
        provider: "native",
        url: finalUrl,
        type: contentType || "application/vnd.apple.mpegurl",
        source: "nested-player-hls",
        confidence: 1250
      };
    }
    return null;
  }

  if (responseKind !== "html" && !/text\/html|xhtml/i.test(contentType)) {
    try { await response.body?.cancel?.(); } catch {}
    return null;
  }

  const html = await readResponseTextLimited(response, 800_000);

  /* Prefer concrete MP4/HLS inside wrapper pages. */
  const explicit = extractExplicitMediaCandidatesAnywhere(
    html,
    finalUrl,
    expectedTitle
  );

  for (const candidate of explicit.slice(0, 4)) {
    const checked = await validateResolvedMediaCandidate(
      candidate,
      articleUrl || finalUrl,
      expectedTitle,
      signal,
      depth + 1
    );
    if (checked) {
      return {
        ...checked,
        source: checked.source || "nested-player-explicit"
      };
    }
  }

  const nested = extractVideoFromHtml(
    html,
    finalUrl,
    expectedTitle,
    null
  );

  if (
    nested?.url &&
    !sameDocumentUrl(nested.url, finalUrl)
  ) {
    return validateResolvedMediaCandidate(
      nested,
      articleUrl || finalUrl,
      expectedTitle,
      signal,
      depth + 1
    );
  }

  return null;
}

async function validateResolvedMediaCandidate(
  media,
  articleUrl,
  expectedTitle,
  signal,
  depth = 0
) {
  if (!media?.url || depth > 2) return null;

  const known = normalizeKnownEmbed(media.url, articleUrl);

  if (
    media.forceIframe === true &&
    media.kind === "embed" &&
    isSafeArticleUrl(media.url)
  ) {
    return {
      ...media,
      kind: "embed",
      provider: "generic",
      url: known?.url || media.url,
      type: "",
      source: media.source || "validated-force-iframe"
    };
  }

  if (known && ["youtube", "vimeo", "dailymotion"].includes(known.provider)) {
    return {
      ...media,
      ...known,
      source: media.source || `validated-${known.provider}`
    };
  }

  if (media.kind === "embed" || known?.kind === "embed") {
    const embed = known || media;

    /*
      Publisher-owned wrappers (notably Halk TV /video-embed/<id>) often send
      X-Frame-Options/CSP that prevents Flöw from framing them. Resolve the
      wrapper server-side to its actual HLS/MP4/known provider first.
    */
    const nested = await resolveNestedPlayerDocument(
      embed.url,
      articleUrl,
      expectedTitle,
      signal,
      depth
    );

    if (nested) return nested;

    /* Known third-party providers were returned above. Generic iframe stays a
       fallback, except Halk TV where the wrapper is known to be non-media. */
    if (String(embed.provider || "").toLowerCase() === "halktv") return null;
    return embed;
  }

  if (media.kind !== "video") return null;
  if (sameDocumentUrl(media.url, articleUrl) && !isExplicitNativeMediaUrl(media.url)) return null;

  /*
    Concrete MP4/HLS URLs are already unambiguous native media. Avoid an
    extra upstream request on the hot path; this keeps /video comfortably
    inside the frontend resolver timeout. Validation fetches are reserved for
    extensionless/signed URLs where HTML-vs-media is genuinely ambiguous.
  */
  if (isExplicitNativeMediaUrl(media.url)) {
    return {
      ...media,
      type:
        media.type ||
        (/\.m3u8(?:[?#]|$)/i.test(media.url)
          ? "application/vnd.apple.mpegurl"
          : "")
    };
  }

  const probe = await probeNativeMediaUrl(
    media.url,
    articleUrl,
    signal
  );

  if (probe.ok) {
    return {
      ...media,
      url: probe.finalUrl || media.url,
      type: probe.contentType || media.type || ""
    };
  }

  if (probe.html && probe.htmlText) {
    const nested = await resolveNestedPlayerDocument(
      probe.finalUrl || media.url,
      articleUrl,
      expectedTitle,
      signal,
      depth
    );
    if (nested) return nested;
    return null;
  }

  /* A 403/timeout from the Worker is not proof that a browser cannot play an
     explicit signed CDN URL. Preserve explicit native URLs on inconclusive
     probes to avoid regressing publishers whose CDN blocks server probes. */
  if (!probe.conclusive && isExplicitNativeMediaUrl(media.url)) {
    return media;
  }

  return null;
}

async function resolveHalkTvOwnedPlayer(
  html = "",
  baseUrl = "",
  expectedTitle = "",
  signal = undefined
) {
  if (!isHalkTvArticleUrl(baseUrl)) return null;

  const decoded = decodeEntities(String(html || ""))
    .replace(/\\u002f/gi, "/")
    .replace(/\\u003a/gi, ":")
    .replace(/\\\//g, "/");

  const urls = [];
  function push(value) {
    const absolute = absoluteUrl(value, baseUrl);
    if (!absolute || urls.includes(absolute)) return;
    try {
      const u = new URL(absolute);
      if (
        (u.hostname === "halktv.com.tr" || u.hostname === "www.halktv.com.tr") &&
        /^\/video-embed\/\d+(?:\/)?$/i.test(u.pathname)
      ) urls.push(u.href);
    } catch {}
  }

  for (const match of decoded.matchAll(/https?:\/\/(?:www\.)?halktv\.com\.tr\/video-embed\/\d+/gi)) push(match[0]);
  for (const match of decoded.matchAll(/["'](\/video-embed\/\d+)["']/gi)) push(match[1]);

  for (const playerUrl of urls.slice(0, 3)) {
    const nested = await resolveNestedPlayerDocument(
      playerUrl,
      baseUrl,
      expectedTitle,
      signal,
      0
    );
    if (nested) {
      return {
        ...nested,
        source: nested.source || "halktv-own-player"
      };
    }
  }

  /* Some Halk TV templates expose the HLS directly in a script while OG
     metadata still points at /video-embed/<id>. Use the strongest explicit
     media candidate only after the wrapper path has been tried. */
  const explicit = extractExplicitMediaCandidatesAnywhere(
    html,
    baseUrl,
    expectedTitle
  );

  if (explicit.length) {
    const best = explicit[0];
    const second = explicit[1];
    if (!second || best.confidence - second.confidence >= 70) {
      return validateResolvedMediaCandidate(
        best,
        baseUrl,
        expectedTitle,
        signal,
        0
      );
    }
  }

  return null;
}

async function resolveGenericVideoValidated(
  html,
  baseUrl,
  expectedTitle,
  hintedMedia,
  signal
) {
  const first = extractVideoFromHtml(
    html,
    baseUrl,
    expectedTitle,
    hintedMedia
  );

  if (first) {
    const checked = await validateResolvedMediaCandidate(
      first,
      baseUrl,
      expectedTitle,
      signal,
      0
    );
    if (checked) return checked;
  }

  /* Metadata may have won the static score with an HTML wrapper. If its
     validation failed, try concrete media URLs found anywhere in page data. */
  const explicit = extractExplicitMediaCandidatesAnywhere(
    html,
    baseUrl,
    expectedTitle
  );

  for (const candidate of explicit.slice(0, 4)) {
    if (first?.url === candidate.url) continue;
    const checked = await validateResolvedMediaCandidate(
      candidate,
      baseUrl,
      expectedTitle,
      signal,
      0
    );
    if (checked) return checked;
  }

  return null;
}


function halkTvYouTubeIdFromUrl(value = "", baseUrl = "") {
  const known =
    normalizeKnownEmbed(
      value,
      baseUrl
    );

  if (
    !known ||
    known.provider !== "youtube"
  ) {
    return null;
  }

  try {
    const u =
      new URL(known.url);

    const id =
      u.pathname.match(
        /\/embed\/([A-Za-z0-9_-]{6,20})/
      )?.[1] || "";

    if (!id) return null;

    return {
      id,
      media: known
    };
  } catch {
    return null;
  }
}

function extractHalkTvYouTubeCandidates(
  html = "",
  baseUrl = "",
  expectedTitle = ""
) {
  if (
    !isHalkTvArticleUrl(
      baseUrl
    )
  ) {
    return [];
  }

  const primary =
    primaryVideoContentScope(
      html,
      expectedTitle
    );

  const scopes = [];

  if (
    primary &&
    primary !== html
  ) {
    scopes.push({
      html: primary,
      baseScore: 1140,
      label: "article"
    });
  }

  const h1Index =
    html.search(/<h1\b/i);

  if (h1Index >= 0) {
    scopes.push({
      html:
        html.slice(
          Math.max(
            0,
            h1Index - 50_000
          ),
          Math.min(
            html.length,
            h1Index + 330_000
          )
        ),
      baseScore:
        primary !== html
          ? 1000
          : 1100,
      label:
        "near-title"
    });
  }

  if (!scopes.length) {
    return [];
  }

  const byId =
    new Map();

  function add({
    value,
    context = "",
    descriptor = "",
    score = 0,
    source = ""
  }) {
    const parsed =
      halkTvYouTubeIdFromUrl(
        value,
        baseUrl
      );

    if (!parsed) return;

    const emptyRelation = {
      common: 0,
      score: 0,
      left: 0,
      right: 0
    };

    const descriptorRelation =
      expectedTitle &&
      descriptor
        ? videoTitleMatch(
            expectedTitle,
            cleanText(descriptor)
          )
        : emptyRelation;

    const contextRelation =
      expectedTitle &&
      context
        ? videoTitleMatch(
            expectedTitle,
            cleanText(context)
          )
        : emptyRelation;

    /*
      Halk TV'nin iframe title alanı gerçek video başlığını taşıyabiliyor.
      Geniş çevre bağlamı hem ana hem related videoda makale H1'ini içerdiği
      için descriptor sinyalini ayrıca ve daha güçlü değerlendir.
    */
    const relation =
      (
        descriptorRelation.common >
          contextRelation.common ||
        descriptorRelation.score >
          contextRelation.score + 0.05
      )
        ? descriptorRelation
        : contextRelation;

    let finalScore =
      score +
      Math.round(
        relation.score * 360 +
        relation.common * 34
      );

    if (
      descriptorRelation.common >= 2 ||
      descriptorRelation.score >= 0.34
    ) {
      finalScore += 170;
    }

    const lower =
      normalize(
        cleanText(context)
      );

    if (
      /(?:ilgili haber|onerilen|önerilen|recommended|related|cok okunan|çok okunan|sidebar|footer|most read|most-read)/
        .test(lower)
    ) {
      finalScore -=
        (
          descriptorRelation.common >= 2 ||
          descriptorRelation.score >= 0.34
        )
          ? 90
          : 480;
    }

    if (
      /youtube video player/i
        .test(descriptor)
    ) {
      finalScore += 25;
    }

    const candidate = {
      id:
        parsed.id,
      media:
        parsed.media,
      score:
        finalScore,
      relation,
      source
    };

    const previous =
byId.get(
        parsed.id
      );

    if (
      !previous ||
      candidate.score >
        previous.score
    ) {
      byId.set(
        parsed.id,
        candidate
      );
    }
  }

  function scan(scopeInfo) {
    const scope =
      decodePlayerConfigText(
        scopeInfo.html
      );

    for (
      const match of
      scope.matchAll(
        /<iframe\b[^>]*>/gi
      )
    ) {
      const tag =
        match[0];

      const index =
        Number(
          match.index
        ) || 0;

      const context =
        scope.slice(
          Math.max(
            0,
            index - 1100
          ),
          Math.min(
            scope.length,
            index + 1100
          )
        );

      const descriptor =
        htmlAttr(
          tag,
          "title"
        ) ||
        htmlAttr(
          tag,
          "aria-label"
        ) ||
        "";

      for (
        const attr of
        [
          "src",
          "data-src",
          "data-lazy-src",
          "data-embed-url",
          "data-video-url",
          "data-original"
        ]
      ) {
        const value =
          htmlAttr(
            tag,
            attr
          );

        if (!value) continue;

        add({
          value,
          context,
          descriptor,
          score:
            scopeInfo.baseScore,
          source:
            `halktv-${scopeInfo.label}-iframe`
        });
      }
    }

    for (
      const match of
      scope.matchAll(
        /<amp-youtube\b[^>]*>/gi
      )
    ) {
      const tag =
        match[0];

      const id =
        htmlAttr(
          tag,
          "data-videoid"
        ) ||
        htmlAttr(
          tag,
          "data-video-id"
        );

      if (
        /^[A-Za-z0-9_-]{6,20}$/
          .test(id)
      ) {
        add({
          value:
            `https://www.youtube.com/watch?v=${id}`,
          context:
            tag,
          descriptor:
            "YouTube video player",
          score:
            scopeInfo.baseScore - 5,
          source:
            `halktv-${scopeInfo.label}-amp-youtube`
        });
      }
    }

    const rawPatterns = [
      /https?:\/\/(?:www\.)?youtube(?:-nocookie)?\.com\/embed\/[A-Za-z0-9_-]{6,20}(?:\?[^"'\\\s<>]*)?/gi,
      /https?:\/\/(?:www\.)?youtube\.com\/watch\?[^"'\\\s<>]*v=[A-Za-z0-9_-]{6,20}[^"'\\\s<>]*/gi,
      /https?:\/\/youtu\.be\/[A-Za-z0-9_-]{6,20}(?:\?[^"'\\\s<>]*)?/gi
    ];

    for (
      const pattern of
      rawPatterns
    ) {
      for (
        const match of
        scope.matchAll(pattern)
      ) {
        const index =
          Number(
            match.index
          ) || 0;

        const context =
          scope.slice(
            Math.max(
              0,
              index - 1100
            ),
            Math.min(
              scope.length,
              index + 1100
            )
          );

        add({
          value:
            match[0],
          context,
          descriptor:
            "YouTube video player",
          score:
            scopeInfo.baseScore - 30,
          source:
            `halktv-${scopeInfo.label}-raw-youtube`
        });
      }
    }
  }

  for (
    const scope of
    scopes
  ) {
    scan(scope);
  }

  const candidates =
    [...byId.values()]
      .sort(
        (a, b) =>
          b.score - a.score
      );

  if (!candidates.length) {
    return [];
  }

  const best =
    candidates[0];

  const second =
    candidates[1];

  /*
    Halk TV'de H1 çevresinde related/önerilen YouTube iframe'leri de
    bulunabiliyor. Gerçek article scope içinden gelmeyen tek bir adayı,
    başlıkla anlamlı ilişki kurmadan kabul etme. Böylece sırf sayfada tek
    YouTube iframe'i var diye başka haberin videosu akışa sızmaz.
  */
  const bestFromArticleScope =
    /^halktv-article-/.test(
      String(best.source || "")
    );

  const bestHasStrongRelation =
    (
      best.relation.common >= 2 &&
      best.relation.score >= 0.28
    ) ||
    best.relation.common >= 3 ||
    best.relation.score >= 0.42;

  if (
    !bestFromArticleScope &&
    !bestHasStrongRelation
  ) {
    return [];
  }

  if (second) {
    const strongSemantic =
      (
        best.relation.common >= 2 &&
        best.relation.score >= 0.28
      ) ||
      best.relation.common >= 3;

    const gap =
      best.score -
      second.score;

    if (
      !strongSemantic &&
      gap < 180
    ) {
      return [];
    }

    if (
      gap < 90 &&
      best.relation.score -
        second.relation.score < 0.12
    ) {
      return [];
    }
  }

  if (best.score < 780) {
    return [];
  }

  return candidates;
}

function resolveHalkTvYouTubeVideo(
  html = "",
  baseUrl = "",
  expectedTitle = ""
) {
  const candidates =
    extractHalkTvYouTubeCandidates(
      html,
      baseUrl,
      expectedTitle
    );

  if (!candidates.length) {
    return null;
  }

  const best =
    candidates[0];

  return {
    ...best.media,
    source:
      "halktv-youtube",
    confidence:
      best.score
  };
}

function isHalkTvArticleUrl(value = "") {
  try {
    const host =
      new URL(value)
        .hostname
        .toLowerCase();

    return (
      host === "halktv.com.tr" ||
      host === "www.halktv.com.tr"
    );
  } catch {
    return false;
  }
}

function isStarArticleUrl(value = "") {
  try {
    const host =
      new URL(value)
        .hostname
        .toLowerCase();

    return (
      host === "star.com.tr" ||
      host === "www.star.com.tr"
    );
  } catch {
    return false;
  }
}

/*
  Star haber sayfalarında gerçek makale videosundan sonra ortak bir
  “ÖNERİLEN VİDEO” modülü bulunabiliyor. Bu modül site genelinde aynı
  player/video ile render edildiği için tüm makaleyi taramak aynı videonun
  farklı haberlere sızmasına yol açıyordu.

  Burada yalnız Star'ın seçilmiş article/main scope'unu önerilen/ilişkili
  video modülü başlamadan önce kesiyoruz. Böylece makale gövdesindeki gerçek
  iframe/player korunurken ortak öneri player'ı aday havuzuna hiç girmiyor.
*/
function starPrimaryArticleVideoScope(html = "") {
  const source = String(html || "");
  if (!source) return source;

  const markers = [
    /<(?:section|div|aside)\b[^>]*(?:id|class)=["'][^"']*(?:onerilen[-_ ]?video|önerilen[-_ ]?video|recommended[-_ ]?video|suggested[-_ ]?video|related[-_ ]?video|video[-_ ]?(?:recommend|recommended|suggested|related))[^"']*["'][^>]*>/i,
    /(?:ÖNERİLEN|ONERILEN)(?:\s|&nbsp;|<[^>]+>){0,12}V(?:İ|I)DEO/i,
    /(?:RELATED|RECOMMENDED|SUGGESTED)(?:\s|&nbsp;|<[^>]+>){0,12}VIDEO/i
  ];

  let cut = -1;
  for (const pattern of markers) {
    const match = pattern.exec(source);
    if (!match) continue;

    /*
      Sayfanın üst navigasyonunda benzer bir metin geçerse makaleyi yanlış
      kesmemek için yalnız scope'un anlamlı bir bölümü geçildikten sonraki
      marker'ı kullan.
    */
    if (match.index < 500) continue;
    if (cut < 0 || match.index < cut) cut = match.index;
  }

  return cut > 0 ? source.slice(0, cut) : source;
}

function articleNumericIdentity(value = "") {
  try {
    const u = new URL(value);
    const path = decodeURIComponent(u.pathname || "");

    /*
      Star gibi yayıncılarda makale kimliği URL'nin sonunda haber-2035636
      biçiminde bulunur. Yalnız uzun sayısal kimlikleri kabul ederek tarih,
      kategori vb. küçük sayıları player korelasyonu sanmıyoruz.
    */
    const matches = [...path.matchAll(/(?:^|[^0-9])(\d{6,14})(?=[^0-9]|$)/g)];
    if (!matches.length) return "";
    return String(matches[matches.length - 1][1] || "");
  } catch {
    return "";
  }
}

function collectHalkTvXStatusCandidates(
  html = "",
  expectedTitle = ""
) {
  const candidates = new Map();

  function add(
    id,
    score,
    context = "",
    source = "",
    order = 0
  ) {
    const cleanId =
      String(id || "")
        .trim();

    if (!/^\d{10,25}$/.test(cleanId)) {
      return;
    }

    let finalScore = score;

    if (
      /twitter-tweet|twitter-widget|x-post|pic\.twitter\.com|blockquote/i
        .test(context)
    ) {
      finalScore += 45;
    }

    const videoIntent =
      /(?:video|görüntü|goruntu|görüntüler|goruntuler|izle|o anlar|işte o anlar|iste o anlar|kameralara|kameraya|sosyal medyada gündem|pic\.twitter\.com)/i
        .test(context);

    if (videoIntent) {
      finalScore += 90;
    }

    /*
      Onedio gibi bir makalede birden çok X postu art arda bulunabiliyor.
      Ana olay videosu genellikle article-scope içindeki ilk embed; sonraki
      postlar reaksiyon/yorum. İlk adaya belirgin ama sınırlı bir konum
      avantajı vererek top-two tie yüzünden tüm videoların iptalini önle.
    */
    if (source.startsWith("article-x")) {
      finalScore += Math.max(-160, 250 - Math.max(0, order) * 125);
    } else if (source.startsWith("near-title-x")) {
      finalScore += Math.max(-140, 190 - Math.max(0, order) * 115);
    } else {
      finalScore -= Math.min(120, Math.max(0, order) * 25);
    }

    if (
      /(?:related|recommended|önerilen|onerilen|çok okunan|cok okunan|sidebar|footer|most-read|mostread)/i
        .test(context)
    ) {
      finalScore -= 280;
    }

    const contextRelation =
      expectedTitle && context
        ? videoTitleMatch(
            expectedTitle,
            cleanText(context)
          )
        : {
            common: 0,
            score: 0,
            left: 0,
            right: 0
          };

    finalScore +=
      Math.round(
        contextRelation.score * 100 +
        contextRelation.common * 10
      );

    const previous =
      candidates.get(cleanId);

    if (
      !previous ||
      finalScore >
        previous.score
    ) {
      candidates.set(
        cleanId,
        {
          id: cleanId,
          score: finalScore,
          source,
          order: Math.max(0, Number(order) || 0),
          videoIntent,
          contextRelation,
          context:
            String(context || "")
              .slice(0, 8000)
        }
      );
    }
  }

  function scanScope(
    scope,
    baseScore,
    label
  ) {
    if (!scope) return;

    const normalized =
      decodeEntities(
        String(scope || "")
      )
        .replace(/\\u002f/gi, "/")
        .replace(/\\u003a/gi, ":")
        .replace(/\\u0026/gi, "&")
        .replace(/\\+\//g, "/");

    const statusPattern =
      /(?:https?:)?\/\/(?:www\.)?(?:twitter\.com|x\.com)\/[A-Za-z0-9_]{1,30}\/status(?:es)?\/(\d{10,25})/gi;

    let match;
    let statusOrder = 0;

    while (
      (
        match =
          statusPattern.exec(normalized)
      )
    ) {
      const context =
        normalized.slice(
          Math.max(
            0,
            match.index - 3500
          ),
          Math.min(
            normalized.length,
            match.index +
            match[0].length +
            3500
          )
        );

      add(
        match[1],
        baseScore,
        context,
        `${label}-status-url`,
        statusOrder++
      );
    }

    for (
      const tag of
      normalized.match(/<[^>]+>/gi) ||
      []
    ) {
      if (
        !/twitter|tweet|x-post|x_embed|x-embed/i
          .test(tag)
      ) {
        continue;
      }

      const id =
        htmlAttr(
          tag,
          "data-tweet-id"
        ) ||
        htmlAttr(
          tag,
          "data-status-id"
        ) ||
        htmlAttr(
          tag,
          "data-id"
        );

      if (
        /^\d{10,25}$/.test(
          id
        )
      ) {
        add(
          id,
          baseScore - 10,
          tag,
          `${label}-data-id`,
          statusOrder++
        );
      }
    }
  }

  const articleScope =
    primaryVideoContentScope(
      html,
      expectedTitle
    );

  if (
    articleScope &&
    articleScope !== html
  ) {
    scanScope(
      articleScope,
      1120,
      "article-x"
    );
  }

  const h1Index =
    html.search(/<h1\b/i);

  if (h1Index >= 0) {
    const nearTitle =
      html.slice(
        Math.max(
          0,
          h1Index - 60_000
        ),
        Math.min(
          html.length,
          h1Index + 320_000
        )
      );

    scanScope(
      nearTitle,
      articleScope !== html
        ? 930
        : 1060,
      "near-title-x"
    );
  }

  return [...candidates.values()]
    .sort(
      (a, b) =>
        b.score - a.score
    )
    .slice(0, 6);
}

function bestXMp4FromTweetResult(
  data
) {
  const containers = [];

  function addContainer(value, fallbackText = "") {
    if (!value || typeof value !== "object") return;
    containers.push({
      value,
      text: String(value.text || fallbackText || "")
    });
  }

  addContainer(data, data?.text || "");
  addContainer(data?.quoted_tweet, data?.text || "");
  addContainer(data?.parent, data?.text || "");

  const results = [];

  function addVariant(variant, text = "") {
    const url = String(
      variant?.url ||
      variant?.src ||
      ""
    );
    const type = String(
      variant?.content_type ||
      variant?.type ||
      ""
    ).toLowerCase();

    if (!url || !isSafeArticleUrl(url)) return;

    let host = "";
    try {
      host = new URL(url).hostname.toLowerCase();
    } catch {
      return;
    }

    if (
      host !== "video.twimg.com" &&
      !host.endsWith(".video.twimg.com")
    ) {
      return;
    }

    const isMp4 =
      type === "video/mp4" ||
      /\.mp4(?:[?#]|$)/i.test(url);
    const isHls =
      /mpegurl/i.test(type) ||
      /\.m3u8(?:[?#]|$)/i.test(url);

    if (!isMp4 && !isHls) return;

    results.push({
      url,
      type:
        isMp4
          ? "video/mp4"
          : "application/vnd.apple.mpegurl",
      bitrate: Number(variant?.bitrate || 0),
      text: String(text || ""),
      rank: isMp4 ? 2 : 1
    });
  }

  for (const container of containers) {
    const value = container.value;

    /* Güncel syndication şeması: video.variants[] => {type, src}. */
    if (Array.isArray(value?.video?.variants)) {
      for (const variant of value.video.variants) {
        addVariant(variant, container.text);
      }
    }

    /* Eski/halen kullanılan şema: mediaDetails[].video_info.variants[]. */
    if (Array.isArray(value?.mediaDetails)) {
      for (const item of value.mediaDetails) {
        const variants = item?.video_info?.variants;
        if (!Array.isArray(variants)) continue;
        for (const variant of variants) {
          addVariant(variant, container.text);
        }
      }
    }
  }

  /*
    X syndication şeması sık değişiyor. Bilinen iki şekle ek olarak JSON'u
    sınırlı derinlikte gezip variants dizilerini bul; yalnız video.twimg.com
    MP4/HLS URL'leri kabul edildiği için bu genişletme yanlış domain riskini
    artırmaz.
  */
  const seen = new Set();

  function walk(value, text = "", depth = 0) {
    if (
      value == null ||
      depth > 6 ||
      typeof value !== "object" ||
      seen.has(value)
    ) {
      return;
    }

    seen.add(value);

    const localText = String(
      value?.text ||
      value?.full_text ||
      value?.description ||
      text ||
      ""
    );

    if (Array.isArray(value)) {
      for (const item of value.slice(0, 30)) {
        walk(item, localText, depth + 1);
      }
      return;
    }

    for (const [key, child] of Object.entries(value)) {
      if (key === "variants" && Array.isArray(child)) {
        for (const variant of child.slice(0, 20)) {
          addVariant(variant, localText);
        }
        continue;
      }

      if (child && typeof child === "object") {
        walk(child, localText, depth + 1);
      }
    }
  }

  walk(data, String(data?.text || ""), 0);

  results.sort((a, b) =>
    (b.rank - a.rank) ||
    (b.bitrate - a.bitrate)
  );

  return results[0] || null;
}
function xSyndicationToken(tweetId = "") {
  try {
    const id =
      BigInt(
        String(tweetId || "")
      );

    const divisor =
      1_000_000_000_000_000n;

    const hi =
      Number(
        id / divisor
      );

    const lo =
      Number(
        id % divisor
      ) / 1e15;

    return (
      (
        (hi + lo) *
        Math.PI
      )
        .toString(36)
        .replace(/(0+|\.)/g, "")
    );
  } catch {
    return "0";
  }
}

/*
  X'in syndication token üretimi resmi olarak belgelenmiş değil ve güncel
  istemcilerde iki hesaplama varyantı görülüyor. Büyük tweet ID'sini Number'a
  dönüştüren varyant, BigInt hi/lo ile son birkaç base36 karakterde farklı
  token üretebiliyor. İkisini de deneyerek tek bir undocumented davranışa
  kilitlenmiyoruz.
*/
function xSyndicationNumberToken(tweetId = "") {
  try {
    const id = Number(String(tweetId || ""));
    if (!Number.isFinite(id) || id <= 0) return "";

    return (
      ((id / 1e15) * Math.PI)
        .toString(36)
        .replace(/(0+|\.)/g, "")
    );
  } catch {
    return "";
  }
}

async function fetchXTweetVideo(
  tweetId,
  signal
) {
  const tokens = [
    xSyndicationNumberToken(
      tweetId
    ),
    xSyndicationToken(
      tweetId
    ),
    "0"
  ].filter(
    (
      value,
      index,
      list
    ) =>
      value &&
      list.indexOf(value) === index
  );

  for (
    const token of
    tokens
  ) {
    const endpoint =
      new URL(
        "https://cdn.syndication.twimg.com/tweet-result"
      );

    endpoint.searchParams.set(
      "id",
      tweetId
    );

    endpoint.searchParams.set(
      "token",
      token
    );

    endpoint.searchParams.set(
      "lang",
      "tr"
    );

    try {
      const response =
        await fetch(
          endpoint.href,
          {
            signal,
            redirect:
              "follow",
            headers: {
              "Accept":
                "application/json,text/plain;q=0.9,*/*;q=0.5",
              "User-Agent":
                "Mozilla/5.0 (compatible; TheFloewVideoResolver/1.0)"
            }
          }
        );

      if (!response.ok) {
        continue;
      }

      const length =
        Number(
          response.headers.get(
            "Content-Length"
          ) || 0
        );

      if (
        length &&
        length > 1_500_000
      ) {
        continue;
      }

      const data =
        await response.json();

      const video =
        bestXMp4FromTweetResult(
          data
        );

      if (!video) {
        continue;
      }

      return {
        tweetId,
        url: video.url,
        type: video.type || "video/mp4",
        bitrate:
          video.bitrate || 0,
        text:
          String(
            video.text ||
            data?.text ||
            ""
          )
            .slice(0, 3000)
      };
    } catch {
      if (signal?.aborted) {
        return null;
      }
    }
  }

  return null;
}

async function resolveArticleXVideo(
  html = "",
  baseUrl = "",
  expectedTitle = "",
  signal = undefined,
  options = {}
) {
  /* Most articles have no X/Twitter embed. Avoid article-scope regex work. */
  if (!articleHasXStatusSignal(html)) {
    return null;
  }

  const allCandidates =
    collectHalkTvXStatusCandidates(
      html,
      expectedTitle
    );

  const strictArticleMatch =
    Boolean(options?.strictArticleMatch);

  const candidates = strictArticleMatch
    ? allCandidates.filter(candidate => {
        const relation = candidate.contextRelation || {};
        return (
          candidate.source?.startsWith("article-x") &&
          candidate.score >= 1000 &&
          (
            candidate.videoIntent ||
            Number(relation.common || 0) >= 2 ||
            Number(relation.score || 0) >= 0.28
          )
        );
      })
    : allCandidates;

  if (!candidates.length) {
    return null;
  }

  const resolved =
    (
      await Promise.all(
        candidates
          .slice(0, 4)
          .map(async candidate => {
            const video =
              await fetchXTweetVideo(
                candidate.id,
                signal
              );

            if (!video) {
              return null;
            }

            let score =
              candidate.score + 120;

            if (
expectedTitle &&
              video.text
            ) {
              const relation =
                videoTitleMatch(
                  expectedTitle,
                  video.text
                );

              /*
                X embed'i gerçekten başka bir haber/post ise yalnız konumsal
                yakınlık puanıyla kazanmasına izin verme. Tweet metni ve haber
                başlığı ikisi de anlamlı uzunluktaysa açık uyuşmazlığı reddet.
              */
              const semanticMismatch =
                relation.left >= 3 &&
                relation.right >= 3 &&
                relation.common < 2 &&
                relation.score < 0.20;

              const contextRelation =
                candidate.contextRelation || {
                  common: 0,
                  score: 0,
                  left: 0,
                  right: 0
                };

              const strongArticleContext =
                candidate.source?.startsWith("article-x") &&
                (
                  candidate.videoIntent ||
                  contextRelation.common >= 2 ||
                  contextRelation.score >= 0.28
                );

              if (semanticMismatch && !strongArticleContext) {
                return null;
              }

              if (semanticMismatch) {
                score -= 110;
              }

              score +=
                Math.round(
                  relation.score * 220 +
                  relation.common * 20
                );
            }

            return {
              ...video,
              score,
              candidateSource:
                candidate.source
            };
          })
      )
    )
      .filter(Boolean)
      .sort(
        (a, b) =>
          b.score - a.score
      );

  if (!resolved.length) {
    /*
      Syndication API doğrudan medya vermese bile makalenin article-scope'unda
      tek ve açık bir X status adayı varsa resmi Tweet iframe'ini son çare olarak
      kullan. Video varsa X player kendi içinde oynatır; birden fazla belirsiz
      status varsa yanlış post riskine karşı fallback yapma.
    */
    if (
      candidates.length === 1 &&
      candidates[0].score >= 1000
    ) {
      const embed = new URL("https://platform.twitter.com/embed/Tweet.html");
      embed.searchParams.set("id", candidates[0].id);
      embed.searchParams.set("dnt", "true");
      embed.searchParams.set("theme", "dark");
      embed.searchParams.set("lang", "tr");

      return {
        kind: "embed",
        url: embed.href,
        type: "",
        provider: "x",
        source: "article-x-official-embed-fallback",
        confidence: candidates[0].score
      };
    }

    return null;
  }

  if (
    resolved[1] &&
    resolved[0].score -
      resolved[1].score < 75
  ) {
    return null;
  }

  return {
    kind: "video",
    url:
      resolved[0].url,
    type:
      resolved[0].type || "video/mp4",
    provider:
      "native",
    source:
      "article-x-syndication",
    confidence:
      resolved[0].score
  };
}

function annotateResolvedMediaForVideoOnly(media = null) {
  if (!media || !media.url) return media;

  if (typeof media.videoOnlyEligible === "boolean") {
    return media;
  }

  const source = String(media.source || "").toLowerCase();

  const explicitlyWeak =
    source.includes("near-title") ||
    source.startsWith("page:") ||
    source.includes("recommended") ||
    source.includes("related") ||
    source.includes("raw-scope");

  const explicitlyArticleLinked =
    source.startsWith("article-") ||
    source.startsWith("jsonld:article") ||
    source.startsWith("cumhuriyet-") ||
    source.startsWith("halktv-") ||
    source.startsWith("ntv-") ||
    source.startsWith("star-article") ||
    source === "feed-hint-fallback" ||
    media.articleLinked === true;

  return {
    ...media,
    articleLinked:
      explicitlyWeak ? false : explicitlyArticleLinked,
    videoOnlyEligible:
      !explicitlyWeak && explicitlyArticleLinked
  };
}

async function resolveArticleVideo(
  request,
  url,
  corsHeaders,
  ctx
) {
  const articleUrl = url.searchParams.get("url") || "";
  const expectedTitle = (url.searchParams.get("title") || "").slice(0, 500);
  const hintedUrl = (url.searchParams.get("hint") || "").slice(0, 4000);
  const hintedType = (url.searchParams.get("hintType") || "").slice(0, 200);
  const strictVideoOnly = url.searchParams.get("strict") === "1";
  const hintedMedia = (
    hintedUrl &&
    isSafeArticleUrl(hintedUrl) &&
    (
      looksLikeVideoUrl(hintedUrl, hintedType) ||
      /^video\//i.test(hintedType) ||
      /mpegurl/i.test(hintedType) ||
      normalizeKnownEmbed(hintedUrl)
    )
  )
    ? { url: hintedUrl, type: hintedType }
    : null;

  if (!isSafeArticleUrl(articleUrl)) {
    return new Response(
      JSON.stringify({
        ok: false,
        error: "Invalid article URL"
      }),
      {
        status: 400,
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json; charset=utf-8",
          "Cache-Control": "no-store"
        }
      }
    );
  }

  const cache = caches.default;

  /*
    v31.78 — Resolver cache'ini gerçek resolver sürümüne bağla.
    Önceki sürümlerde cache anahtarı dışarıdan gelen /video isteğinin
    kendisiydi. Frontend aynı `rv` parametresini kullanmaya devam ettiği
    için yeni Worker deploy edilse bile eski yanlış video cevabı cache'ten
    dönebiliyordu. Internal anahtar resolver sürümüyle namespace edilir;
    böylece her resolver güncellemesi eski sonuçları otomatik olarak kırar.
  */
  const cacheUrl =
    "https://floew.internal/video-resolver?" +
    new URLSearchParams({
      rv: VIDEO_RESOLVER_VERSION,
      url: articleUrl,
      title: expectedTitle,
      hint: hintedUrl,
      hintType: hintedType
    }).toString();

  const cacheRequest = new Request(cacheUrl);
  const cached = await cache.match(cacheRequest);

  if (cached) {
    const cachedBody = await cached.text();
    let responseBody = cachedBody;

    /*
      31.100 — strict ve normal video çözümü aynı canonical cache'i paylaşır.
      strict yalnız response katmanında article-linked uygunluğunu filtreler;
      aynı makale ikinci kez ağır resolver zincirine girmez.
    */
    if (strictVideoOnly) {
      try {
        const payload = JSON.parse(cachedBody);
        if (payload?.media && payload.media.videoOnlyEligible !== true) {
          payload.media = null;
        }
        responseBody = JSON.stringify(payload);
      } catch {}
    }

    return new Response(responseBody, {
      status: 200,
      headers: {
        ...corsHeaders,
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store",
        "X-Floew-Video-Cache": "HIT",
        "X-Floew-Worker-Version": WORKER_VERSION,
        "X-Floew-Resolver-Version": VIDEO_RESOLVER_VERSION
      }
    });
  }

  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    11800
  );

  let result = null;
  let articleHtmlChecked = false;

  try {
    const response = await fetch(articleUrl, {
      signal: controller.signal,
      redirect: "follow",
      headers: {
        "User-Agent": "The-Floew-News-Wall/3.2",
        "Accept":
          "text/html,application/xhtml+xml;q=0.9,*/*;q=0.8"
      }
    });

    if (response.ok) {
      const type =
        response.headers.get("Content-Type") || "";

      const length = Number(
        response.headers.get("Content-Length") || 0
      );

      if (
        type.toLowerCase().includes("text/html")
      ) {
        /*
          Do not buffer the complete upstream document and slice afterwards.
          Some publisher pages omit Content-Length and can be many megabytes;
          reading only the resolver budget keeps CPU/memory bounded.
        */
        const limited = await readResponseTextLimited(
          response,
          MAX_ARTICLE_HTML_CHARS
        );
        articleHtmlChecked = true;

        const resolvedArticleUrl =
          response.url || articleUrl;

        const hasVideoSignal =
          articleHasVideoResolverSignal(
            limited,
            hintedMedia
          );

        if (!hasVideoSignal) {
          result = null;
        } else if (
          isCumhuriyetArticleUrl(
            resolvedArticleUrl
          )
        ) {
          result =
            await resolveCumhuriyetDailymotionVideo(
              limited,
              resolvedArticleUrl,
              expectedTitle,
              controller.signal
            );
        }

        if (
          hasVideoSignal &&
          !result &&
          isHalkTvArticleUrl(
            resolvedArticleUrl
          )
        ) {
          result =
            resolveHalkTvYouTubeVideo(
              limited,
              resolvedArticleUrl,
              expectedTitle
            );

          /*
            Halk TV'nin ikinci güvenilir özel yolu X/Twitter embed'idir.
            Generic taramadan önce çöz; aksi halde sayfadaki unrelated native
            player izi gerçek X videosunu bastırabiliyor.
          */
          if (!result) {
            result =
              await resolveArticleXVideo(
                limited,
                resolvedArticleUrl,
                expectedTitle,
                controller.signal
              );
          }

          if (!result) {
            result =
              await resolveHalkTvOwnedPlayer(
                limited,
                resolvedArticleUrl,
                expectedTitle,
                controller.signal
              );
          }
        }

        /*
          X/Twitter video embed'i yalnız Halk TV'ye özgü değil. Star ve diğer
          kaynaklar da makale gövdesinde X status videosu kullanabiliyor.
          Halk TV özel yolları sonuç vermediyse (veya kaynak Halk TV değilse)
          article-scope X resolver'ını generic HTML taramasından önce dene.
        */
        if (hasVideoSignal && !result) {
          result =
            await resolveArticleXVideo(
              limited,
              resolvedArticleUrl,
              expectedTitle,
              controller.signal,
              isStarArticleUrl(resolvedArticleUrl)
                ? { strictArticleMatch: true }
                : {}
            );
        }

        if (hasVideoSignal && !result && isStarArticleUrl(resolvedArticleUrl)) {
          result = resolveStarArticleVideo(
            limited,
            resolvedArticleUrl,
            expectedTitle
          );
        }

        if (hasVideoSignal && result) {
          result =
            await validateResolvedMediaCandidate(
              result,
              resolvedArticleUrl,
              expectedTitle,
              controller.signal,
              0
            );
        }

        if (hasVideoSignal && !result && !isStarArticleUrl(resolvedArticleUrl)) {
          result =
            await resolveGenericVideoValidated(
              limited,
              resolvedArticleUrl,
              expectedTitle,
              hintedMedia,
              controller.signal
            );
        }
      }
    }
  } catch (error) {
    console.warn(
      "Video resolve error:",
      articleUrl,
      error
    );
  } finally {
    clearTimeout(timeout);
  }

  /*
    Star ve Habertürk bazı player işaretlerini bot/özel UA isteklerinde eksik
    döndürebiliyor. İlk tur sonuç vermediyse yalnız bu iki host için bir kez
    normal browser UA ile yeniden alıp aynı resolver zincirini çalıştır.
  */
  if (!result) {
    let retryHost = "";
    try { retryHost = new URL(articleUrl).hostname.toLowerCase(); } catch {}
    const browserRetryHost = [
      "star.com.tr",
      "www.star.com.tr",
      "haberturk.com",
      "www.haberturk.com"
    ].includes(retryHost);

    if (browserRetryHost) {
      const retryController = new AbortController();
      const retryTimeout = setTimeout(() => retryController.abort(), 9000);
      try {
        const retryResponse = await fetch(articleUrl, {
          signal: retryController.signal,
          redirect: "follow",
          headers: {
            "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.0.0 Safari/537.36",
            "Accept": "text/html,application/xhtml+xml;q=0.9,*/*;q=0.8",
            "Accept-Language": "tr-TR,tr;q=0.9,en;q=0.7"
          }
        });

        if (retryResponse.ok && (retryResponse.headers.get("Content-Type") || "").toLowerCase().includes("text/html")) {
          const retryHtml = await readResponseTextLimited(
            retryResponse,
            MAX_ARTICLE_HTML_CHARS
          );
          const retryUrl = retryResponse.url || articleUrl;
          const retryHasVideoSignal =
            articleHasVideoResolverSignal(
              retryHtml,
              hintedMedia
            );

          if (retryHasVideoSignal && isCumhuriyetArticleUrl(retryUrl)) {
            result = await resolveCumhuriyetDailymotionVideo(
              retryHtml,
              retryUrl,
              expectedTitle,
              retryController.signal
            );
          }

          if (retryHasVideoSignal && !result && isHalkTvArticleUrl(retryUrl)) {
            result = resolveHalkTvYouTubeVideo(retryHtml, retryUrl, expectedTitle);
            if (!result) result = await resolveArticleXVideo(retryHtml, retryUrl, expectedTitle, retryController.signal);
            if (!result) result = await resolveHalkTvOwnedPlayer(retryHtml, retryUrl, expectedTitle, retryController.signal);
          }

          if (retryHasVideoSignal && !result) {
            result = await resolveArticleXVideo(
              retryHtml,
              retryUrl,
              expectedTitle,
              retryController.signal,
              isStarArticleUrl(retryUrl) ? { strictArticleMatch: true } : {}
            );
          }

          if (retryHasVideoSignal && !result && isStarArticleUrl(retryUrl)) {
            result = resolveStarArticleVideo(
              retryHtml,
              retryUrl,
              expectedTitle
            );
          }

          if (retryHasVideoSignal && result) {
            result = await validateResolvedMediaCandidate(
              result,
              retryUrl,
              expectedTitle,
              retryController.signal,
              0
            );
          }

          if (retryHasVideoSignal && !result && !isStarArticleUrl(retryUrl)) {
            result = await resolveGenericVideoValidated(
              retryHtml,
              retryUrl,
              expectedTitle,
              hintedMedia,
              retryController.signal
            );
          }
        }
      } catch (error) {
        console.warn("Video browser-UA retry error:", articleUrl, error);
      } finally {
        clearTimeout(retryTimeout);
      }
    }
  }

  /*
    Sayfaya ulaşılamadıysa RSS item'ın doğrudan medya enclosure'ı son çare
    olabilir. Sayfa HTML'i incelendi fakat uyuşmadıysa hint'e geri dönmeyiz.
  */
  if (
    !result &&
    !articleHtmlChecked &&
    hintedMedia &&
    !isCumhuriyetArticleUrl(articleUrl)
  ) {
    const known = normalizeKnownEmbed(hintedMedia.url);
    result = known || (
      looksLikeVideoUrl(hintedMedia.url, hintedMedia.type)
        ? {
            kind: "video",
            url: hintedMedia.url,
            type: hintedMedia.type || "",
            provider: "native",
            source: "feed-hint-fallback",
            confidence: 1180
          }
        : null
    );
  }

  result = annotateResolvedMediaForVideoOnly(result);

  /* Canonical body daima normal resolver sonucunu saklar. */
  const canonicalBody = JSON.stringify({
    ok: true,
    workerVersion: WORKER_VERSION,
    resolverVersion: VIDEO_RESOLVER_VERSION,
    media: result
  });

  let responseResult = result;
  if (
    strictVideoOnly &&
    responseResult &&
    responseResult.videoOnlyEligible !== true
  ) {
    responseResult = null;
  }

  const body = strictVideoOnly
    ? JSON.stringify({
        ok: true,
        workerVersion: WORKER_VERSION,
        resolverVersion: VIDEO_RESOLVER_VERSION,
        media: responseResult
      })
    : canonicalBody;

  const ttl =
    result?.source ===
      "cumhuriyet-dailymotion-native"
      ? 300
      : (result ? 3600 : 1800);

  /*
    Client tarafına /video cevabını cache'letme. Cache yalnız yukarıdaki
    resolver-versioned internal key üzerinden Worker içinde tutulur.
  */
  const response = new Response(body, {
    status: 200,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Floew-Video-Cache": "MISS",
      "X-Floew-Worker-Version": WORKER_VERSION,
      "X-Floew-Resolver-Version": VIDEO_RESOLVER_VERSION
    }
  });

  const cacheResponse = new Response(canonicalBody, {
    status: 200,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": `public, max-age=${ttl}`
    }
  });

  safeWaitUntil(
    ctx,
    cache.put(cacheRequest, cacheResponse),
    "video-cache-put"
  );

  return response;
}


/*
  v31.97 — Final RSS image safety net.

  A number of otherwise healthy feeds publish no directly usable RSS image,
  or HTML-escape the <img> markup inside description/content:encoded. First
  decode that embedded markup and re-run the normal high-quality image parser.

  For the small set of publishers confirmed by /debug/rss-health to still
  have missing images, fall back to the existing /image resolver. The resolver
  fetches the article page only when the image is actually requested, prefers
  OG/Twitter/JSON-LD lead images, and caches the resulting response. This keeps
  RSS ingestion fast and avoids re-introducing low-quality thumbnails.
*/
const RSS_ARTICLE_IMAGE_FALLBACK_SOURCES = new Set([
  "Independent Türkçe",
  "Independent Bilim",
  "DW Türkçe",
  "DW",
  "Euronews",
  "ShiftDelete.Net",
  "Sputnik Türkiye",
  "Bant Mag.",
  "Edebiyat Haber",
  "The New York Times",
  "CNBC",
  "CNBC-e",
  "Diken",
  "Al Jazeera",
  "Cazkolik",
  "Deli Kasap",
  "Basket Dergisi",
  "Takvim",
  "Sabah",
  "Mynet",
  "Financial Times",
  "TechCrunch",
  "Los Angeles Times"
]);

function decodeEmbeddedMarkup(value = "") {
  let decoded = String(value || "");

  // Two passes cover common double-escaped WordPress/Drupal RSS fragments.
  for (let i = 0; i < 2; i++) {
    const next = decodeEntities(decoded);
    if (next === decoded) break;
    decoded = next;
  }

  return decoded;
}

function getEscapedHtmlImageFallback(item, source = {}) {
  const decoded = decodeEmbeddedMarkup(item);
  if (!decoded || decoded === String(item || "")) return "";

  return (
    getImage(decoded, source.url || "") ||
    getRssImageFallback(decoded, source)
  );
}

function articleImageFallbackUrl(articleUrl = "") {
  if (!articleUrl || !isSafeArticleUrl(articleUrl)) return "";

  const proxy = new URL(
    "/image",
    "https://thefloew.thefloewback.workers.dev"
  );

  // target deliberately uses the article URL. preferArticle=1 makes /image
  // resolve the page's canonical image before ever treating target as an image.
  proxy.searchParams.set("url", articleUrl);
  proxy.searchParams.set("ref", articleUrl);
  proxy.searchParams.set("preferArticle", "1");
  return proxy.href;
}

function sputnikArticleImageFallbackUrl(articleUrl = "") {
  const value = articleImageFallbackUrl(articleUrl);
  if (!value) return "";

  /*
    Önceki OG-first Sputnik sonucu edge cache'te kalmış olabilir.
    Bu parametre yalnız Türkçe Sputnik için /image cache anahtarını kırar.
  */
  const proxy = new URL(value);
  proxy.searchParams.set("imageResolver", "sputnik-20260928-1");
  return proxy.href;
}

function getEffectiveFeedImage(item, source = {}, link = "") {
  const sourceName = String(source.name || "");

  /*
    v31.102 — Sputnik Türkiye RSS'te başlık ve büyük marka yazısı görselin
    içine basılmış sosyal kart veriyor. Türkçe Sputnik'te RSS görselini
    kullanma; gerçek makale fotoğrafını /image resolver seçsin.

    Yabancı sekmesindeki "Sputnik" bilerek bu kurala dahil değildir.
  */
  if (sourceName === "Sputnik Türkiye" && link) {
    return sputnikArticleImageFallbackUrl(link);
  }

  const direct =
    getImage(item, source.url || "") ||
    getRssImageFallback(item, source) ||
    getEscapedHtmlImageFallback(item, source);

  if (direct) return direct;

  if (
    link &&
    RSS_ARTICLE_IMAGE_FALLBACK_SOURCES.has(sourceName)
  ) {
    return articleImageFallbackUrl(link);
  }

  return "";
}

function getFeedCategories(item) {
  const values = [];
  const matches =
    item.match(/<category(?:\s[^>]*)?>([\s\S]*?)<\/category>/gi) || [];

  for (const raw of matches) {
    const value = cleanText(
      raw
        .replace(/^<category(?:\s[^>]*)?>/i, "")
        .replace(/<\/category>$/i, "")
    );
    if (value) values.push(value);
  }

  return values;
}

/*
 * 1) RSS category/tag → bizim kategori adımız.
 */
function mapFeedCategory(value) {
  const t = normalize(value);
  if (!t) return null;

  if (t === "son dakika" || t === "sondakika" || t === "breaking" || t === "flash")
    return { breaking: true };

  if (t === "spor" || t.includes("sports") || t.includes("football")) return { category: C.SPORTS };
  if (t === "ekonomi" || t.includes("economy") || t.includes("finance") || t === "finans") return { category: C.ECONOMY };
  if (t === "dunya" || t.includes("world") || t.includes("international")) return { category: C.WORLD };
  if (t === "turkiye" || t === "turkey") return { category: C.TURKEY };
  if (t === "siyaset" || t.includes("politic")) return { category: C.POLITICS };
  if (t === "magazin" || t.includes("celebrity")) return { category: C.MAGAZINE };

  if (t.includes("saglik") || t.includes("health") || t.includes("tip")) return { category: C.HEALTH };
  if (t === "bilim" || t.includes("science") || t.includes("bilimsel")) return { category: C.SCIENCE };
  if (t.includes("otomotiv") || t.includes("otomobil") || t.includes("araba") || t.includes("automotive") || t.includes("car")) return { category: C.AUTOMOTIVE };
  if (t.includes("sinema") || t === "film" || t.includes("movie")) return { category: C.CINEMA };
  if (t === "tv" || t.includes("televizyon") || t.includes("dizi") || t.includes("television")) return { category: C.TELEVISION };
  if (t.includes("muzik") || t.includes("music") || t.includes("album")) return { category: C.MUSIC };
  if (t.includes("edebiyat") || t.includes("kitap") || t.includes("literature") || t.includes("book")) return { category: C.LITERATURE };
  if (t.includes("moda") || t.includes("fashion") || t.includes("stil") || t.includes("giyim")) return { category: C.FASHION };
  if (t.includes("tarih") || t.includes("history")) return { category: C.HISTORY };
  if (t.includes("seyahat") || t.includes("gezi") || t.includes("travel") || t.includes("turizm")) return { category: C.TRAVEL };
  if (t.includes("yasam") || t.includes("life") || t.includes("lifestyle")) return { category: C.LIFE };

  if (t === "teknoloji" || t.includes("technology") || t.includes("yazilim") || t.includes("donanim"))
    return { category: C.TECHNOLOGY };

  if (t.includes("kultur") || t.includes("sanat") || t.includes("culture") || t === "art")
    return { category: C.CULTURE };

  // Eski "Gündem" etiketini artık bir kategori olarak göstermiyoruz.
  // Genel haber kaynaklarındaki bu etiket kaynak varsayılanına bırakılır.
  if (t === "gundem" || t === "agenda" || t === "news") return null;

  return null;
}

/*
 * URL yolu, özellikle genel RSS'lerde kategori için çok güçlü bir sinyaldir.
 * Örn. /spor/, /spor/futbol/, /ekonomi/, /saglik/ gibi.
 */
function categoryFromLink(link = "") {
  let path = "";

  try {
    path = decodeURIComponent(
      new URL(link).pathname || ""
    ).toLocaleLowerCase("tr-TR");
  } catch {
    path = String(link || "")
      .toLocaleLowerCase("tr-TR");
  }

  const tests = [
    [C.SPORTS, /(?:^|\/)(?:spor|sports|futbol|basketbol|voleybol|tenis|motor-sporlari)(?:\/|$)/i],
    [C.ECONOMY, /(?:^|\/)(?:ekonomi|economy|finans|finance)(?:\/|$)/i],
    [C.WORLD, /(?:^|\/)(?:dunya|world|international)(?:\/|$)/i],
    [C.POLITICS, /(?:^|\/)(?:siyaset|politika|politics)(?:\/|$)/i],
    [C.MAGAZINE, /(?:^|\/)(?:magazin|entertainment)(?:\/|$)/i],
    [C.TECHNOLOGY, /(?:^|\/)(?:teknoloji|technology|bilim-teknoloji)(?:\/|$)/i],
    [C.CULTURE, /(?:^|\/)(?:kultur-sanat|sanat|culture-art)(?:\/|$)/i],
    [C.HEALTH, /(?:^|\/)(?:saglik|health)(?:\/|$)/i],
    [C.AUTOMOTIVE, /(?:^|\/)(?:otomobil|otomotiv|automotive|cars)(?:\/|$)/i],
    [C.CINEMA, /(?:^|\/)(?:sinema|film)(?:\/|$)/i],
    [C.TELEVISION, /(?:^|\/)(?:televizyon|dizi|tv)(?:\/|$)/i],
    [C.MUSIC, /(?:^|\/)(?:muzik|music)(?:\/|$)/i],
    [C.TRAVEL, /(?:^|\/)(?:seyahat|gezi|travel)(?:\/|$)/i],
    [C.LIFE, /(?:^|\/)(?:yasam|life)(?:\/|$)/i],
    [C.TURKEY, /(?:^|\/)(?:turkiye|gundem|yerel-haberler)(?:\/|$)/i]
  ];

  for (const [category, pattern] of tests) {
    if (pattern.test(path)) return category;
  }

  return "";
}

/*
 * 2) Genel RSS'lerde metin tabanlı karar.
 *
 * Burada "bir kelime geçti → kategori" yapmıyoruz.
 * Önce başlık çok güçlü sinyal olarak değerlendirilir.
 * Açıklama daha düşük ağırlıkta kullanılır.
 */
const RULES = {
  [C.SPORTS]: [
    ["futbol",12],["basketbol",12],["voleybol",12],["tenis",12],
    ["formula 1",12],["f1",12],["motogp",13],["moto gp",13],
    ["grand prix",11],["super lig",12],["premier league",12],
    ["la liga",12],["serie a",12],["bundesliga",12],
    ["uefa",12],["fifa",12],["transfer",11],
    ["fenerbahce",12],["galatasaray",12],["besiktas",12],
    ["trabzonspor",12],["basaksehir",11],["milli takim",11],
    ["bilardo",11],["gures",11],["pehlivan",10],["atletizm",11],
    ["yuzme",10],["motor sporlari",12],
    ["gol",8],["mac",8],["spor",7]
  ],
  [C.ECONOMY]: [
    ["merkez bankasi",14],["enflasyon",12],["faiz",12],["dolar",10],["euro",10],["altin",10],["borsa",12],["hisse senedi",12],["bitcoin",10],["kripto",10],["vergi",9],["butce",9],["ihracat",9],["ithalat",9],["finans",9],["ekonomi",7]
  ],
  [C.POLITICS]: [
    ["cumhurbaskani",12],["bakan",9],["tbmm",14],["meclis",12],["milletvekili",12],["parti",8],["secim",11],["anayasa",11],["kanun teklifi",12],["kabine",11],["siyaset",11]
  ],
  [C.WORLD]: [
    ["abd",10],["amerika",10],["avrupa",9],["rusya",12],["ukrayna",12],["israil",12],["filistin",12],["gazze",13],["iran",11],["suriye",11],["ingiltere",10],["fransa",10],["almanya",10],["cin",10],["nato",11],["birlesmis milletler",11],["uluslararasi",9]
  ],
  [C.TURKEY]: [
    ["istanbul",9],["ankara",9],["izmir",9],["adana",9],["antalya",9],["bursa",9],["turkiye",10],["jandarma",10],["emniyet",10],["valilik",10],["belediye",10],["deprem",14],["yangin",10],["sel",10],["heyelan",10],["gozalti",8],["tutuklandi",8],["savcilik",8]
  ],
  [C.TECHNOLOGY]: [
    ["yapay zeka",14],["iphone",12],["android",12],["samsung",12],["apple",12],["google",10],["microsoft",10],["akilli telefon",12],["bilgisayar",10],["yazilim",10],["donanim",10],["siber",11],["hacker",11],["robot",10],["cip",10],["nvidia",12],["openai",12],["chatgpt",12],["teknoloji",8]
  ],
  [C.MAGAZINE]: [
    ["magazin",13],["unlu",8],["evlilik",10],["bosandi",10],["hamile",10],["kirmizi hali",11],["sosyetik",9],["influencer",8]
  ],
  [C.CULTURE]: [
    ["sergi",13],["muze",13],["tiyatro",13],["opera",13],["bale",13],["festival",10],["bienal",13],["resim",8],["heykel",12],["arkeoloji",13],["kultur sanat",12],["sanat",8]
  ],
  [C.HEALTH]: [
    ["saglik",10],["hastalik",10],["tedavi",11],["doktor",9],["hekim",9],["tip",8],["asi",9],["kanser",12],["kalp",9],["beyin",9],["ruh sagligi",11],["psikoloji",9],["beslenme",8],["diyet",8],["hastane",8]
  ],
  [C.SCIENCE]: [
    ["bilim",11],["bilimsel",12],["arastirma",8],["fizik",10],["kimya",10],["biyoloji",10],["astronomi",11],["uzay",10],["nasa",11],["evrim",11],["genetik",11],["parcacik",9],["kuantum",11],["paleontoloji",10]
  ],
  [C.AUTOMOTIVE]: [
    ["otomobil",12],["otomotiv",13],["arac",8],["elektrikli arac",12],["suv",10],["sedan",10],["motor1",14],["tesla",11],["togg",12],["renault",9],["volkswagen",9],["bmw",9],["mercedes",9],["toyota",9],["hyundai",9],["ford",9],["motor",7]
  ],
  [C.CINEMA]: [
    ["sinema",13],["film",10],["vizyon",12],["yonetmen",10],["fragman",10],["box office",11],["festival filmi",11],["oscar",10],["cannes",10],["beyazperde",12]
  ],
  [C.TELEVISION]: [
    ["televizyon",13],["dizi",12],["sezon",7],["bolum",7],["netflix dizisi",10],["disney+",9],["prime video",9],["show tv",9],["kanal d",9],["star tv",9],["now tv",9],["atv",9],["trt 1",9]
  ],
  [C.MUSIC]: [
    ["muzik",13],["album",12],["single",11],["sarki",10],["muzisyen",11],["konser",10],["festival",8],["spotify",9],["plak",9],["turne",10],["rock",8],["caz",9],["indie",9],["rap",8]
  ],
  [C.LITERATURE]: [
    ["edebiyat",13],["kitap",11],["roman",10],["oyku",10],["siir",11],["yazar",10],["sair",11],["yayinevi",10],["kitap fuari",10],["edebi",10]
  ],
  [C.FASHION]: [
    ["moda",13],["fashion",13],["defile",12],["koleksiyon",9],["tasarimci",9],["giyim",10],["stil",10],["trend",8],["haute couture",12],["moda haftasi",12],["vogue",12]
  ],
  [C.HISTORY]: [
    ["tarih",11],["tarihi",8],["osmanli",11],["bizans",11],["antik",10],["arkeoloji",10],["imparatorluk",9],["cumhuriyet tarihi",11],["savas",6],["medeniyet",9]
  ],
  [C.TRAVEL]: [
    ["seyahat",13],["gezi",12],["gezilecek",12],["rota",10],["tatil",10],["turizm",10],["otel",8],["seyahat rehberi",12],["plaj",8],["ada",7],["kamp",8]
  ],
  [C.LIFE]: [
    ["yasam",9],["hayat",6],["ev yasam",10],["dekorasyon",10],["gastronomi",9],["yemek",7],["iliski",7],["aile",6],["hobiler",8],["wellness",8]
  ]
};

function wholeWord(text, term) {
  const escaped = normalize(term)
    .replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
    .replace(/\s+/g, "\\s+");

  return new RegExp(
    `(^|[^a-z0-9])${escaped}($|[^a-z0-9])`,
    "i"
  ).test(text);
}

function score(text, category) {
  let total = 0;
  for (const [term, points] of RULES[category] || []) {
    if (wholeWord(text, term)) total += points;
  }
  return total;
}

function classifyGeneral(title, description, fallback = C.LIFE) {
  const titleText = normalize(title);
  const descText = normalize(description);

  const categories = Object.values(C).filter(x => x !== C.BREAKING);
  let best = fallback;
  let bestScore = 0;

  for (const category of categories) {
    const titleScore = score(titleText, category);
    const descScore = score(descText, category);
    const total = titleScore * 3 + descScore;

    if (total > bestScore) {
      bestScore = total;
      best = category;
    }
  }

  return best;
}

function classify(item, source) {
  let category = source.fixedCategory || null;
  let breaking =
    source.foreign
      ? false
      : Boolean(source.fixedBreaking);

  // Önce RSS'in kendi kategorisi.
  for (const raw of item.feedCategories) {
    const mapped = mapFeedCategory(raw);
    if (!mapped) continue;

    if (mapped.breaking && !source.foreign) breaking = true;

    if (mapped.category && !category) {
      category = mapped.category;
    }
  }

  if (!category) {
    category = categoryFromLink(item.link);
  }

  // URL de kategori vermiyorsa metinden karar ver. Kaynak varsayılanı,
  // skor üretmeyen içeriklerde güvenli geri dönüş kategorisidir.
  if (!category) {
    category = classifyGeneral(
      item.title,
      item.description,
      source.defaultCategory || C.LIFE
    );
  }

  const text = normalize(
    `${item.title} ${item.description}`
  );

  if (
    !source.foreign &&
    (
      wholeWord(text, "son dakika") ||
      wholeWord(text, "sondakika") ||
      wholeWord(text, "flaş") ||
      wholeWord(text, "acil")
    )
  ) {
    breaking = true;
  }

  return { category, breaking };
}

function getFeedItemLink(item, baseUrl = "") {
  const textLink=getTag(item, "link");
  if(textLink){
    const absolute=absoluteUrl(textLink, baseUrl);
    if(absolute)return absolute;
  }

  // Atom and publisher namespaces may use atom:link / news:link.
  const linkTags=item.match(/<(?:[A-Za-z0-9_-]+:)?link\b[^>]*>/gi) || [];

  let fallback="";
  for(const tag of linkTags){
    const href=getAttr(tag, "href") || getAttr(tag, "url");
    if(!href)continue;

    const rel=(getAttr(tag, "rel") || "").toLowerCase();
    const absolute=absoluteUrl(href, baseUrl);
    if(!absolute)continue;

    if(rel==="alternate" || !rel){
      return absolute;
    }
if(!fallback)fallback=absolute;
  }

  if(fallback)return fallback;

  /* RSS 1.0 / RDF can keep the canonical permalink on rdf:about. */
  const opening =
    item.match(/<(?:[A-Za-z0-9_-]+:)?(?:item|entry)\b[^>]*>/i)?.[0] || "";
  const rdfAbout =
    getAttr(opening, "rdf:about") ||
    getAttr(opening, "about");
  if(rdfAbout){
    const absolute=absoluteUrl(rdfAbout, baseUrl);
    if(absolute)return absolute;
  }

  /* Common canonical-link fields used by RSS generators. */
  for(const tagName of [
    "feedburner:origLink",
    "origLink",
    "permalink",
    "comments",
    "dc:identifier",
    "identifier",
    "guid",
    "id"
  ]){
    const value=getTag(item, tagName);
    if(!value)continue;

    if(/^https?:\/\//i.test(value) || /^\//.test(value)){
      const absolute=absoluteUrl(value, baseUrl);
      if(absolute)return absolute;
    }
  }

  /*
    v31.97 — Some feeds (notably current Milliyet) omit a parser-friendly
    <link> but still embed the canonical article URL in HTML/CDATA or another
    custom field. Only enable the broad URL recovery for Milliyet so we do not
    accidentally mistake unrelated asset URLs for article links elsewhere.
  */
  if(String(baseUrl || "").toLowerCase().includes("milliyet.com.tr")){
    const decoded=decodeEmbeddedMarkup(item);
    const candidates=[];

    const addCandidate=value=>{
      const raw=decodeEntities(String(value || ""))
        .replace(/[\]\[(){}<>"']+$/g, "")
        .trim();
      if(!raw)return;

      const absolute=absoluteUrl(raw, baseUrl);
      if(!absolute)return;

      try{
        const u=new URL(absolute);
        const host=u.hostname.toLowerCase();
        const path=u.pathname.toLowerCase();

        if(!(host==="milliyet.com.tr" || host.endsWith(".milliyet.com.tr")))return;
        if(path.includes("/rss/"))return;
        if(/\.(?:jpe?g|png|gif|webp|svg|avif)(?:$|\?)/i.test(path))return;
        if(u.href===absoluteUrl(baseUrl, baseUrl))return;

        let score=0;
        if(host==="www.milliyet.com.tr")score+=30;
        if(path.split("/").filter(Boolean).length>=2)score+=40;
        if(/\d{5,}/.test(path))score+=20;
        if(!candidates.some(entry=>entry.url===u.href)){
          candidates.push({url:u.href,score});
        }
      }catch{}
    };

    for(const tag of decoded.match(/<a\b[^>]*>/gi) || []){
      addCandidate(getAttr(tag,"href"));
    }

    for(const match of decoded.match(/https?:\/\/[^\s<>"']+/gi) || []){
      addCandidate(match);
    }

    candidates.sort((a,b)=>b.score-a.score);
    if(candidates[0]?.url)return candidates[0].url;
  }

  return "";
}

function parseRSS(xml, source) {
  const items = [];
  const sourceText = String(xml || "");

  /*
    Most feeds are either RSS <item> or Atom <entry>. Building arrays for every
    block in a large feed was one of /news' biggest CPU costs. Iterate lazily
    and stop as soon as the 30 usable rows the frontend can consume are ready.
  */
  const hasRssItems = /<item\b/i.test(sourceText);
  const blockPattern = hasRssItems
    ? /<item\b[^>]*>[\s\S]*?<\/item>/gi
    : /<entry\b[^>]*>[\s\S]*?<\/entry>/gi;

  let match;
  let blockIndex = 0;
  let scanned = 0;

  while (
    items.length < 30 &&
    scanned < NEWS_RSS_SCAN_BLOCK_LIMIT &&
    (match = blockPattern.exec(sourceText))
  ) {
    const item = match[0];
    const feedOrder = blockIndex++;
    scanned++;

    /* Cheap rejection first; do not run image/category/video regexes unless
       the item can actually become a story. */
    const title = getTag(item, "title");
    if (!title) continue;

    const link = getFeedItemLink(item, source.url);
    if (!link) continue;

    const image = getEffectiveFeedImage(item, source, link);
    if (!image) continue;

    const description =
      getFirstTag(item, [
        "description",
        "content:encoded",
        "summary",
        "content"
      ]);

    const published =
      getFirstTag(item, [
        "pubDate",
        "published",
        "updated",
        "dc:date"
      ]);

    const feedVideo = getFeedVideo(item, source.url);
    const feedCategories = getFeedCategories(item);

    const result = classify(
      { title, description, feedCategories, link },
      source
    );

    const mappedFeedCategory =
      feedCategories.some(raw => {
        const mapped = mapFeedCategory(raw);
        return Boolean(mapped?.category);
      });

    const categoryPriority =
      source.fixedCategory
        ? 3
        : mappedFeedCategory
          ? 2
          : 1;

    items.push({
      title,
      source: source.name,
      category: result.category,
      categoryPriority,
      breaking: result.breaking,
      foreign: Boolean(source.foreign),
      image,
      video: feedVideo?.url || "",
      videoType: feedVideo?.type || "",
      /* Publisher-owned /video RSS lanes are a strong article-level video hint. */
      videoArticleHint: /\/video(?:[/?#]|$)/i.test(source.url),
      videoVerified: Boolean(
        feedVideo?.url &&
        (
          looksLikeVideoUrl(feedVideo.url, feedVideo.type || "") ||
          normalizeKnownEmbed(feedVideo.url)
        )
      ),
      feedOrder,
      link,
      published,
      description
    });
  }

  return items;
}


const VIDEO_INDEX_DETAIL_LIMIT = 6;
const VIDEO_INDEX_CACHE_SECONDS = 180;

function articleMetaMap(html = "") {
  const map = new Map();

  for (const tag of html.match(/<meta\b[^>]*>/gi) || []) {
    const key = (
      htmlAttr(tag, "property") ||
      htmlAttr(tag, "name") ||
      htmlAttr(tag, "itemprop")
    ).toLowerCase();

    const value = htmlAttr(tag, "content");

    if (key && value && !map.has(key)) {
      map.set(key, value);
    }
  }

  return map;
}

function articleTitleFromHtml(html = "", fallback = "") {
  const meta = articleMetaMap(html);

  const value =
    meta.get("og:title") ||
    meta.get("twitter:title") ||
    meta.get("headline") ||
    "";

  if (value) return cleanText(value);

  const h1 = html.match(
    /<h1\b[^>]*>([\s\S]*?)<\/h1>/i
  );

  return h1
    ? cleanText(h1[1])
    : cleanText(fallback);
}

function articleDescriptionFromHtml(html = "") {
  const meta = articleMetaMap(html);

  const value =
    meta.get("og:description") ||
    meta.get("twitter:description") ||
    meta.get("description") ||
    "";

  return cleanText(value);
}

function articlePublishedFromHtml(html = "") {
  const meta = articleMetaMap(html);

  for (const key of [
    "article:published_time",
    "datepublished",
    "date",
    "pubdate",
    "publishdate",
    "publish_date"
  ]) {
    const value = String(
      meta.get(key) || ""
    ).trim();

    if (
      value &&
      Number.isFinite(
        new Date(value).getTime()
      )
    ) {
      return value;
    }
  }

  for (const script of
    html.match(
      /<script\b[^>]*type=["']application\/ld\+json["'][^>]*>[\s\S]*?<\/script>/gi
    ) || []
  ) {
    const body = script
      .replace(/^<script\b[^>]*>/i, "")
      .replace(/<\/script>$/i, "")
      .trim();

    if (!body) continue;

    try {
      const parsed = JSON.parse(body);
      let found = "";

      const visit = value => {
        if (found || !value) return;

        if (Array.isArray(value)) {
          value.forEach(visit);
          return;
        }

        if (typeof value !== "object") return;

        for (const key of [
          "datePublished",
          "uploadDate",
          "dateCreated"
        ]) {
          const candidate =
            String(value[key] || "").trim();

          if (
            candidate &&
            Number.isFinite(
              new Date(candidate).getTime()
            )
          ) {
            found = candidate;
            return;
          }
        }

        for (const child of Object.values(value)) {
          if (child && typeof child === "object") {
            visit(child);
          }
        }
      };

      visit(parsed);

      if (found) return found;
    } catch {}
  }

  return "";
}

function videoIndexCandidateUrl(value = "", source = {}) {
  const absolute = absoluteUrl(
    value,
    source.url
  );

  if (!absolute) return "";

  try {
    const url = new URL(absolute);
    const host = url.hostname
      .toLowerCase()
      .replace(/^www\./, "");

    if (source.videoIndex === "halktv") {
      if (host !== "halktv.com.tr") return "";

      /*
        Halk TV article URLs use a numeric h suffix. This excludes navigation,
        category links and "Çok Okunanlar" list destinations that are not
        article pages.
      */
      if (!/-\d+h\/?$/i.test(url.pathname)) {
        return "";
      }

      return url.href;
    }

    if (source.videoIndex === "ntv") {
      if (host !== "ntv.com.tr") return "";

      const path =
        decodeURIComponent(url.pathname);

      const dedicatedVideo =
        /\/video\/[^/]+\/[^/]+,[A-Za-z0-9_-]{6,}/i
          .test(path);

      const currentVideoSlug =
        /\/(?:turkiye|dunya|ekonomi|yasam|teknoloji|saglik|sanat|egitim|seyahat|otomobil|spor|sporskor)\/video-[^/]+/i
          .test(path);

      if (
        !dedicatedVideo &&
        !currentVideoSlug
      ) {
        return "";
      }

      return url.href;
    }

    return "";
  } catch {
    return "";
  }
}

function videoIndexLinkCandidates(html = "", source = {}) {
  const candidates = [];
  const seen = new Set();

  for (
    const match of
    html.matchAll(
      /<a\b[^>]*href=(["'])(.*?)\1[^>]*>([\s\S]*?)<\/a>/gi
    )
  ) {
    const href =
      videoIndexCandidateUrl(
        decodeEntities(match[2] || ""),
        source
      );

    if (!href || seen.has(href)) continue;

    const title =
      cleanText(match[3] || "");

    if (!title || title.length < 6) continue;

    seen.add(href);

    candidates.push({
      link: href,
      title,
      order:
        Number(match.index) || 0
    });

    if (candidates.length >= 24) {
      break;
    }
  }

  return candidates;
}

async function fetchVideoDiscoveryArticle(
  candidate,
  source
) {
  const controller =
    new AbortController();

  const timeout =
    setTimeout(
      () => controller.abort(),
      8500
    );

  try {
    const response =
      await fetch(
        candidate.link,
        {
          signal:
            controller.signal,
          redirect:
            "follow",
          headers: {
            "User-Agent":
              "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.0.0 Safari/537.36",
            "Accept":
              "text/html,application/xhtml+xml;q=0.9,*/*;q=0.7",
            "Accept-Language":
              "tr-TR,tr;q=0.9,en;q=0.6"
          }
        }
      );

    if (!response.ok) {
      return null;
    }

    const finalUrl =
      response.url ||
      candidate.link;

    if (!isSafeArticleUrl(finalUrl)) {
      return null;
    }

    const html =
      await readResponseTextLimited(
        response,
        MAX_ARTICLE_HTML_CHARS
      );

    const title =
      articleTitleFromHtml(
        html,
        candidate.title
      );

    if (!title) return null;

    let media = null;

    if (
      source.videoIndex === "halktv"
    ) {
      media =
        resolveHalkTvYouTubeVideo(
          html,
          finalUrl,
          title
        );

      if (!media) {
        media =
          await resolveArticleXVideo(
            html,
            finalUrl,
            title,
            controller.signal
          );
      }

      if (!media) {
        media =
          await resolveHalkTvOwnedPlayer(
            html,
            finalUrl,
            title,
            controller.signal
          );
      }

      if (media) {
        media =
          await validateResolvedMediaCandidate(
            media,
            finalUrl,
            title,
            controller.signal,
            0
          );
      }

      if (!media) {
        media =
          await resolveGenericVideoValidated(
            html,
            finalUrl,
            title,
            null,
            controller.signal
          );
      }
    } else if (
      source.videoIndex === "ntv"
    ) {
      media =
        await resolveGenericVideoValidated(
          html,
          finalUrl,
          title,
          null,
          controller.signal
        );
    }

    /*
      Discovery feed'e yalnız gerçekten çözülebilen video haberini ekle.
      Böylece "Sadece videolu haberler" taraması tekrar aynı makaleyi
      tahmin etmeye çalışmak zorunda kalmaz.
    */
    if (!media?.url) {
      return null;
    }

    const description =
      articleDescriptionFromHtml(
        html
      );

    const image =
      extractArticleImageFromHtml(
        html,
        finalUrl
      );

    const published =
      articlePublishedFromHtml(
        html
      );

    /*
      Tarihi belirlenemeyen discovery girdisini "şimdi" diye uydurma.
      Yanlış göreli zaman göstermek yerine bu girdiyi atla.
    */
    if (!published) {
      return null;
    }

    const result =
      classify(
        {
          title,
          description,
          feedCategories: [],
          link: finalUrl
        },
        source
      );

    return {
      title,
      source:
        source.name,
      category:
        result.category,
      categoryPriority:
        source.fixedCategory
          ? 3
          : 1,
      breaking: false,
      foreign: false,
      image,
      /*
        Frontend story.video is a native <video> fast-path. Never put iframe
        embeds/player documents there; leaving it empty makes the frontend call
        /video, which preserves kind/provider and selects the correct renderer.
      */
      video:
        media.kind === "video"
          ? media.url
          : "",
      videoType:
        media.kind === "video"
          ? (media.type || "")
          : "",
      videoDiscovery: true,
      videoVerified: true,
      videoArticleHint: true,
      videoDiscoveryProvider:
        media.provider || "",
      link:
        finalUrl,
      published,
      description
    };
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchVideoIndexSource(source) {
  const cache =
    caches.default;

  const cacheUrl =
    "https://floew.internal/video-index?" +
    new URLSearchParams({
      rv:
        VIDEO_RESOLVER_VERSION,
      source:
        source.name,
      url:
        source.url
    }).toString();

  const cacheRequest =
    new Request(cacheUrl);

  const cached =
    await cache.match(
      cacheRequest
    );

  if (cached) {
    try {
      return await cached.json();
    } catch {}
  }

  const controller =
    new AbortController();

  const timeout =
    setTimeout(
      () => controller.abort(),
      9000
    );

  try {
    const response =
      await fetch(
        source.url,
        {
          signal:
            controller.signal,
          redirect:
            "follow",
          headers: {
            "User-Agent":
              "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.0.0 Safari/537.36",
            "Accept":
              "text/html,application/xhtml+xml;q=0.9,*/*;q=0.7",
            "Accept-Language":
              "tr-TR,tr;q=0.9,en;q=0.6"
          }
        }
      );

    if (!response.ok) {
      return [];
    }

    const html =
      await readResponseTextLimited(
        response,
        3_500_000
      );

    const candidates =
      videoIndexLinkCandidates(
        html,
        {
          ...source,
          url:
            response.url ||
            source.url
        }
      )
        .slice(
          0,
          VIDEO_INDEX_DETAIL_LIMIT
        );

    if (!candidates.length) {
      return [];
    }

    const rows =
      (
        await Promise.all(
          candidates.map(
            candidate =>
              fetchVideoDiscoveryArticle(
                candidate,
                source
              )
          )
        )
      )
        .filter(Boolean)
        .sort((a,b)=>{
          const at =
            new Date(a.published)
              .getTime();

          const bt =
            new Date(b.published)
              .getTime();

          return (
            (Number.isFinite(bt) ? bt : 0) -
            (Number.isFinite(at) ? at : 0)
          );
        })
        .slice(
          0,
          VIDEO_INDEX_DETAIL_LIMIT
        );

    if (rows.length) {
      const output =
        new Response(
          JSON.stringify(rows),
          {
            headers: {
              "Content-Type":
                "application/json; charset=utf-8",
              "Cache-Control":
                `public, max-age=${VIDEO_INDEX_CACHE_SECONDS}`
            }
          }
        );

      await cache.put(
        cacheRequest,
        output.clone()
      );
    }

    return rows;
  } catch (error) {
    console.warn(
      `Video index error: ${source.name}`,
      source.url,
      error
    );

    return [];
  } finally {
    clearTimeout(timeout);
  }
}


async function debugCnnRssRequest(corsHeaders) {
  const urls = [
    "https://www.cnnturk.com/feed/rss",
    "https://www.cnnturk.com/feed/rss/all/news",
    "https://www.cnnturk.com/feed/rss/turkiye/news",
    "https://www.cnnturk.com/feed/rss/all/video"
  ];

  const userAgents = [
    {
      label: "production-ua",
      value: "The-Floew-News-Wall/3.0"
    },
    {
      label: "browser-ua",
      value:
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) " +
        "AppleWebKit/537.36 (KHTML, like Gecko) " +
        "Chrome/139.0.0.0 Safari/537.36"
    }
  ];

  async function probe(feedUrl, ua) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 12000);
    const started = Date.now();

    try {
      const response = await fetch(feedUrl, {
        signal: controller.signal,
        redirect: "follow",
        headers: {
          "User-Agent": ua.value,
          "Accept":
            "application/rss+xml, application/atom+xml, application/xml, text/xml, */*",
          "Accept-Language": "tr-TR,tr;q=0.9,en;q=0.6",
          "Cache-Control": "no-cache",
          "Pragma": "no-cache"
        }
      });

      const body = await response.text();
      const source = {
        name: "CNN Türk",
        url: feedUrl,
        fixedCategory: null,
        defaultCategory: "#Türkiye"
      };
      const parsed = parseRSS(body, source);
      const prefix = body
        .slice(0, 600)
        .replace(/\s+/g, " ")
        .trim();

      return {
        feedUrl,
        label: ua.label,
        status: response.status,
        ok: response.ok,
        finalUrl: response.url,
        redirected: response.redirected,
        elapsedMs: Date.now() - started,
        headers: {
          contentType: response.headers.get("content-type") || "",
          contentLength: response.headers.get("content-length") || "",
          server: response.headers.get("server") || "",
          cfRay: response.headers.get("cf-ray") || "",
          cacheControl: response.headers.get("cache-control") || ""
        },
        bodyChars: body.length,
        markers: {
          rss: /<rss\b/i.test(body),
          feed: /<feed\b/i.test(body),
          rdf: /<rdf:RDF\b/i.test(body),
          itemCount: (body.match(/<item\b/gi) || []).length,
          entryCount: (body.match(/<entry\b/gi) || []).length,
          html: /<html\b/i.test(body),
          cloudflareChallenge:
            /cf-chl|challenge-platform|just a moment|attention required/i.test(body),
          accessDenied:
            /access denied|forbidden|request blocked|bot detection/i.test(body)
        },
        parsedCount: parsed.length,
        parsedPreview: parsed.slice(0, 3).map(item => ({
          title: item.title,
          link: item.link,
          image: item.image,
          videoArticleHint: Boolean(item.videoArticleHint)
        })),
        bodyPrefix: prefix,
        error: ""
      };
    } catch (error) {
      return {
        feedUrl,
        label: ua.label,
        status: 0,
        ok: false,
        finalUrl: "",
        redirected: false,
        elapsedMs: Date.now() - started,
        headers: {},
        bodyChars: 0,
        markers: {},
        parsedCount: 0,
        parsedPreview: [],
        bodyPrefix: "",
        error: String(error?.name || "Error") + ": " + String(error?.message || error || "")
      };
    } finally {
      clearTimeout(timeout);
    }
  }

  const probes = [];
  for (const feedUrl of urls) {
    for (const ua of userAgents) {
      probes.push(await probe(feedUrl, ua));
    }
  }

  const diagnosis = [];
  const anyXml = probes.some(p => p.ok && (p.markers?.rss || p.markers?.feed || p.markers?.rdf));
  const anyParsed = probes.some(p => p.parsedCount > 0);
  const browserOnly = probes.some(p =>
    p.label === "browser-ua" && p.parsedCount > 0 &&
    !probes.some(q => q.feedUrl === p.feedUrl && q.label === "production-ua" && q.parsedCount > 0)
  );
  const challenged = probes.some(p => p.markers?.cloudflareChallenge || p.markers?.accessDenied);

  if (!anyXml) diagnosis.push("cnn-rss-returned-no-xml-to-worker");
  if (anyXml && !anyParsed) diagnosis.push("cnn-rss-xml-arrived-but-parser-returned-zero-items");
  if (browserOnly) diagnosis.push("cnn-rss-works-only-with-browser-user-agent");
  if (challenged) diagnosis.push("cnn-rss-edge-bot-or-access-challenge-detected");
  if (anyParsed) diagnosis.push("cnn-rss-is-reachable-and-parseable-from-worker");

  return new Response(
    JSON.stringify({
      ok: true,
      workerVersion: WORKER_VERSION,
      resolverVersion: VIDEO_RESOLVER_VERSION,
      probes,
      diagnosis
    }, null, 2),
    {
      status: 200,
      headers: {
        ...corsHeaders,
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store"
      }
    }
  );
}

async function fetchSource(source) {
  if (source.kind === "video-index") {
    return fetchVideoIndexSource(source);
  }

  const cache = caches.default;
  const parsedCacheRequest = newsSourceCacheRequest(source);

  try {
    const cached = await cache.match(parsedCacheRequest);
    if (cached) {
      const rows = await cached.json();
      if (Array.isArray(rows)) return rows;
    }
  } catch (error) {
    console.warn(`RSS parsed-cache read failed: ${source.name}`, error);
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10500);

  const isCnnTurk = (() => {
    try {
      const host = new URL(source.url).hostname.toLowerCase();
      return host === "cnnturk.com" || host === "www.cnnturk.com";
    } catch {
      return false;
    }
  })();

  async function requestFeed(userAgent) {
    return fetch(source.url, {
      signal: controller.signal,
      redirect: "follow",
      headers: {
        "User-Agent": userAgent,
        "Accept":
          "application/rss+xml, application/atom+xml, application/xml, text/xml, */*",
        "Accept-Language": "tr-TR,tr;q=0.9,en;q=0.6"
      }
    });
  }
try {
    let response = await requestFeed("The-Floew-News-Wall/3.0");

    /*
      CNN Türk occasionally serves a different edge response to non-browser UAs.
      A single browser-UA retry keeps its large news/video RSS catalog from
      disappearing without weakening other sources.
    */
    if (!response.ok && isCnnTurk) {
      response = await requestFeed(
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) " +
        "AppleWebKit/537.36 (KHTML, like Gecko) " +
        "Chrome/139.0.0.0 Safari/537.36"
      );
    }

    if (!response.ok) {
      throw new Error(
        `${response.status} ${response.statusText}`
      );
    }

    /* RSS files can be surprisingly large. The feed is newest-first and
       parseRSS stops after 30 usable rows, so reading megabytes beyond this
       bound only burns CPU/memory without changing the batch result. */
    let xml = await readResponseTextLimited(response, NEWS_RSS_MAX_BYTES);

    if (
      isCnnTurk &&
      !/<(?:rss|feed|rdf:RDF|item|entry)\b/i.test(xml)
    ) {
      const retry = await requestFeed(
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) " +
        "AppleWebKit/537.36 (KHTML, like Gecko) " +
        "Chrome/139.0.0.0 Safari/537.36"
      );

      if (retry.ok) {
        const retryText = await readResponseTextLimited(
          retry,
          NEWS_RSS_MAX_BYTES
        );
        if (/<(?:rss|feed|rdf:RDF|item|entry)\b/i.test(retryText)) {
          xml = retryText;
        }
      }
    }

    const rows = parseRSS(xml, source);

    /* Await the write on a cold source. If a large batch later hits the CPU
       ceiling, sources that already finished parsing stay warm for the retry,
       allowing the batch to converge instead of failing from zero every time. */
    try {
      await cache.put(
        parsedCacheRequest,
        new Response(JSON.stringify(rows), {
          headers: {
            "Content-Type": "application/json; charset=utf-8",
            "Cache-Control":
              `public, max-age=${newsSourceCacheSeconds(source)}`
          }
        })
      );
    } catch (error) {
      console.warn(`RSS parsed-cache write failed: ${source.name}`, error);
    }

    return rows;
  } catch (error) {
    console.error(
      `RSS error: ${source.name}`,
      source.url,
      error
    );
    return [];
  } finally {
    clearTimeout(timeout);
  }
}


function isSafeCustomRssUrl(value = "") {
  try {
    const u = new URL(value);

    if (!isSafeArticleUrl(u.href)) return false;
    if (u.username || u.password) return false;

    /* Keep the proxy on normal web ports only. */
    if (
      u.port &&
      u.port !== "80" &&
      u.port !== "443"
    ) return false;

    return true;
  } catch {
    return false;
  }
}

function customRssSourceName(xml = "", feedUrl = "") {
  try {
    const firstItem = xml.search(/<(?:[A-Za-z0-9_-]+:)?(?:item|entry)\b/i);
    const header = firstItem >= 0
      ? xml.slice(0, firstItem)
      : xml.slice(0, 120000);

    const title = getFirstTag(header, ["title", "dc:title"]);
    if (title) return title.slice(0, 120);

    return new URL(feedUrl).hostname
      .replace(/^www\./i, "")
      .slice(0, 120);
  } catch {
    return "Özel RSS";
  }
}

function customRssHostName(feedUrl = "") {
  try {
    return new URL(feedUrl).hostname
      .replace(/^www\./i, "")
      .slice(0, 120) || "Özel RSS";
  } catch {
    return "Özel RSS";
  }
}

function getCustomRssItemLink(item = "", baseUrl = "") {
  const normal = getFeedItemLink(item, baseUrl);
  if (normal) return normal;

  /* RSS 1.0 / RDF feeds often keep the canonical URL in rdf:about. */
  const opening = item.match(/<(?:[A-Za-z0-9_-]+:)?(?:item|entry)\b[^>]*>/i)?.[0] || "";
  const rdfAbout =
    getAttr(opening, "rdf:about") ||
    getAttr(opening, "about");
  if (rdfAbout) {
    const absolute = absoluteUrl(rdfAbout, baseUrl);
    if (absolute) return absolute;
  }

  /* Some feeds use guid/id as the permalink and omit <link>. */
  for (const tagName of ["guid", "id"]) {
    const value = getTag(item, tagName);
    if (!/^https?:\/\//i.test(value)) continue;
    const absolute = absoluteUrl(value, baseUrl);
    if (absolute) return absolute;
  }

  return "";
}

function parseCustomRSS(xml = "", feedUrl = "") {
  const sourceName =
    customRssSourceName(xml, feedUrl);

  const source = {
    name: sourceName,
    url: feedUrl,
    fixedCategory: null,
    defaultCategory: C.LIFE,
    foreign: false
  };

  const items = [];
  const blocks = [
    ...(xml.match(/<(?:[A-Za-z0-9_-]+:)?item\b[\s\S]*?<\/(?:[A-Za-z0-9_-]+:)?item>/gi) || []),
    ...(xml.match(/<(?:[A-Za-z0-9_-]+:)?entry\b[\s\S]*?<\/(?:[A-Za-z0-9_-]+:)?entry>/gi) || [])
  ];

  for (const item of blocks.slice(0, 40)) {
    const title = getFirstTag(item, [
      "title",
      "dc:title",
      "media:title"
    ]);

    const description =
      getFirstTag(item, [
        "description",
        "content:encoded",
        "summary",
        "content",
        "dc:description"
      ]);

    const link =
      getCustomRssItemLink(item, feedUrl);

    const published =
      getFirstTag(item, [
        "pubDate",
        "published",
        "updated",
        "dc:date",
        "date",
        "created"
      ]);

    const image = getImage(item, feedUrl) || "";
    const feedVideo = getFeedVideo(item, feedUrl);
    const feedCategories = getFeedCategories(item);

    /* Custom RSS is allowed to have no image: frontend supplies defaultrss.jpg. */
    if (!title || !link) continue;
    if (!isSafeArticleUrl(link)) continue;

    const result = classify(
      { title, description, feedCategories, link },
      source
    );

    const mappedFeedCategory =
      feedCategories.some(raw => {
        const mapped = mapFeedCategory(raw);
        return Boolean(mapped?.category);
      });

    items.push({
      title,
      source: sourceName,
      category: result.category || C.LIFE,
      categoryPriority: mappedFeedCategory ? 2 : 1,
      breaking: false,
      foreign: false,
      image,
      video: feedVideo?.url || "",
      videoType: feedVideo?.type || "",
      link,
      published,
      description,
      customRss: true
    });
  }

  return {
    source: sourceName,
    items,
    format: "xml"
  };
}

function parseCustomJsonFeed(text = "", feedUrl = "") {
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    return null;
  }

  if (!data || typeof data !== "object" || !Array.isArray(data.items)) {
    return null;
  }

  const sourceName =
    cleanText(data.title || "").slice(0, 120) ||
    customRssHostName(feedUrl);

  const source = {
    name: sourceName,
    url: feedUrl,
    fixedCategory: null,
    defaultCategory: C.LIFE,
    foreign: false
  };

  const items = [];

  for (const entry of data.items.slice(0, 40)) {
    if (!entry || typeof entry !== "object") continue;

    const description = cleanText(
      entry.summary ||
      entry.content_text ||
      entry.content_html ||
      ""
    );

    const title = cleanText(
      entry.title ||
      entry.summary ||
      entry.content_text ||
      ""
    ).slice(0, 500);

    let link = absoluteUrl(
      entry.url || entry.external_url || "",
      feedUrl
    );

    if (!link && /^https?:\/\//i.test(String(entry.id || ""))) {
      link = absoluteUrl(entry.id, feedUrl);
    }

    if (!title || !link || !isSafeArticleUrl(link)) continue;

    let image = absoluteUrl(
      entry.image || entry.banner_image || "",
      feedUrl
    );

    let feedVideo = null;
    const attachments = Array.isArray(entry.attachments)
      ? entry.attachments
      : [];

    for (const attachment of attachments) {
      if (!attachment || typeof attachment !== "object") continue;
      const attachmentUrl = absoluteUrl(attachment.url || "", feedUrl);
      const mime = String(attachment.mime_type || "").toLowerCase();
      if (!attachmentUrl) continue;

      if (!image && mime.startsWith("image/")) {
        image = attachmentUrl;
      }

      if (!feedVideo && looksLikeVideoUrl(attachmentUrl, mime)) {
        feedVideo = { url: attachmentUrl, type: mime };
      }
    }

    const feedCategories = Array.isArray(entry.tags)
      ? entry.tags.map(value=>cleanText(value)).filter(Boolean)
      : [];

    const result = classify(
      { title, description, feedCategories, link },
      source
    );

    const mappedFeedCategory =
      feedCategories.some(raw => {
        const mapped = mapFeedCategory(raw);
        return Boolean(mapped?.category);
      });

    items.push({
      title,
      source: sourceName,
      category: result.category || C.LIFE,
      categoryPriority: mappedFeedCategory ? 2 : 1,
      breaking: false,
      foreign: false,
      image: image || "",
      video: feedVideo?.url || "",
      videoType: feedVideo?.type || "",
      link,
      published:
        entry.date_published ||
        entry.date_modified ||
        "",
      description,
      customRss: true
    });
  }

  return {
    source: sourceName,
    items,
    format: "jsonfeed"
  };
}

function discoverCustomFeedUrl(html = "", baseUrl = "") {
  const tags = html.match(/<link\b[^>]*>/gi) || [];

  for (const tag of tags) {
    const rel = htmlAttr(tag, "rel")
      .toLowerCase()
      .split(/\s+/)
      .filter(Boolean);

    if (!rel.includes("alternate")) continue;

    const type = htmlAttr(tag, "type").toLowerCase();
    const href = htmlAttr(tag, "href");
    if (!href) continue;

    const looksLikeFeedType =
      type.includes("rss") ||
      type.includes("atom") ||
      type.includes("feed+json") ||
      type.includes("application/json") ||
      type.includes("application/xml") ||
      type.includes("text/xml");

    if (!looksLikeFeedType) continue;

    const absolute = absoluteUrl(href, baseUrl);
    if (absolute && isSafeCustomRssUrl(absolute)) {
      return absolute;
    }
  }

  return "";
}

function customRssError(code, message) {
  const error = new Error(message || code || "Custom RSS error");
  error.code = code || "custom_rss_error";
  return error;
}

function customRssJsonResponse(
  corsHeaders,
  status,
  code,
  message,
  extra = {}
) {
  return new Response(
    JSON.stringify({
      ok: false,
      code,
      error: message,
      ...extra
    }),
    {
      status,
      headers: {
        ...corsHeaders,
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store"
      }
    }
  );
}

async function fetchSafeCustomRss(feedUrl, signal) {
  let current = feedUrl;

  /* Follow redirects manually so every redirect target is validated. */
  for (let hop = 0; hop < 5; hop++) {
    if (!isSafeCustomRssUrl(current)) {
      throw customRssError("unsafe_url", "Unsafe RSS URL");
    }

    const response = await fetch(current, {
      signal,
      redirect: "manual",
      headers: {
        /* Browser-like UA improves compatibility with feeds that block generic bots. */
        "User-Agent":
          "Mozilla/5.0 (compatible; TheFloew/3.4; +https://thefloew.github.io/The-Floew/)",
        "Accept":
          "application/rss+xml, application/atom+xml, application/feed+json, application/json, application/xml, text/xml, text/html;q=0.8, */*;q=0.5",
        "Accept-Language": "tr-TR,tr;q=0.9,en;q=0.7",
        "Cache-Control": "no-cache"
      }
    });

    if (
      response.status >= 300 &&
      response.status < 400
    ) {
      const location =
        response.headers.get("Location") || "";

      const next = absoluteUrl(location, current);
      if (!next || !isSafeCustomRssUrl(next)) {
        throw customRssError(
          "unsafe_redirect",
          "Unsafe RSS redirect"
        );
      }

      current = next;
      continue;
    }

    return { response, finalUrl: current };
  }

  throw customRssError(
    "too_many_redirects",
    "Too many RSS redirects"
  );
}

function customRssUpstreamFailure(response, corsHeaders) {
  const upstreamStatus = Number(response?.status || 0);

  let code = "upstream_http";
  let message = `Upstream returned HTTP ${upstreamStatus || "error"}`;

  if (upstreamStatus === 401 || upstreamStatus === 403) {
    code = "upstream_forbidden";
    message = `Upstream access denied (${upstreamStatus})`;
  } else if (upstreamStatus === 404 || upstreamStatus === 410) {
    code = "upstream_not_found";
    message = `Feed not found (${upstreamStatus})`;
  } else if (upstreamStatus === 429) {
    code = "upstream_rate_limited";
    message = "Upstream rate limited the request (429)";
  } else if (upstreamStatus >= 500) {
    code = "upstream_error";
    message = `Upstream server error (${upstreamStatus})`;
  }

  return customRssJsonResponse(
    corsHeaders,
    502,
    code,
    message,
    { upstream_status: upstreamStatus }
  );
}

async function readCustomRssResponse(response, corsHeaders) {
  const maxBytes = 2_500_000;
  const length = Number(
    response.headers.get("Content-Length") || 0
  );

  if (length && length > maxBytes) {
    return {
      errorResponse: customRssJsonResponse(
        corsHeaders,
        413,
        "feed_too_large",
        "RSS feed is larger than 2.5 MB"
      )
    };
  }

  const body = await response.text();

  /* Character count is a conservative secondary guard when Content-Length is absent. */
  if (body.length > maxBytes) {
    return {
      errorResponse: customRssJsonResponse(
        corsHeaders,
        413,
        "feed_too_large",
        "RSS feed is larger than 2.5 MB"
      )
    };
  }

  return {
    body,
    contentType: String(
      response.headers.get("Content-Type") || ""
    ).toLowerCase()
  };
}

function parseCustomFeedBody(body = "", contentType = "", finalUrl = "") {
  const trimmed = String(body || "").trim();

  const looksJson =
    contentType.includes("json") ||
    trimmed.startsWith("{") ||
    trimmed.startsWith("[");

  if (looksJson) {
    const parsedJson = parseCustomJsonFeed(trimmed, finalUrl);
    if (parsedJson) return parsedJson;
  }

  const looksXml =
    contentType.includes("xml") ||
    contentType.includes("rss") ||
    contentType.includes("atom") ||
    /^<\?xml\b/i.test(trimmed) ||
    /^<(?:rss|feed|rdf:RDF)\b/i.test(trimmed) ||
    /<(?:[A-Za-z0-9_-]+:)?(?:item|entry)\b/i.test(trimmed);

  if (looksXml) {
    return parseCustomRSS(trimmed, finalUrl);
  }

  return null;
}

async function getCustomRss(
  request,
  url,
  corsHeaders,
  ctx
) {
  const feedUrl = url.searchParams.get("url") || "";

  if (!isSafeCustomRssUrl(feedUrl)) {
    return customRssJsonResponse(
      corsHeaders,
      400,
      "invalid_url",
      "Invalid or unsafe RSS URL"
    );
  }

  const cache = caches.default;
  const cached = await cache.match(request);
  if (cached) return cached;

  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    10000
  );

  try {
    let { response, finalUrl } =
      await fetchSafeCustomRss(
        feedUrl,
        controller.signal
      );

    if (!response.ok) {
      return customRssUpstreamFailure(response, corsHeaders);
    }

    let read = await readCustomRssResponse(response, corsHeaders);
    if (read.errorResponse) return read.errorResponse;

    let body = read.body;
    let contentType = read.contentType;

    /* If a web page was supplied, use its standard RSS/Atom/JSON autodiscovery link. */
    const looksHtml =
      contentType.includes("text/html") ||
      /<html\b|<!doctype\s+html/i.test(body.slice(0, 20000));

    if (looksHtml) {
      const discovered = discoverCustomFeedUrl(body, finalUrl);

      if (!discovered || discovered === finalUrl) {
        return customRssJsonResponse(
          corsHeaders,
          415,
          "unsupported_format",
          "Address returned HTML and no RSS/Atom/JSON Feed was discovered"
        );
      }

      ({ response, finalUrl } = await fetchSafeCustomRss(
        discovered,
        controller.signal
      ));

      if (!response.ok) {
        return customRssUpstreamFailure(response, corsHeaders);
      }

      read = await readCustomRssResponse(response, corsHeaders);
      if (read.errorResponse) return read.errorResponse;

      body = read.body;
      contentType = read.contentType;
    }

    const parsed = parseCustomFeedBody(
      body,
      contentType,
      finalUrl
    );

    if (!parsed) {
      return customRssJsonResponse(
        corsHeaders,
        415,
        "unsupported_format",
        "Response is not a supported RSS, Atom or JSON Feed"
      );
    }

    if (!parsed.items.length) {
      return customRssJsonResponse(
        corsHeaders,
        422,
        "no_items",
        "Feed contains no usable items",
        {
          source: parsed.source,
          count: 0,
          items: [],
          format: parsed.format || "unknown"
        }
      );
    }

    const output = new Response(
      JSON.stringify({
        ok: true,
        source: parsed.source,
        count: parsed.items.length,
        items: parsed.items,
        format: parsed.format || "unknown"
      }),
      {
        status: 200,
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json; charset=utf-8",
          "Cache-Control": "public, max-age=300"
        }
      }
    );

    safeWaitUntil(
      ctx,
      cache.put(request, output.clone()),
      "response-cache-put"
    );

    return output;
  } catch (error) {
    console.warn(
      "Custom RSS error:",
      feedUrl,
      error
    );

    if (
      error?.name === "AbortError" ||
      controller.signal.aborted
    ) {
      return customRssJsonResponse(
        corsHeaders,
        504,
        "timeout",
        "RSS source timed out"
      );
    }

    const code = String(error?.code || "");

    if (code === "too_many_redirects") {
      return customRssJsonResponse(
        corsHeaders,
        502,
        code,
        "RSS source redirected too many times"
      );
    }

    if (code === "unsafe_redirect" || code === "unsafe_url") {
      return customRssJsonResponse(
        corsHeaders,
        400,
        code,
        "RSS redirect was blocked by the security policy"
      );
    }

    return customRssJsonResponse(
      corsHeaders,
      502,
      "network_error",
      "RSS source could not be reached"
    );
  } finally {
    clearTimeout(timeout);
  }
}



function isSputnikTurkeyArticleUrl(value = "") {
  try {
    const host = new URL(String(value || "")).hostname.toLowerCase();

    return (
      host === "anlatilaninotesi.com.tr" ||
      host.endsWith(".anlatilaninotesi.com.tr") ||
      host === "tr.sputniknews.com"
    );
  } catch {
    return false;
  }
}

function extractSputnikArticleImageFromHtml(html = "", baseUrl = "") {
  const source = String(html || "");
  const candidates = new Map();
  let order = 0;

  const add = (raw = "", bonus = 0) => {
    raw = String(raw || "").replaceAll("\\/", "/");
    const absolute = absoluteUrl(raw, baseUrl);
    if (!absolute) return;

    let parsed;
    try {
      parsed = new URL(absolute);
    } catch {
      return;
    }

    if (
      parsed.hostname.toLowerCase() !==
      "cdn.img.anlatilaninotesi.com.tr"
    ) {
      return;
    }

    /*
      Yazılı sosyal kartlar /images/sharing/... altında; gerçek makale
      fotoğrafları /img/... altında. Sosyal kartı burada kesin olarak dışla.
    */
    if (!/\/img\//i.test(parsed.pathname)) return;

    const value = parsed.href;

    if (
      /(?:logo|sprite|avatar|icon|placeholder|banner|promo|advert|reklam)/i
        .test(value)
    ) {
      return;
    }

    let score = bonus - order++;

    if (/_1920x0_/i.test(value)) score += 500;
    else if (/_(?:1600|1440|1280)x0_/i.test(value)) score += 350;
    else if (/_(?:960|1024)x0_/i.test(value)) score += 180;

    const previous = candidates.get(value);

    if (previous === undefined || score > previous) {
      candidates.set(value, score);
    }
  };

  const scan = (fragment = "", bonus = 0) => {
    for (
      const tag of
      fragment.match(/<(?:img|source|link)\b[^>]*>/gi) || []
    ) {
      for (
        const attr of [
          "src",
          "data-src",
          "data-lazy-src",
          "data-original",
          "data-image",
          "data-url",
          "href"
        ]
      ) {
        const value = htmlAttr(tag, attr);
        if (value) add(value, bonus);
      }

      for (
        const attr of [
          "srcset",
          "data-srcset",
          "data-lazy-srcset"
        ]
      ) {
        const value = htmlAttr(tag, attr);
        if (!value) continue;

        for (const part of value.split(",")) {
          add(
            part.trim().split(/\s+/)[0] || "",
            bonus
          );
        }
      }
    }

    const rawUrlRe =
      /https?:\\?\/\\?\/cdn\.img\.anlatilaninotesi\.com\.tr\\?\/img\\?\/[^"' <>{}\s]+/gi;

    let match;

    while ((match = rawUrlRe.exec(fragment))) {
      add(match[0], bonus);
    }
  };

  for (
    const article of
    source.match(
      /<article\b[^>]*>[\s\S]*?<\/article>/gi
    ) || []
  ) {
    scan(article, 1200);
  }

  for (
    const figure of
    source.match(
      /<figure\b[^>]*>[\s\S]*?<\/figure>/gi
    ) || []
  ) {
    scan(figure, 900);
  }

  scan(source, 100);

  return [...candidates.entries()]
    .sort((a, b) => b[1] - a[1])[0]?.[0] || "";
}

function extractArticleImageFromHtml(html = "", baseUrl = "") {
  if (isSputnikTurkeyArticleUrl(baseUrl)) {
    const cleanSputnikImage =
      extractSputnikArticleImageFromHtml(
        html,
        baseUrl
      );

    if (cleanSputnikImage) {
      return cleanSputnikImage;
    }
  }

  const candidates = [];

  const add = (value = "") => {
    const absolute = absoluteUrl(value, baseUrl);
    if (!absolute || !/^https?:\/\//i.test(absolute)) return;
    if (!candidates.includes(absolute)) candidates.push(absolute);
  };

  // Open Graph / Twitter / schema meta images.
  const metaTags = html.match(/<meta\b[^>]*>/gi) || [];

  for (const tag of metaTags) {
    const key = (
      htmlAttr(tag, "property") ||
      htmlAttr(tag, "name") ||
      htmlAttr(tag, "itemprop")
    ).toLowerCase();

    const content = htmlAttr(tag, "content");
    if (!content) continue;

    if (
      key === "og:image" ||
      key === "og:image:url" ||
      key === "og:image:secure_url" ||
      key === "twitter:image" ||
      key === "twitter:image:src" ||
      key === "image" ||
      key === "thumbnailurl"
    ) {
      add(content);
    }
  }

  // Some publishers expose the canonical preview image via link rel=image_src.
  for (const tag of html.match(/<link\b[^>]*>/gi) || []) {
    const rel = htmlAttr(tag, "rel").toLowerCase();
    if (rel === "image_src" || rel === "preload") {
      const as = htmlAttr(tag, "as").toLowerCase();

      if (rel === "image_src" || as === "image") {
        add(htmlAttr(tag, "href"));
      }
    }
  }

  // JSON-LD often contains the lead image even when RSS media URLs are stale.
  const scripts =
    html.match(
      /<script\b[^>]*type=["']application\/ld\+json["'][^>]*>[\s\S]*?<\/script>/gi
    ) || [];

  for (const script of scripts) {
    const body = script
      .replace(/^<script\b[^>]*>/i, "")
      .replace(/<\/script>$/i, "")
      .trim();

    if (!body) continue;

    try {
      const parsed = JSON.parse(body);

      const visit = value => {
        if (!value) return;

        if (typeof value === "string") return;

        if (Array.isArray(value)) {
          value.forEach(visit);
          return;
        }

        if (typeof value !== "object") return;

        const image = value.image;

        if (typeof image === "string") {
          add(image);
        } else if (Array.isArray(image)) {
          image.forEach(entry => {
            if (typeof entry === "string") add(entry);
            else if (entry && typeof entry === "object") {
              add(entry.url || entry.contentUrl || "");
            }
          });
        } else if (image && typeof image === "object") {
          add(image.url || image.contentUrl || "");
        }

        add(value.thumbnailUrl || "");

        for (const child of Object.values(value)) {
          if (child && typeof child === "object") visit(child);
        }
      };

      visit(parsed);
    } catch {
      // Invalid JSON-LD should never block the rest of the page.
    }
  }

  return candidates[0] || "";
}

async function resolveArticleImageUrl(articleUrl = "") {
  if (!articleUrl || !isSafeArticleUrl(articleUrl)) return "";

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 9000);

  try {
    const response = await fetch(articleUrl, {
      signal: controller.signal,
      redirect: "follow",
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) " +
          "AppleWebKit/537.36 (KHTML, like Gecko) " +
          "Chrome/139.0.0.0 Safari/537.36",
        "Accept":
          "text/html,application/xhtml+xml;q=0.9,*/*;q=0.8",
        "Accept-Language":"en-US,en;q=0.9"
      }
    });

    if (!response.ok) return "";

    const type =
      (response.headers.get("Content-Type") || "").toLowerCase();

    if (!type.includes("text/html")) return "";

    const length =
      Number(response.headers.get("Content-Length") || 0);

    if (length && length > 4_000_000) return "";

    const html = await readResponseTextLimited(
      response,
      MAX_ARTICLE_HTML_CHARS
    );

    return extractArticleImageFromHtml(
      html,
      response.url || articleUrl
    );
  } catch (error) {
    console.warn(
      "Article image resolve error:",
      articleUrl,
      error
    );
    return "";
  } finally {
    clearTimeout(timeout);
  }
}


function losAngelesTimesOriginImage(value = "") {
  try {
    const transformed = new URL(value);

    if (
      transformed.hostname.toLowerCase() !==
      "ca-times.brightspotcdn.com"
    ) {
      return "";
    }

    let nested = transformed.searchParams.get("url") || "";
    if (!nested) return "";

    /*
      URLSearchParams normally decodes this already. Handle a possible
      second layer of percent-encoding defensively.
    */
    for (let i = 0; i < 2; i++) {
      try {
        const candidate = new URL(nested);

        if (
          candidate.hostname.toLowerCase() ===
          "california-times-brightspot.s3.amazonaws.com"
        ) {
          return candidate.href;
        }

        return "";
      } catch {
        try {
          const decoded = decodeURIComponent(nested);
          if (decoded === nested) return "";
          nested = decoded;
        } catch {
          return "";
        }
      }
    }

    return "";
  } catch {
    return "";
  }
}

async function proxyImage(
  request,
  url,
  corsHeaders,
  ctx
) {
  const target = url.searchParams.get("url") || "";
  const requestedRef = url.searchParams.get("ref") || "";

  if (!isSafeArticleUrl(target)) {
    return new Response("Invalid image URL", {
      status: 400,
      headers: {
        ...corsHeaders,
        "Content-Type": "text/plain; charset=utf-8",
        "Cache-Control": "no-store"
      }
    });
  }

  const safeRef =
    requestedRef && isSafeArticleUrl(requestedRef)
      ? requestedRef
      : "";

  const preferArticle =
    url.searchParams.get("preferArticle") === "1";

  const cache = caches.default;
const cached = await cache.match(request);
  if (cached) return cached;

  const browserHeaders = {
    "User-Agent":
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) " +
      "AppleWebKit/537.36 (KHTML, like Gecko) " +
      "Chrome/139.0.0.0 Safari/537.36",
    "Accept":
      "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8",
    "Accept-Language":"en-US,en;q=0.9"
  };

  async function fetchImage(
    imageUrl,
    extraHeaders = {}
  ) {
    if (!imageUrl || !isSafeArticleUrl(imageUrl)) return null;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 9000);

    try {
      return await fetch(imageUrl, {
        signal: controller.signal,
        redirect: "follow",
        headers: {
          ...browserHeaders,
          ...extraHeaders
        }
      });
    } finally {
      clearTimeout(timeout);
    }
  }

  function validImageResponse(response) {
    if (!response?.ok) return false;

    const type =
      (response.headers.get("Content-Type") || "").toLowerCase();

    return type.startsWith("image/");
  }

  async function tryImageVariants(imageUrl) {
    if (!imageUrl) return null;

    /*
      Los Angeles Times uses Brightspot "dims4" transformer URLs whose
      ?url= parameter points to the original California Times S3 object.
      The transformer is the part that can reject proxy/hotlink requests,
      while the origin object is the actual image. Prefer the origin when
      we can identify it safely.
    */
    const laOrigin =
      losAngelesTimesOriginImage(imageUrl);

    if (laOrigin) {
      let originResponse = safeRef
        ? await fetchImage(
            laOrigin,
            { "Referer": safeRef }
          )
        : null;

      if (!validImageResponse(originResponse)) {
        originResponse = await fetchImage(laOrigin);
      }

      if (validImageResponse(originResponse)) {
        return originResponse;
      }
    }

    let response = safeRef
      ? await fetchImage(
          imageUrl,
          { "Referer": safeRef }
        )
      : null;

    if (!validImageResponse(response)) {
      response = await fetchImage(imageUrl);
    }

    return validImageResponse(response)
      ? response
      : null;
  }

  try {
    /*
      v31.19.0 — High-resolution source preference.
      Halk TV / Aydınlık and any image detected as too small by the frontend
      can request the article's canonical OG/Twitter/JSON-LD image first.
    */
    let response = null;

    if (preferArticle && safeRef) {
      const articleImage =
        await resolveArticleImageUrl(safeRef);

      if (articleImage) {
        response =
          await tryImageVariants(articleImage);
      }
    }

    /* If article-first did not produce a usable image, keep the RSS image. */
    if (!validImageResponse(response)) {
      response =
        await tryImageVariants(target);
    }

    /* Preserve the old fallback behavior for ordinary requests. */
    if (
      !validImageResponse(response) &&
      safeRef &&
      !preferArticle
    ) {
      const articleImage =
        await resolveArticleImageUrl(safeRef);

      if (
        articleImage &&
        articleImage !== target
      ) {
        response =
          await tryImageVariants(articleImage);
      }
    }

    if (!validImageResponse(response)) {
      return new Response("Image fetch failed", {
        status: 502,
        headers: {
          ...corsHeaders,
          "Content-Type": "text/plain; charset=utf-8",
          "Cache-Control": "no-store"
        }
      });
    }

    const type =
      response.headers.get("Content-Type") || "image/jpeg";

    const output = new Response(response.body, {
      status: 200,
      headers: {
        ...corsHeaders,
        "Content-Type": type,
        "Cache-Control": "public, max-age=21600",
        "X-Floew-Image-Proxy":"origin-aware"
      }
    });

    safeWaitUntil(
      ctx,
      cache.put(request, output.clone()),
      "response-cache-put"
    );

    return output;
  } catch (error) {
    console.warn("Image proxy error:", target, error);

    return new Response("Image proxy error", {
      status: 502,
      headers: {
        ...corsHeaders,
        "Content-Type": "text/plain; charset=utf-8",
        "Cache-Control": "no-store"
      }
    });
  }
}


function escapeSourceHtmlAttr(value = "") {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function sourceViewerDocument(html = "", finalUrl = "") {
  const safeBase = escapeSourceHtmlAttr(finalUrl);
  const originalJson = JSON.stringify(finalUrl || "")
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/&/g, "\\u0026");

  let output = String(html || "").slice(0, 5_000_000);

  /* Read-only snapshot: third-party scripts/frames are intentionally removed. */
  output = output
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<iframe\b[^>]*>[\s\S]*?<\/iframe>/gi, "")
    .replace(/<object\b[^>]*>[\s\S]*?<\/object>/gi, "")
    .replace(/<embed\b[^>]*>/gi, "")
    .replace(/<base\b[^>]*>/gi, "")
    .replace(/<meta\b[^>]*http-equiv=["']?Content-Security-Policy["']?[^>]*>/gi, "")
    .replace(/<meta\b[^>]*http-equiv=["']?refresh["']?[^>]*>/gi, "")
    .replace(/\s+on[a-z]+\s*=\s*(["'])[\s\S]*?\1/gi, "")
    .replace(/\s+target\s*=\s*(["'])(?:_top|_parent)\1/gi, "");

  const injected = `
    <base href="${safeBase}">
    <meta name="viewport" content="width=device-width,initial-scale=1">
    <style id="floew-source-viewer-style">
      html{min-height:100%;background:#fff!important;color-scheme:light!important}
      body{min-height:100%;margin-top:0!important}
      img,video{max-width:100%}
    </style>
    <script>
      (()=>{
        const ORIGINAL=${originalJson};

        const normalizeLazyImages=()=>{
          document.querySelectorAll('img').forEach(img=>{
            if(img.getAttribute('src'))return;
            const lazy=
              img.getAttribute('data-src') ||
              img.getAttribute('data-lazy-src') ||
              img.getAttribute('data-original') ||
              img.getAttribute('data-url');
            if(lazy)img.setAttribute('src',lazy);
          });
        };

        document.addEventListener('click',event=>{
          const anchor=event.target?.closest?.('a[href]');
          if(!anchor)return;

          let href='';
          try{href=new URL(anchor.getAttribute('href'),document.baseURI).href}catch(_){return}
          if(!/^https?:\/\//i.test(href))return;

          event.preventDefault();
          event.stopPropagation();
          parent.postMessage({type:'floew-source-nav',url:href},'*');
        },true);

        document.addEventListener('submit',event=>{
          event.preventDefault();
          event.stopPropagation();
        },true);

        document.addEventListener('DOMContentLoaded',normalizeLazyImages,{once:true});
        normalizeLazyImages();
      })();
    <\/script>
  `;

  if (/<head\b[^>]*>/i.test(output)) {
    output = output.replace(/<head\b[^>]*>/i, match => match + injected);
  } else if (/<html\b[^>]*>/i.test(output)) {
    output = output.replace(/<html\b[^>]*>/i, match => match + `<head>${injected}</head>`);
  } else {
    output = `<!doctype html><html><head>${injected}</head><body>${output}</body></html>`;
  }

  return output;
}

async function fetchSafeSourcePage(articleUrl) {
  let current = articleUrl;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12000);

  try {
    for (let hop = 0; hop < 6; hop++) {
      if (!isSafeArticleUrl(current)) {
        throw new Error("Unsafe source URL");
      }

      const response = await fetch(current, {
        signal: controller.signal,
        redirect: "manual",
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
            "(KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36",
          "Accept":
            "text/html,application/xhtml+xml;q=0.9,*/*;q=0.7",
          "Accept-Language": "tr-TR,tr;q=0.9,en;q=0.6"
        }
      });

      if (
        response.status >= 300 &&
        response.status < 400
      ) {
        const location = response.headers.get("Location") || "";
        if (!location) return response;

        const next = new URL(location, current).href;
        if (!isSafeArticleUrl(next)) {
          throw new Error("Unsafe source redirect");
        }

        current = next;
        continue;
      }

      return response;
    }

    throw new Error("Too many source redirects");
  } finally {
    clearTimeout(timeout);
  }
}

async function proxyArticleSource(
  request,
  url,
  corsHeaders
) {
  const articleUrl = url.searchParams.get("url") || "";

  if (!isSafeArticleUrl(articleUrl)) {
    return new Response(
      "Geçersiz kaynak adresi.",
      {
        status: 400,
        headers: {
          ...corsHeaders,
          "Content-Type": "text/plain; charset=utf-8",
          "Cache-Control": "no-store"
        }
      }
    );
  }

  try {
    const response = await fetchSafeSourcePage(articleUrl);

    if (!response?.ok) {
      return new Response(
        `Kaynak yüklenemedi (${response?.status || 502}).`,
        {
          status: 502,
          headers: {
            ...corsHeaders,
            "Content-Type": "text/plain; charset=utf-8",
            "Cache-Control": "no-store"
          }
        }
      );
    }

    const type = (response.headers.get("Content-Type") || "").toLowerCase();
    const length = Number(response.headers.get("Content-Length") || 0);

    if (
      !type.includes("text/html") ||
      (length && length > 5_000_000)
    ) {
      return new Response(
        "Bu kaynak Flöw içi görünümde gösterilemiyor.",
        {
          status: 415,
          headers: {
            ...corsHeaders,
            "Content-Type": "text/plain; charset=utf-8",
            "Cache-Control": "no-store"
          }
        }
      );
    }

    const html = await response.text();
    const finalUrl = response.url || articleUrl;
    const documentHtml = sourceViewerDocument(html, finalUrl);

    return new Response(documentHtml, {
      status: 200,
      headers: {
        ...corsHeaders,
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "public, max-age=120, stale-while-revalidate=300",
        "Cross-Origin-Resource-Policy": "cross-origin",
        "Referrer-Policy": "no-referrer",
        "X-Content-Type-Options": "nosniff",
        "Content-Security-Policy":
          "default-src https: data: blob:; " +
          "img-src https: data: blob:; " +
          "style-src https: 'unsafe-inline'; " +
          "font-src https: data:; " +
          "media-src https: blob:; " +
          "script-src 'unsafe-inline'; " +
          "connect-src 'none'; " +
          "frame-src 'none'; object-src 'none'; " +
          "form-action 'none'; base-uri *; frame-ancestors *"
      }
    });
  } catch (error) {
    console.warn("Source viewer error:", articleUrl, error);

    return new Response(
      "Kaynak şu anda Flöw içinde görüntülenemiyor.",
      {
        status: 502,
        headers: {
          ...corsHeaders,
          "Content-Type": "text/plain; charset=utf-8",
          "Cache-Control": "no-store"
        }
      }
    );
  }
}


/* --------------------------------------------------------------------------
   v31.79 diagnostic — NTV / Halk TV end-to-end video reachability probe
   This endpoint does not change normal /video selection logic. It repeats the
   production resolver without cache, then probes the selected media URL so we
   can distinguish "resolver could not find it" from "browser cannot play it".
   -------------------------------------------------------------------------- */

const DEBUG_MEDIA_MAX_TEXT = 360_000;

function debugTrimUrl(value = "") {
  if (!value) return "";
  try {
    const u = new URL(value);
    return (u.origin + u.pathname + u.search).slice(0, 1800);
  } catch {
    return String(value).replace(/[\r\n\t]+/g, " ").slice(0, 1800);
  }
}

function debugPickHeaders(headers) {
  if (!headers) return {};
  const get = name => headers.get(name) || "";
  return {
    contentType: get("Content-Type"),
    contentLength: get("Content-Length"),
    contentRange: get("Content-Range"),
    acceptRanges: get("Accept-Ranges"),
    location: get("Location"),
    accessControlAllowOrigin: get("Access-Control-Allow-Origin"),
    accessControlAllowCredentials: get("Access-Control-Allow-Credentials"),
    xFrameOptions: get("X-Frame-Options"),
    contentSecurityPolicy: get("Content-Security-Policy"),
    crossOriginResourcePolicy: get("Cross-Origin-Resource-Policy"),
    cacheControl: get("Cache-Control"),
    server: get("Server"),
    via: get("Via")
  };
}

async function debugReadTextLimited(response, maxBytes = DEBUG_MEDIA_MAX_TEXT) {
  if (!response?.body) {
    const text = await response.text();
    return { text: text.slice(0, maxBytes), bytesRead: Math.min(text.length, maxBytes), truncated: text.length > maxBytes };
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let text = "";
  let bytesRead = 0;
  let truncated = false;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      const remaining = maxBytes - bytesRead;
      if (remaining <= 0) {
        truncated = true;
        break;
      }
      const chunk = value.byteLength > remaining ? value.slice(0, remaining) : value;
      bytesRead += chunk.byteLength;
      text += decoder.decode(chunk, { stream: true });
      if (value.byteLength > remaining) {
        truncated = true;
        break;
      }
    }
  } finally {
    try { await reader.cancel(); } catch {}
  }

  text += decoder.decode();
  return { text, bytesRead, truncated };
}

async function debugReadBytesLimited(response, maxBytes = 32768) {
  if (!response?.body) return { bytesRead: 0 };
  const reader = response.body.getReader();
  let bytesRead = 0;
  try {
    while (bytesRead < maxBytes) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      bytesRead += Math.min(value.byteLength, maxBytes - bytesRead);
      if (bytesRead >= maxBytes) break;
    }
  } finally {
    try { await reader.cancel(); } catch {}
  }
  return { bytesRead };
}

function debugHtmlMarkersV3179(html = "") {
  const lower = String(html || "").toLowerCase();
  const count = regex => (lower.match(regex) || []).length;
  return {
    htmlChars: String(html || "").length,
    videoTags: count(/<video\b/g),
    sourceTags: count(/<source\b/g),
    iframes: count(/<iframe\b/g),
    youtube: count(/youtube(?:-nocookie)?\.com|youtu\.be/g),
    xTwitterStatus: count(/(?:twitter\.com|x\.com)\/[a-z0-9_]+\/status(?:es)?\/\d+/g),
    mp4: count(/\.mp4(?:[?#"'\\]|$)/g),
    m3u8: count(/\.m3u8(?:[?#"'\\]|$)/g),
    nextFlight: count(/__next_f/g),
    videoObject: count(/videoobject/g),
    contentUrl: count(/contenturl/g),
    embedUrl: count(/embedurl/g),
    ogVideo: count(/og:video/g),
    twitterPlayer: count(/twitter:player/g)
  };
}

function debugNtvCandidatesV3179(html, finalUrl, title) {
  try {
    return (extractNtvNextVideoCandidates(html, finalUrl, title) || [])
      .slice(0, 12)
      .map(item => ({
        url: debugTrimUrl(item?.url || ""),
        type: item?.type || "",
        source: item?.source || "",
        key: item?.key || "",
        score: Number(item?.score || 0),
        slideMatched: Boolean(item?.slideMatched),
        contentMatched: Boolean(item?.contentMatched),
        titleCommon: Number(item?.titleCommon || 0),
        titleScore: Number(item?.titleScore || 0)
      }));
  } catch (error) {
    return [{ error: String(error?.message || error).slice(0, 300) }];
  }
}

function debugHalkCandidatesV3179(html, finalUrl, title) {
  const result = { youtube: [], x: [] };
  try {
    result.youtube = (extractHalkTvYouTubeCandidates(html, finalUrl, title) || [])
      .slice(0, 12)
      .map(item => ({
        id: item?.id || "",
        url: debugTrimUrl(item?.media?.url || ""),
        score: Number(item?.score || 0),
        source: item?.source || "",
        relationCommon: Number(item?.relation?.common || 0),
        relationScore: Number(item?.relation?.score || 0)
      }));
  } catch (error) {
    result.youtube = [{ error: String(error?.message || error).slice(0, 300) }];
  }
  try {
    result.x = (collectHalkTvXStatusCandidates(html, title) || [])
      .slice(0, 12)
      .map(item => ({
        id: item?.id || "",
        score: Number(item?.score || 0),
        source: item?.source || ""
      }));
  } catch (error) {
    result.x = [{ error: String(error?.message || error).slice(0, 300) }];
  }
  return result;
}

async function debugResolveVideoNoCache(articleUrl, expectedTitle) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 11800);
  const result = {
    article: {
      requestUrl: debugTrimUrl(articleUrl),
      status: 0,
      ok: false,
      finalUrl: "",
      headers: {},
      bytesRead: 0,
      truncated: false,
      markers: null
    },
    hostClass: { ntv: false, halktv: false, cumhuriyet: false },
    candidates: { ntv: [], halktv: { youtube: [], x: [] } },
    resolutionPath: [],
    media: null,
    error: ""
  };

  try {
    const response = await fetch(articleUrl, {
      signal: controller.signal,
      redirect: "follow",
      headers: {
        "User-Agent": "The-Floew-News-Wall/3.2",
        "Accept": "text/html,application/xhtml+xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "tr-TR,tr;q=0.9,en;q=0.6"
      }
    });

    result.article.status = response.status;
    result.article.ok = response.ok;
    result.article.finalUrl = debugTrimUrl(response.url || articleUrl);
    result.article.headers = debugPickHeaders(response.headers);

    if (!response.ok) {
      result.error = `article-http-${response.status}`;
      return result;
    }

    const contentType = response.headers.get("Content-Type") || "";
    const length = Number(response.headers.get("Content-Length") || 0);
    if (!contentType.toLowerCase().includes("text/html")) {
      result.error = `article-not-html:${contentType}`;
      return result;
    }
    if (length && length > 4_000_000) {
      result.error = `article-content-length-too-large:${length}`;
      return result;
    }

    const read = await debugReadTextLimited(response, 4_000_000);
    result.article.bytesRead = read.bytesRead;
    result.article.truncated = read.truncated;
    const html = read.text || "";
    result.article.markers = debugHtmlMarkersV3179(html);
    const finalUrl = response.url || articleUrl;

    let host = "";
    try { host = new URL(finalUrl).hostname.toLowerCase(); } catch {}
    result.hostClass.ntv = host === "ntv.com.tr" || host === "www.ntv.com.tr";
    result.hostClass.halktv = isHalkTvArticleUrl(finalUrl);
    result.hostClass.cumhuriyet = isCumhuriyetArticleUrl(finalUrl);

    if (result.hostClass.ntv) {
      result.candidates.ntv = debugNtvCandidatesV3179(html, finalUrl, expectedTitle);
    }
    if (result.hostClass.halktv) {
      result.candidates.halktv = debugHalkCandidatesV3179(html, finalUrl, expectedTitle);
    }

    let media = null;

    if (result.hostClass.cumhuriyet) {
      result.resolutionPath.push("cumhuriyet-dailymotion");
      media = await resolveCumhuriyetDailymotionVideo(
        html,
        finalUrl,
        expectedTitle,
        controller.signal
      );
    }

    if (!media && result.hostClass.halktv) {
      result.resolutionPath.push("halktv-youtube");
      media = resolveHalkTvYouTubeVideo(html, finalUrl, expectedTitle);
      if (!media) {
        result.resolutionPath.push("halktv-x");
        media = await resolveArticleXVideo(
          html,
          finalUrl,
          expectedTitle,
          controller.signal
        );
      }
      if (!media) {
        result.resolutionPath.push("halktv-own-player");
        media = await resolveHalkTvOwnedPlayer(
          html,
          finalUrl,
          expectedTitle,
          controller.signal
        );
      }
    }

    if (!media) {
      result.resolutionPath.push("article-x");
      media = await resolveArticleXVideo(
        html,
        finalUrl,
        expectedTitle,
        controller.signal
      );
    }

    if (media) {
      result.resolutionPath.push("shared-media-validation");
      media = await validateResolvedMediaCandidate(
        media,
        finalUrl,
        expectedTitle,
        controller.signal,
        0
      );
    }

    if (!media) {
      result.resolutionPath.push("generic-html-resolver+validation");
      media = await resolveGenericVideoValidated(
        html,
        finalUrl,
        expectedTitle,
        null,
        controller.signal
      );
    }

    result.media = media ? {
      kind: media.kind || "",
      provider: media.provider || "",
      source: media.source || "",
      type: media.type || "",
      url: debugTrimUrl(media.url || ""),
      confidence: Number(media.confidence || 0)
    } : null;
  } catch (error) {
    result.error = String(error?.name ? `${error.name}: ${error.message || ""}` : error).slice(0, 600);
  } finally {
    clearTimeout(timeout);
  }

  return result;
}

function debugPlaylistUris(text = "") {
  return String(text || "")
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(line => line && !line.startsWith("#"))
    .slice(0, 8);
}

async function debugFetchMediaOnce(mediaUrl, articleUrl, mode, options = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 9000);
  const headers = {
    "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.0.0 Safari/537.36",
    "Accept": options.accept || "*/*"
  };

  if (mode === "source-referer") {
    headers["Referer"] = articleUrl;
  }
  if (mode === "range") {
    headers["Range"] = "bytes=0-32767";
  }

  const output = {
    mode,
    requestUrl: debugTrimUrl(mediaUrl),
    status: 0,
    ok: false,
    finalUrl: "",
    redirected: false,
    headers: {},
    bytesRead: 0,
    error: ""
  };

  try {
    const response = await fetch(mediaUrl, {
      signal: controller.signal,
      redirect: "follow",
      headers
    });
    output.status = response.status;
    output.ok = response.ok;
    output.finalUrl = debugTrimUrl(response.url || mediaUrl);
    output.redirected = response.redirected;
    output.headers = debugPickHeaders(response.headers);

    if (options.text) {
      const read = await debugReadTextLimited(response, options.maxBytes || DEBUG_MEDIA_MAX_TEXT);
      output.bytesRead = read.bytesRead;
      output.text = read.text;
      output.truncated = read.truncated;
    } else {
      const read = await debugReadBytesLimited(response, options.maxBytes || 32768);
      output.bytesRead = read.bytesRead;
    }
  } catch (error) {
    output.error = String(error?.name ? `${error.name}: ${error.message || ""}` : error).slice(0, 500);
  } finally {
    clearTimeout(timeout);
  }

  return output;
}

async function debugProbeHls(mediaUrl, articleUrl) {
  const manifestModes = await Promise.all([
    debugFetchMediaOnce(mediaUrl, articleUrl, "no-referer", {
      accept: "application/vnd.apple.mpegurl,application/x-mpegURL,*/*",
      text: true,
      maxBytes: 360_000
    }),
    debugFetchMediaOnce(mediaUrl, articleUrl, "source-referer", {
      accept: "application/vnd.apple.mpegurl,application/x-mpegURL,*/*",
      text: true,
      maxBytes: 360_000
    })
  ]);

  const preferred = manifestModes.find(row => row.ok && /#EXTM3U/i.test(row.text || "")) || manifestModes.find(row => row.ok) || manifestModes[0];
  const text = preferred?.text || "";
  const uris = debugPlaylistUris(text);
  const playlist = {
    isExtM3u: /#EXTM3U/i.test(text),
    masterVariants: (text.match(/#EXT-X-STREAM-INF/gi) || []).length,
    mediaSegments: (text.match(/#EXTINF/gi) || []).length,
    firstUris: uris.map(uri => {
      try { return debugTrimUrl(new URL(uri, preferred.finalUrl || mediaUrl).toString()); }
      catch { return String(uri).slice(0, 600); }
    })
  };

  let childProbe = null;
  let segmentProbe = null;

  if (uris.length) {
    let firstUrl = "";
    try { firstUrl = new URL(uris[0], preferred.finalUrl || mediaUrl).toString(); } catch {}

    if (firstUrl) {
      const looksChildPlaylist = /\.m3u8(?:[?#]|$)/i.test(firstUrl) || playlist.masterVariants > 0;
      if (looksChildPlaylist) {
        childProbe = await debugFetchMediaOnce(firstUrl, articleUrl, "source-referer", {
          accept: "application/vnd.apple.mpegurl,application/x-mpegURL,*/*",
          text: true,
          maxBytes: 300_000
        });
        const childUris = debugPlaylistUris(childProbe.text || "");
        childProbe.playlist = {
          isExtM3u: /#EXTM3U/i.test(childProbe.text || ""),
          mediaSegments: ((childProbe.text || "").match(/#EXTINF/gi) || []).length,
          firstUris: childUris.slice(0, 5).map(uri => {
            try { return debugTrimUrl(new URL(uri, childProbe.finalUrl || firstUrl).toString()); }
            catch { return String(uri).slice(0, 600); }
          })
        };
        delete childProbe.text;

        if (childUris.length) {
          let segmentUrl = "";
          try { segmentUrl = new URL(childUris[0], childProbe.finalUrl || firstUrl).toString(); } catch {}
          if (segmentUrl) {
            segmentProbe = await debugFetchMediaOnce(segmentUrl, articleUrl, "range", {
              accept: "video/mp2t,video/*,application/octet-stream,*/*",
              maxBytes: 32768
            });
          }
        }
      } else {
        segmentProbe = await debugFetchMediaOnce(firstUrl, articleUrl, "range", {
          accept: "video/mp2t,video/*,application/octet-stream,*/*",
          maxBytes: 32768
        });
      }
    }
  }

  for (const row of manifestModes) delete row.text;

  return { kind: "hls", manifests: manifestModes, playlist, childProbe, segmentProbe };
}

async function debugProbeResolvedMedia(media, articleUrl) {
  if (!media?.url) return { present: false };

  const knownEmbed = normalizeKnownEmbed(media.url);
  if (media.kind === "embed" || knownEmbed) {
    const probe = await debugFetchMediaOnce(media.url, articleUrl, "no-referer", {
      accept: "text/html,application/xhtml+xml;q=0.9,*/*;q=0.8",
      maxBytes: 16384
    });
    return {
      present: true,
      playbackMode: "embed",
      provider: media.provider || knownEmbed?.provider || "",
      probe
    };
  }

  const isHls = /mpegurl|m3u8/i.test(`${media.type || ""} ${media.url || ""}`);
  if (isHls) {
    return {
      present: true,
      playbackMode: "hls",
      ...(await debugProbeHls(media.url, articleUrl))
    };
  }

  const direct = await Promise.all([
    debugFetchMediaOnce(media.url, articleUrl, "range", {
      accept: "video/*,application/octet-stream,*/*",
      maxBytes: 32768
    }),
    debugFetchMediaOnce(media.url, articleUrl, "source-referer", {
      accept: "video/*,application/octet-stream,*/*",
      maxBytes: 32768
    })
  ]);

  return { present: true, playbackMode: "native", probes: direct };
}

function debugBuildDiagnosis(resolution, playback) {
  const diagnosis = [];
  if (!resolution?.article?.ok) diagnosis.push("article-fetch-failed");
  if (resolution?.article?.truncated) diagnosis.push("article-html-truncated");
  if (!resolution?.media) {
    diagnosis.push("resolver-returned-no-media");
    if (resolution?.hostClass?.ntv && (resolution?.article?.markers?.mp4 || resolution?.article?.markers?.m3u8)) {
      diagnosis.push("ntv-html-contains-media-markers-but-resolver-selected-none");
    }
    if (resolution?.hostClass?.halktv && !resolution?.candidates?.halktv?.youtube?.length && !resolution?.candidates?.halktv?.x?.length) {
      diagnosis.push("halktv-static-html-has-no-source-specific-youtube-or-x-candidate");
    }
    return diagnosis;
  }

  diagnosis.push(`resolver-selected:${resolution.media.source || resolution.media.provider || "unknown"}`);

  if (playback?.playbackMode === "embed") {
    if (!playback.probe?.ok) diagnosis.push("embed-url-fetch-failed");
    else diagnosis.push("embed-url-is-reachable");

    if (resolution?.media?.provider === "halktv") {
      diagnosis.push("halktv-video-embed-correctly-classified-as-iframe");
    }

    const xfo = String(playback.probe?.headers?.xFrameOptions || "").toLowerCase();
    const csp = String(playback.probe?.headers?.contentSecurityPolicy || "").toLowerCase();
    if (/deny|sameorigin/.test(xfo)) {
      diagnosis.push("embed-x-frame-options-may-block-floew-iframe");
    }
    if (/frame-ancestors\s+[^;]*(?:'none'|'self')/.test(csp)) {
      diagnosis.push("embed-csp-frame-ancestors-may-block-floew-iframe");
    }
    return diagnosis;
  }

  if (playback?.playbackMode === "hls") {
    const goodManifest = (playback.manifests || []).find(row => row.ok);
    if (!goodManifest) diagnosis.push("hls-manifest-fetch-failed");
    else {
      diagnosis.push("hls-manifest-is-reachable-from-worker");
      if (!goodManifest.headers?.accessControlAllowOrigin) {
        diagnosis.push("hls-manifest-has-no-cors-header-hlsjs-may-be-blocked");
      }
    }
    if (playback.playlist && !playback.playlist.isExtM3u) diagnosis.push("resolved-url-did-not-return-extm3u");
    if (playback.childProbe && !playback.childProbe.ok) diagnosis.push("hls-child-playlist-fetch-failed");
    if (playback.segmentProbe && !playback.segmentProbe.ok) diagnosis.push("hls-first-segment-fetch-failed");
    if (playback.segmentProbe?.ok) diagnosis.push("hls-first-segment-is-reachable-from-worker");
    return diagnosis;
  }

  const probes = playback?.probes || [];
  const anyOk = probes.some(row => row.ok);
  if (!anyOk) diagnosis.push("native-media-fetch-failed");
  else diagnosis.push("native-media-is-reachable-from-worker");
  const sourceReferer = probes.find(row => row.mode === "source-referer");
  const noRef = probes.find(row => row.mode === "range");
  if (sourceReferer?.ok && noRef && !noRef.ok) diagnosis.push("media-appears-to-require-source-referer-hotlink-protection-likely");
  const contentTypes = probes.map(row => row.headers?.contentType || "").filter(Boolean);
  if (contentTypes.some(type => /text\/html/i.test(type))) diagnosis.push("resolved-media-url-returned-html-not-video");
  return diagnosis;
}

async function debugVideoReachabilityRequest(url, corsHeaders) {
  const articleUrl = url.searchParams.get("url") || "";
  const title = (url.searchParams.get("title") || "").slice(0, 500);

  if (!isSafeArticleUrl(articleUrl)) {
    return new Response(JSON.stringify({ ok: false, error: "Invalid article URL" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" }
    });
  }

  const resolution = await debugResolveVideoNoCache(articleUrl, title);
  const playback = await debugProbeResolvedMedia(resolution.media, articleUrl);
  const diagnosis = debugBuildDiagnosis(resolution, playback);
return new Response(JSON.stringify({
    ok: true,
    workerVersion: WORKER_VERSION,
    resolverVersion: VIDEO_RESOLVER_VERSION,
    articleUrl: debugTrimUrl(articleUrl),
    title,
    resolution,
    playback,
    diagnosis
  }, null, 2), {
    status: 200,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store"
    }
  });
}


function balanceNewsForBatch(news = []) {
  const categories = new Map();

  for (const item of news) {
    const category = item.category || C.LIFE;
    if (!categories.has(category)) categories.set(category, new Map());

    const publicSource = String(item.source || "Bilinmeyen kaynak");
    /*
     * CNN Türk'ün normal haber ve video RSS'leri dengelemede ayrı lane'ler
     * gibi davranır; fakat frontend'e görünen kaynak adı değişmez. Böylece
     * config.js'deki `CNN Türk` filtresi ve logo eşleşmesi bozulmaz.
     */
    const source =
      publicSource === "CNN Türk" && item.videoArticleHint
        ? "CNN Türk Video"
        : publicSource;
    const sourceMap = categories.get(category);
    if (!sourceMap.has(source)) sourceMap.set(source, []);
    sourceMap.get(source).push(item);
  }

  const selected = [];

  for (const sourceMap of categories.values()) {
    /* `news` is already newest-first before this function is called, so each
       source queue inherits that order. Re-sorting every queue repeated Date
       parsing dozens of times on every /news miss. */
    const queues = [...sourceMap.entries()]
      .map(([source, items]) => ({
        source,
        items: items.slice(),
        used: 0
      }))
      .sort((a, b) => {
        const aTime = new Date(a.items[0]?.published).getTime();
        const bTime = new Date(b.items[0]?.published).getTime();
        return (Number.isFinite(bTime) ? bTime : 0) -
               (Number.isFinite(aTime) ? aTime : 0);
      });

    let progress = true;
    while (
      selected.length < news.length &&
      progress
    ) {
      progress = false;

      let categoryCount = 0;
      for (const queue of queues) categoryCount += queue.used;
      if (categoryCount >= NEWS_CATEGORY_BATCH_LIMIT) break;

      for (const queue of queues) {
        if (categoryCount >= NEWS_CATEGORY_BATCH_LIMIT) break;
        if (queue.used >= NEWS_SOURCE_CATEGORY_LIMIT) continue;

        const item = queue.items[queue.used];
        if (!item) continue;

        selected.push(item);
        queue.used++;
        categoryCount++;
        progress = true;
      }
    }
  }

  return selected.sort((a, b) => {
    const aTime = new Date(a.published).getTime();
    const bTime = new Date(b.published).getTime();
    return (Number.isFinite(bTime) ? bTime : 0) -
           (Number.isFinite(aTime) ? aTime : 0);
  });
}



function debugRssItemFieldStats(xml = "", source = {}) {
  const blocks = [
    ...(String(xml).match(/<item[\s\S]*?<\/item>/gi) || []),
    ...(String(xml).match(/<entry[\s\S]*?<\/entry>/gi) || [])
  ];

  const stats = {
    blockCount: blocks.length,
    missingTitle: 0,
    missingLink: 0,
    missingImage: 0,
    missingPublished: 0,
    hasFeedVideo: 0,
    sampleDrops: []
  };

  for (let i = 0; i < blocks.length; i++) {
    const item = blocks[i];
    const title = getTag(item, "title");
    const link = getFeedItemLink(item, source.url || "");
    const image = getEffectiveFeedImage(item, source, link);
    const published = getFirstTag(item, [
      "pubDate", "published", "updated", "dc:date"
    ]);
    const feedVideo = getFeedVideo(item, source.url || "");

    if (!title) stats.missingTitle++;
    if (!link) stats.missingLink++;
    if (!image) stats.missingImage++;
    if (!published) stats.missingPublished++;
    if (feedVideo?.url) stats.hasFeedVideo++;

    if ((!title || !link || !image) && stats.sampleDrops.length < 3) {
      stats.sampleDrops.push({
        index: i,
        title: title || "",
        link: link || "",
        image: image || "",
        reasons: [
          !title ? "missing-title" : "",
          !link ? "missing-link" : "",
          !image ? "missing-image" : ""
        ].filter(Boolean)
      });
    }
  }

  return stats;
}

async function debugRssHealthRequest(url, corsHeaders) {
  const rawBatch = url.searchParams.get("batch");
  const batch = Number.parseInt(rawBatch ?? "", 10);
  const compact = url.searchParams.get("compact") === "1";

  if (!Number.isInteger(batch) || batch < 0 || batch >= NEWS_BATCH_COUNT) {
    return new Response(
      JSON.stringify({
        ok: false,
        error: "Use /debug/rss-health?batch=0 through batch=11",
        batchCount: NEWS_BATCH_COUNT
      }, null, 2),
      {
        status: 400,
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json; charset=utf-8",
          "Cache-Control": "no-store"
        }
      }
    );
  }

  const batchSources = SOURCES
    .map((source, index) => ({ source, index }))
    .filter(({ source, index }) =>
      !source.disabled &&
      index % NEWS_BATCH_COUNT === batch &&
      source.kind !== "video-index"
    );

  async function probe(entry) {
    const { source, index } = entry;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 9000);
    const started = Date.now();

    try {
      const response = await fetch(source.url, {
        signal: controller.signal,
        redirect: "follow",
        headers: {
          "User-Agent": "The-Floew-News-Wall/3.0",
          "Accept": "application/rss+xml, application/atom+xml, application/xml, text/xml, */*",
          "Accept-Language": "tr-TR,tr;q=0.9,en;q=0.6"
        }
      });

      const text = await response.text();
      const markers = {
        rss: /<rss\b/i.test(text),
        feed: /<feed\b/i.test(text),
        rdf: /<rdf:RDF\b/i.test(text),
        itemCount: (text.match(/<item\b/gi) || []).length,
        entryCount: (text.match(/<entry\b/gi) || []).length,
        html: /<!doctype\s+html|<html\b/i.test(text)
      };

      let parsed = [];
      let fieldStats = {
        blockCount: 0, missingTitle: 0, missingLink: 0, missingImage: 0,
        missingPublished: 0, hasFeedVideo: 0, sampleDrops: []
      };
      let parserError = "";

      if (markers.rss || markers.feed || markers.rdf || markers.itemCount || markers.entryCount) {
        try {
          parsed = parseRSS(text, source);
          fieldStats = debugRssItemFieldStats(text, source);
        } catch (error) {
          parserError = String(error?.name || "Error") + ": " + String(error?.message || error || "");
        }
      }

      const rawCount = markers.itemCount + markers.entryCount;
      const parsedCount = parsed.length;
      const expectedCount = Math.min(rawCount, 30);
      const parseRatio = expectedCount > 0
        ? Number((parsedCount / expectedCount).toFixed(3))
        : 0;
      const issues = [];

      if (!response.ok) issues.push(`http-${response.status}`);
      if (response.ok && !(markers.rss || markers.feed || markers.rdf)) issues.push("non-rss-response");
      if (rawCount === 0 && response.ok) issues.push("no-items-in-feed");
      if (rawCount > 0 && parsedCount === 0) issues.push("parser-returned-zero");
      else if (rawCount >= 5 && parseRatio < 0.5) issues.push("low-parse-ratio");
      if (fieldStats.missingImage > 0) issues.push("items-missing-image");
      if (fieldStats.missingLink > 0) issues.push("items-missing-link");
      if (fieldStats.missingTitle > 0) issues.push("items-missing-title");
      if (parserError) issues.push("parser-exception");

      return {
        sourceIndex: index,
        source: source.name,
        feedUrl: source.url,
        fixedCategory: source.fixedCategory || null,
        status: response.status,
        ok: response.ok,
        finalUrl: response.url,
        redirected: response.redirected,
        elapsedMs: Date.now() - started,
        contentType: response.headers.get("content-type") || "",
        bodyChars: text.length,
        markers,
        parsedCount,
        parseRatio,
        fieldStats,
        parsedPreview: parsed.slice(0, 2).map(item => ({
          title: item.title,
          link: item.link,
          image: item.image,
          videoArticleHint: Boolean(item.videoArticleHint)
        })),
        issues,
        parserError
      };
    } catch (error) {
      return {
        sourceIndex: index,
        source: source.name,
        feedUrl: source.url,
        status: 0,
        ok: false,
        elapsedMs: Date.now() - started,
        issues: [error?.name === "AbortError" ? "timeout" : "fetch-exception"],
        error: String(error?.name || "Error") + ": " + String(error?.message || error || "")
      };
    } finally {
      clearTimeout(timeout);
    }
  }

  const feeds = await Promise.all(batchSources.map(probe));
  const suspects = feeds.filter(feed => (feed.issues || []).length > 0);
  const severe = suspects.filter(feed =>
    (feed.issues || []).some(issue =>
      ["parser-returned-zero", "low-parse-ratio", "non-rss-response", "parser-exception", "timeout", "fetch-exception"].includes(issue) || /^http-/.test(issue)
    )
  );

  const bySource = {};
  for (const feed of feeds) {
    const key = feed.source || "unknown";
    if (!bySource[key]) bySource[key] = { feeds: 0, rawItems: 0, parsedItems: 0, severeFeeds: 0 };
    bySource[key].feeds++;
    bySource[key].rawItems += Number(feed.markers?.itemCount || 0) + Number(feed.markers?.entryCount || 0);
    bySource[key].parsedItems += Number(feed.parsedCount || 0);
    if (severe.includes(feed)) bySource[key].severeFeeds++;
  }

  const payload = compact
    ? {
        ok: true,
        workerVersion: WORKER_VERSION,
        batch,
        batchCount: NEWS_BATCH_COUNT,
        feedCount: feeds.length,
        severeCount: severe.length,
        suspectCount: suspects.length,
        severe,
        bySource
      }
    : {
        ok: true,
        workerVersion: WORKER_VERSION,
        batch,
        batchCount: NEWS_BATCH_COUNT,
        feedCount: feeds.length,
        severeCount: severe.length,
        suspectCount: suspects.length,
        severe,
        suspects,
        bySource,
        feeds
      };

  return new Response(
    JSON.stringify(payload, null, 2),
    {
      status: 200,
      headers: {
        ...corsHeaders,
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store"
      }
    }
  );
}

async function handleRequest(request, env, ctx) {
    const url = new URL(request.url);
    const corsHeaders = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
      "Access-Control-Max-Age": "86400",
      "X-Floew-Worker-Version": WORKER_VERSION,
      "X-Floew-Resolver-Version": VIDEO_RESOLVER_VERSION
    };

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders });
    }

    if (request.method !== "GET") {
      return new Response(
        JSON.stringify({ ok: false, error: "Method Not Allowed" }),
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

    if (url.pathname === "/image") {
      return proxyImage(request, url, corsHeaders, ctx);
    }

    if (url.pathname === "/custom-rss") {
      return getCustomRss(request, url, corsHeaders, ctx);
    }

    if (url.pathname === "/source") {
      return proxyArticleSource(request, url, corsHeaders);
    }

    if (url.pathname === "/debug/rss-health") {
      return debugRssHealthRequest(url, corsHeaders);
    }

    if (url.pathname === "/debug/cnn-rss") {
      return debugCnnRssRequest(corsHeaders);
    }

    if (url.pathname === "/debug/video") {
      return debugVideoReachabilityRequest(url, corsHeaders);
    }

    if (url.pathname === "/video") {
      return resolveArticleVideo(request, url, corsHeaders, ctx);
    }

    if (url.pathname !== "/news") {
      return new Response(
        JSON.stringify({
          ok: true,
          service: "The Flöw News Worker",
          workerVersion: WORKER_VERSION,
          resolverVersion: VIDEO_RESOLVER_VERSION,
          newsBatchCount: NEWS_BATCH_COUNT,
          endpoints: [
            "/news",
            "/video",
            "/image",
            "/custom-rss",
            "/source",
            "/debug/rss-health",
            "/debug/cnn-rss",
            "/debug/video"
          ]
        }),
        {
          status: 200,
          headers: {
            ...corsHeaders,
            "Content-Type": "application/json; charset=utf-8",
            "Cache-Control": "no-store"
          }
        }
      );
    }

    try {
      const rawBatch = url.searchParams.get("batch");
      const batch = rawBatch === null ? 0 : Number.parseInt(rawBatch, 10);

      if (
        !Number.isInteger(batch) ||
        batch < 0 ||
        batch >= NEWS_BATCH_COUNT
      ) {
        return new Response(
          JSON.stringify({
            ok: false,
            error: "Invalid batch",
            batchCount: NEWS_BATCH_COUNT
          }),
          {
            status: 400,
            headers: {
              ...corsHeaders,
              "Content-Type": "application/json; charset=utf-8",
              "Cache-Control": "no-store"
            }
          }
        );
      }

      const callback = url.searchParams.get("callback");

      /* Validate JSONP before any expensive RSS work. */
      if (
        callback &&
        !/^[A-Za-z_$][0-9A-Za-z_$]*(?:\.[A-Za-z_$][0-9A-Za-z_$]*)*$/.test(
          callback
        )
      ) {
        return new Response("Invalid callback", {
          status: 400,
          headers: {
            ...corsHeaders,
            "Content-Type": "text/plain; charset=utf-8",
            "Cache-Control": "no-store"
          }
        });
      }

      const widgetMode = isWidgetNewsRequest(request, url, rawBatch);

      /*
        Canonical cache key deliberately ignores `_floew`, retry tokens and the
        JSONP callback. All clients asking for batch N therefore share the same
        computed JSON payload.
      */
      const batchCache = caches.default;
      const batchCacheRequest = newsBatchCacheRequest(batch);
      const widgetStaleRequest = newsWidgetStaleCacheRequest(batch);

      const cachedJson = await cachedNewsJson(batchCache, batchCacheRequest);
      if (cachedJson) {
        return newsBatchResponse(
          cachedJson,
          batch,
          callback,
          corsHeaders,
          widgetMode ? "WIDGET-HOT" : "HIT"
        );
      }

      /*
        WidgetKit must never be the request that wakes the whole RSS catalog.
        On a hot-cache miss it receives the most recent long-lived snapshot.
        This is intentionally stale-safe: a home-screen widget being a few
        minutes behind is far preferable to a 503 / CPU-limit failure.
      */
      if (widgetMode) {
        const staleJson = await cachedNewsJson(batchCache, widgetStaleRequest);
        if (staleJson) {
          return newsBatchResponse(
            staleJson,
            batch,
            callback,
            corsHeaders,
            "WIDGET-STALE"
          );
        }

        const fallbackRows = await widgetNewsFallbackRows();
        const fallbackJson = JSON.stringify(fallbackRows);

        if (fallbackRows.length) {
          safeWaitUntil(
            ctx,
            batchCache.put(
              widgetStaleRequest,
              new Response(fallbackJson, {
                headers: {
                  "Content-Type": "application/json; charset=utf-8",
                  "Cache-Control": `public, max-age=${NEWS_WIDGET_STALE_SECONDS}`
                }
              })
            ),
            `widget-stale-bootstrap-${batch}`
          );
        }

        return newsBatchResponse(
          fallbackJson,
          batch,
          callback,
          corsHeaders,
          fallbackRows.length ? "WIDGET-FALLBACK" : "WIDGET-EMPTY"
        );
      }

      /*
       * RSS kataloğu batch'lere bölünür. Böylece tek /news çağrısındaki
       * external subrequest sayısı sınırlı kalır ve yönlendirmeler için pay
       * bırakılır.
       */
      const batchSources = SOURCES.filter(
        (source, index) =>
          !source.disabled &&
          index % NEWS_BATCH_COUNT === batch
      );

      const results = await Promise.all(
        batchSources.map(fetchSource)
      );

      const unique = new Map();

      function mergeDuplicate(existing, candidate) {
        if (!existing) return candidate;

        const oldPriority = Number(existing.categoryPriority) || 0;
        const newPriority = Number(candidate.categoryPriority) || 0;
        const preferred = newPriority > oldPriority ? candidate : existing;
        const other = preferred === candidate ? existing : candidate;

        return {
          ...preferred,
          breaking: Boolean(existing.breaking || candidate.breaking),
          foreign: Boolean(existing.foreign || candidate.foreign),
          video: preferred.video || other.video || "",
          videoType: preferred.videoType || other.videoType || "",
          videoArticleHint: Boolean(preferred.videoArticleHint || other.videoArticleHint),
          videoVerified: Boolean(preferred.videoVerified || other.videoVerified),
          feedOrder: Math.min(
            Number.isFinite(Number(preferred.feedOrder)) ? Number(preferred.feedOrder) : 9999,
            Number.isFinite(Number(other.feedOrder)) ? Number(other.feedOrder) : 9999
          )
        };
      }

      for (const item of results.flat()) {
        const key = item.link || `${item.source}|${item.title}`;
        unique.set(key, mergeDuplicate(unique.get(key), item));
      }

      let news = [...unique.values()];

      news.sort((a, b) => {
        const aTime = new Date(a.published).getTime();
        const bTime = new Date(b.published).getTime();
        return (
          (Number.isFinite(bTime) ? bTime : 0) -
          (Number.isFinite(aTime) ? aTime : 0)
        );
      });

      /*
       * Eski `kategori başına ilk 14` kesmesi, aynı kategoride yoğun feed'i
       * olan CNN Türk gibi kaynakları diğer kaynakların arkasında tamamen
       * görünmez hale getirebiliyordu. Kaynak-aware round-robin hem güncelliği
       * hem kaynak çeşitliliğini korur.
       */
      news = balanceNewsForBatch(news);

      const json = JSON.stringify(news);

      try {
        await batchCache.put(
          batchCacheRequest,
          new Response(json, {
            headers: {
              "Content-Type": "application/json; charset=utf-8",
              "Cache-Control": `public, max-age=${NEWS_BATCH_CACHE_SECONDS}`
            }
          })
        );
      } catch (error) {
        console.warn(`News batch cache write failed: ${batch}`, error);
      }

      /*
        Keep a much longer last-known-good snapshot for native widgets. This
        write is best-effort and never delays the web response.
      */
      safeWaitUntil(
        ctx,
        batchCache.put(
          widgetStaleRequest,
          new Response(json, {
            headers: {
              "Content-Type": "application/json; charset=utf-8",
              "Cache-Control": `public, max-age=${NEWS_WIDGET_STALE_SECONDS}`
            }
          })
        ),
        `widget-stale-put-${batch}`
      );

      return newsBatchResponse(
        json,
        batch,
        callback,
        corsHeaders,
        "MISS"
      );
    } catch (error) {
      console.error("The Flöw Worker error:", error);

      return new Response(
        JSON.stringify({
          ok: false,
          error: "News feed generation failed"
        }),
        {
          status: 502,
          headers: {
            ...corsHeaders,
            "Content-Type": "application/json; charset=utf-8",
            "Cache-Control": "no-store"
          }
        }
      );
    }
}

export default {
  async fetch(request, env, ctx) {
    try {
      return await handleRequest(request, env, ctx);
    } catch (error) {
      console.error("The Flöw uncaught route error:", request.url, error);

      return new Response(
        JSON.stringify({
          ok: false,
          error: "News Worker request failed",
          workerVersion: WORKER_VERSION
        }),
        {
          status: 502,
          headers: {
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Methods": "GET, OPTIONS",
            "Access-Control-Allow-Headers": "Content-Type",
            "Content-Type": "application/json; charset=utf-8",
            "Cache-Control": "no-store",
            "X-Floew-Worker-Version": WORKER_VERSION,
            "X-Floew-Resolver-Version": VIDEO_RESOLVER_VERSION
          }
        }
      );
    }
  }
};
