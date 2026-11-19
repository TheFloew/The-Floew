/* Flöw | Kaydet ve Sonra Oku v1.0.0
   Cihazda saklanır. Sunucuya hiçbir istek göndermez. */
(function(){
  "use strict";
  const KEY="floew.savedStories.v1";
  const MAX=300;
  const $=(selector,root=document)=>root.querySelector(selector);
  const $$=(selector,root=document)=>Array.from(root.querySelectorAll(selector));
  const bookmark='<svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" stroke-linecap="round" aria-hidden="true"><path d="M6 3.8h12v17l-6-4-6 4z"/></svg>';
  const closeIcon='<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><path d="M5 5l14 14M19 5L5 19"/></svg>';
  let items=[];
  let panel=null;
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
    const href=validUrl($(".source-link",slide)?.getAttribute("href")||"");
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
      button.disabled=!story;
      button.setAttribute("aria-pressed",String(selected));
      button.setAttribute("aria-label",selected?"Kaydedilenlerden çıkar":"Sonra okumak için kaydet");
      button.title=selected?"Kaydedilenlerden çıkar":"Sonra okumak için kaydet";
    });
    const count=$("#floew-saved-count");
    if(count)count.textContent=items.length?String(items.length):"";
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
    button.className="save-story-button";
    button.type="button";
    button.innerHTML=bookmark;
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
  function render(){
    if(!panel)return;
    const list=$("#floew-saved-list",panel);
    list.replaceChildren();
    if(!items.length){
      list.append(make("p","floew-saved-empty","Henüz kaydedilmiş haber yok. Haber altındaki yer imi simgesine dokunarak buraya ekleyebilirsiniz."));
      return;
    }
    for(const entry of items){
      const row=make("div","floew-saved-row");
      const link=make("a","floew-saved-story");
      link.href=entry.url;
      link.target="_blank";
      link.rel="noopener noreferrer";
      link.append(make("strong","",entry.title));
      if(entry.source)link.append(make("span","floew-saved-source",entry.source));
      const remove=make("button","floew-saved-remove","×");
      remove.type="button";
      remove.title="Listeden çıkar";
      remove.setAttribute("aria-label","Haberi listeden çıkar: "+entry.title);
      remove.addEventListener("click",()=>{
        items=items.filter(x=>x.url!==entry.url);
        persist();render();syncButtons();
      });
      row.append(link,remove);
      list.append(row);
    }
  }
  function openPanel(){
    if(!panel)return;
    lastFocus=document.activeElement;
    panel.hidden=false;
    document.body.classList.add("floew-saved-open");
    render();
    $("#floew-saved-close",panel)?.focus();
  }
  function closePanel(){
    if(!panel)return;
    panel.hidden=true;
    document.body.classList.remove("floew-saved-open");
    if(lastFocus?.isConnected)lastFocus.focus();
  }
  function setupPanel(){
    panel=make("div","floew-saved-overlay");
    panel.id="floew-saved-overlay";
    panel.hidden=true;
    panel.innerHTML='<section class="floew-saved-panel" role="dialog" aria-modal="true" aria-labelledby="floew-saved-title"><header class="floew-saved-header"><div><h2 id="floew-saved-title">Kaydedilen Haberler</h2><p>Sonra okumak için ayırdıklarınız</p></div><button id="floew-saved-close" type="button" aria-label="Kapat">'+closeIcon+'</button></header><div id="floew-saved-list" class="floew-saved-list"></div><footer>Haberler yalnızca bu cihazda saklanır.</footer></section>';
    document.body.append(panel);
    panel.addEventListener("click",e=>{if(e.target===panel)closePanel();});
    $("#floew-saved-close",panel).addEventListener("click",closePanel);
    document.addEventListener("keydown",e=>{
      if(panel.hidden)return;
      if(e.key==="Escape"){e.preventDefault();closePanel();}
      if(e.key==="Tab"){
        const focusable=$$('button,a[href]',panel).filter(el=>!el.disabled);
        if(!focusable.length)return;
        if(e.shiftKey&&document.activeElement===focusable[0]){e.preventDefault();focusable[focusable.length-1].focus();}
        else if(!e.shiftKey&&document.activeElement===focusable[focusable.length-1]){e.preventDefault();focusable[0].focus();}
      }
    });
  }
  function addMenuEntry(){
    const menu=$("#control-menu-panel");
    if(!menu||$("#saved-stories-button"))return;
    const button=make("button","control-menu-item floew-saved-menu");
    button.id="saved-stories-button";
    button.type="button";
    button.setAttribute("aria-label","Kaydedilen haberler");
    button.title="Kaydedilen haberler";
    button.innerHTML=bookmark+'<span id="floew-saved-count" aria-hidden="true"></span>';
    const settings=$("#menu-button");
    menu.insertBefore(button,settings||null);
    button.addEventListener("click",e=>{e.preventDefault();e.stopPropagation();openPanel();});
  }
  function addStyles(){
    const style=make("style");
    style.textContent=`
      .save-story-button{display:inline-flex;align-items:center;justify-content:center;color:#fff;background:transparent;border:0;padding:0;margin:0;cursor:pointer;opacity:.8;flex:0 0 auto;transition:opacity .16s ease,transform .16s ease}
      .save-story-button:hover,.save-story-button:focus-visible{opacity:1}
      .save-story-button:active{transform:scale(.88)}
      .save-story-button[aria-pressed="true"] svg{fill:currentColor}
      .save-story-button:disabled{opacity:.3;cursor:default}
      .floew-saved-menu{position:relative}
      .floew-saved-menu svg{width:20px;height:20px}
      #floew-saved-count{position:absolute;font-size:10px;right:1px;top:1px;line-height:1}
      .floew-saved-overlay[hidden]{display:none!important}
      .floew-saved-overlay{position:fixed;inset:0;z-index:2147483000;background:rgba(0,0,0,.76);display:flex;align-items:center;justify-content:center;padding:20px;box-sizing:border-box}
      .floew-saved-panel{background:#141414;color:#fff;border:1px solid #353535;border-radius:16px;width:min(580px,100%);max-height:min(80vh,780px);display:flex;flex-direction:column;overflow:hidden;box-shadow:0 20px 80px #000b;font-family:inherit}
      .floew-saved-header{display:flex;align-items:flex-start;justify-content:space-between;gap:18px;padding:24px 24px 18px;border-bottom:1px solid #333}
      .floew-saved-header h2{font-size:22px;margin:0 0 4px;font-weight:650}
      .floew-saved-header p{font-size:13px;color:#aaa;margin:0}
      #floew-saved-close{background:none;border:0;color:#fff;cursor:pointer;padding:5px}
      .floew-saved-list{overflow:auto;overscroll-behavior:contain;padding:10px 24px;min-height:80px}
      .floew-saved-row{display:flex;align-items:center;gap:12px;border-bottom:1px solid #303030;padding:14px 0}
      .floew-saved-row:last-child{border:0}
      .floew-saved-story{color:#fff!important;text-decoration:none;flex:1;min-width:0;display:flex;flex-direction:column;gap:6px;line-height:1.4}
      .floew-saved-story:hover strong{text-decoration:underline}
      .floew-saved-story strong{font-size:15px;font-weight:500}
      .floew-saved-source{color:#aaa;font-size:12px}
      .floew-saved-remove{background:transparent;border:0;color:#aaa;font-size:25px;cursor:pointer;padding:8px}
      .floew-saved-remove:hover{color:#fff}
      .floew-saved-empty{color:#aaa;font-size:14px;line-height:1.6;padding:14px 0}
      .floew-saved-panel footer{font-size:11px;color:#999;padding:14px 24px;border-top:1px solid #333}
      @media(max-width:600px){.floew-saved-overlay{padding:12px}.floew-saved-header{padding:20px 18px 14px}.floew-saved-list{padding:8px 18px}.floew-saved-panel footer{padding:12px 18px}}
    `;
    document.head.append(style);
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