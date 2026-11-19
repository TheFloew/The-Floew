/* Flöw · Kaydet ve Sonra Oku (local-only, no API/database requests) */
(function(){
  "use strict";

  const KEY="thefloew.savedStories.v1";
  const MAX_SAVED=100;
  const overlay=document.getElementById("saved-stories-overlay");
  const list=document.getElementById("saved-stories-list");
  const count=document.getElementById("saved-stories-count");
  const feedback=document.getElementById("saved-stories-feedback");
  const openButton=document.getElementById("saved-stories-open");
  const closeButton=document.getElementById("saved-stories-close");
  if(!overlay || !list || !openButton || !closeButton)return;

  const clean=(value,max=320)=>String(value||"").replace(/\s+/g," ").trim().slice(0,max);
  function validUrl(raw){
    try{
      const url=new URL(raw,location.href);
      return (url.protocol==="https:" || url.protocol==="http:")?url.href:"";
    }catch(e){return "";}
  }
  function storyKey(raw){
    const href=validUrl(raw);
    if(!href)return "";
    try{
      const url=new URL(href);
      url.hash="";
      for(const name of Array.from(url.searchParams.keys())){
        if(/^utm_|^(fbclid|gclid|yclid|mc_cid|mc_eid|igshid)$/i.test(name)){
          url.searchParams.delete(name);
        }
      }
      url.searchParams.sort();
      if(url.pathname.length>1)url.pathname=url.pathname.replace(/\/+$/,"");
      return url.href;
    }catch(e){return href;}
  }
  function load(){
    try{
      const data=JSON.parse(localStorage.getItem(KEY)||"[]");
      if(!Array.isArray(data))return [];
      const seen=new Set();
      return data.filter(item=>{
        if(!item || typeof item!=="object")return false;
        const id=storyKey(item.url);
        if(!id || seen.has(id))return false;
        seen.add(id);
        item.id=id;
        item.url=validUrl(item.url);
        item.title=clean(item.title);
        item.source=clean(item.source,90);
        item.category=clean(item.category,80);
        item.description=clean(item.description,500);
        item.timeLabel=clean(item.timeLabel,90);
        item.image=validUrl(item.image);
        item.savedAt=Number(item.savedAt)||Date.now();
        return Boolean(item.title);
      }).slice(0,MAX_SAVED);
    }catch(e){return [];}
  }

  let saved=load();
  let previousFocus=null;
  function store(next){
    try{
      localStorage.setItem(KEY,JSON.stringify(next));
      saved=next;
      return true;
    }catch(e){
      if(feedback){
        feedback.textContent="Kaydetme başarısız. Tarayıcının depolama iznini veya boş alanını kontrol edin.";
        feedback.hidden=false;
      }
      return false;
    }
  }
  function getStory(slide){
    if(!slide)return null;
    const info=slide.__floewSavedStory||{};
    const source=slide.querySelector(".source-link");
    const url=validUrl(info.link||source?.getAttribute("href"));
    const id=storyKey(url);
    if(!id || source?.getAttribute("aria-hidden")==="true")return null;
    const title=clean(slide.querySelector(".headline h1")?.textContent||info.title);
    if(!title)return null;
    return {
      id:id,
      url:url,
      title:title,
      source:clean(info.source||slide.querySelector(".source")?.textContent,90),
      category:clean(info.flowCategory||slide.querySelector(".category")?.textContent,80),
      description:clean(slide.querySelector(".description")?.textContent||info.description,500),
      timeLabel:clean(slide.querySelector(".time")?.textContent,90),
      image:validUrl(info.image||slide.querySelector(".slide-image")?.currentSrc||""),
      savedAt:Date.now()
    };
  }
  function syncSlide(slide){
    if(!slide)return;
    const button=slide.querySelector(".saved-story-toggle");
    if(!button)return;
    const story=getStory(slide);
    const isSaved=Boolean(story && saved.some(item=>item.id===story.id));
    button.hidden=!story;
    button.classList.toggle("is-saved",isSaved);
    button.setAttribute("aria-pressed",String(isSaved));
    const label=isSaved?"Kaydedilenlerden çıkar":"Sonra okumak için kaydet";
    button.setAttribute("aria-label",label);
    button.title=label;
  }
  function syncAll(){
    document.querySelectorAll(".slide").forEach(syncSlide);
  }
  function showCount(){
    if(count)count.textContent=saved.length+" haber kaydedildi · Yalnızca bu cihazda";
  }
  function make(tag,className,text){
    const el=document.createElement(tag);
    if(className)el.className=className;
    if(text!==undefined)el.textContent=text;
    return el;
  }
  function render(){
    showCount();
    list.replaceChildren();
    if(!saved.length){
      list.appendChild(make("p","saved-stories-empty","Henüz kaydedilen haber yok. Haberlerin altındaki yer imi simgesine dokunarak burada bir okuma listesi oluşturabilirsin."));
      return;
    }
    const fragment=document.createDocumentFragment();
    for(const item of saved){
      const row=make("div","saved-stories-row");
      const link=make("a","saved-stories-article");
      link.href=item.url;
      link.target="_blank";
      link.rel="noopener noreferrer";
      link.title="Haberi kaynağında oku";
      if(item.image){
        const image=make("img","saved-stories-image");
        image.src=item.image;
        image.alt="";
        image.loading="lazy";
        image.referrerPolicy="no-referrer";
        image.addEventListener("error",()=>{image.hidden=true;});
        link.appendChild(image);
      }
      const body=make("div","saved-stories-body");
      const meta=make("div","saved-stories-meta",item.source+(item.category?" · "+item.category:""));
      const heading=make("div","saved-stories-title",item.title);
      const savedDate=new Date(item.savedAt).toLocaleDateString("tr-TR",{day:"numeric",month:"short",year:"numeric"});
      const time=make("div","saved-stories-date","Kaydedildi: "+savedDate);
      body.append(meta,heading,time);
      link.appendChild(body);
      row.appendChild(link);
      const remove=make("button","saved-stories-remove","Kaldır");
      remove.type="button";
      remove.setAttribute("aria-label","Kaydedilenlerden çıkar: "+item.title);
      remove.addEventListener("click",event=>{
        event.preventDefault();
        event.stopPropagation();
        if(store(saved.filter(entry=>entry.id!==item.id))){
          render();
          syncAll();
        }
      });
      row.appendChild(remove);
      fragment.appendChild(row);
    }
    list.appendChild(fragment);
  }
  function open(){
    if(!overlay.hidden)return;
    previousFocus=document.activeElement;
    if(typeof window.pauseFlowForUi==="function")window.pauseFlowForUi();
    overlay.hidden=false;
    overlay.classList.add("open");
    overlay.setAttribute("aria-hidden","false");
    if(typeof window.closeControlMenu==="function")window.closeControlMenu();
    if(feedback)feedback.hidden=true;
    render();
    closeButton.focus({preventScroll:true});
  }
  function close(){
    if(overlay.hidden)return;
    overlay.classList.remove("open");
    overlay.hidden=true;
    overlay.setAttribute("aria-hidden","true");
    if(previousFocus?.isConnected && !previousFocus.closest("[inert]")){
      previousFocus.focus({preventScroll:true});
    }else{
      document.getElementById("control-menu-button")?.focus({preventScroll:true});
    }
    if(typeof window.queueUiFlowResumeCheck==="function")window.queueUiFlowResumeCheck();
  }

  document.querySelectorAll(".saved-story-toggle").forEach(button=>{
    button.addEventListener("pointerdown",event=>event.stopPropagation());
    button.addEventListener("pointerup",event=>event.stopPropagation());
    button.addEventListener("click",event=>{
      event.preventDefault();
      event.stopPropagation();
      const slide=button.closest(".slide");
      const story=getStory(slide);
      if(!story)return;
      const exists=saved.some(item=>item.id===story.id);
      const next=exists
        ?saved.filter(item=>item.id!==story.id)
        :[story,...saved].slice(0,MAX_SAVED);
      if(store(next)){
        syncAll();
        if(!overlay.hidden)render();
      }
    });
  });
  openButton.addEventListener("pointerdown",event=>event.stopPropagation());
  openButton.addEventListener("click",event=>{
    event.preventDefault();
    event.stopPropagation();
    open();
  });
  closeButton.addEventListener("click",close);
  overlay.addEventListener("click",event=>{
    if(event.target===overlay)close();
  });
  document.addEventListener("keydown",event=>{
    if(overlay.hidden)return;
    if(event.key==="Escape"){
      event.preventDefault();
      event.stopImmediatePropagation();
      close();
    }
    if(event.key==="Tab"){
      const focusables=Array.from(overlay.querySelectorAll("button:not([disabled]),a[href]"))
        .filter(el=>el.getClientRects().length>0);
      if(!focusables.length)return;
      const first=focusables[0],last=focusables[focusables.length-1];
      if(event.shiftKey && document.activeElement===first){
        event.preventDefault();last.focus();
      }else if(!event.shiftKey && document.activeElement===last){
        event.preventDefault();first.focus();
      }
    }
  },true);
  window.addEventListener("storage",event=>{
    if(event.key!==KEY)return;
    saved=load();
    syncAll();
    if(!overlay.hidden)render();
  });
  window.FloewBookmarks={syncSlide:syncSlide};
  syncAll();
})();