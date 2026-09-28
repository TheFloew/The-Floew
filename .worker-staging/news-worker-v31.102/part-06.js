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
