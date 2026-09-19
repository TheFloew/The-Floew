(()=>{
  "use strict";

  const ENDPOINT="https://thefloew-baitbuster.thefloewback.workers.dev/v1/evaluate";
  const MAX_BATCH=12;
  const SCAN_DEBOUNCE_MS=180;
  const FETCH_TIMEOUT_MS=20000;
  const slides=[...document.querySelectorAll("#a,#b")];
  const UI=globalThis.BaitBusterUI;
  const settingButton=document.getElementById("baitbuster-setting");
  if(!slides.length||!UI)return;

  const pendingKeys=new Set();
  const completedKeys=new Set();
  const resultByKey=new Map();
  const queued=new Map();
  const appliedState=new WeakMap();
  let scanTimer=0;
  let requestInFlight=false;
  let activeController=null;
  let featureEnabled=UI.loadEnabled(localStorage);

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
    const expectedHeading=clean(UI.headlineForMode(state,state.mode));

    if(currentUrl!==state.url||currentHeading!==expectedHeading){
      clearRewritePresentation(slide);
    }
  }

  function storyFromStateItem(item){
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

  function queueUpcomingStories(){
    try{
      if(
        typeof state==="undefined" ||
        !state ||
        !Array.isArray(state.stories) ||
        !state.stories.length
      )return;

      const start=Math.max(0,Number(state.index)||0);
      const end=Math.min(state.stories.length,start+MAX_BATCH);
      for(let i=start;i<end;i++){
        const story=storyFromStateItem(state.stories[i]);
        if(!story)continue;
        if(
          pendingKeys.has(story.key) ||
          completedKeys.has(story.key) ||
          queued.has(story.key)
        )continue;
        queued.set(story.key,story);
      }
    }catch{}
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

  function updateMarkerLabel(marker,mode){
    const title=UI.markerTitleForMode(mode);
    marker.removeAttribute("title");
    marker.dataset.tooltip=title;
    marker.setAttribute("aria-label",title);
    marker.setAttribute("aria-pressed",mode==="original"?"true":"false");
  }

  function renderAppliedState(slide,state){
    const heading=slide.querySelector("h1");
    if(!heading)return;

    heading.dataset.baitbusterOriginalTitle=state.originalTitle;
    heading.dataset.baitbusterApplied="1";
    heading.textContent=UI.headlineForMode(state,state.mode);

    markerFor(slide)?.remove();
    const marker=document.createElement("button");
    marker.type="button";
    marker.className="baitbuster-rewrite-mark";
    marker.textContent=UI.markerText();
    updateMarkerLabel(marker,state.mode);

    const stopGesture=event=>{
      event.stopPropagation();
    };
    const toggleHeadline=event=>{
      UI.stopNavigationEvent(event);

      const current=appliedState.get(slide);
      if(!current)return;

      current.mode=UI.nextMode(current.mode);
      heading.textContent=UI.headlineForMode(current,current.mode);
      updateMarkerLabel(marker,current.mode);
    };

    marker.addEventListener("pointerdown",stopGesture);
    marker.addEventListener("pointerup",toggleHeadline);
    marker.addEventListener("pointercancel",stopGesture);
    marker.addEventListener("touchstart",event=>event.stopPropagation(),{passive:true});
    marker.addEventListener("touchend",event=>event.stopPropagation(),{passive:true});
    marker.addEventListener("click",event=>{
      UI.stopNavigationEvent(event);
    });
    marker.addEventListener("keydown",event=>{
      if(event.key!=="Enter"&&event.key!==" ")return;
      toggleHeadline(event);
    });

    heading.insertAdjacentElement("beforebegin",marker);
  }

  function applyResultToSlide(slide,result){
    if(result?.rewriteStatus!=="rewritten"||!clean(result.flowTitle))return;
    resetIfSlideReused(slide);
    const story=readSlideStory(slide);
    if(!story||story.key!==result.key)return;

    const flowTitle=clean(result.flowTitle);
    const previous=appliedState.get(slide);
    const existingMarker=markerFor(slide);

    if(UI.canReusePresentation(previous,story,flowTitle,Boolean(existingMarker))){
      const heading=slide.querySelector("h1");
      if(heading){
        const expectedTitle=UI.headlineForMode(previous,previous.mode);
        if(clean(heading.textContent)!==clean(expectedTitle)){
          heading.textContent=expectedTitle;
        }
      }
      updateMarkerLabel(existingMarker,previous.mode);
      return;
    }

    const stateForSlide={
      key:story.key,
      url:story.url,
      originalTitle:story.title,
      flowTitle,
      mode:previous?.key===story.key
        ? previous.mode
        : "ai"
    };

    appliedState.set(slide,stateForSlide);
    renderAppliedState(slide,stateForSlide);
  }

  function applyResult(result){
    for(const slide of slides)applyResultToSlide(slide,result);
  }

  async function flushQueue(){
    if(!featureEnabled||requestInFlight||!queued.size)return;
    const batch=[...queued.values()].slice(0,MAX_BATCH);
    for(const story of batch){
      queued.delete(story.key);
      pendingKeys.add(story.key);
    }
    requestInFlight=true;

    const controller=new AbortController();
    activeController=controller;
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
      if(!featureEnabled)return;
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
        resultByKey.set(key,result);
        applyResult(result);
      }
      for(const story of batch){
        if(!returned.has(story.key))pendingKeys.delete(story.key);
      }
    }catch{
      for(const story of batch)pendingKeys.delete(story.key);
    }finally{
      clearTimeout(timeout);
      if(activeController===controller)activeController=null;
      requestInFlight=false;
      if(featureEnabled&&queued.size)queueMicrotask(flushQueue);
    }
  }

  function scanSlides(){
    scanTimer=0;
    if(!featureEnabled)return;
    queueUpcomingStories();

    for(const slide of slides){
      resetIfSlideReused(slide);
      const story=readSlideStory(slide);
      if(!story)continue;

      const cachedResult=resultByKey.get(story.key);
      if(cachedResult){
        applyResultToSlide(slide,cachedResult);
        continue;
      }

      if(
        pendingKeys.has(story.key) ||
        completedKeys.has(story.key) ||
        queued.has(story.key)
      )continue;

      queued.set(story.key,story);
    }

    void flushQueue();
  }

  function scheduleScan(){
    clearTimeout(scanTimer);
    if(!featureEnabled)return;
    scanTimer=setTimeout(scanSlides,SCAN_DEBOUNCE_MS);
  }

  function restoreOriginalHeadlines(){
    for(const slide of slides){
      const current=appliedState.get(slide);
      const heading=slide.querySelector("h1");
      if(current&&heading){
        heading.textContent=current.originalTitle;
      }
      clearRewritePresentation(slide);
    }
  }

  function syncSettingButton(){
    if(!settingButton)return;
    settingButton.classList.toggle("active",featureEnabled);
    settingButton.setAttribute("aria-pressed",featureEnabled?"true":"false");
    const stateEl=settingButton.querySelector(".media-setting-state");
    if(stateEl)stateEl.textContent=UI.settingLabel(featureEnabled);
  }

  function setFeatureEnabled(enabled){
    featureEnabled=UI.saveEnabled(localStorage,Boolean(enabled));
    syncSettingButton();

    if(!featureEnabled){
      clearTimeout(scanTimer);
      scanTimer=0;
      queued.clear();
      pendingKeys.clear();
      activeController?.abort();
      restoreOriginalHeadlines();
      return;
    }

    scheduleScan();
  }

  settingButton?.addEventListener("click",event=>{
    event.preventDefault();
    event.stopPropagation();
    setFeatureEnabled(!featureEnabled);
  });
  syncSettingButton();

  const observer=new MutationObserver(scheduleScan);
  for(const slide of slides){
    observer.observe(slide,{
      subtree:true,
      childList:true,
      characterData:true,
      attributes:true
    });
  }

  if(featureEnabled)scheduleScan();
})();
