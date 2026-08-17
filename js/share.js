/*
  Flöw — Haber paylaşımı v2.1.0
  ------------------------------------------------------------
  - ⤴ Haberi paylaş düğmesi: Flöra ile Kaynağa Git arasına eklenir.
  - Paylaşım URL'si ayrı Flöw Share Worker üzerinden üretilir.
  - Mobilde Web Share API; masaüstünde clipboard fallback kullanılır.
*/
(function(){
  "use strict";

  const FEATURE_VERSION="2.1.0";
  const SHARE_LABEL="Haberi paylaş";
  const SHARE_BASE=
    "https://thefloew-share.thefloewback.workers.dev/share/";

  function clean(value){
    return String(value||"")
      .replace(/\s+/g," ")
      .trim();
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

  function shareUrlForArticle(articleUrl){
    const safe=validHttpUrl(articleUrl);
    if(!safe)return "";

    return (
      SHARE_BASE+
      base64UrlUtf8(safe)
    );
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

    const shareUrl=
      shareUrlForArticle(articleUrl);

    if(
      !articleUrl ||
      !shareUrl
    ){
      return null;
    }

    return {
      title:
        title ||
        "Flöw'de bir haber",
      source,
      articleUrl,
      shareUrl
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
      ok ? "✓" : "!";

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
          oldText || "⤴";

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

  function installForActions(
    actions
  ){
    if(!actions)return;

    const sourceLink=
      actions.querySelector(
        ".source-link"
      );

    if(!sourceLink)return;

    let button=
      actions.querySelector(
        ".share-link"
      );

    if(!button){
      button=
        document.createElement(
          "button"
        );

      button.type="button";
      button.className=
        "share-link";

      button.textContent="⤴";

      button.setAttribute(
        "aria-label",
        SHARE_LABEL
      );

      button.title=
        SHARE_LABEL;

      /*
        Flöra → Paylaş → Kaynağa Git
      */
      actions.insertBefore(
        button,
        sourceLink
      );
    }

    if(
      button.dataset
        .floewShareInstalled===
      FEATURE_VERSION
    ){
      syncButton(
        button,
        sourceLink
      );

      return;
    }

    button.dataset
      .floewShareInstalled=
      FEATURE_VERSION;

    for(
      const eventName of [
        "pointerdown",
        "pointerup",
        "dblclick",
        "contextmenu",
        "wheel"
      ]
    ){
      button.addEventListener(
        eventName,
        event=>{
          event.stopPropagation();
        },
        eventName==="wheel"
          ? {passive:true}
          : false
      );
    }

    button.addEventListener(
      "click",
      event=>{
        event.preventDefault();
        event.stopPropagation();

        void shareStory(button);
      }
    );

    syncButton(
      button,
      sourceLink
    );

    const observer=
      new MutationObserver(()=>{
        syncButton(
          button,
          sourceLink
        );
      });

    observer.observe(
      sourceLink,
      {
        attributes:true,
        attributeFilter:[
          "href",
          "aria-hidden",
          "style"
        ]
      }
    );
  }

  function installStyles(){
    if(
      document.getElementById(
        "floew-share-style"
      )
    ){
      return;
    }

    const style=
      document.createElement(
        "style"
      );

    style.id=
      "floew-share-style";

    style.textContent=`
      .share-link{
        display:inline-flex;
        align-items:center;
        justify-content:center;
        flex:0 0 auto;
        margin:0;
        padding:0;
        border:0;
        outline:0;
        background:transparent;
        color:#fff;
        font:400 18px/1 Arial,sans-serif;
        opacity:.82;
        text-shadow:
          0 1px 3px rgba(0,0,0,.65),
          0 2px 7px rgba(0,0,0,.42);
        cursor:pointer;
        pointer-events:auto;
        appearance:none;
        -webkit-appearance:none;
        -webkit-tap-highlight-color:transparent;
        user-select:none;
        touch-action:manipulation;
      }

      .share-link:hover,
      .share-link:focus-visible{
        opacity:1;
      }

      .share-link:focus-visible{
        outline:
          1px solid
          rgba(255,255,255,.72);
        outline-offset:5px;
      }

      .share-link[hidden],
      .share-link[
        aria-hidden="true"
      ]{
        display:none !important;
      }

      .share-link.share-done{
        opacity:1;
      }

      .share-link.share-error{
        opacity:.72;
      }

      @media(max-width:520px){
        .share-link{
          font-size:18px;
        }
      }
    `;

    document.head.appendChild(
      style
    );
  }

  function install(){
    installStyles();

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
