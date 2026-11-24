/* Flöw | Kaydet ve Sonra Oku v1.0.0
   Cihazda saklanır. Sunucuya hiçbir istek göndermez. */
(function(){
  "use strict";
  const KEY="floew.savedStories.v1";
  const MAX=300;
  const $=(selector,root=document)=>root.querySelector(selector);
  const $$=(selector,root=document)=>Array.from(root.querySelectorAll(selector));
  let items=[];
  let panel=null;
  let panelExitTimer=null;
  let lastFocus=null;

  function validUrl(input){
    try{
      const u=new URL(input,location.href);
      return /^https?:$/.test(u.protocol)?u.href:"";
    }catch{return "";}
  }
  function load(){
    try{
      const parsed=JSON.parse(localStorage.getItem(KEY)||"[]");
      if(Array.isArray(parsed))items=parsed.filter(x=>x&&typeof x.url==="string"&&validUrl(x.url)&&typeof x.title==="string").slice(0,MAX);
    }catch{items=[];}
  }
  function persist(){
    try{localStorage.setItem(KEY,JSON.stringify(items));return true;}
    catch{return false;}
  }
  function current(slide){
    const raw=$(".source-link",slide)?.getAttribute("href")||"";
    const href=raw&&raw!=="#"?validUrl(raw):"";
    const title=$("h1",slide)?.textContent?.trim()||"";
    if(!href||href===location.href||!title)return null;
    return {
      url:href,
      title,
      source:$(".source",slide)?.textContent?.trim()||"",
      savedAt:Date.now()
    };
  }
  function syncButtons(){
    $$(".slide .save-story-button").forEach(button=>{
      const story=current(button.closest(".slide"));
      const selected=!!story&&items.some(x=>x.url===story.url);
      button.hidden=!story;
      button.classList.toggle("fi-bookmark-filled",selected);
      button.classList.toggle("fi-bookmark",!selected);
      button.setAttribute("aria-pressed",String(selected));
      button.setAttribute("aria-label",selected?"Kaydedilenlerden çıkar":"Sonra okumak için kaydet");
      button.title=selected?"Kaydedilenlerden çıkar":"Sonra okumak için kaydet";
    });
    const count=$("#floew-bookmark-number-inside");
    if(count){
      count.textContent=items.length?String(items.length):"";
      count.dataset.digits=String(items.length).length;
      count.style.fontSize=items.length>=100?"7px":items.length>=10?"9px":"11px";
      count.closest("button")?.setAttribute("aria-label",items.length?("Kaydedilen haberler: "+items.length):"Kaydedilen haberler");
    }
  }
  function toggle(slide){
    const story=current(slide);
    if(!story)return;
    const old=items.slice();
    const i=items.findIndex(x=>x.url===story.url);
    if(i>=0)items.splice(i,1);
    else items.unshift(story);
    items=items.slice(0,MAX);
    if(!persist()){
      items=old;
      alert("Bu cihazda haber kaydedilemedi. Tarayıcı depolama iznini kontrol edin.");
    }
    syncButtons();
    render();
  }
  function stop(e){e.stopPropagation();}
  function bindGestures(button){
    ["pointerdown","pointerup","mousedown","mouseup","touchstart","touchend","dblclick","wheel"].forEach(name=>
      button.addEventListener(name,stop,{passive:name==="wheel"})
    );
  }
  function addAction(actions){
    if($(".save-story-button",actions))return;
    const button=document.createElement("button");
    button.className="save-story-button fi fi-bookmark";
    button.type="button";
    const anchor=$(".feedback-inline-link",actions)||$(".source-link",actions);
    if(anchor)actions.insertBefore(button,anchor);
    else actions.append(button);
    bindGestures(button);
    button.addEventListener("click",event=>{
      event.preventDefault();event.stopPropagation();
      toggle(button.closest(".slide"));
    });
  }
  function make(tag,cls,text){
    const el=document.createElement(tag);
    if(cls)el.className=cls;
    if(text!=null)el.textContent=text;
    return el;
  }
  function openSavedSource(entry){
    const viewer=window.openSourceViewer;
    if(typeof viewer!=="function"){
      const status=$("#floew-saved-status",panel);
      if(status)status.textContent="Kaynak görüntüleyici kullanılamıyor. Lütfen sayfayı yenileyin.";
      return;
    }
    closePanel();
    if(!viewer(entry.url,entry.source||"Kaynak")){
      openPanel();
      const status=$("#floew-saved-status",panel);
      if(status)status.textContent="Haber kaynağı açılamadı.";
    }
  }
  function render(){
    if(!panel)return;
    const list=$("#floew-saved-list",panel);
    list.replaceChildren();
    const count=$("#floew-saved-total",panel);
    if(count)count.textContent=items.length+" haber kaydedildi";
    if(!items.length){
      list.append(make("p","floew-saved-empty","Henüz kaydedilmiş haber yok. Haber altındaki yer imi simgesine basarak ekleyebilirsiniz."));
      return;
    }
    for(const entry of items){
      const row=make("div","floew-saved-row");
      const link=make("button","floew-saved-story");
      link.type="button";
      link.title="Haberi Flöw içinde aç";
      link.append(make("strong","",entry.title));
      if(entry.source)link.append(make("span","floew-saved-source",entry.source));
      link.addEventListener("click",e=>{
        e.preventDefault();
        e.stopPropagation();
        openSavedSource(entry);
      });
      const remove=make("button","floew-saved-remove fi fi-close");
      remove.type="button";
      remove.title="Kaydedilenlerden çıkar";
      remove.setAttribute("aria-label","Haberi listeden çıkar: "+entry.title);
      remove.addEventListener("click",e=>{
        e.preventDefault();
        e.stopPropagation();
        const previous=items.slice();
        items=items.filter(x=>x.url!==entry.url);
        if(!persist()){
          items=previous;
          alert("Bu cihazda kayıt silinemedi. Tarayıcı depolama iznini kontrol edin.");
        }
        render();syncButtons();
      });
      row.append(link,remove);
      list.append(row);
    }
  }
  function openPanel(){
    if(!panel)return;
    clearTimeout(panelExitTimer);
    lastFocus=document.activeElement;
    panel.hidden=false;
    panel.removeAttribute("inert");
    panel.setAttribute("aria-hidden","false");
    document.body.classList.add("floew-saved-open");
    if(typeof window.pauseFlowForUi==="function")window.pauseFlowForUi();
    render();
    // Force the closed frame before transitioning to the open frame.
    void panel.offsetWidth;
    panel.classList.add("open");
    $("#floew-saved-close",panel)?.focus();
  }
  function closePanel(){
    if(!panel||panel.hidden||panel.getAttribute("aria-hidden")==="true")return;
    panel.classList.remove("open");
    panel.setAttribute("aria-hidden","true");
    panel.setAttribute("inert","");
    document.body.classList.remove("floew-saved-open");
    if(lastFocus?.isConnected)lastFocus.focus();
    clearTimeout(panelExitTimer);
    const reduced=window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches;
    panelExitTimer=setTimeout(()=>{
      if(panel?.classList.contains("open"))return;
      panel.hidden=true;
      if(typeof window.queueUiFlowResumeCheck==="function")window.queueUiFlowResumeCheck();
    },reduced?0:340);
  }
  function setupPanel(){
    panel=make("div","floew-saved-overlay");
    panel.id="floew-saved-overlay";
    panel.hidden=true;
    panel.setAttribute("aria-hidden","true");
    panel.setAttribute("inert","");
    panel.innerHTML='<section class="floew-saved-panel" role="dialog" aria-modal="true" aria-labelledby="floew-saved-title"><div class="menu-header floew-saved-header"><div><div id="floew-saved-title" class="menu-title">Kaydedilen Haberler</div><div class="menu-subtitle">Sonra okumak için ayırdıklarınız</div></div><button id="floew-saved-close" class="fi fi-close" type="button" aria-label="Kaydedilen haberleri kapat" title="Kapat"></button></div><div class="floew-saved-meta"><span id="floew-saved-total"></span></div><p id="floew-saved-status" role="status" aria-live="polite"></p><div id="floew-saved-list" class="floew-saved-list"></div><footer>Bu liste yalnızca bu cihazda saklanır.</footer></section>';
    document.body.append(panel);
    // Pencere içi tıklama, scroll ve dokunma hareketleri haber akışına iletilmesin.
    for(const name of ["pointerdown","pointerup","pointermove","pointercancel","mousedown","mouseup","touchstart","touchmove","touchend","wheel","click","dblclick","contextmenu"]){
      panel.addEventListener(name,e=>e.stopPropagation(),{passive:name==="wheel"||name.startsWith("touch")});
    }
    panel.addEventListener("click",e=>{if(e.target===panel)closePanel();});
    $("#floew-saved-close",panel).addEventListener("click",e=>{e.preventDefault();closePanel();});
    window.addEventListener("keydown",e=>{
      if(panel.hidden)return;
      if(e.key==="Escape"){e.preventDefault();e.stopImmediatePropagation();closePanel();return;}
      if(["ArrowUp","ArrowDown","ArrowLeft","ArrowRight","PageUp","PageDown"," "].includes(e.key)){
        e.stopImmediatePropagation();
      }
      if(e.key==="Tab"){
        const focusable=$$("button:not([disabled])",panel).filter(el=>el.getClientRects().length);
        if(!focusable.length)return;
        if(e.shiftKey&&document.activeElement===focusable[0]){
          e.preventDefault();focusable[focusable.length-1].focus();
        }else if(!e.shiftKey&&document.activeElement===focusable[focusable.length-1]){
          e.preventDefault();focusable[0].focus();
        }
      }
    },{capture:true});
    // Mevcut global haber navigasyonunu beta modal açıkken devre dışı bırak.
    const originalBlocking=window.navigationBlockingPanelOpen;
    if(typeof originalBlocking==="function"){
      window.navigationBlockingPanelOpen=function(){return !panel.hidden||originalBlocking();};
    }
    const originalPauseSurface=window.anyUiPauseSurfaceOpen;
    if(typeof originalPauseSurface==="function"){
      window.anyUiPauseSurfaceOpen=function(){return !panel.hidden||originalPauseSurface();};
    }
  }
  function addMenuEntry(){
    const menu=$("#control-menu-panel");
    if(!menu||$("#saved-stories-button"))return;
    const button=make("button","control-menu-item floew-saved-menu fi fi-bookmark");
    button.id="saved-stories-button";
    button.type="button";
    button.setAttribute("aria-label","Kaydedilen haberler");
    button.title="Kaydedilen haberler";
    button.innerHTML='<span id="floew-bookmark-number-inside" aria-hidden="true"></span>';
    const info=$("#info-button",menu);
    const settings=$("#menu-button",menu);
    menu.insertBefore(button,info||settings||null);
    button.addEventListener("click",e=>{e.preventDefault();e.stopPropagation();openPanel();});
  }
  function addStyles(){
    if(document.getElementById("floew-saved-stories-css"))return;
    const link=document.createElement("link");
    link.id="floew-saved-stories-css";
    link.rel="stylesheet";
    link.href="/css/saved-stories.css?v=19";
    document.head.append(link);
  }
  function init(){
    load();addStyles();setupPanel();addMenuEntry();
    $$(".slide .headline-actions").forEach(addAction);
    syncButtons();
    const observer=new MutationObserver(records=>{
      if(records.some(r=>r.type==="childList"||r.attributeName==="href")){
        $$(".slide .headline-actions").forEach(addAction);
        syncButtons();
      }
    });
    $$(".slide").forEach(slide=>observer.observe(slide,{subtree:true,childList:true,characterData:true,attributes:true,attributeFilter:["href"]}));
    window.addEventListener("storage",event=>{if(event.key===KEY){load();syncButtons();render();}});
  }
  if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",init,{once:true});
  else init();
})();