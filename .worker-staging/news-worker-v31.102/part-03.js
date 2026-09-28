
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
