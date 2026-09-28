
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
