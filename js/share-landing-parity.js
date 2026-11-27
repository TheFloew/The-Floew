/* Flöw shared-story landing parity. Loaded by Share Worker, not the news feed. */
(function(){
  "use strict";
  if(document.documentElement.dataset.floewLandingParity==="1")return;
  const slide=document.getElementById("share-slide");
  const shareButton=document.getElementById("share-again");
  const sourceButton=document.getElementById("share-source-view");
  if(!slide || !shareButton || !sourceButton)return;
  document.documentElement.dataset.floewLandingParity="1";

  const HOST="https://xn--flw-tna.tr";
  const HOME="https://flöw.tr/";
  const ANALYTICS="https://thefloew-analytics.thefloewback.workers.dev";
  const assets=[
    ["/css/share-landing-parity.css?v=3","stylesheet"],
    ["/css/visual-share.css?v=3","stylesheet"]
  ];
  for(const item of assets){
    const node=document.createElement("link");
    node.rel=item[1];node.href=HOST+item[0];document.head.appendChild(node);
  }
  const headline=()=>document.getElementById("share-headline")?.textContent?.trim()||"Flöw'de bir haber";
  const sourceName=()=>slide.querySelector(".source")?.textContent?.trim()||"";
  const safeUrl=value=>{
    try{
      const url=new URL(value,location.href);
      return /^https?:$/.test(url.protocol)?url.href:"";
    }catch(_){return "";}
  };
  const sourceUrl=()=>safeUrl(sourceButton.getAttribute("href"));
  const shortUrl=()=>{
    const match=/^\/s\/([A-Za-z0-9_-]+)\/?$/.exec(location.pathname);
    return match?"https://flöw.tr/s/"+match[1]:location.href.split("#")[0];
  };
  const numeric=value=>{
    const cleaned=String(value??"").replace(/[≈\s]/g,"").replace(",",".");
    if(!cleaned || cleaned==="—")return null;
    const parsed=Number(cleaned);
    return Number.isFinite(parsed)&&parsed>=0&&parsed<=100?parsed:null;
  };
  const stop=event=>{event.preventDefault();event.stopImmediatePropagation();};

  // A visible, keyboard-accessible route to the live news feed.
  if(!document.getElementById("floew-continue-feed")){
    const link=document.createElement("a");
    link.id="floew-continue-feed";link.href=HOME;
    link.setAttribute("aria-label","Flöw ana haber akışına devam et");
    link.textContent="Akışa devam et";
    document.body.appendChild(link);
  }

  // The Worker has historically serialized null as 0.0. Prefer the saved
  // positive score; otherwise resolve the canonical story key on demand.
  function ensureFlora(){
    let badge=slide.querySelector(".flora-inline");
    if(badge)return badge;
    const actions=slide.querySelector(".headline-actions");
    if(!actions)return null;
    badge=document.createElement("span");
    badge.className="flora-inline";
    badge.setAttribute("aria-label","Flöra puanı yükleniyor");
    const mark=document.createElement("span");
    mark.className="flora-inline-mark";mark.setAttribute("aria-hidden","true");mark.textContent="𝒇";
    const value=document.createElement("span");
    value.className="flora-inline-value";value.textContent="—";
    badge.append(mark,value);
    actions.insertBefore(badge,shareButton);
    return badge;
  }
  function showFlora(score,estimated){
    const badge=ensureFlora();
    if(!badge)return;
    const value=badge.querySelector(".flora-inline-value");
    value.textContent=(estimated?"≈":"")+score.toFixed(1);
    badge.classList.add("has-score");
    badge.classList.toggle("flora-estimated",Boolean(estimated));
    const title=estimated
      ?"Flöra tahmini: "+score.toFixed(1)+"/100"
      :"Flöra: "+score.toFixed(1)+"/100";
    badge.title=title;badge.setAttribute("aria-label",title);
  }
  function canonicalKey(urlValue){
    try{
      const url=new URL(urlValue);
      url.hash="";
      const omit=["fbclid","gclid","dclid","msclkid","mc_cid","mc_eid",
        "ref","ref_src","ref_url","ocid","cmpid","campaign","partner","output","amp"];
      for(const key of [...url.searchParams.keys()]){
        if(key.toLowerCase().startsWith("utm_")||omit.includes(key.toLowerCase()))url.searchParams.delete(key);
      }
      url.searchParams.sort();
      if(url.pathname.length>1)url.pathname=url.pathname.replace(/\/+$/g,"");
      return url.href;
    }catch(_){return urlValue;}
  }
  const loadScript=url=>new Promise((resolve,reject)=>{
    const script=document.createElement("script");script.src=url;script.async=true;
    script.onload=resolve;script.onerror=()=>reject(new Error("asset_load_failed"));
    document.head.appendChild(script);
  });
  async function restoreFlora(){
    const badge=ensureFlora();
    if(!badge)return;
    const previous=numeric(badge.querySelector(".flora-inline-value")?.textContent);
    // A valid positive snapshot is already a suitable score: no extra request.
    if(previous!==null && previous>0)return;
    // Never flash a misleading 0.0 while we check the missing score.
    badge.querySelector(".flora-inline-value").textContent="—";
    badge.classList.remove("has-score");
    badge.title="Flöra puanı yükleniyor";
    const url=sourceUrl();
    if(!url)return;
    const key=canonicalKey(url);
    let stats=null;
    try{
      const endpoint=new URL(ANALYTICS+"/stats/flora-story");
      endpoint.searchParams.set("range","7d");
      endpoint.searchParams.set("stream","main");
      endpoint.searchParams.set("story_key",key);
      const response=await fetch(endpoint.href,{
        mode:"cors",credentials:"omit",cache:"default",headers:{"Accept":"application/json"}
      });
      if(response.ok){
        const body=await response.json();
        if(body.ok && body.stats)stats=body.stats;
      }
    }catch(_){}
    const actual=stats?.flora===null||stats?.flora===undefined?null:numeric(stats.flora);
    if(actual!==null && Number(stats.views)>=8 && Number(stats.avg_dwell_ms)>0){
      showFlora(actual,false);return;
    }
    try{
      if(!window.FloewFloraPredictor){
        await loadScript(HOST+"/js/flora-predictor.js?v=2");
      }
      const response=await fetch(ANALYTICS+"/stats/flora-vocabulary?stream=main",{
        mode:"cors",credentials:"omit",cache:"default",headers:{"Accept":"application/json"}
      });
      if(!response.ok)throw new Error("no_vocabulary");
      const data=await response.json();
      const model=data?.model;
      if(!data?.ok || !model || Number(model.sampleStories)<12)return;
      const result=window.FloewFloraPredictor?.estimate?.(headline(),model);
      if(result && numeric(result.score)!==null){
        showFlora(Number(result.score),true);return;
      }
    }catch(_){}
    if(previous!==null && previous>0)showFlora(previous,false);
    else{
      badge.querySelector(".flora-inline-value").textContent="—";
      badge.title="Flöra puanı henüz hazır değil";
      badge.setAttribute("aria-label",badge.title);
      badge.classList.remove("has-score");
    }
  }
  void restoreFlora();

  // Share the *same* short link again. No new KV/Worker snapshot is created.
  function storyFromButton(){
    const articleUrl=sourceUrl();
    return articleUrl?{
      articleUrl,title:headline(),source:sourceName(),shareUrl:shortUrl()
    }:null;
  }
  function buildShareSnapshot(_button,story){
    const photo=slide.querySelector("#share-image");
    const favicon=slide.querySelector(".source-logo");
    return Promise.resolve({
      title:story.title,source:story.source,
      category:slide.querySelector(".category")?.textContent?.trim()||"",
      description:document.getElementById("share-description")?.textContent?.trim()||"",
      image:safeUrl(photo?.currentSrc||photo?.getAttribute("src")),
      sourceLogo:safeUrl(favicon?.currentSrc||favicon?.getAttribute("src")),
      floraScore:numeric(slide.querySelector(".flora-inline-value")?.textContent),
      media:null
    });
  }
  function flash(ok,mode){
    const old=shareButton.getAttribute("aria-label")||"Haberi paylaş";
    clearTimeout(shareButton.__floewShareFlash);
    shareButton.classList.remove("fi-share","fi-check","fi-warning","share-done","share-error");
    shareButton.classList.add(ok?"fi-check":"fi-warning",ok?"share-done":"share-error");
    shareButton.setAttribute("aria-label",ok?(mode==="native"?"Haber paylaşıldı":"Flöw bağlantısı kopyalandı"):"Bağlantı kopyalanamadı");
    shareButton.__floewShareFlash=setTimeout(()=>{
      shareButton.classList.remove("fi-check","fi-warning","share-done","share-error");
      shareButton.classList.add("fi-share");
      shareButton.setAttribute("aria-label",old);
    },1300);
  }
  async function copyText(text){
    if(navigator.clipboard?.writeText){
      try{await navigator.clipboard.writeText(text);return true;}catch(_){}
    }
    const field=document.createElement("textarea");field.value=text;field.readOnly=true;
    field.style.position="fixed";field.style.left="-9999px";
    document.body.appendChild(field);field.select();
    let ok=false;try{ok=document.execCommand("copy");}catch(_){}
    field.remove();return ok;
  }
  async function sharePreparedStory(_button,story){
    const text=story.title+"\n"+(story.source?story.source+" • ":"")+"Flöw";
    if(typeof navigator.share==="function"){
      try{
        await navigator.share({title:story.title,text,url:story.shareUrl});
        flash(true,"native");return true;
      }catch(error){
        if(error?.name==="AbortError")return false;
      }
    }
    const ok=await copyText(text+"\n"+story.shareUrl);
    flash(ok,"clipboard");return ok;
  }
  window.FloewShare={
    storyFromButton,
    buildShareSnapshot,
    shareUrlForArticle:()=>Promise.resolve(shortUrl()),
    sharePreparedStory,
    shareStory:()=>sharePreparedStory(shareButton,storyFromButton()),
    telemetry:()=>{}
  };

  let shareToolsPromise=null;
  function shareTools(){
    if(shareToolsPromise)return shareToolsPromise;
    // Keep the original 1080x1920 visual card and QR renderer from the feed.
    shareToolsPromise=Promise.resolve()
      .then(()=>loadScript(HOST+"/js/vendor/qrcode-generator.js?v=1"))
      .then(()=>loadScript(HOST+"/js/visual-share.js?v=9"));
    return shareToolsPromise;
  }
  // Capture wins over the Worker's direct-share click listener at the target.
  document.addEventListener("click",event=>{
    if(!shareButton.contains(event.target))return;
    stop(event);
    void shareTools().then(()=>{
      if(!window.FloewVisualShare?.open?.(shareButton)){
        return sharePreparedStory(shareButton,storyFromButton());
      }
    }).catch(()=>sharePreparedStory(shareButton,storyFromButton()));
  },true);

  // Same proxied-source URL as the news feed; close with its 340ms panel
  // transition instead of blanking the frame immediately.
  const sourceOverlay=document.getElementById("share-source-overlay");
  const sourceClose=document.getElementById("share-source-close");
  const sourceFrame=document.getElementById("share-source-frame");
  let cleanup=0;
  const closeSource=()=>{
    sourceOverlay?.classList.remove("open");
    sourceOverlay?.setAttribute("aria-hidden","true");
    sourceOverlay?.setAttribute("inert","");
    clearTimeout(cleanup);
    cleanup=setTimeout(()=>{
      if(!sourceOverlay?.classList.contains("open") && sourceFrame)sourceFrame.src="about:blank";
    },window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches?0:340);
    sourceButton.focus();
  };
  sourceButton.addEventListener("click",()=>{
    clearTimeout(cleanup);
    sourceOverlay?.removeAttribute("inert");
  },true);
  sourceClose?.addEventListener("click",event=>{
    stop(event);closeSource();
  },true);
  sourceOverlay?.addEventListener("click",event=>{
    if(event.target===sourceOverlay){event.preventDefault();closeSource();}
  });
  document.addEventListener("keydown",event=>{
    if(event.key==="Escape" && sourceOverlay?.classList.contains("open")){
      stop(event);closeSource();
    }
  },true);
})();