/*
 * Flöw mobile focus / transition hotfix
 * Base frontend: 31.21.0
 * Hotfix: 31.21.1
 *
 * Goals:
 * - Prefer the whole meaningful face group instead of only the largest face.
 * - Keep non-face fallback focus closer to the safe center on mobile.
 * - Pre-compute the next story's focal point before marking its slide ready.
 * - Never change object-position while a slide is physically moving.
 * - Keep passive slides hidden so their transform reset cannot flash on screen.
 */
(function(){
  "use strict";

  window.__floewMobileFocusFixVersion="31.21.1";

  if(
    !window.__floewAppStarted ||
    typeof mediaKey!=="function" ||
    typeof smartCropEnabled!=="function" ||
    typeof storyImageProxyUrl!=="function" ||
    typeof smartFocalFromPixels!=="function" ||
    typeof preloadStoryAssets!=="function" ||
    typeof scheduleNextStoryPreload!=="function" ||
    typeof setStoryStageVisible!=="function"
  ){
    console.warn("Flöw mobile focus hotfix: compatible app.js not found.");
    return;
  }

  const HOTFIX_TRANSITION_CLASSES=[
    "enter-up","exit-up","enter-down","exit-down",
    "enter-left","exit-left","enter-right","exit-right"
  ];
  const HOTFIX_FOCAL_SAMPLE=48;
  const HOTFIX_FOCAL_CACHE_MAX=180;
  const hotfixFocalCache=new Map();

  function clampHotfix(value,min,max){
    return Math.max(min,Math.min(max,value));
  }

  function isFlowTransitioning(slide){
    return Boolean(
      slide &&
      HOTFIX_TRANSITION_CLASSES.some(
        className=>slide.classList.contains(className)
      )
    );
  }

  function focalPosition(focal){
    return `${focal.x.toFixed(1)}% ${focal.y.toFixed(1)}%`;
  }

  function rememberFocal(key,value){
    if(hotfixFocalCache.has(key))hotfixFocalCache.delete(key);
    hotfixFocalCache.set(key,value);

    while(hotfixFocalCache.size>HOTFIX_FOCAL_CACHE_MAX){
      hotfixFocalCache.delete(hotfixFocalCache.keys().next().value);
    }
  }

  /*
    Replace the 31.21.0 focal detector. The old FaceDetector branch selected
    only the largest face. Here, faces that are at least 12% of the largest
    face are treated as one meaningful group and the group's center is used.
  */
  detectSmartFocalPoint=function(story){
    const source=String(story?.image||"").trim();
    if(!source)return Promise.resolve(null);

    const key=`${mediaKey(story)}|${source}`;
    if(hotfixFocalCache.has(key))return hotfixFocalCache.get(key);

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
          const naturalWidth=probe.naturalWidth||0;
          const naturalHeight=probe.naturalHeight||0;

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

                const relevantFaces=faces.filter(
                  face=>face.width*face.height>=largestArea*.12
                );

                const left=Math.min(...relevantFaces.map(face=>face.x));
                const right=Math.max(...relevantFaces.map(face=>face.x+face.width));
                const top=Math.min(...relevantFaces.map(face=>face.y));
                const bottom=Math.max(...relevantFaces.map(face=>face.y+face.height));

                const centerX=(left+right)/2;
                const centerY=(top+bottom)/2;
                const groupWidth=(right-left)/naturalWidth;

                /*
                  Very wide groups are safer around the geometric center.
                  object-fit:cover cannot zoom out, so this avoids pulling the
                  crop toward one edge and losing the opposite person.
                */
                const faceX=groupWidth>.58
                  ? 50
                  : (centerX/naturalWidth)*100;

                finish({
                  x:clampHotfix(faceX,20,80),
                  y:clampHotfix((centerY/naturalHeight)*100,14,74)
                });
                return;
              }
            }catch(e){
              /* Fall through to the pixel heuristic. */
            }
          }

          const scale=Math.min(
            HOTFIX_FOCAL_SAMPLE/naturalWidth,
            HOTFIX_FOCAL_SAMPLE/naturalHeight,
            1
          );
          const width=Math.max(8,Math.round(naturalWidth*scale));
          const height=Math.max(8,Math.round(naturalHeight*scale));
          const canvas=document.createElement("canvas");
          canvas.width=width;
          canvas.height=height;

          const ctx=canvas.getContext("2d",{willReadFrequently:true});
          if(!ctx){
            finish(null);
            return;
          }

          ctx.drawImage(probe,0,0,width,height);
          const pixels=ctx.getImageData(0,0,width,height).data;
          const raw=smartFocalFromPixels(pixels,width,height);

          if(!raw){
            finish(null);
            return;
          }

          /*
            The generic saliency heuristic can be attracted to bright text,
            logos or a high-contrast object at the edge. Pull it 35% toward
            center and use tighter safety limits so faces are less likely to
            disappear from a portrait viewport.
          */
          const centerBiasedX=50+(Number(raw.x)-50)*.65;
          const centerBiasedY=50+(Number(raw.y)-50)*.72;

          finish({
            x:clampHotfix(centerBiasedX,20,80),
            y:clampHotfix(centerBiasedY,14,74)
          });
        }catch(e){
          finish(null);
        }
      };

      probe.onerror=()=>finish(null);
      probe.src=storyImageProxyUrl(story)||source;
    }).then(value=>{
      rememberFocal(key,Promise.resolve(value));
      return value;
    });

    rememberFocal(key,task);
    return task;
  };

  /*
    Do not move the crop inside a slide while the slide itself is moving.
    If analysis finishes late, wait until animation end and only apply it to
    the slide that actually became active. CSS then eases that late correction.
  */
  applySmartFocalPoint=function(img,story){
    if(!img)return;

    img.style.objectPosition="50% 50%";
    if(!smartCropEnabled())return;

    const focalKey=`${mediaKey(story)}|${String(story?.image||"").trim()}`;
    img.dataset.focalKey=focalKey;

    const applyIfCurrent=focal=>{
      if(
        !focal ||
        img.dataset.focalKey!==focalKey ||
        !smartCropEnabled()
      )return;

      img.style.objectPosition=focalPosition(focal);
    };

    const run=async()=>{
      const focal=await detectSmartFocalPoint(story);
      if(
        !focal ||
        img.dataset.focalKey!==focalKey ||
        !smartCropEnabled()
      )return;

      const slide=img.closest(".slide");

      if(isFlowTransitioning(slide)){
        slide.addEventListener(
          "animationend",
          ()=>{
            if(slide.classList.contains("active")){
              requestAnimationFrame(()=>applyIfCurrent(focal));
            }
          },
          {once:true}
        );
        return;
      }

      applyIfCurrent(focal);
    };

    if("requestIdleCallback" in window){
      window.requestIdleCallback(run,{timeout:700});
    }else{
      setTimeout(run,0);
    }
  };

  /* Start focal analysis as soon as normal asset preloading starts. */
  const originalPreloadStoryAssets=preloadStoryAssets;
  preloadStoryAssets=function(story){
    if(story && smartCropEnabled()){
      detectSmartFocalPoint(story).catch(()=>{});
    }
    return originalPreloadStoryAssets(story);
  };

  /*
    31.21.0 marked the inactive slide as preloaded after image.decode(), even
    when focal analysis was still running. This version waits for focal data
    and writes object-position before data-preloaded-story-key is set.
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

          if(image && smartCropEnabled()){
            try{
              const focal=await detectSmartFocalPoint(story);
              if(
                focal &&
                slides[1-state.active]===inactiveSlide &&
                storyIdentity(state.stories[state.index])===fromKey &&
                storyIdentity(state.stories[index])===targetKey
              ){
                image.style.objectPosition=focalPosition(focal);
              }
            }catch(e){}
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
    Track whether the story stage as a whole should be visible. The matching
    CSS hides passive slides with !important so inline visibility="visible"
    from the base app cannot expose a slide during its transform reset.
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

  /* Prewarm the first next-story focus with the patched scheduler. */
  try{
    scheduleNextStoryPreload(0);
  }catch(e){}
})();
