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
