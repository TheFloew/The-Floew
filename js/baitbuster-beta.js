(()=>{
  "use strict";

  const ENDPOINT="https://thefloew-baitbuster.thefloewback.workers.dev/v1/evaluate";
  const CLIENT_VERSION="13";
  const PREFETCH_COUNT=2;
  const SCAN_DEBOUNCE_MS=180;
  const FETCH_TIMEOUT_MS=20000;
  const slides=[...document.querySelectorAll("#a,#b")];
  const UI=globalThis.BaitBusterUI;
  const settingButton=document.getElementById("baitbuster-setting");
  if(!slides.length||!UI)return;

  const pendingKeys=new Set();
  const completedKeys=new Set();
  const resultByKey=new Map();
  const foregroundQueue=new Map();
  const prefetchQueue=new Map();
  const appliedState=new WeakMap();
  const requestState={
    foreground:{inFlight:false,controller:null},
    prefetch:{inFlight:false,controller:null}
  };
  let scanTimer=0;
  let featureEnabled=UI.loadEnabled(localStorage);

  function isPageVisible(){
    return document.visibilityState==="visible";
  }

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

  function storyAlreadyScheduled(key){
    return Boolean(
      pendingKeys.has(key) ||
      completedKeys.has(key) ||
      foregroundQueue.has(key) ||
      prefetchQueue.has(key)
    );
  }

  function enqueueStory(queue,story){
    if(!story||storyAlreadyScheduled(story.key))return false;
    queue.set(story.key,story);
    return true;
  }

  function queueStateWindow(){
    try{
      if(
        typeof state==="undefined" ||
        !state ||
        !Array.isArray(state.stories) ||
        !state.stories.length
      )return false;

      const start=Math.max(0,Number(state.index)||0);
      const current=storyFromStateItem(state.stories[start]);
      const prefetched=[];
      const end=Math.min(
        state.stories.length,
        start+1+PREFETCH_COUNT
      );

      for(let i=start+1;i<end;i++){
        const story=storyFromStateItem(state.stories[i]);
        if(story)prefetched.push(story);
      }

      const desiredForegroundKey=current?.key||"";
      const desiredPrefetchKeys=new Set(
        prefetched.map(story=>story.key)
      );

      for(const key of foregroundQueue.keys()){
        if(key!==desiredForegroundKey)foregroundQueue.delete(key);
      }
      for(const key of prefetchQueue.keys()){
        if(!desiredPrefetchKeys.has(key))prefetchQueue.delete(key);
      }

      if(current){
        prefetchQueue.delete(current.key);
        if(
          !pendingKeys.has(current.key) &&
          !completedKeys.has(current.key) &&
          !foregroundQueue.has(current.key)
        ){
          foregroundQueue.set(current.key,current);
        }
      }

      for(const story of prefetched){
        if(foregroundQueue.has(story.key))continue;
        enqueueStory(prefetchQueue,story);
      }
      return true;
    }catch{
      return false;
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
    const beginPress=event=>{
      event.stopPropagation();
      marker.classList.add("is-pressing");
      try{marker.setPointerCapture?.(event.pointerId);}catch{}
    };
    const endPress=event=>{
      marker.classList.remove("is-pressing");
      try{
        if(marker.hasPointerCapture?.(event.pointerId)){
          marker.releasePointerCapture?.(event.pointerId);
        }
      }catch{}
    };
    const toggleHeadline=event=>{
      endPress(event);
      UI.stopNavigationEvent(event);

      const current=appliedState.get(slide);
      if(!current)return;

      current.mode=UI.nextMode(current.mode);
      heading.textContent=UI.headlineForMode(current,current.mode);
      updateMarkerLabel(marker,current.mode);
    };

    marker.addEventListener("pointerdown",beginPress);
    marker.addEventListener("pointerup",toggleHeadline);
    marker.addEventListener("pointercancel",event=>{
      stopGesture(event);
      endPress(event);
    });
    marker.addEventListener("lostpointercapture",()=>marker.classList.remove("is-pressing"));
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

  async function flushLane(queue,laneName,batchSize){
    const lane=requestState[laneName];
    if(
      !featureEnabled ||
      !isPageVisible() ||
      lane.inFlight ||
      !queue.size
    )return;

    const batch=[...queue.values()].slice(0,batchSize);
    for(const story of batch){
      queue.delete(story.key);
      pendingKeys.add(story.key);
    }
    lane.inFlight=true;

    const controller=new AbortController();
    lane.controller=controller;
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
        body:JSON.stringify({stories:batch})
      });
      if(!response.ok)throw new Error(`baitbuster_http_${response.status}`);
      const payload=await response.json();
      if(!featureEnabled||!isPageVisible())return;
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
      if(lane.controller===controller)lane.controller=null;
      lane.inFlight=false;
      if(featureEnabled&&queue.size){
        queueMicrotask(()=>flushLane(queue,laneName,batchSize));
      }
    }
  }

  function flushForegroundQueue(){
    return flushLane(foregroundQueue,"foreground",1);
  }

  function flushPrefetchQueue(){
    return flushLane(prefetchQueue,"prefetch",PREFETCH_COUNT);
  }

  function scanSlides(){
    scanTimer=0;
    if(!featureEnabled||!isPageVisible())return;
    const queuedFromState=queueStateWindow();

    for(const slide of slides){
      resetIfSlideReused(slide);
      const story=readSlideStory(slide);
      if(!story)continue;

      const cachedResult=resultByKey.get(story.key);
      if(cachedResult){
        applyResultToSlide(slide,cachedResult);
        continue;
      }

      if(queuedFromState)continue;
      if(storyAlreadyScheduled(story.key))continue;

      const queue=slide.classList.contains("active")
        ? foregroundQueue
        : prefetchQueue;
      enqueueStory(queue,story);
    }

    void flushForegroundQueue();
    void flushPrefetchQueue();
  }

  function scheduleScan(){
    clearTimeout(scanTimer);
    if(!featureEnabled||!isPageVisible())return;
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
      foregroundQueue.clear();
      prefetchQueue.clear();
      pendingKeys.clear();
      requestState.foreground.controller?.abort();
      requestState.prefetch.controller?.abort();
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

  document.addEventListener("visibilitychange",()=>{
    if(!featureEnabled)return;

    if(!isPageVisible()){
      clearTimeout(scanTimer);
      scanTimer=0;
      foregroundQueue.clear();
      prefetchQueue.clear();
      pendingKeys.clear();
      requestState.foreground.controller?.abort();
      requestState.prefetch.controller?.abort();
      return;
    }

    scheduleScan();
  });

  function handleSlideMutations(records){
    const touched=new Set();

    for(const record of records){
      const target=record?.target;
      const element=target?.nodeType===1
        ? target
        : target?.parentElement;
      const slide=element?.closest?.("#a,#b");
      if(slide&&slides.includes(slide))touched.add(slide);
    }

    for(const slide of touched){
      resetIfSlideReused(slide);
    }
    scheduleScan();
  }

  const observer=new MutationObserver(handleSlideMutations);
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
