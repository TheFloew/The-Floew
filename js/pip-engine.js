/* Flöw PiP | one-way presentation mirror of the committed feed and ad media.
   Intentionally never selects stories, advances the feed or opens PiP on its own. */
(function(root){
  "use strict";

  function create(config){
    const WIDTH=960,HEIGHT=540;
    const imageCache=new Map();
    const checkedVideoFrames=new WeakMap();
    const maxCache=28;
    let canvas=null,video=null,stream=null,frameTrack=null;
    let active=false,current=null,transition=null,timer=null;
    let generation=0,watchingMedia=false;
    let opening=false;
    const now=()=>performance.now();

    function mode(){
      if(typeof HTMLCanvasElement==="undefined" ||
         typeof HTMLVideoElement==="undefined" ||
         typeof HTMLCanvasElement.prototype.captureStream!=="function")return "none";
      if(typeof HTMLVideoElement.prototype.requestPictureInPicture==="function")return "standard";
      const probe=document.createElement("video");
      if(typeof probe.webkitSetPresentationMode==="function" &&
         typeof probe.webkitSupportsPresentationMode==="function" &&
         probe.webkitSupportsPresentationMode("picture-in-picture"))return "webkit";
      return "none";
    }

    function storyKey(story){
      return story ? "story|"+config.storyKey(story) : "";
    }
    function adKey(ad){
      return ad ? "ad|"+String(ad.id||"")+"|"+String(ad.src||"")+"|"+String(ad.type||"") : "";
    }
    function itemKey(item){
      return !item ? "" : item.kind==="ad" ? adKey(item.ad) : storyKey(item.story);
    }
    function makeStory(story){
      return {kind:"story",story,image:null,imageUrl:"",assetSerial:0,loading:false,failedAt:0};
    }
    function makeAd(ad){
      return {kind:"ad",ad,image:null,imageUrl:"",assetSerial:0,loading:false,failedAt:0};
    }
    function desiredItem(){
      const ad=config.currentAd();
      if(ad)return makeAd(ad);
      const story=config.currentStory();
      return story ? makeStory(story) : null;
    }
    function target(){
      return transition?.to||current;
    }
    function isTarget(item,epoch){
      return active && epoch===generation && target()===item;
    }
    function sourceUrl(url){
      try{
        const result=new URL(String(url||""),document.baseURI);
        return /^https?:$/.test(result.protocol)?result.href:"";
      }catch(_){return "";}
    }

    async function getImage(url){
      url=sourceUrl(url);
      if(!url)return null;
      if(imageCache.has(url))return imageCache.get(url);
      const promise=(async()=>{
        const proxy=sourceUrl(config.imageProxyBase);
        const parsed=new URL(url);
        const baseOrigin=new URL(document.baseURI).origin;
        const proxyParsed=proxy?new URL(proxy):null;
        const isProxy=Boolean(proxyParsed &&
          parsed.origin===proxyParsed.origin &&
          parsed.pathname===proxyParsed.pathname);
        const isSameOrigin=parsed.origin===baseOrigin;
        const candidates=[];
        if(isProxy||isSameOrigin)candidates.push(url);
        else if(proxy)candidates.push(proxy+"?url="+encodeURIComponent(url));

        for(const candidate of candidates){
          try{
            const response=await fetch(candidate,{
              mode:"cors",credentials:"omit",cache:"default"
            });
            if(!response.ok)continue;
            const blob=await response.blob();
            if(typeof createImageBitmap==="function"){
              const bitmap=await createImageBitmap(blob);
              if(bitmap?.width>0 && bitmap?.height>0)return bitmap;
            }
            const img=await new Promise((resolve,reject)=>{
              const el=new Image();
              const objectURL=URL.createObjectURL(blob);
              el.onload=()=>{URL.revokeObjectURL(objectURL);resolve(el);};
              el.onerror=()=>{URL.revokeObjectURL(objectURL);reject(new Error("decode"));};
              el.src=objectURL;
            });
            if(img.naturalWidth>0)return img;
          }catch(_){}
        }
        return null;
      })();
      imageCache.set(url,promise);
      // Bound both pending and decoded entries; never keep a failed result forever.
      if(imageCache.size>maxCache){
        const oldest=imageCache.keys().next().value;
        imageCache.delete(oldest);
      }
      promise.then(value=>{if(!value && imageCache.get(url)===promise)imageCache.delete(url);});
      return promise;
    }

    function slideFor(story){
      if(!story)return null;
      const key=config.storyKey(story);
      return config.slides.find(slide=>slide?.dataset?.storyKey===key)||null;
    }
    function visibleStoryImage(story){
      const slide=slideFor(story);
      const img=slide?.querySelector(".slide-image");
      if(!img || img.style?.visibility==="hidden" ||
         img.dataset?.imageStage==="failed" ||
         !img.complete || !img.naturalWidth)return "";
      return sourceUrl(img.currentSrc||img.src);
    }
    function visibleAdImage(ad){
      if(!ad || ad.type==="video")return "";
      const image=config.adImage;
      const fromDom=sourceUrl(image?.currentSrc||image?.src);
      const expected=sourceUrl(ad.src);
      // DOM ad image can still belong to a previous campaign while switching.
      return fromDom===expected && image?.complete && image?.naturalWidth
        ? fromDom : expected;
    }
    function imageUrlFor(item){
      if(!item)return "";
      return item.kind==="ad"
        ? visibleAdImage(item.ad)
        : visibleStoryImage(item.story);
    }

    /* A clean browser-decoded image can be copied immediately, without a
       second network request. Keep a snapshot, never a live recycled <img>. */
    function snapshotFromPage(item,url){
      const img=item.kind==="ad"
        ? config.adImage
        : slideFor(item.story)?.querySelector(".slide-image");
      if(!img || !img.complete || !img.naturalWidth || !img.naturalHeight ||
         sourceUrl(img.currentSrc||img.src)!==url)return null;
      const scale=Math.min(1,960/img.naturalWidth,540/img.naturalHeight);
      const w=Math.max(1,Math.round(img.naturalWidth*scale));
      const h=Math.max(1,Math.round(img.naturalHeight*scale));
      try{
        const copy=document.createElement("canvas");
        copy.width=w;copy.height=h;
        const ctx=copy.getContext("2d",{willReadFrequently:true});
        ctx.drawImage(img,0,0,w,h);
        ctx.getImageData(0,0,1,1);
        return copy;
      }catch(_){
        // A cross-origin image must not taint the streaming PiP canvas.
        return null;
      }
    }

    function refreshImage(item,epoch){
      if(!item || !isTarget(item,epoch))return;
      const url=imageUrlFor(item);
      const retry=Boolean(item.failedAt && now()-item.failedAt>=15000);
      if(item.imageUrl===url && !retry)return;
      item.imageUrl=url;
      item.image=null;
      item.failedAt=0;
      item.loading=false;
      const serial=++item.assetSerial;
      if(!url){draw();return;}
      const snapshot=snapshotFromPage(item,url);
      if(snapshot){
        item.image=snapshot;
        draw();
        return;
      }
      item.loading=true;
      void getImage(url).then(image=>{
        if(!isTarget(item,epoch) || item.assetSerial!==serial)return;
        // The visible slide could have upgraded its thumbnail to an article image.
        if(imageUrlFor(item)!==url){refreshImage(item,epoch);return;}
        item.loading=false;
        if(!image)item.failedAt=now();
        else item.image=image;
        draw();
      }).catch(()=>{
        if(!isTarget(item,epoch) || item.assetSerial!==serial)return;
        item.loading=false;
        item.failedAt=now();
        draw();
      });
    }

    function safeVideoFrame(media){
      if(!media || media.readyState<2 || !media.videoWidth || !media.videoHeight)return false;
      const src=String(media.currentSrc||media.src||"");
      const previous=checkedVideoFrames.get(media);
      if(previous?.src===src)return previous.safe;
      let safe=false;
      try{
        const sample=document.createElement("canvas");
        sample.width=sample.height=1;
        const ctx=sample.getContext("2d",{willReadFrequently:true});
        ctx.drawImage(media,0,0,1,1);
        ctx.getImageData(0,0,1,1);
        safe=true;
      }catch(_){safe=false;}
      checkedVideoFrames.set(media,{src,safe});
      return safe;
    }
    function storyVideo(item){
      if(item?.kind!=="story")return null;
      const slide=slideFor(item.story);
      const media=slide?.querySelector(".slide-video.media-visible");
      return media && safeVideoFrame(media) ? media : null;
    }
    function adVideo(item){
      if(item?.kind!=="ad" || item.ad.type!=="video")return null;
      const media=config.adVideo;
      if(sourceUrl(media?.currentSrc||media?.src)!==sourceUrl(item.ad.src))return null;
      return media && safeVideoFrame(media) ? media : null;
    }
    function liveVideo(item){
      const media=item?.kind==="ad"?adVideo(item):storyVideo(item);
      return media && !media.paused && !media.ended ? media : null;
    }

    function lines(ctx,text,maxWidth,maxLines){
      const words=String(text||"").trim().split(/\s+/);
      const result=[];
      let line="";
      for(const word of words){
        const next=line?line+" "+word:word;
        if(ctx.measureText(next).width<=maxWidth)line=next;
        else{
          if(line)result.push(line);
          line=word;
          if(result.length>=maxLines-1)break;
        }
      }
      if(line && result.length<maxLines)result.push(line);
      if(result.length===maxLines && result.join(" ").length<String(text||"").length){
        let last=result[maxLines-1];
        while(last.length>2 && ctx.measureText(last+"…").width>maxWidth){
          last=last.slice(0,-1);
        }
        result[maxLines-1]=last.trim()+"…";
      }
      return result;
    }
    function paintMedia(ctx,media,contain=false){
      if(!media)return false;
      const w=media.videoWidth||media.naturalWidth||media.width||0;
      const h=media.videoHeight||media.naturalHeight||media.height||0;
      if(w<=0||h<=0)return false;
      const scale=(contain?Math.min:Math.max)(WIDTH/w,HEIGHT/h);
      const dw=w*scale,dh=h*scale;
      try{
        ctx.drawImage(media,(WIDTH-dw)/2,(HEIGHT-dh)/2,dw,dh);
        return true;
      }catch(_){return false;}
    }
    function paintStory(ctx,item){
      ctx.fillStyle="#090909";
      ctx.fillRect(0,0,WIDTH,HEIGHT);
      paintMedia(ctx,storyVideo(item)||item.image,false);
      const grad=ctx.createLinearGradient(0,HEIGHT*.34,0,HEIGHT);
      grad.addColorStop(0,"rgba(0,0,0,0)");
      grad.addColorStop(1,"rgba(0,0,0,.92)");
      ctx.fillStyle=grad;
      ctx.fillRect(0,0,WIDTH,HEIGHT);
      ctx.textAlign="right";
      ctx.textBaseline="alphabetic";
      ctx.shadowColor="rgba(0,0,0,.65)";
      ctx.shadowBlur=7;
      ctx.font='700 18px "Comfortaa",Arial,sans-serif';
      ctx.fillStyle="rgba(255,255,255,.88)";
      ctx.fillText(item.story?.flowCategory||"",WIDTH-28,HEIGHT-132);
      ctx.font='700 20px "Comfortaa",Arial,sans-serif';
      ctx.fillStyle="#fff";
      ctx.fillText(item.story?.source||"",WIDTH-28,HEIGHT-102);
      const slide=slideFor(item.story);
      const visibleHeading=slide?.querySelector(".headline h1")?.textContent?.trim();
      ctx.font='700 34px "Comfortaa",Arial,sans-serif';
      const wrapped=lines(ctx,visibleHeading||item.story?.title||"Flöw",WIDTH-56,2);
      let y=HEIGHT-58-(wrapped.length-1)*40;
      for(const line of wrapped){ctx.fillText(line,WIDTH-28,y);y+=40;}
      ctx.shadowBlur=0;
    }
    function paintAd(ctx,item){
      ctx.fillStyle="#000";
      ctx.fillRect(0,0,WIDTH,HEIGHT);
      const videoMedia=adVideo(item);
      const painted=paintMedia(ctx,videoMedia||item.image,true);
      if(!painted && item.ad.type==="video"){
        ctx.textAlign="center";
        ctx.textBaseline="middle";
        ctx.fillStyle="rgba(255,255,255,.8)";
        ctx.font='700 30px "Comfortaa",Arial,sans-serif';
        ctx.fillText("Video reklamı",WIDTH/2,HEIGHT/2);
      }
      ctx.textAlign="right";
      ctx.textBaseline="top";
      ctx.shadowColor="rgba(0,0,0,.7)";
      ctx.shadowBlur=6;
      ctx.font='700 18px "Comfortaa",Arial,sans-serif';
      ctx.fillStyle="rgba(255,255,255,.85)";
      ctx.fillText("Reklam",WIDTH-24,22);
      ctx.shadowBlur=0;
    }
    function paint(ctx,item,x=0,y=0){
      if(!item)return;
      ctx.save();
      ctx.translate(x,y);
      ctx.beginPath();ctx.rect(0,0,WIDTH,HEIGHT);ctx.clip();
      if(item.kind==="ad")paintAd(ctx,item);
      else paintStory(ctx,item);
      ctx.restore();
    }
    function vector(dir){
      const sign=dir<0?-1:1;
      switch(config.direction()){
        case "down":return {x:0,y:-sign};
        case "left":return {x:sign,y:0};
        case "right":return {x:-sign,y:0};
        default:return {x:0,y:sign};
      }
    }
    function requestFrame(){
      try{frameTrack?.requestFrame?.();}catch(_){}
    }
    function draw(){
      if(!canvas)return;
      const ctx=canvas.getContext("2d");
      if(!ctx)return;
      ctx.clearRect(0,0,WIDTH,HEIGHT);
      if(transition){
        const fraction=Math.max(0,Math.min(1,(now()-transition.start)/420));
        const p=1-Math.pow(1-fraction,3);
        const move=transition.vector;
        paint(ctx,transition.from,-move.x*WIDTH*p,-move.y*HEIGHT*p);
        paint(ctx,transition.to,move.x*WIDTH*(1-p),move.y*HEIGHT*(1-p));
        if(fraction>=1){
          current=transition.to;
          transition=null;
        }
      }else if(current)paint(ctx,current);
      else{ctx.fillStyle="#090909";ctx.fillRect(0,0,WIDTH,HEIGHT);}
      requestFrame();
    }
    function resetTimer(){
      if(timer!==null){clearTimeout(timer);timer=null;}
    }
    function schedule(){
      resetTimer();
      if(!active)return;
      const item=target();
      const cadence=transition?48:liveVideo(item)?90:850;
      timer=setTimeout(tick,cadence);
    }
    function refreshTarget(){
      const item=target();
      if(item)refreshImage(item,generation);
    }
    function reconcile(){
      if(!active || config.isBusy() || config.isAdEntering())return;
      const next=desiredItem();
      if(itemKey(next)!==itemKey(target())){
        setTarget(next,1,false);
      }else{
        refreshTarget();
      }
    }
    function tick(){
      timer=null;
      if(!active)return;
      reconcile();
      draw();
      if(timer===null)schedule();
    }
    function setTarget(next,dir=1,animate=true){
      if(!active)return;
      if(itemKey(next)===itemKey(target())){refreshTarget();return;}
      const from=target();
      const epoch=++generation;
      if(from && next && animate && !document.hidden){
        transition={from,to:next,vector:vector(dir),start:now()};
      }else{
        transition=null;
        current=next;
      }
      refreshImage(next,epoch);
      draw();
      schedule();
    }

    function mediaUpdated(){
      if(!active)return;
      // Resolve after native image.onload had a chance to switch a thumbnail
      // to the final image URL, without replacing any host onload handlers.
      queueMicrotask(()=>{
        if(!active)return;
        refreshTarget();
        draw();
      });
    }
    function watchMedia(){
      if(watchingMedia)return;
      watchingMedia=true;
      for(const slide of config.slides){
        const img=slide?.querySelector(".slide-image");
        img?.addEventListener("load",mediaUpdated);
        img?.addEventListener("error",mediaUpdated);
      }
      config.adImage?.addEventListener("load",mediaUpdated);
      config.adImage?.addEventListener("error",mediaUpdated);
      config.adVideo?.addEventListener("loadeddata",mediaUpdated);
      config.adVideo?.addEventListener("seeked",mediaUpdated);
      document.addEventListener("visibilitychange",mediaUpdated);
    }

    function ensureVideo(){
      if(video)return video;
      canvas=document.createElement("canvas");
      canvas.width=WIDTH;
      canvas.height=HEIGHT;
      stream=canvas.captureStream(0);
      frameTrack=stream.getVideoTracks?.()[0]||null;
      // Some engines do not expose manual frame capture. Fallback stays light.
      if(typeof frameTrack?.requestFrame!=="function"){
        stream.getTracks?.().forEach(track=>track.stop());
        stream=canvas.captureStream(15);
        frameTrack=null;
      }
      video=document.createElement("video");
      video.muted=true;video.defaultMuted=true;video.volume=0;
      video.autoplay=true;video.playsInline=true;
      video.disablePictureInPicture=false;
      video.setAttribute("playsinline","");
      video.setAttribute("webkit-playsinline","");
      video.setAttribute("aria-hidden","true");
      Object.assign(video.style,{
        position:"fixed",width:"2px",height:"2px",opacity:".01",
        pointerEvents:"none",right:"0",bottom:"0",zIndex:"-1"
      });
      document.body.appendChild(video);
      video.srcObject=stream;
      video.addEventListener("leavepictureinpicture",deactivate);
      video.addEventListener("webkitpresentationmodechanged",()=>{
        if(video.webkitPresentationMode==="picture-in-picture"){
          active=true;reconcile();schedule();
        }else{deactivate();}
      });
      watchMedia();
      draw();
      return video;
    }

    function deactivate(){
      active=false;opening=false;generation++;
      transition=null;current=null;
      resetTimer();
    }
    function warm(){
      if(mode()==="none")return;
      const media=ensureVideo();
      const result=media.play();
      if(result?.catch)result.catch(()=>{});
    }
    async function toggle(){
      const which=mode();
      if(which==="none"){
        config.status("Bu tarayıcı, Flöw'ün Picture-in-Picture görünümünü desteklemiyor.");
        return false;
      }
      if(opening)return false;
      if(document.pictureInPictureElement===video && document.exitPictureInPicture){
        await document.exitPictureInPicture();
        return false;
      }
      if(video?.webkitPresentationMode==="picture-in-picture" &&
         typeof video.webkitSetPresentationMode==="function"){
        video.webkitSetPresentationMode("inline");
        return false;
      }
      opening=true;
      try{
        const media=ensureVideo();
        current=desiredItem();
        transition=null;
        ++generation;
        draw(); // deliver a valid initial frame before native PiP requests playback
        const play=media.play();
        if(play?.then)await play;
        if(which==="standard")await media.requestPictureInPicture();
        else media.webkitSetPresentationMode("picture-in-picture");
        active=true;
        refreshTarget();
        draw();
        schedule();
        return true;
      }catch(err){
        console.warn("Flöw PiP:",err);
        deactivate();
        config.status("Picture-in-Picture açılamadı. Tarayıcı bu oturumda PiP isteğine izin vermedi.");
        return false;
      }finally{opening=false;}
    }

    return Object.freeze({
      mode,warm,toggle,
      transitionStory(story,dir=1){
        if(active && story)setTarget(makeStory(story),dir,true);
      },
      transitionAd(ad,dir=1){
        if(active && ad)setTarget(makeAd(ad),dir,true);
      },
      sync(){if(active){reconcile();draw();schedule();}},
      isActive:()=>active
    });
  }
  root.FloewPiPEngine=Object.freeze({create});
})(window);
