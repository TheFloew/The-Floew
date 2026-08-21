/*
  Flöw — Haber paylaşımı v3.1.0
  ------------------------------------------------------------
  - ⤴︎ Haberi paylaş düğmesi: Flöra ile Kaynağa Git arasına eklenir.
  - Paylaşım URL'si ayrı Flöw Share Worker üzerinden üretilir.
  - Mobilde Web Share API; masaüstünde clipboard fallback kullanılır.
*/
(function(){
  "use strict";

  const FEATURE_VERSION="3.1.0";
  const SHARE_LABEL="Haberi paylaş";
  const SHARE_WORKER_BASE=String(
    window.FLOEW_CONFIG?.shareWorkerBase||"https://thefloew-share.thefloewback.workers.dev"
  ).replace(/\/$/,"");
  const SHARE_PUBLIC_ORIGIN=String(
    window.FLOEW_CONFIG?.sharePublicOrigin||"https://flöw.tr"
  ).replace(/\/$/,"");
  const LEGACY_SHARE_BASE=`${SHARE_WORKER_BASE}/share/`;
  const SHORT_CREATE_ENDPOINTS=[
    `${SHARE_PUBLIC_ORIGIN}/s/create`,
    `${SHARE_WORKER_BASE}/s/create`
  ];
  const SHORT_LINK_TIMEOUT_MS=6500;
  const shortLinkCache=new Map();

  function clean(value){
    return String(value||"")
      .replace(/\s+/g," ")
      .trim();
  }

  function normalizeDisplayShareUrl(value){
    const raw=String(value||"").trim();
    if(!raw)return "";

    try{
      const url=new URL(raw,location.href);

      if(
        url.protocol!=="http:" &&
        url.protocol!=="https:"
      ){
        return "";
      }

      /*
        URL.href alan adı Unicode olduğunda host'u punycode'a çevirir.
        Kopyalanan/paylaşılan Flöw kısa linki kullanıcıya tekrar Unicode
        gösterelim: https://flöw.tr/s/AbCd123
      */
      const path=url.pathname||"";
      const codeMatch=/^\/s\/([A-Za-z0-9_-]+)\/?$/i.exec(path);

      if(
        codeMatch &&
        /^(?:flöw\.tr|xn--flw-tna\.tr)$/i.test(url.hostname)
      ){
        return (
          `${SHARE_PUBLIC_ORIGIN}/s/`+
          encodeURIComponent(codeMatch[1])
        );
      }

      return url.href;
    }catch(e){
      return "";
    }
  }

  function validHttpUrl(value){
    const raw=String(value||"").trim();

    if(!raw)return "";

    try{
      const url=new URL(raw,location.href);

      if(
        url.protocol!=="http:" &&
        url.protocol!=="https:"
      ){
        return "";
      }

      return url.href;
    }catch(e){
      return "";
    }
  }

  function base64UrlUtf8(value){
    const bytes=
      new TextEncoder().encode(
        String(value||"")
      );

    let binary="";
    const chunk=0x8000;

    for(
      let i=0;
      i<bytes.length;
      i+=chunk
    ){
      binary+=
        String.fromCharCode(
          ...bytes.subarray(i,i+chunk)
        );
    }

    return btoa(binary)
      .replace(/\+/g,"-")
      .replace(/\//g,"_")
      .replace(/=+$/g,"");
  }

  function legacyShareUrlForArticle(articleUrl){
    const safe=validHttpUrl(articleUrl);
    if(!safe)return "";

    return (
      LEGACY_SHARE_BASE+
      base64UrlUtf8(safe)
    );
  }

  function currentStoryForShare(slide,articleUrl){
    try{
      if(
        typeof state!=="undefined" &&
        state &&
        Array.isArray(state.stories)
      ){
        const current=state.stories[state.index]||null;

        if(
          current &&
          validHttpUrl(current.link)===articleUrl
        ){
          return current;
        }

        return state.stories.find(item=>
          validHttpUrl(item?.link)===articleUrl
        )||current;
      }
    }catch(e){}

    return null;
  }

  function normalizeShareMedia(value){
    if(!value || typeof value!=="object")return null;

    const kind=String(value.kind||"").toLowerCase();
    const url=validHttpUrl(value.url);
    if(!url)return null;

    if(kind!=="video" && kind!=="embed")return null;

    const provider=clean(value.provider||"").toLowerCase();

    return {
      kind,
      url,
      type:clean(value.type||"").slice(0,120),
      provider:
        ["native","youtube","vimeo","dailymotion"].includes(provider)
          ? provider
          : (kind==="video" ? "native" : "")
    };
  }

  function mediaSnapshotFromSlide(slide){
    if(!slide)return null;

    const video=slide.querySelector(".slide-video");
    const descriptor=
      normalizeShareMedia(video?.__floewMediaDescriptor);

    if(descriptor)return descriptor;

    const embed=slide.querySelector(".slide-embed");
    const embedSrc=validHttpUrl(embed?.getAttribute("src"));

    if(
      embedSrc &&
      embedSrc!=="about:blank" &&
      embed?.classList?.contains("media-visible")
    ){
      return normalizeShareMedia({
        kind:"embed",
        url:embedSrc,
        provider:embed.dataset.provider||""
      });
    }

    return null;
  }

  async function resolveMediaSnapshot(storyRef,slide){
    const fromSlide=mediaSnapshotFromSlide(slide);
    if(fromSlide)return fromSlide;

    try{
      if(
        storyRef &&
        typeof resolveStoryMedia==="function"
      ){
        let timeoutId=0;

        const timeout=new Promise(resolve=>{
          timeoutId=setTimeout(
            ()=>resolve(null),
            2400
          );
        });

        const resolved=await Promise.race([
          Promise.resolve(
            resolveStoryMedia(storyRef)
          ).catch(()=>null),
          timeout
        ]);

        clearTimeout(timeoutId);

        return normalizeShareMedia(resolved);
      }
    }catch(e){}

    return null;
  }

  function numericFloraScore(slide){
    const raw=clean(
      slide
        ?.querySelector(".flora-inline-value")
        ?.textContent
    );

    if(!raw || raw==="—")return null;

    const value=Number(
      raw.replace(",",".")
    );

    return Number.isFinite(value)
      ? Math.max(0,Math.min(100,value))
      : null;
  }

  async function buildShareSnapshot(button,story){
    const slide=
      button?.closest?.(".slide");

    const storyRef=
      currentStoryForShare(
        slide,
        story.articleUrl
      );

    const imageEl=
      slide?.querySelector(".slide-image");

    const logoEl=
      slide?.querySelector(".source-logo");

    const media=
      await resolveMediaSnapshot(
        storyRef,
        slide
      );

    const image=
      validHttpUrl(
        imageEl?.currentSrc ||
        imageEl?.src ||
        storyRef?.image
      );

    const sourceLogo=
      validHttpUrl(
        logoEl?.currentSrc ||
        logoEl?.src
      );

    return {
      title:
        clean(
          storyRef?.title ||
          story.title
        ).slice(0,700),
      source:
        clean(
          storyRef?.source ||
          story.source
        ).slice(0,180),
      category:
        clean(
          storyRef?.flowCategory ||
          slide
            ?.querySelector(".category")
            ?.textContent
        ).slice(0,100),
      description:
        clean(
          storyRef?.description ||
          storyRef?.summary ||
          slide
            ?.querySelector(".description")
            ?.textContent
        ).slice(0,5000),
      image,
      sourceLogo,
      published:
        clean(
          storyRef?.published ||
          ""
        ).slice(0,80),
      floraScore:
        numericFloraScore(slide),
      media
    };
  }

  async function requestShortShareUrl(articleUrl,snapshot=null){
    const safe=validHttpUrl(articleUrl);
    if(!safe)return "";

    /*
      We intentionally POST even when the URL was shared earlier in this
      session. The code stays deterministic, while KV receives the newest
      Flöw snapshot (title/category/image/video/Flöra etc.).
    */
    for(const endpoint of SHORT_CREATE_ENDPOINTS){
      const controller=
        typeof AbortController==="function"
          ? new AbortController()
          : null;

      const timer=setTimeout(()=>{
        try{controller?.abort()}catch(e){}
      },SHORT_LINK_TIMEOUT_MS);

      try{
        const response=await fetch(endpoint,{
          method:"POST",
          headers:{
            "Content-Type":"application/json"
          },
          body:JSON.stringify({
            url:safe,
            snapshot
          }),
          cache:"no-store",
          credentials:"omit",
          signal:controller?.signal
        });

        if(!response.ok)continue;

        const data=await response.json();
        const shortUrl=normalizeDisplayShareUrl(data?.shareUrl);

        if(
          data?.ok===true &&
          shortUrl &&
          /^https:\/\/(?:flöw\.tr|xn--flw-tna\.tr)\/s\/[A-Za-z0-9_-]+\/?$/i.test(shortUrl)
        ){
          shortLinkCache.set(safe,shortUrl);
          return shortUrl;
        }
      }catch(e){}
      finally{
        clearTimeout(timer);
      }
    }

    return normalizeDisplayShareUrl(
      shortLinkCache.get(safe)||""
    );
  }

  async function shareUrlForArticle(articleUrl,snapshot=null){
    const safe=validHttpUrl(articleUrl);
    if(!safe)return "";

    const shortUrl=
      await requestShortShareUrl(
        safe,
        snapshot
      );

    if(shortUrl)return shortUrl;

    return legacyShareUrlForArticle(safe);
  }

  function storyFromButton(button){
    const slide=
      button?.closest?.(".slide");

    if(!slide)return null;

    const sourceLink=
      slide.querySelector(".source-link");

    const articleUrl=
      validHttpUrl(
        sourceLink?.getAttribute("href")
      );

    const title=
      clean(
        slide.querySelector("h1")
          ?.textContent
      );

    const source=
      clean(
        slide.querySelector(".source")
          ?.textContent
      );

    if(!articleUrl){
      return null;
    }

    return {
      title:
        title ||
        "Flöw'de bir haber",
      source,
      articleUrl,
      shareUrl:"",
      snapshot:null
    };
  }

  function shareText(story){
    return [
      story.title,
      story.source
        ? `${story.source} • Flöw`
        : "Flöw"
    ].join("\n");
  }

  async function copyText(text){
    if(
      navigator.clipboard?.writeText
    ){
      try{
        await navigator.clipboard
          .writeText(text);

        return true;
      }catch(e){}
    }

    try{
      const area=
        document.createElement(
          "textarea"
        );

      area.value=text;
      area.setAttribute(
        "readonly",
        ""
      );

      area.style.position="fixed";
      area.style.left="-9999px";
      area.style.top="0";
      area.style.opacity="0";

      document.body.appendChild(area);

      area.select();
      area.setSelectionRange(
        0,
        area.value.length
      );

      const ok=
        document.execCommand("copy");

      area.remove();

      return Boolean(ok);
    }catch(e){
      return false;
    }
  }

  function flashButton(
    button,
    ok=true
  ){
    if(!button)return;

    const oldText=
      button.textContent;

    const oldLabel=
      button.getAttribute(
        "aria-label"
      ) || SHARE_LABEL;

    const oldTitle=
      button.title ||
      SHARE_LABEL;

    button.classList.add(
      ok
        ? "share-done"
        : "share-error"
    );

    button.textContent=
      ok ? "✓︎" : "!";

    button.setAttribute(
      "aria-label",
      ok
        ? "Flöw paylaşım bağlantısı kopyalandı"
        : "Bağlantı kopyalanamadı"
    );

    button.title=
      button.getAttribute(
        "aria-label"
      );

    clearTimeout(
      button.__floewShareResetTimer
    );

    button.__floewShareResetTimer=
      setTimeout(()=>{
        button.classList.remove(
          "share-done",
          "share-error"
        );

        button.textContent=
          oldText || "⤴︎";

        button.setAttribute(
          "aria-label",
          oldLabel
        );

        button.title=
          oldTitle;
      },1300);
  }

  function telemetry(
    story,
    mode
  ){
    try{
      if(
        typeof telemetryQueueEvent!==
        "function"
      ){
        return;
      }

      let currentStory=null;

      if(
        typeof state!=="undefined" &&
        state &&
        Array.isArray(state.stories)
      ){
        currentStory=
          state.stories[
            state.index
          ] || null;
      }

      const payload={
        value_text:
          story.source||"",
        mode,
        meta:{
          share_url:
            story.shareUrl,
          article_url:
            story.articleUrl,
          share_feature_version:
            FEATURE_VERSION,
          branded_card:true,
          short_link:
            /\/s\/[A-Za-z0-9_-]+\/?$/i.test(story.shareUrl),
          share_worker:
            "standalone"
        }
      };

      if(
        currentStory &&
        typeof telemetryStoryPayload===
          "function"
      ){
        payload.story=
          telemetryStoryPayload(
            currentStory
          );
      }

      telemetryQueueEvent(
        "story_share",
        payload
      );
    }catch(e){}
  }

  async function shareStory(
    button
  ){
    const story=
      storyFromButton(button);

    if(!story)return;

    button?.setAttribute("aria-busy","true");

    try{
      story.snapshot=
        await buildShareSnapshot(
          button,
          story
        );

      story.shareUrl=
        await shareUrlForArticle(
          story.articleUrl,
          story.snapshot
        );
    }finally{
      button?.removeAttribute("aria-busy");
    }

    if(!story.shareUrl){
      flashButton(button,false);
      return;
    }

    const text=
      shareText(story);

    if(
      typeof navigator.share===
      "function"
    ){
      try{
        await navigator.share({
          title:story.title,
          text,
          url:story.shareUrl
        });

        telemetry(
          story,
          "native"
        );

        return;
      }catch(error){
        if(
          error?.name===
            "AbortError" ||
          error?.name===
            "NotAllowedError"
        ){
          return;
        }
      }
    }

    const copied=
      await copyText(
        `${text}\n${story.shareUrl}`
      );

    flashButton(
      button,
      copied
    );

    if(copied){
      telemetry(
        story,
        "clipboard"
      );
    }
  }

  function syncButton(
    button,
    sourceLink
  ){
    if(!button)return;

    const href=
      validHttpUrl(
        sourceLink
          ?.getAttribute("href")
      );

    const sourceHidden=
      !sourceLink ||
      sourceLink
        .getAttribute("aria-hidden")===
        "true" ||
      sourceLink.style.display===
        "none";

    const available=
      Boolean(href) &&
      !sourceHidden;

    button.hidden=
      !available;

    button.setAttribute(
      "aria-hidden",
      available
        ? "false"
        : "true"
    );

    button.tabIndex=
      available ? 0 : -1;
  }

  function installForActions(actions){
    if(!actions)return;

    const sourceLink=actions.querySelector(".source-link");
    const button=actions.querySelector(".share-link");

    if(!sourceLink || !button)return;

    if(button.dataset.floewShareInstalled===FEATURE_VERSION){
      syncButton(button,sourceLink);
      return;
    }

    button.dataset.floewShareInstalled=FEATURE_VERSION;

    for(const eventName of [
      "pointerdown",
      "pointerup",
      "dblclick",
      "contextmenu",
      "wheel"
    ]){
      button.addEventListener(
        eventName,
        event=>event.stopPropagation(),
        eventName==="wheel" ? {passive:true} : false
      );
    }

    button.addEventListener("click",event=>{
      event.preventDefault();
      event.stopPropagation();
      void shareStory(button);
    });

    syncButton(button,sourceLink);

    const observer=new MutationObserver(()=>{
      syncButton(button,sourceLink);
    });

    observer.observe(sourceLink,{
      attributes:true,
      attributeFilter:["href","aria-hidden","style"]
    });
  }

  function install(){
    document
      .querySelectorAll(
        ".headline-actions"
      )
      .forEach(
        installForActions
      );

    document.documentElement
      .dataset
      .floewShareVersion=
      FEATURE_VERSION;
  }

  if(
    document.readyState===
    "loading"
  ){
    document.addEventListener(
      "DOMContentLoaded",
      install,
      {once:true}
    );
  }else{
    install();
  }
})();
