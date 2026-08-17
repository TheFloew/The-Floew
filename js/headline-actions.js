/*
  Flöw — Manşet aksiyonları v1.0.0
  ------------------------------------------------------------
  Görsel sıra:
    Flöra → ⤴ Paylaş → ⚑ Geri bildirim → ⎋ Kaynağa git

  - Aksiyonların arasını biraz açar.
  - ⚑ düğmesi mevcut Flöw geri bildirim ekranını doğrudan açar.
  - Açılırken o anda ekrandaki haber geri bildirim bağlamına yeniden alınır.
  - Haber kaydırma/tıklama jestlerinin düğme üzerinden tetiklenmesini engeller.
*/
(function(){
  "use strict";

  const FEATURE_VERSION="1.0.0";
  const STYLE_ID="floew-headline-actions-v1-style";
  const BUTTON_CLASS="feedback-inline-link";

  function injectStyles(){
    if(document.getElementById(STYLE_ID))return;

    const style=document.createElement("style");
    style.id=STYLE_ID;
    style.textContent=`
      /*
        Önceki değerler:
          desktop 17px
          mobile  15px

        Dört aksiyonun birbirine yapışık görünmemesi için ölçülü biçimde
        artırılıyor.
      */
      .headline-actions{
        gap:22px !important;
      }

      .${BUTTON_CLASS}{
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
        font:400 18px/1 Arial,"Apple Symbols","Segoe UI Symbol",sans-serif;
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

      .${BUTTON_CLASS}:hover,
      .${BUTTON_CLASS}:focus-visible{
        opacity:1;
      }

      .${BUTTON_CLASS}:focus-visible{
        outline:1px solid rgba(255,255,255,.72);
        outline-offset:5px;
      }

      @media(max-width:520px){
        .headline-actions{
          gap:19px !important;
        }

        .${BUTTON_CLASS}{
          font-size:18px;
        }
      }
    `;
    document.head.appendChild(style);
  }

  function openFeedback(){
    /*
      reset() mevcut geri bildirim akışını başa alır ve o anda ekrandaki
      haberi yeniden yakalar. Böylece kullanıcı daha önce geri bildirim
      göndermiş olsa bile ⚑ her zaman yeni bir bildirim başlatır.
    */
    try{
      if(window.FloewFeedback?.reset){
        window.FloewFeedback.reset();
      }

      if(window.FloewFeedback?.open){
        window.FloewFeedback.open();
        return;
      }
    }catch(e){}

    /*
      feedback.js beklenmedik biçimde geç yüklenirse mevcut "Flöw hakkında"
      mekanizmasına güvenli fallback.
    */
    try{
      if(typeof openStatsOverlay==="function"){
        openStatsOverlay();
      }

      if(typeof switchAboutTab==="function"){
        switchAboutTab("report");
      }

      document
        .querySelector('[data-about-tab="report"]')
        ?.click();
    }catch(e){}
  }

  function stopGesture(event){
    event.stopPropagation();
  }

  function installButton(actions){
    if(!actions || actions.querySelector(`.${BUTTON_CLASS}`))return;

    const sourceLink=actions.querySelector(".source-link");
    if(!sourceLink)return;

    const button=document.createElement("button");
    button.type="button";
    button.className=BUTTON_CLASS;
    button.textContent="⚑";
    button.setAttribute("aria-label","Geri bildirim");
    button.title="Geri bildirim";

    /*
      share.js, ⤴ düğmesini source-link'ten önce yerleştiriyor.
      Biz de source-link'ten hemen önce ekleyerek kesin sırayı elde ediyoruz:

      Flöra → ⤴ → ⚑ → ⎋
    */
    actions.insertBefore(button,sourceLink);

    for(const eventName of [
      "pointerdown",
      "pointerup",
      "mousedown",
      "mouseup",
      "touchstart",
      "touchend",
      "dblclick",
      "contextmenu",
      "wheel"
    ]){
      button.addEventListener(
        eventName,
        stopGesture,
        eventName==="wheel" ? {passive:true} : {passive:false}
      );
    }

    button.addEventListener("click",event=>{
      event.preventDefault();
      event.stopPropagation();
      openFeedback();
    });
  }

  function install(){
    injectStyles();

    document
      .querySelectorAll(".headline-actions")
      .forEach(installButton);

    /*
      Gelecekte slide DOM'u yeniden üretilirse düğmenin kaybolmaması için
      hafif bir MutationObserver kullan.
    */
    if(window.MutationObserver){
      const observer=new MutationObserver(()=>{
        document
          .querySelectorAll(".headline-actions")
          .forEach(installButton);
      });

      observer.observe(document.body,{
        childList:true,
        subtree:true
      });
    }

    document.documentElement.dataset.floewHeadlineActionsVersion=
      FEATURE_VERSION;
  }

  if(document.readyState==="loading"){
    document.addEventListener(
      "DOMContentLoaded",
      install,
      {once:true}
    );
  }else{
    install();
  }
})();
