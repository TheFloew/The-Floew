(()=>{
  "use strict";

  const ENDPOINT="https://thefloew-baitbuster.thefloewback.workers.dev/v1/evaluate";
  const CLIENT_VERSION="16";
  const FETCH_TIMEOUT_MS=12000;
  const UI=globalThis.BaitBusterUI;
  const settingButton=document.getElementById("baitbuster-setting");
  const slides=[...document.querySelectorAll("#a,#b")];

  if(!UI)return;

  const entityDecoder=document.createElement("textarea");
  const resultByKey=new Map();
  const requestByKey=new Map();
  const appliedState=new WeakMap();
  let featureEnabled=UI.loadEnabled(localStorage);
  let lastError="";

  function detectClientType(){
    const ua=String(navigator.userAgent||"");
    if(/FloewIOS\//i.test(ua))return "ios-app";
    if(/Android/i.test(ua)){
      if(/Android TV|GoogleTV|AFT|\bTV\b/i.test(ua))return "android-tv";
      if(/\bwv\b|;\s*wv\)/i.test(ua))return "android-app";
    }
    return "web";
  }

  const CLIENT_TYPE=detectClientType();

  function decodeHtmlEntities(value){
    const raw=String(value||"");
    if(!raw.includes("&"))return raw;

    entityDecoder.innerHTML=raw
      .replace(/</g,"&lt;")
      .replace(/>/g,"&gt;");

    return entityDecoder.value;
  }

  function clean(value){
    return decodeHtmlEntities(value)
      .replace(/\s+/g," ")
      .trim();
  }

  function httpUrl(value){
    try{
      const url=new URL(String(value||""),location.href);
      if(url.protocol!=="https:"&&url.protocol!=="http:")return "";
      return url.href;
    }catch{
      return "";
    }
  }

  function normalizeStory(item){
    if(!item||typeof item!=="object")return null;

    const title=clean(item.title);
    const url=httpUrl(item.link||item.url);
    if(!title||!url)return null;

    const description=clean(item.description||item.summary);
    const source=clean(item.source);
    const category=clean(item.flowCategory||item.category);
    const key=`${url}|${title}`.slice(0,900);

    return {key,url,title,description,source,category};
  }

  function markerFor(slide){
    return slide?.querySelector?.(".baitbuster-rewrite-mark")||null;
  }

  function updateMarkerLabel(marker,mode){
    if(!marker)return;

    const title=UI.markerTitleForMode(mode);
    const pressed=mode==="original"?"true":"false";

    if(marker.hasAttribute("title"))marker.removeAttribute("title");
    if(marker.dataset.tooltip!==title)marker.dataset.tooltip=title;
    if(marker.getAttribute("aria-label")!==title){
      marker.setAttribute("aria-label",title);
    }
    if(marker.getAttribute("aria-pressed")!==pressed){
      marker.setAttribute("aria-pressed",pressed);
    }
  }

  function clearSlide(slide,{restore=true}={}){
    if(!slide)return;

    const current=appliedState.get(slide);
    const heading=slide.querySelector("h1");

    if(restore&&current&&heading){
      heading.textContent=current.originalTitle;
    }

    if(heading){
      delete heading.dataset.baitbusterOriginalTitle;
      delete heading.dataset.baitbusterApplied;
    }

    markerFor(slide)?.remove();
    appliedState.delete(slide);
  }

  function renderResult(slide,story,result){
    if(!slide||!story)return false;

    clearSlide(slide,{restore:false});

    const heading=slide.querySelector("h1");
    if(!heading)return false;

    if(
      !featureEnabled ||
      result?.rewriteStatus!=="rewritten" ||
      !clean(result.flowTitle)
    ){
      heading.textContent=story.title;
      return false;
    }

    const flowTitle=clean(result.flowTitle);
    const stateForSlide={
      key:story.key,
      url:story.url,
      originalTitle:story.title,
      flowTitle,
      mode:"ai"
    };

    appliedState.set(slide,stateForSlide);
    heading.dataset.baitbusterOriginalTitle=story.title;
    heading.dataset.baitbusterApplied="1";
    heading.textContent=flowTitle;

    const marker=document.createElement("button");
    marker.type="button";
    marker.className="baitbuster-rewrite-mark";
    marker.textContent=UI.markerText();
    updateMarkerLabel(marker,stateForSlide.mode);

    const stop=event=>event.stopPropagation();

    marker.addEventListener("pointerdown",event=>{
      stop(event);
      marker.classList.add("is-pressing");
      try{marker.setPointerCapture?.(event.pointerId)}catch{}
    });

    marker.addEventListener("pointercancel",event=>{
      stop(event);
      marker.classList.remove("is-pressing");
    });

    marker.addEventListener("lostpointercapture",()=>{
      marker.classList.remove("is-pressing");
    });

    const toggle=event=>{
      UI.stopNavigationEvent(event);
      marker.classList.remove("is-pressing");

      const current=appliedState.get(slide);
      if(!current)return;

      current.mode=UI.nextMode(current.mode);
      heading.textContent=UI.headlineForMode(current,current.mode);
      updateMarkerLabel(marker,current.mode);
    };

    marker.addEventListener("pointerup",toggle);
    marker.addEventListener("click",event=>UI.stopNavigationEvent(event));
    marker.addEventListener("touchstart",stop,{passive:true});
    marker.addEventListener("touchend",stop,{passive:true});
    marker.addEventListener("keydown",event=>{
      if(event.key!=="Enter"&&event.key!==" ")return;
      toggle(event);
    });

    heading.insertAdjacentElement("beforebegin",marker);
    return true;
  }

  async function requestStory(story){
    const controller=new AbortController();
    const timeout=setTimeout(()=>controller.abort(),FETCH_TIMEOUT_MS);

    try{
      const response=await fetch(ENDPOINT,{
        method:"POST",
        mode:"cors",
        credentials:"omit",
        cache:"no-store",
        signal:controller.signal,
        headers:{
          "Content-Type":"application/json",
          "X-BaitBuster-Client":CLIENT_TYPE,
          "X-BaitBuster-Version":CLIENT_VERSION
        },
        body:JSON.stringify({stories:[story]})
      });

      if(!response.ok){
        throw new Error(`baitbuster_http_${response.status}`);
      }

      const payload=await response.json();

      if(payload?.ok!==true||!Array.isArray(payload.results)){
        throw new Error("baitbuster_invalid_response");
      }

      const result=payload.results.find(row=>clean(row?.key)===story.key)||
        payload.results[0]||
        null;

      if(!result){
        throw new Error("baitbuster_missing_result");
      }

      if(result.flowTitle){
        result.flowTitle=clean(result.flowTitle);
      }

      lastError="";
      resultByKey.set(story.key,result);
      return result;
    }catch(error){
      lastError=String(error?.message||error||"baitbuster_error");
      console.warn("BaitBuster:",lastError);
      throw error;
    }finally{
      clearTimeout(timeout);
    }
  }

  function prepareStory(rawStory){
    if(!featureEnabled)return Promise.resolve(null);

    const story=normalizeStory(rawStory);
    if(!story)return Promise.resolve(null);

    if(resultByKey.has(story.key)){
      return Promise.resolve(resultByKey.get(story.key));
    }

    if(requestByKey.has(story.key)){
      return requestByKey.get(story.key);
    }

    const promise=requestStory(story)
      .finally(()=>{
        requestByKey.delete(story.key);
      });

    requestByKey.set(story.key,promise);
    return promise;
  }

  function applyToSlide(slide,rawStory,result){
    const story=normalizeStory(rawStory);
    if(!story){
      clearSlide(slide,{restore:false});
      return false;
    }

    const resolved=
      result ||
      resultByKey.get(story.key) ||
      null;

    return renderResult(slide,story,resolved);
  }

  async function prepareAndApply(slide,rawStory){
    const story=normalizeStory(rawStory);
    if(!story){
      clearSlide(slide,{restore:false});
      return null;
    }

    let result=null;
    try{
      result=await prepareStory(story);
    }catch{
      result=null;
    }

    applyToSlide(slide,story,result);
    return result;
  }

  function prefetchStories(items){
    if(!featureEnabled||!Array.isArray(items))return;

    for(const item of items.slice(0,2)){
      void prepareStory(item).catch(()=>{});
    }
  }

  function syncSettingButton(){
    if(!settingButton)return;

    settingButton.classList.toggle("active",featureEnabled);
    settingButton.setAttribute(
      "aria-pressed",
      featureEnabled?"true":"false"
    );

    const stateEl=settingButton.querySelector(".media-setting-state");
    if(stateEl)stateEl.textContent=UI.settingLabel(featureEnabled);
  }

  function setEnabled(value){
    featureEnabled=UI.saveEnabled(localStorage,Boolean(value));
    syncSettingButton();

    /*
      Aktif haber sistem tarafından sonradan değiştirilmez. Ayar değişikliği
      yalnız sonraki hazırlanan haberlere uygulanır. Kapatırken mevcut AI
      sunumu ise kullanıcı tercihini anında geri almak için orijinale döner.
    */
    if(!featureEnabled){
      for(const slide of slides)clearSlide(slide,{restore:true});
    }

    window.dispatchEvent(
      new CustomEvent("floew:baitbuster-setting-changed",{
        detail:{enabled:featureEnabled}
      })
    );
  }

  settingButton?.addEventListener("click",event=>{
    event.preventDefault();
    event.stopPropagation();
    setEnabled(!featureEnabled);
  });

  syncSettingButton();

  globalThis.BaitBusterBeta={
    version:CLIENT_VERSION,
    isEnabled:()=>featureEnabled,
    prepareStory,
    prepareAndApply,
    applyToSlide,
    prefetchStories,
    clearSlide,
    normalizeStory,
    getResult:rawStory=>{
      const story=normalizeStory(rawStory);
      return story?resultByKey.get(story.key)||null:null;
    },
    getLastError:()=>lastError
  };

  window.dispatchEvent(new Event("floew:baitbuster-ready"));
})();
