(()=>{
  "use strict";

  const ENDPOINT="https://thefloew-baitbuster.thefloewback.workers.dev/v1/evaluate";
  const MAX_BATCH=12;
  const SCAN_DEBOUNCE_MS=180;
  const FETCH_TIMEOUT_MS=20000;
  const slides=[...document.querySelectorAll("#a,#b")];
  if(!slides.length)return;

  const pendingKeys=new Set();
  const completedKeys=new Set();
  const queued=new Map();
  const appliedState=new WeakMap();
  let scanTimer=0;
  let requestInFlight=false;

  function clean(value){
    return String(value||"").replace(/\s+/g," ").trim();
  }

  function httpUrl(value){
    try{
      const url=new URL(String(value||""),location.href);
      if(url.protocol!=="https:"&&url.protocol!=="http:")return "";
      return url.href;
    }catch{return "";}
  }

  function markerFor(slide){
    return slide.querySelector(".baitbuster-rewrite-mark");
  }

  function clearRewritePresentation(slide){
    const heading=slide.querySelector("h1");
    if(heading){
      delete heading.dataset.baitbusterOriginalTitle;
      delete heading.dataset.baitbusterApplied;
    }
    markerFor(slide)?.remove();
    appliedState.delete(slide);
  }

  function resetIfSlideReused(slide){
    const state=appliedState.get(slide);
    if(!state)return;
    const heading=slide.querySelector("h1");
    const rawHref=slide.querySelector(".source-link")?.getAttribute("href")||"";
    const currentUrl=httpUrl(rawHref);
    const currentHeading=clean(heading?.textContent);

    if(currentUrl!==state.url||currentHeading!==state.flowTitle){
      clearRewritePresentation(slide);
    }
  }

  function readSlideStory(slide){
    const heading=slide.querySelector("h1");
    if(!heading)return null;

    const title=clean(
      heading.dataset.baitbusterOriginalTitle||heading.textContent
    );
    const rawHref=slide.querySelector(".source-link")?.getAttribute("href")||"";
    if(!rawHref||rawHref==="#")return null;
    const url=httpUrl(rawHref);
    if(!title||!url)return null;

    const description=clean(slide.querySelector(".description")?.textContent);
    const source=clean(slide.querySelector(".source")?.textContent);
    const category=clean(slide.querySelector(".category")?.textContent);
    const key=`${url}|${title}`.slice(0,900);

    return {key,url,title,description,source,category};
  }

  function applyResultToSlide(slide,result){
    if(result?.rewriteStatus!=="rewritten"||!clean(result.flowTitle))return;
    resetIfSlideReused(slide);
    const story=readSlideStory(slide);
    if(!story||story.key!==result.key)return;

    const heading=slide.querySelector("h1");
    if(!heading)return;
    const flowTitle=clean(result.flowTitle);
    if(!heading.dataset.baitbusterOriginalTitle){
      heading.dataset.baitbusterOriginalTitle=story.title;
    }
    heading.textContent=flowTitle;
    heading.dataset.baitbusterApplied="1";

    markerFor(slide)?.remove();
    const marker=document.createElement("span");
    marker.className="baitbuster-rewrite-mark";
    marker.textContent="✦";
    marker.title="BaitBuster β tarafından sadeleştirildi";
    marker.setAttribute("aria-label","BaitBuster beta tarafından sadeleştirildi");
    heading.insertAdjacentElement("afterend",marker);

    appliedState.set(slide,{
      key:story.key,
      url:story.url,
      originalTitle:story.title,
      flowTitle
    });
  }

  function applyResult(result){
    for(const slide of slides)applyResultToSlide(slide,result);
  }

  async function flushQueue(){
    if(requestInFlight||!queued.size)return;
    const batch=[...queued.values()].slice(0,MAX_BATCH);
    for(const story of batch){
      queued.delete(story.key);
      pendingKeys.add(story.key);
    }
    requestInFlight=true;

    const controller=new AbortController();
    const timeout=setTimeout(()=>controller.abort(),FETCH_TIMEOUT_MS);
    try{
      const response=await fetch(ENDPOINT,{
        method:"POST",
        mode:"cors",
        credentials:"omit",
        cache:"no-store",
        signal:controller.signal,
        headers:{"Content-Type":"application/json"},
        body:JSON.stringify({stories:batch})
      });
      if(!response.ok)throw new Error(`baitbuster_http_${response.status}`);
      const payload=await response.json();
      if(payload?.ok!==true||!Array.isArray(payload.results)){
        throw new Error("baitbuster_invalid_response");
      }

      const returned=new Set();
      for(const result of payload.results){
        const key=clean(result?.key);
        if(!key)continue;
        returned.add(key);
        pendingKeys.delete(key);
        completedKeys.add(key);
        applyResult(result);
      }
      for(const story of batch){
        if(!returned.has(story.key))pendingKeys.delete(story.key);
      }
    }catch{
      for(const story of batch)pendingKeys.delete(story.key);
    }finally{
      clearTimeout(timeout);
      requestInFlight=false;
      if(queued.size)queueMicrotask(flushQueue);
    }
  }

  function scanSlides(){
    scanTimer=0;
    for(const slide of slides){
      resetIfSlideReused(slide);
      const story=readSlideStory(slide);
      if(!story)continue;
      if(pendingKeys.has(story.key)||completedKeys.has(story.key)||queued.has(story.key))continue;
      queued.set(story.key,story);
    }
    void flushQueue();
  }

  function scheduleScan(){
    clearTimeout(scanTimer);
    scanTimer=setTimeout(scanSlides,SCAN_DEBOUNCE_MS);
  }

  const observer=new MutationObserver(scheduleScan);
  for(const slide of slides){
    observer.observe(slide,{
      subtree:true,
      childList:true,
      characterData:true,
      attributes:true
    });
  }

  scheduleScan();
})();
