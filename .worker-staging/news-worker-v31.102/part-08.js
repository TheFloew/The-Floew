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
