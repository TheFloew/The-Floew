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
