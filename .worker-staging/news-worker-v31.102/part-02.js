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
