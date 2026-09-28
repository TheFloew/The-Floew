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
