/* Flöw Document PiP: real HTML/CSS/video, no canvas capture or independent feed. */
(function(root){
 "use strict";
 function create(config){
  const MS=300, W=480, H=270;
  let win=null,host=null,shown=null,poll=null,epoch=0,opening=false,closing=false;
  const http=value=>{
   try{const u=new URL(String(value||""),document.baseURI);return /^https?:$/.test(u.protocol)?u.href:""}catch(_){return ""}
  };
  const key=item=>!item?"":item.kind==="ad"
   ?"ad|"+String(item.ad?.id||"")+"|"+String(item.ad?.src||"")
   :"story|"+config.storyKey(item.story);
  const slideFor=story=>config.slides.find(s=>s?.dataset?.storyKey===config.storyKey(story))||null;
  const supported=()=>typeof root.documentPictureInPicture?.requestWindow==="function";
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
   "#floew-pip-stage{position:fixed;inset:0;isolation:isolate;overflow:hidden}",
   ".floew-pip-card{position:absolute;inset:0;overflow:hidden;contain:layout paint;background:radial-gradient(ellipse at 28% 25%,#49516a 0%,#252c3e 45%,#111725 100%)}",
   ".floew-pip-card.is-ad{background:#1b2230}",
   ".floew-pip-media{position:absolute;inset:0;width:100%;height:100%;border:0;object-fit:cover;opacity:0;transition:opacity .17s ease}",
   ".floew-pip-media.is-ready{opacity:1}",
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
  function label(element,value){const text=String(value||"");if(element.textContent!==text)element.textContent=text}
  function make(item){
   const outer=el("section","floew-pip-card"+(item.kind==="ad"?" is-ad":""));
   const fallback=el("div","floew-pip-fallback");
   const shade=el("div","floew-pip-shade");
   const caption=el("div","floew-pip-caption");
   const category=el("div","floew-pip-category"),source=el("div","floew-pip-source"),title=el("div","floew-pip-title");
   caption.append(category,source,title);
   outer.append(fallback,shade,caption);
   const entry={item,key:key(item),outer,fallback,category,source,title,
    image:null,imageSource:"",media:null,mediaKey:"",hls:null,imageSerial:0,mediaSerial:0,animations:[]};
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
   if(entry.item.kind==="story"){
    const resolved=http(config.storyImageProxy(entry.item.story));
    if(resolved && resolved!==url)return resolved;
   }
   const proxy=http(config.imageProxyBase);
   return proxy ? proxy+"?url="+encodeURIComponent(url) : "";
  }
  function imageUpdate(entry){
   const url=pickImage(entry);
   if(!url||url===entry.imageSource)return;
   entry.imageSource=url;
   const token=++entry.imageSerial,old=entry.image,img=el("img","floew-pip-media");
   img.decoding="async";img.draggable=false;img.alt="";
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
   return null;
  }
  function cleanupMedia(entry){
   ++entry.mediaSerial;
   if(entry.hls){try{entry.hls.destroy()}catch(_){}entry.hls=null}
   if(entry.media){
    try{entry.media.pause?.()}catch(_){}
    entry.media.remove();
    entry.media=null;
   }
   entry.mediaKey="";
  }
  function showVideo(entry,desc){
   const video=el("video","floew-pip-media");
   video.autoplay=true;video.muted=true;video.defaultMuted=true;video.volume=0;
   video.loop=!desc.once;video.playsInline=true;video.controls=false;video.preload="auto";
   video.disablePictureInPicture=true;
   video.setAttribute("muted","");video.setAttribute("autoplay","");video.setAttribute("playsinline","");
   entry.outer.insertBefore(video,entry.outer.firstChild);
   entry.media=video;
   const token=++entry.mediaSerial;
   const live=()=>win&&!closing&&entry.media===video&&entry.mediaSerial===token;
   const play=()=>{
    if(!live())return;
    const master=desc.ref;
    if(master && Number.isFinite(master.currentTime) && Number.isFinite(video.duration) && video.duration>0){
     const time=Number(master.currentTime)||0;
     if(time>=0&&time<video.duration-.3&&Math.abs(video.currentTime-time)>2)
      try{video.currentTime=time}catch(_){}
    }
    const result=video.play();
    if(result?.catch)result.catch(()=>{});
   };
   const ready=()=>{
    if(!live())return;
    video.classList.add("is-ready");
    if(entry.item.kind==="ad")label(entry.fallback,"");
    play();
   };
   video.addEventListener("loadeddata",ready);
   video.addEventListener("canplay",ready);
   video.addEventListener("error",()=>{
    if(!live())return;
    cleanupMedia(entry);
    if(entry.item.kind==="ad")label(entry.fallback,"Video reklam açılamadı");
   });
   const isHls=/mpegurl/i.test(desc.type||"")||/\.m3u8(?:[?#]|$)/i.test(desc.src);
   if(!isHls){video.src=desc.src;play();return}
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
   if(identity===entry.mediaKey)return;
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
   if(axis==="left")return ["translate3d("+(-100*sign)+"%,0,0)","translate3d("+(100*sign)+"%,0,0)"];
   if(axis==="right")return ["translate3d("+(100*sign)+"%,0,0)","translate3d("+(-100*sign)+"%,0,0)"];
   if(axis==="down")return ["translate3d(0,"+(100*sign)+"%,0)","translate3d(0,"+(-100*sign)+"%,0)"];
   return ["translate3d(0,"+(-100*sign)+"%,0)","translate3d(0,"+(100*sign)+"%,0)"];
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
    // Even if another animation started, the old scene must not leak.
    retire(old);
   };
   Promise.allSettled([enter.finished,leave.finished]).then(finish,finish);
   win.setTimeout(finish,MS+120);
  }
  function sync(){
   if(!win||closing)return;
   if(!config.isBusy()&&!config.isAdEntering()){
    const item=desired();
    if(key(item)!==shown?.key)switchTo(item,1,false);
   }
   refresh(shown);
  }
  function reset(){
   if(win && poll!==null){win.clearInterval(poll);poll=null}
   const old=shown;
   shown=null;retire(old);
   host=null;win=null;opening=false;closing=false;epoch++;
  }
  async function toggle(){
   if(!supported()||opening)return false;
   if(win&&!win.closed){closing=true;win.close();reset();return false}
   opening=true;
   try{
    // Requires transient activation: do not await network, image, or video.
    const opened=await root.documentPictureInPicture.requestWindow({width:W,height:H});
    win=opened;
    win.document.title="Flöw";
    const style=el("style");style.textContent=css;win.document.head.appendChild(style);
    host=el("main");host.id="floew-pip-stage";win.document.body.appendChild(host);
    win.addEventListener("pagehide",reset,{once:true});
    switchTo(desired(),1,false);
    // The clock runs in the visible PiP document, not the background feed.
    poll=win.setInterval(sync,180);
    return true;
   }catch(err){
    console.warn("Flöw Document PiP:",err);
    config.status("Gelişmiş PiP açılamadı. Tarayıcı pencereye izin vermedi.");
    reset();return false;
   }finally{opening=false}
  }
  return Object.freeze({
   supported,toggle,
   transitionStory(story,dir=1){if(win&&!closing&&story)switchTo({kind:"story",story},dir,true)},
   transitionAd(ad,dir=1){if(win&&!closing&&ad)switchTo({kind:"ad",ad},dir,true)},
   sync,isActive:()=>Boolean(win&&!win.closed&&!closing)
  });
 }
 root.FloewDocumentPiP=Object.freeze({create});
})(window);
