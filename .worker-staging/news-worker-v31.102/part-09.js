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
