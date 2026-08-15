/*
 * Flöw mobile focus / transition fix
 * Base frontend: 31.21.0
 * Fix version: 31.21.2
 *
 * Main changes versus 31.21.1:
 * - focal position is LOCKED before a story transition starts;
 * - late analysis is never applied to an active/moving story;
 * - fast/manual swipes get a short focal-analysis grace period;
 * - browsers without FaceDetector use a much safer horizontal center bias;
 * - passive slides are hidden by the companion CSS during transform reset.
 */
(function(){
  "use strict";

  window.__floewMobileFocusFixVersion="31.21.2";

  if(
    !window.__floewAppStarted ||
    typeof mediaKey!=="function" ||
    typeof smartCropEnabled!=="function" ||
    typeof storyImageProxyUrl!=="function" ||
    typeof smartFocalFromPixels!=="function" ||
    typeof preloadStoryAssets!=="function" ||
    typeof scheduleNextStoryPreload!=="function" ||
    typeof setStoryStageVisible!=="function" ||
    typeof transitionTo!=="function"
  ){
    console.warn("Flöw mobile focus fix 31.21.2: compatible app.js not found.");
    return;
  }

  const FIX_FOCAL_CACHE_MAX=180;
  const FIX_FOCAL_SAMPLE=56;
  const FIX_FAST_FOCAL_WAIT_MS=520;
  const fixFocalCache=new Map();

  function clampFix(value,min,max){
    return Math.max(min,Math.min(max,value));
  }

  function focalKeyFor(story){
    return `${mediaKey(story)}|${String(story?.image||"").trim()}`;
  }

  function focalPosition(focal){
    return `${focal.x.toFixed(1)}% ${focal.y.toFixed(1)}%`;
  }

  function rememberFocal(key,value){
    if(fixFocalCache.has(key))fixFocalCache.delete(key);
    fixFocalCache.set(key,value);
    while(fixFocalCache.size>FIX_FOCAL_CACHE_MAX){
      fixFocalCache.delete(fixFocalCache.keys().next().value);
    }
  }

  function timeoutValue(ms,value=null){
    return new Promise(resolve=>setTimeout(()=>resolve(value),ms));
  }

  /*
   * Native FaceDetector: use the complete meaningful face group, not only the
   * largest face. This is particularly important for two-person/group photos.
   *
   * No FaceDetector (notably many mobile browsers): the old generic saliency
   * detector could chase a logo/text/high-contrast object to an edge. In that
   * fallback we deliberately keep X close to center. This is less clever, but
   * substantially safer for people in a portrait viewport where most cropping
   * happens horizontally.
   */
  detectSmartFocalPoint=function(story){
    const source=String(story?.image||"").trim();
    if(!source)return Promise.resolve(null);

    const key=focalKeyFor(story);
    if(fixFocalCache.has(key))return fixFocalCache.get(key);

    const task=new Promise(resolve=>{
      const probe=new Image();
      let settled=false;

      const finish=value=>{
        if(settled)return;
        settled=true;
        clearTimeout(timeout);
        resolve(value);
      };

      const timeout=setTimeout(()=>finish(null),4500);
      probe.crossOrigin="anonymous";
      probe.referrerPolicy="no-referrer";
      probe.decoding="async";

      probe.onload=async()=>{
        try{
          const naturalWidth=probe.naturalWidth||probe.width||0;
          const naturalHeight=probe.naturalHeight||probe.height||0;
          if(!naturalWidth || !naturalHeight){
            finish(null);
            return;
          }

          if("FaceDetector" in window){
            try{
              const detector=new window.FaceDetector({
                fastMode:true,
                maxDetectedFaces:8
              });
              const detected=await detector.detect(probe);
              const faces=(Array.isArray(detected)?detected:[])
                .map(item=>item?.boundingBox)
                .filter(box=>
                  box &&
                  Number(box.width)>0 &&
                  Number(box.height)>0
                );

              if(faces.length){
                const largestArea=Math.max(
                  ...faces.map(face=>face.width*face.height)
                );
                const relevant=faces.filter(
                  face=>face.width*face.height>=largestArea*.10
                );
                const left=Math.min(...relevant.map(face=>face.x));
                const right=Math.max(...relevant.map(face=>face.x+face.width));
                const top=Math.min(...relevant.map(face=>face.y));
                const bottom=Math.max(...relevant.map(face=>face.y+face.height));
                const groupCenterX=(left+right)/2;
                const groupCenterY=(top+bottom)/2;
                const groupWidth=(right-left)/naturalWidth;

                /* Wide groups stay near geometric center so neither side is lost. */
                const x=groupWidth>.50
                  ? 50
                  : (groupCenterX/naturalWidth)*100;

                finish({
                  x:clampFix(x,24,76),
                  y:clampFix((groupCenterY/naturalHeight)*100,16,72)
                });
                return;
              }
            }catch(e){}
          }

          const scale=Math.min(
            FIX_FOCAL_SAMPLE/naturalWidth,
            FIX_FOCAL_SAMPLE/naturalHeight,
            1
          );
          const width=Math.max(8,Math.round(naturalWidth*scale));
          const height=Math.max(8,Math.round(naturalHeight*scale));
          const canvas=document.createElement("canvas");
          canvas.width=width;
          canvas.height=height;
          const ctx=canvas.getContext("2d",{willReadFrequently:true});
          if(!ctx){
            finish({x:50,y:46});
            return;
          }

          ctx.drawImage(probe,0,0,width,height);
          const pixels=ctx.getImageData(0,0,width,height).data;
          const raw=smartFocalFromPixels(pixels,width,height);
          if(!raw){
            finish({x:50,y:46});
            return;
          }

          /*
           * Keep horizontal movement intentionally small without true face data.
           * Vertical movement may be a little stronger because portrait-screen
           * cropping of landscape news images is predominantly horizontal.
           */
          const safeX=50+(Number(raw.x)-50)*.20;
          const safeY=46+(Number(raw.y)-46)*.45;
          finish({
            x:clampFix(safeX,42,58),
            y:clampFix(safeY,28,64)
          });
        }catch(e){
          finish({x:50,y:46});
        }
      };

      probe.onerror=()=>finish({x:50,y:46});
      probe.src=storyImageProxyUrl(story)||source;
    }).then(value=>{
      rememberFocal(key,Promise.resolve(value));
      return value;
    });

    rememberFocal(key,task);
    return task;
  };

  /*
   * Reset our lock whenever the image element is reused for another story.
   * The base setter then calls the patched applySmartFocalPoint below.
   */
  const originalSetStoryImage=setStoryImage;
  setStoryImage=function(img,story){
    if(img){
      delete img.dataset.focalLockedKey;
      img.style.objectPosition="50% 50%";
    }
    return originalSetStoryImage(img,story);
  };

  /*
   * Never change the crop of an active or moving slide. Analysis is allowed to
   * settle only while the slide is passive (preload stage), before its focal
   * position is locked for presentation.
   */
  applySmartFocalPoint=function(img,story){
    if(!img)return;

    img.style.objectPosition="50% 50%";
    if(!smartCropEnabled())return;

    const key=focalKeyFor(story);
    img.dataset.focalKey=key;

    const run=async()=>{
      const focal=await detectSmartFocalPoint(story);
      if(
        !focal ||
        img.dataset.focalKey!==key ||
        img.dataset.focalLockedKey===key ||
        !smartCropEnabled()
      )return;

      const slide=img.closest(".slide");
      if(!slide)return;

      /* Active/animated images never receive a late object-position update. */
      if(
        slide.classList.contains("active") ||
        slide.classList.contains("enter-up") ||
        slide.classList.contains("exit-up") ||
        slide.classList.contains("enter-down") ||
        slide.classList.contains("exit-down") ||
        slide.classList.contains("enter-left") ||
        slide.classList.contains("exit-left") ||
        slide.classList.contains("enter-right") ||
        slide.classList.contains("exit-right")
      )return;

      img.style.objectPosition=focalPosition(focal);
    };

    if("requestIdleCallback" in window){
      window.requestIdleCallback(run,{timeout:650});
    }else{
      setTimeout(run,0);
    }
  };

  /* Start focus analysis together with normal media preloading. */
  const originalPreloadStoryAssets=preloadStoryAssets;
  preloadStoryAssets=function(story){
    if(story && smartCropEnabled()){
      detectSmartFocalPoint(story).catch(()=>{});
    }
    return originalPreloadStoryAssets(story);
  };

  /*
   * Mark the passive next slide ready only after its final image URL is decoded
   * AND focal position is resolved. This is the normal 10-second path.
   */
  scheduleNextStoryPreload=function(delay=70){
    clearTimeout(nextStoryPreloadTimer);

    nextStoryPreloadTimer=setTimeout(()=>{
      if(adActive || state.busy || state.stories.length<2)return;

      const index=nextStoryIndexForPreload();
      if(index<0)return;

      const story=state.stories[index];
      const fromKey=storyIdentity(state.stories[state.index]);
      const targetKey=storyIdentity(story);

      preloadStoryAssets(story);

      preloadImage(story.image).then(()=>{
        if(
          adActive ||
          state.busy ||
          storyIdentity(state.stories[state.index])!==fromKey ||
          storyIdentity(state.stories[index])!==targetKey
        )return;

        const inactiveSlide=slides[1-state.active];
        fill(inactiveSlide,story,{prepareMedia:false});
        inactiveSlide.className="slide";

        const image=inactiveSlide.querySelector(".slide-image");

        const cleanupReady=()=>{
          image?.removeEventListener("load",markReady);
          image?.removeEventListener("error",markReady);
        };

        const markReady=async()=>{
          await Promise.resolve();
          if(image && (!image.complete || !image.naturalWidth))return;

          if(image?.decode){
            try{await image.decode();}catch(e){}
          }

          if(
            adActive ||
            state.busy ||
            slides[1-state.active]!==inactiveSlide ||
            storyIdentity(state.stories[state.index])!==fromKey ||
            storyIdentity(state.stories[index])!==targetKey
          ){
            cleanupReady();
            return;
          }

          const key=focalKeyFor(story);
          let focal=null;
          if(image && smartCropEnabled()){
            try{focal=await detectSmartFocalPoint(story);}catch(e){}
          }

          if(
            adActive ||
            state.busy ||
            slides[1-state.active]!==inactiveSlide ||
            storyIdentity(state.stories[state.index])!==fromKey ||
            storyIdentity(state.stories[index])!==targetKey
          ){
            cleanupReady();
            return;
          }

          if(image){
            image.style.objectPosition=focal
              ? focalPosition(focal)
              : "50% 50%";
            image.dataset.focalLockedKey=key;
          }

          inactiveSlide.dataset.preloadedStoryKey=targetKey;
          cleanupReady();
        };

        image?.addEventListener("load",markReady);
        image?.addEventListener("error",markReady);
        markReady();
      }).catch(()=>{});
    },Math.max(0,delay));
  };

  /*
   * Critical path for an early/manual swipe. The base 31.21.0 transition waits
   * for image decode, but not focal analysis. Here focus analysis starts before
   * image preparation and receives a short grace period before animation. Once
   * chosen, that object-position is locked until the image element is reused.
   */
  transitionTo=async function(nextIndex,fromHistory,dir){
    if(state.busy)return;

    state.busy=true;
    clearTimeout(state.timer);

    const currentSlide=slides[state.active];
    const nextSlide=slides[1-state.active];
    const story=state.stories[nextIndex];
    const key=focalKeyFor(story);
    const focalTask=smartCropEnabled()
      ? detectSmartFocalPoint(story).catch(()=>null)
      : Promise.resolve(null);

    if(!slidePreloadedForStory(nextSlide,story)){
      await preloadImage(story.image);
    }
    preloadStoryAssets(story);

    prepareTransitionSlide(nextSlide,story);

    const nextImage=nextSlide.querySelector(".slide-image");
    if(nextImage?.decode){
      try{await nextImage.decode();}catch(e){}
    }

    let focal=null;
    if(smartCropEnabled()){
      try{
        focal=await Promise.race([
          focalTask,
          timeoutValue(FIX_FAST_FOCAL_WAIT_MS,null)
        ]);
      }catch(e){}
    }

    /* If preloader already locked the exact story, preserve that result. */
    if(nextImage && nextImage.dataset.focalLockedKey!==key){
      nextImage.style.objectPosition=focal
        ? focalPosition(focal)
        : "50% 50%";
      nextImage.dataset.focalLockedKey=key;
    }

    currentSlide.className="slide";
    nextSlide.className="slide";

    void nextSlide.offsetWidth;

    const [enterClass,exitClass]=transitionPair(dir);

    startPiPTransition(
      state.stories[state.index],
      story,
      dir
    );

    nextSlide.classList.add(enterClass);
    currentSlide.classList.add(exitClass);
    activateSlideMedia(nextSlide,story);

    nextSlide.addEventListener(
      "animationend",
      ()=>{
        nextSlide.className="slide active";
        currentSlide.className="slide";
        stopSlideMedia(currentSlide);

        state.active=1-state.active;
        state.index=nextIndex;
        updateKeywordAlert(story);

        if(dir>0){
          newsShownSinceAd++;
        }

        state.busy=false;
        timer();
      },
      {once:true}
    );
  };

  /*
   * Tell CSS whether story slides should be visible at all. This also makes the
   * outgoing-slide transform reset invisible after animationend.
   */
  const originalSetStoryStageVisible=setStoryStageVisible;
  setStoryStageVisible=function(visible){
    const wall=document.getElementById("wall");
    if(wall){
      wall.dataset.storyStageVisible=visible?"1":"0";
    }
    return originalSetStoryStageVisible(visible);
  };

  const wall=document.getElementById("wall");
  if(wall && !wall.dataset.storyStageVisible){
    wall.dataset.storyStageVisible="1";
  }

  try{
    scheduleNextStoryPreload(0);
  }catch(e){}
})();
