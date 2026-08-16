/*
  Flöw — Haber paylaşımı v1.0.0
  ------------------------------------------------------------
  - Manşet altındaki Flöra ve Kaynağa Git düğmeleri arasına ⤴ ekler.
  - Mobilde Web Share API ile sistem paylaşım ekranını açar.
  - Web Share yoksa başlık + kaynak + gerçek haber URL'sini panoya kopyalar.
  - Paylaşılan URL, yayıncının gerçek haber URL'sidir. Böylece WhatsApp,
    Telegram, X, Facebook vb. uygulamalar kartı yayıncının OG/Twitter
    meta verilerinden (başlık, görsel, açıklama) oluşturabilir.
*/
(function(){
  "use strict";

  const FEATURE_VERSION="1.0.0";
  const SHARE_LABEL="Haberi paylaş";

  function clean(value){
    return String(value||"").replace(/\s+/g," ").trim();
  }

  function validHttpUrl(value){
    const raw=String(value||"").trim();
    if(!raw)return "";
    try{
      const url=new URL(raw,location.href);
      if(url.protocol!=="http:" && url.protocol!=="https:")return "";
      return url.href;
    }catch(e){
      return "";
    }
  }

  function storyFromButton(button){
    const slide=button?.closest?.(".slide");
    if(!slide)return null;

    const sourceLink=slide.querySelector(".source-link");
    const link=validHttpUrl(sourceLink?.getAttribute("href"));
    const title=clean(slide.querySelector("h1")?.textContent);
    const source=clean(slide.querySelector(".source")?.textContent);

    if(!link)return null;

    return {
      title:title || "Flöw'de bir haber",
      source,
      link,
      slide
    };
  }

  function shareText(story){
    const parts=[story.title];
    parts.push(story.source ? `${story.source} • Flöw` : "Flöw");
    return parts.join("\n");
  }

  async function copyText(text){
    if(navigator.clipboard?.writeText){
      try{
        await navigator.clipboard.writeText(text);
        return true;
      }catch(e){}
    }

    try{
      const area=document.createElement("textarea");
      area.value=text;
      area.setAttribute("readonly","");
      area.style.position="fixed";
      area.style.left="-9999px";
      area.style.top="0";
      area.style.opacity="0";
      document.body.appendChild(area);
      area.select();
      area.setSelectionRange(0,area.value.length);
      const ok=document.execCommand("copy");
      area.remove();
      return Boolean(ok);
    }catch(e){
      return false;
    }
  }

  function flashButton(button,ok=true){
    if(!button)return;
    const oldText=button.textContent;
    const oldLabel=button.getAttribute("aria-label")||SHARE_LABEL;
    const oldTitle=button.title||SHARE_LABEL;

    button.classList.add(ok ? "share-done" : "share-error");
    button.textContent=ok ? "✓" : "!";
    button.setAttribute(
      "aria-label",
      ok ? "Haber bağlantısı kopyalandı" : "Haber bağlantısı kopyalanamadı"
    );
    button.title=button.getAttribute("aria-label");

    clearTimeout(button.__floewShareResetTimer);
    button.__floewShareResetTimer=setTimeout(()=>{
      button.classList.remove("share-done","share-error");
      button.textContent=oldText || "⤴";
      button.setAttribute("aria-label",oldLabel);
      button.title=oldTitle;
    },1300);
  }

  function telemetry(story,mode){
    try{
      if(typeof telemetryQueueEvent!=="function")return;

      let currentStory=null;
      if(
        typeof state!=="undefined" &&
        state &&
        Array.isArray(state.stories)
      ){
        currentStory=state.stories[state.index]||null;
      }

      const payload={
        value_text:story.source||"",
        mode,
        meta:{
          share_url:story.link,
          share_feature_version:FEATURE_VERSION
        }
      };

      if(
        currentStory &&
        typeof telemetryStoryPayload==="function"
      ){
        payload.story=telemetryStoryPayload(currentStory);
      }

      telemetryQueueEvent("story_share",payload);
    }catch(e){}
  }

  async function shareStory(button){
    const story=storyFromButton(button);
    if(!story)return;

    const text=shareText(story);

    if(typeof navigator.share==="function"){
      try{
        await navigator.share({
          title:story.title,
          text,
          url:story.link
        });
        telemetry(story,"native");
        return;
      }catch(error){
        /*
          Kullanıcı paylaşım panelini kendisi kapattıysa panoya zorla
          kopyalamıyoruz. Diğer Web Share hatalarında clipboard fallback var.
        */
        if(
          error?.name==="AbortError" ||
          error?.name==="NotAllowedError"
        ){
          return;
        }
      }
    }

    const copied=await copyText(
      `${text}\n${story.link}`
    );

    flashButton(button,copied);
    if(copied)telemetry(story,"clipboard");
  }

  function syncButton(button,sourceLink){
    if(!button)return;
    const href=validHttpUrl(sourceLink?.getAttribute("href"));
    const sourceHidden=
      !sourceLink ||
      sourceLink.getAttribute("aria-hidden")==="true" ||
      sourceLink.style.display==="none";

    const available=Boolean(href) && !sourceHidden;
    button.hidden=!available;
    button.setAttribute("aria-hidden",available?"false":"true");
    button.tabIndex=available?0:-1;
  }

  function installForActions(actions){
    if(!actions || actions.querySelector(".share-link"))return;

    const sourceLink=actions.querySelector(".source-link");
    if(!sourceLink)return;

    const button=document.createElement("button");
    button.type="button";
    button.className="share-link";
    button.textContent="⤴";
    button.setAttribute("aria-label",SHARE_LABEL);
    button.title=SHARE_LABEL;

    /*
      Flöra → Paylaş → Kaynağa Git
    */
    actions.insertBefore(button,sourceLink);

    for(const eventName of ["pointerdown","pointerup","click","dblclick","contextmenu","wheel"]){
      button.addEventListener(eventName,event=>{
        event.stopPropagation();
      },eventName==="wheel"?{passive:true}:false);
    }

    button.addEventListener("click",event=>{
      event.preventDefault();
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

  function installStyles(){
    if(document.getElementById("floew-share-style"))return;

    const style=document.createElement("style");
    style.id="floew-share-style";
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
        outline:1px solid rgba(255,255,255,.72);
        outline-offset:5px;
      }
      .share-link[hidden],
      .share-link[aria-hidden="true"]{
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
    document.head.appendChild(style);
  }

  function install(){
    installStyles();
    document.querySelectorAll(".headline-actions").forEach(installForActions);
    document.documentElement.dataset.floewShareVersion=FEATURE_VERSION;
  }

  if(document.readyState==="loading"){
    document.addEventListener("DOMContentLoaded",install,{once:true});
  }else{
    install();
  }
})();
