/* Flöw Document PiP: real HTML/CSS/video, no canvas capture or independent feed. */
(function(root){
 "use strict";
 function create(config){
  const MS=300, W=480, H=270;
  let win=null,host=null,shown=null,poll=null,openerPoll=null;
  let sceneDocument=null,epoch=0,opening=false,closing=false,recovering=false;
  const http=value=>{
   try{const u=new URL(String(value||""),document.baseURI);return /^https?:$/.test(u.protocol)?u.href:""}catch(_){return ""}
  };
  const key=item=>!item?"":item.kind==="ad"
   ?"ad|"+String(item.ad?.id||"")+"|"+String(item.ad?.src||"")
   :"story|"+config.storyKey(item.story);
  const slideFor=story=>config.slides.find(s=>s?.dataset?.storyKey===config.storyKey(story))||null;
  const supported=()=>typeof root.documentPictureInPicture?.requestWindow==="function";
  // The main page already warms upcoming adverts; the PiP document has a
  // separate media decoder. Prime the next adverts here before the main
  // ad finishes, so short videos are visible from their first frames.
  const warmedAds=new Map();
  const MAX_WARM_ADS=2;
  function stopWarmedMedia(media){
   try{media.pause?.()}catch(_){}
   try{media.removeAttribute?.("src")}catch(_){}
   try{media.load?.()}catch(_){}
   try{media.remove?.()}catch(_){}
  }
  function preloadAd(ad){
   if(!win||closing||ad?.type!=="video")return false;
   const src=http(ad.src);
   if(!src||warmedAds.has(src))return false;
   const media=el("video");
   media.muted=true;media.defaultMuted=true;media.volume=0;
   media.preload="auto";media.playsInline=true;
   media.disablePictureInPicture=true;
   media.setAttribute("muted","");
   media.setAttribute("playsinline","");
   media.src=src;
   warmedAds.set(src,media);
   try{media.load?.()}catch(_){}
   while(warmedAds.size>MAX_WARM_ADS){
    const oldest=warmedAds.keys().next().value;
    const removed=warmedAds.get(oldest);
    warmedAds.delete(oldest);
    stopWarmedMedia(removed);
   }
   return true;
  }
  function primeUpcomingAds(){
   if(!win||closing)return;
   for(const ad of (config.upcomingAds?.()||[]).slice(0,MAX_WARM_ADS)){
    preloadAd(ad);
   }
  }
  const desired=()=>{
   const ad=config.currentAd();
   if(ad)return {kind:"ad",ad};
   const story=config.currentStory();
   return story?{kind:"story",story}:null;
  };
  const css=[
   "html,body{margin:0;width:100%;height:100%;overflow:hidden;background:#131b28;color:#fff}",
   "body{font-family:Comfortaa,Arial,sans-serif}",
   "*{box-sizing:border-box}",
   "#floew-pip-stage{position:fixed;inset:0;width:100vw;height:100vh;isolation:isolate;overflow:hidden}",
   ".floew-pip-waiting{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;text-align:center;padding:20px;color:#d8e0eb;font-size:14px;line-height:1.5}",
   ".floew-pip-waiting[hidden]{display:none}",
   ".floew-pip-card{position:fixed;inset:0;width:100vw;height:100vh;overflow:hidden;background:radial-gradient(ellipse at 28% 25%,#49516a 0%,#252c3e 45%,#111725 100%)}",
   ".floew-pip-card.is-ad{background:#1b2230}",
   ".floew-pip-media{position:absolute;inset:0;width:100%;height:100%;border:0;object-fit:cover;opacity:0;transition:opacity .17s ease}",
   ".floew-pip-media.is-ready{opacity:1}",
   ".floew-pip-card img.floew-pip-media{z-index:1}",
   ".floew-pip-card video.floew-pip-media,.floew-pip-card iframe.floew-pip-media{z-index:2}",
   ".floew-pip-shade,.floew-pip-caption{z-index:3}",
   ".floew-pip-adtag{z-index:4}",
   ".floew-pip-play{position:absolute;z-index:5;left:50%;top:50%;transform:translate(-50%,-50%);border:1px solid rgba(255,255,255,.55);border-radius:999px;padding:12px 19px;background:rgba(0,0,0,.7);color:#fff;font:700 16px Comfortaa,Arial,sans-serif;cursor:pointer}",
   ".floew-pip-play[hidden]{display:none}",
   ".floew-pip-card.is-ad .floew-pip-media{object-fit:contain}",
   ".floew-pip-shade{position:absolute;inset:0;pointer-events:none;background:linear-gradient(to bottom,transparent 25%,rgba(0,0,0,.27) 52%,rgba(0,0,0,.93) 100%)}",
   ".floew-pip-caption{position:absolute;bottom:5%;left:5%;right:5%;text-align:right;text-shadow:0 1px 9px #000}",
   ".floew-pip-category{font-size:clamp(9px,2.5vw,17px);font-weight:700;opacity:.83;margin-bottom:7px}",
   ".floew-pip-source{font-size:clamp(11px,2.8vw,19px);font-weight:700;margin-bottom:9px}",
   ".floew-pip-title{font-size:clamp(18px,4.3vw,32px);font-weight:700;line-height:1.2;display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:3;overflow:hidden;overflow-wrap:anywhere}",
   ".floew-pip-adtag{position:absolute;right:4%;top:5%;font-size:clamp(12px,2.6vw,18px);font-weight:700;text-shadow:0 1px 8px #000}",
   ".floew-pip-fallback{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;text-align:center;padding:10%;font-size:clamp(12px,3vw,18px);color:#d8e0eb}",
   ".floew-pip-fallback:empty{display:none}",
   "@media(prefers-reduced-motion:reduce){.floew-pip-media{transition:none}}"
  ].join("\n");
  function el(tag,cls){const node=win.document.createElement(tag);if(cls)node.className=cls;return node}
  // Firefox Document PiP can compute a zero-sized absolutely positioned
  // section under paint/layout containment even when the stage fills the
  // viewport. Give each visual layer explicit viewport-relative dimensions.
  // Inline geometry also survives CSS cascade/reflow differences in Firefox.
  function layoutStage(stage){
   Object.assign(stage.style,{
    position:"fixed",left:"0",top:"0",width:"100vw",height:"100vh",
    overflow:"hidden"
   });
  }
  function layoutCard(card){
   Object.assign(card.style,{
    position:"fixed",left:"0",top:"0",right:"0",bottom:"0",
    width:"100vw",height:"100vh",minWidth:"0",minHeight:"0",
    overflow:"hidden",contain:"none"
   });
  }
  function layoutMedia(media,isAd=false){
   Object.assign(media.style,{
    position:"absolute",left:"0",top:"0",right:"0",bottom:"0",
    width:"100%",height:"100%",minWidth:"0",minHeight:"0",
    objectFit:isAd?"contain":"cover",display:"block"
   });
  }
  function label(element,value){const text=String(value||"");if(element.textContent!==text)element.textContent=text}
  function make(item){
   const outer=el("section","floew-pip-card"+(item.kind==="ad"?" is-ad":""));
   layoutCard(outer);
   const fallback=el("div","floew-pip-fallback");
   const shade=el("div","floew-pip-shade");
   const caption=el("div","floew-pip-caption");
   const category=el("div","floew-pip-category"),source=el("div","floew-pip-source"),title=el("div","floew-pip-title");
   caption.append(category,source,title);
   outer.append(fallback,shade,caption);
   const entry={item,key:key(item),outer,fallback,category,source,title,
    image:null,imageSource:"",media:null,mediaKey:"",hls:null,imageSerial:0,mediaSerial:0,animations:[],
    videoControl:null,nextPlaybackCheck:0,playPending:false,adVideoReady:false,
    requestVideoPlay:null,syncVideoTime:null,showBlockedPlayback:null,
    failedMediaKey:"",nextRetryAt:0,mediaFailures:0};
   if(item.kind==="ad"){
    shade.remove();caption.remove();
    fallback.textContent="Reklam yükleniyor";
    const badge=el("div","floew-pip-adtag");badge.textContent="Reklam";outer.append(badge);
   }
   return entry;
  }
  function textFor(entry){
   if(entry.item.kind==="ad")return;
   const story=entry.item.story,slide=slideFor(story);
   label(entry.category,story.flowCategory||"");
   label(entry.source,story.source||"");
   label(entry.title,slide?.querySelector(".headline h1")?.textContent?.trim()||story.title||"Flöw");
  }
  function pickImage(entry){
   if(entry.item.kind==="ad"){
    const ad=entry.item.ad;
    if(ad.type==="video")return "";
    const live=config.adImage,expected=http(ad.src),actual=http(live?.currentSrc||live?.src);
    return actual===expected && live?.complete && live?.naturalWidth?actual:expected;
   }
   const story=entry.item.story,img=slideFor(story)?.querySelector(".slide-image");
   if(img?.complete&&img?.naturalWidth&&img?.dataset?.imageStage!=="failed")
    return http(img.currentSrc||img.src);
   return http(config.initialStoryImage(story)||story.image);
  }
  function proxyFor(entry,url){
   if(entry.item.kind==="story" && http(entry.item.story.image)===url){
    const resolved=http(config.storyImageProxy(entry.item.story));
    if(resolved && resolved!==url)return resolved;
   }
   // When the on-page image has upgraded to a different article picture,
   // proxy precisely that URL, not the obsolete RSS thumbnail URL.
   const proxy=http(config.imageProxyBase);
   return proxy ? proxy+"?url="+encodeURIComponent(url) : "";
  }
  function imageUpdate(entry){
   const url=pickImage(entry);
   if(!url||url===entry.imageSource)return;
   entry.imageSource=url;
   const token=++entry.imageSerial,old=entry.image,img=el("img","floew-pip-media");
   img.decoding="async";img.draggable=false;img.alt="";
   layoutMedia(img,entry.item.kind==="ad");
   entry.outer.insertBefore(img,entry.outer.firstChild);
   entry.image=img;
   img.onload=()=>{
    if(entry.image!==img||entry.imageSerial!==token)return;
    img.classList.add("is-ready");
    if(entry.item.kind==="ad")label(entry.fallback,"");
    if(old && old!==img)win.setTimeout(()=>old.remove(),180);
   };
   img.onerror=()=>{
    if(entry.image!==img||entry.imageSerial!==token)return;
    const alternative=proxyFor(entry,url);
    if(alternative && alternative!==img.src && img.dataset.fallback!=="1"){
     img.dataset.fallback="1";img.src=alternative;
    }else{
     img.remove();entry.image=old||null;
     if(entry.item.kind==="ad"&&!entry.media)label(entry.fallback,"Reklam görseli açılamadı");
    }
   };
   img.src=url;
  }
  function descriptor(entry){
   if(entry.item.kind==="ad"){
    const ad=entry.item.ad;
    return ad.type==="video"?{kind:"video",src:http(ad.src),once:true,ref:config.adVideo}:null;
   }
   const slide=slideFor(entry.item.story);
   const video=slide?.querySelector(".slide-video.media-visible");
   if(video){
    const detail=video.__floewMediaDescriptor||{};
    const src=http(detail.url)||http(video.currentSrc||video.src);
    if(src)return {kind:"video",src,type:String(detail.type||""),once:false,ref:video};
   }
   const frame=slide?.querySelector(".slide-embed.media-visible");
   if(frame&&http(frame.src))return {kind:"iframe",src:http(frame.src)};
   const daily=slide?.querySelector(".slide-dailymotion.media-visible iframe");
   if(daily&&http(daily.src))return {kind:"iframe",src:http(daily.src)};
   // The Dailymotion SDK sometimes owns its iframe outside the host DOM.
   // Use the exact video/player IDs supplied by the active Flöw player.
   const host=slide?.querySelector(".slide-dailymotion.media-visible");
   const playerId=String(host?.dataset?.dailymotionPlayerId||"");
   const videoId=String(host?.dataset?.dailymotionVideoId||"");
   if(/^[A-Za-z0-9_-]+$/.test(playerId)&&/^[A-Za-z0-9_-]+$/.test(videoId)){
    const url="https://geo.dailymotion.com/player/"+playerId+
      ".html?video="+encodeURIComponent(videoId)+"&mute=true";
    return {kind:"iframe",src:url};
   }
   return null;
  }
  function cleanupMedia(entry){
   ++entry.mediaSerial;
   entry.playPending=false;
   entry.adVideoReady=false;
   entry.requestVideoPlay=null;
   entry.syncVideoTime=null;
   entry.showBlockedPlayback=null;
   if(entry.videoControl){entry.videoControl.remove();entry.videoControl=null}
   if(entry.hls){try{entry.hls.destroy()}catch(_){}entry.hls=null}
   if(entry.media){
    try{entry.media.pause?.()}catch(_){}
    entry.media.remove();
    entry.media=null;
   }
   entry.mediaKey="";
  }
  function showVideo(entry,desc){
   // Reuse an already-buffered video instead of creating a cold decoder
   // when the ad arrives. Normal news videos still use a fresh element.
   const warmed=entry.item.kind==="ad"?warmedAds.get(desc.src):null;
   if(warmed)warmedAds.delete(desc.src);
   const video=warmed||el("video");
   video.className="floew-pip-media";
   layoutMedia(video,entry.item.kind==="ad");
   video.autoplay=true;video.muted=true;video.defaultMuted=true;video.volume=0;
   video.loop=!desc.once;video.playsInline=true;video.controls=false;video.preload="auto";
   video.disablePictureInPicture=true;
   video.setAttribute("muted","");video.setAttribute("autoplay","");video.setAttribute("playsinline","");
   video.setAttribute("webkit-playsinline","");
   entry.outer.insertBefore(video,entry.outer.firstChild);
   entry.media=video;
   entry.nextPlaybackCheck=0;
   entry.playPending=false;
   entry.adVideoReady=false;
   const token=++entry.mediaSerial;
   const live=()=>win&&!closing&&entry.media===video&&entry.mediaSerial===token;
   const isAd=entry.item.kind==="ad";
   function updatePlayButton(show){
    if(!isAd||!live())return;
    if(!show){
     if(entry.videoControl)entry.videoControl.hidden=true;
     return;
    }
    if(!entry.videoControl){
     const button=el("button","floew-pip-play");
     button.type="button";
     button.textContent="▶ Reklamı oynat";
     button.setAttribute("aria-label","Reklam videosunu oynat");
     button.addEventListener("click",()=>{
      entry.nextPlaybackCheck=0;
      play(true);
     });
     entry.outer.appendChild(button);
     entry.videoControl=button;
    }
    entry.videoControl.hidden=false;
   }
   function syncTime(){
    const master=desc.ref;
    if(!master||!Number.isFinite(master.currentTime)||
       !Number.isFinite(video.duration)||video.duration<=0)return;
    const time=Number(master.currentTime)||0;
    if(time>=0&&time<video.duration-.35 &&
       Math.abs(Number(video.currentTime)-time)>2.5){
     try{video.currentTime=time}catch(_){}
    }
   }
   function play(byUser=false){
    if(!live()||entry.playPending)return;
    if(video.ended && isAd){
     const master=desc.ref;
     if(!master||master.ended)return;
     try{video.currentTime=Math.min(Number(master.currentTime)||0,Math.max(0,video.duration-.5))}catch(_){}
    }
    if(video.readyState>=1)syncTime();
    entry.playPending=true;
    let result;
    try{result=video.play()}catch(error){
     entry.playPending=false;
     if(isAd)updatePlayButton(true);
     return;
    }
    Promise.resolve(result).then(()=>{
     if(!live())return;
     entry.playPending=false;
     entry.nextPlaybackCheck=0;
     updatePlayButton(false);
    },error=>{
     if(!live())return;
     entry.playPending=false;
     entry.nextPlaybackCheck=Date.now()+1800;
     if(isAd)updatePlayButton(true);
     if(error?.name!=="NotAllowedError")console.warn("PiP reklam oynatma:",error);
    });
   }
   entry.requestVideoPlay=play;
   entry.syncVideoTime=syncTime;
   entry.showBlockedPlayback=updatePlayButton;
   const ready=()=>{
    if(!live())return;
    entry.adVideoReady=true;
    video.classList.add("is-ready");
    if(isAd)label(entry.fallback,"");
    play();
   };
   video.addEventListener("loadedmetadata",syncTime);
   video.addEventListener("loadeddata",ready);
   video.addEventListener("canplay",ready);
   video.addEventListener("playing",()=>{
    if(!live())return;
    entry.adVideoReady=true;
    video.classList.add("is-ready");
    if(isAd)label(entry.fallback,"");
    updatePlayButton(false);
   });
   video.addEventListener("error",()=>{
    if(!live())return;
    const failedKey=entry.mediaKey;
    cleanupMedia(entry);
    entry.failedMediaKey=failedKey;
    entry.mediaFailures++;
    entry.nextRetryAt=Date.now()+Math.min(15000,2000*entry.mediaFailures);
    if(isAd)label(entry.fallback,"Video reklam yüklenemedi");
   });
   const isHls=/mpegurl/i.test(desc.type||"")||/\.m3u8(?:[?#]|$)/i.test(desc.src);
   if(!isHls){
    if(video.src!==desc.src)video.src=desc.src;
    if(video.readyState>=2)Promise.resolve().then(ready);
    else play();
    return;
   }
   Promise.resolve(config.ensureHlsLibrary()).then(Hls=>{
    if(!live())return;
    if(Hls?.isSupported?.()){
     const hls=new Hls({enableWorker:true,lowLatencyMode:false,backBufferLength:30});
     entry.hls=hls;
     hls.on(Hls.Events.MEDIA_ATTACHED,()=>{if(live())hls.loadSource(desc.src)});
     hls.on(Hls.Events.MANIFEST_PARSED,()=>{if(live())play()});
     hls.on(Hls.Events.ERROR,(_event,data)=>{
      if(!live()||!data?.fatal)return;
      if(data.type===Hls.ErrorTypes?.MEDIA_ERROR){
       try{hls.recoverMediaError();return}catch(_){}
      }
      cleanupMedia(entry);
      if(entry.item.kind==="ad")label(entry.fallback,"Video reklam açılamadı");
     });
     hls.attachMedia(video);
    }else if(video.canPlayType("application/vnd.apple.mpegurl")){video.src=desc.src;play()}
    else cleanupMedia(entry);
   }).catch(()=>{if(live())cleanupMedia(entry)});
  }
  function showFrame(entry,desc){
   const iframe=el("iframe","floew-pip-media");
   layoutMedia(iframe,false);
   iframe.allow="autoplay; encrypted-media; picture-in-picture";
   iframe.referrerPolicy="strict-origin-when-cross-origin";
   iframe.tabIndex=-1;
   entry.outer.insertBefore(iframe,entry.outer.firstChild);
   entry.media=iframe;
   iframe.addEventListener("load",()=>{if(entry.media===iframe)iframe.classList.add("is-ready")});
   iframe.src=desc.src;
  }
  function mediaUpdate(entry){
   const media=descriptor(entry);
   const identity=media ? media.kind+"|"+media.src : "";
   if(identity===entry.mediaKey){
    if(entry.item.kind==="ad" && media?.kind==="video" &&
       entry.media && entry.media.tagName==="VIDEO"){
     const movie=entry.media;
     if(!movie.paused && !movie.ended){
      entry.syncVideoTime?.();
      entry.nextPlaybackCheck=0;
      entry.showBlockedPlayback?.(false);
     }else if(movie.readyState>=2 &&
              Date.now()>=entry.nextPlaybackCheck &&
              !entry.playPending &&
              !movie.ended){
      entry.nextPlaybackCheck=Date.now()+1800;
      entry.requestVideoPlay?.();
     }
    }
    return;
   }
   if(identity && entry.failedMediaKey===identity && Date.now()<entry.nextRetryAt)return;
   cleanupMedia(entry);
   if(!media)return;
   entry.mediaKey=identity;
   if(media.kind==="video")showVideo(entry,media);
   else showFrame(entry,media);
  }
  function refresh(entry){
   if(!win||closing||!entry)return;
   textFor(entry);
   imageUpdate(entry);
   mediaUpdate(entry);
  }
  function retire(entry){
   if(!entry)return;
   for(const animation of entry.animations){try{animation.cancel()}catch(_){}}
   cleanupMedia(entry);
   entry.image?.remove();
   entry.outer.remove();
  }
  function offsets(dir){
   const sign=dir<0?-1:1,axis=config.direction();
   // Match the feed's existing vector: forward/up enters from below,
   // backward reverses; left/right use the same directional convention.
   if(axis==="left")return ["translate3d("+(100*sign)+"%,0,0)","translate3d("+(-100*sign)+"%,0,0)"];
   if(axis==="right")return ["translate3d("+(-100*sign)+"%,0,0)","translate3d("+(100*sign)+"%,0,0)"];
   if(axis==="down")return ["translate3d(0,"+(-100*sign)+"%,0)","translate3d(0,"+(100*sign)+"%,0)"];
   return ["translate3d(0,"+(100*sign)+"%,0)","translate3d(0,"+(-100*sign)+"%,0)"];
  }
  function switchTo(item,dir=1,animate=true){
   if(!win||closing)return;
   if(key(item)===shown?.key){refresh(shown);return}
   const token=++epoch,old=shown;
   shown=item?make(item):null;
   if(shown){host.appendChild(shown.outer);refresh(shown)}
   if(!old)return;
   if(!shown||!animate||config.reducedMotion?.()||
      typeof shown.outer.animate!=="function"||typeof old.outer.animate!=="function"){
    retire(old);return;
   }
   const [start,end]=offsets(dir);
   const options={duration:MS,easing:"cubic-bezier(.22,.61,.36,1)",fill:"both"};
   const enter=shown.outer.animate([{transform:start},{transform:"translate3d(0,0,0)"}],options);
   const leave=old.outer.animate([{transform:"translate3d(0,0,0)"},{transform:end}],options);
   shown.animations.push(enter);old.animations.push(leave);
   let done=false;
   const finish=()=>{
    if(done)return;
    done=true;
    // Firefox can suspend compositor animations during a Document PiP
    // transition. Cancel its fill effect so the active ad cannot remain
    // translated fully outside the small viewport.
    if(shown===currentIncoming){
     try{enter.finish()}catch(_){}
     try{enter.cancel()}catch(_){}
     currentIncoming.outer.style.transform="";
    }
    retire(old);
   };
   const currentIncoming=shown;
   Promise.allSettled([enter.finished,leave.finished]).then(finish,finish);
   win.setTimeout(finish,MS+120);
   root.setTimeout?.(finish,MS+550);
  }
  function attached(){
   if(!win || win.closed)return false;
   let doc;
   try{doc=win.document}catch(_){return false}
   if(!doc?.body || !doc?.head || !host || doc!==sceneDocument)return false;
   if(typeof doc.body.contains==="function")return doc.body.contains(host);
   return Array.from(doc.body.children||[]).includes(host);
  }
  function mountScene(){
   if(!win||closing||win.closed||recovering)return false;
   if(attached())return true;
   recovering=true;
   try{
    const doc=win.document;
    if(!doc?.head||!doc?.body)return false;

    // Firefox may replace the initial about:blank Document *after*
    // requestWindow resolves. Old nodes then belong to a detached page,
    // leaving an apparently open PiP window with no visible content.
    const old=shown;
    shown=null;
    retire(old);
    for(const media of warmedAds.values())stopWarmedMedia(media);
    warmedAds.clear();

    sceneDocument=doc;
    let style=doc.getElementById?.("floew-pip-styles");
    if(!style){
     style=doc.createElement("style");
     style.id="floew-pip-styles";
     style.textContent=css;
     doc.head.appendChild(style);
    }
    host=doc.createElement("main");
    host.id="floew-pip-stage";
    layoutStage(host);
    const waiting=doc.createElement("div");
    waiting.className="floew-pip-waiting";
    waiting.textContent="Flöw PiP görüntüsü hazırlanıyor";
    host.appendChild(waiting);
    doc.body.appendChild(host);
    const item=desired();
    if(item)switchTo(item,1,false);
    if(shown)waiting.hidden=true;
    return true;
   }catch(error){
    console.warn("Flöw PiP sahnesi yeniden kurulamıyor:",error);
    return false;
   }finally{recovering=false}
  }
  function sync(){
   if(!win||closing)return;
   if(win.closed){reset();return}
   if(!mountScene())return;
   primeUpcomingAds();
   if(!config.isBusy()&&!config.isAdEntering()){
    const item=desired();
    if(key(item)!==shown?.key)switchTo(item,1,false);
   }
   const waiting=host?.querySelector?.(".floew-pip-waiting");
   if(waiting)waiting.hidden=Boolean(shown);
   refresh(shown);
  }
  function reset(){
   if(win && poll!==null){try{win.clearInterval(poll)}catch(_){}poll=null}
   if(openerPoll!==null){try{root.clearInterval(openerPoll)}catch(_){}openerPoll=null}
   for(const media of warmedAds.values())stopWarmedMedia(media);
   warmedAds.clear();
   const old=shown;
   shown=null;retire(old);
   host=null;sceneDocument=null;win=null;
   opening=false;closing=false;recovering=false;epoch++;
  }
  async function toggle(){
   if(!supported()||opening)return false;
   if(win&&!win.closed){closing=true;win.close();reset();return false}
   opening=true;
   try{
    // Requires transient activation: do not await network, image, or video.
    // Restore the browser's normal "return to tab" control.
    const opened=await root.documentPictureInPicture.requestWindow({width:W,height:H});
    win=opened;
    try{win.document.title="Flöw"}catch(_){}
    // Do not interpret a transient about:blank navigation as closing PiP.
    win.addEventListener("pagehide",()=>{
     if(win?.closed)reset();
     else root.setTimeout?.(sync,0);
    });
    win.addEventListener("load",()=>root.setTimeout?.(sync,0));
    mountScene();
    primeUpcomingAds();
    // Firefox can suspend the provisional PiP document's timers. Keep an
    // opener-owned heartbeat to restore the scene if it is replaced.
    poll=win.setInterval(sync,180);
    openerPoll=root.setInterval?.(sync,300)??null;
    return true;
   }catch(err){
    console.warn("Flöw Document PiP:",err);
    config.status("Gelişmiş PiP açılamadı. Tarayıcı pencereye izin vermedi.");
    reset();return false;
   }finally{opening=false}
  }
  return Object.freeze({
   supported,toggle,preloadAd,
   transitionStory(story,dir=1){
    if(win&&!closing&&story){
     if(mountScene())switchTo({kind:"story",story},dir,!document.hidden);
    }
   },
   transitionAd(ad,dir=1){
    if(win&&!closing&&ad){
     if(mountScene())switchTo({kind:"ad",ad},dir,!document.hidden);
    }
   },
   sync,isActive:()=>Boolean(win&&!win.closed&&!closing)
  });
 }
 root.FloewDocumentPiP=Object.freeze({create});
})(window);
