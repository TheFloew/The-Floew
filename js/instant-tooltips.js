/* Flöw | Tüm başlıklandırılmış kontroller için anlık hover etiketi */
(function(){
  "use strict";
  const targets=[
    "button","a","[role='button']","input[type='button']",
    "input[type='submit']",".flora-inline"
  ].join(",");
  let active=null;
  let activeTitle="";
  let label=null;

  const titleObserver=new MutationObserver(()=>{
    if(!active)return;
    const changed=active.getAttribute("title");
    if(changed===null)return;
    activeTitle=changed.trim();
    active.dataset.floewTooltipTitle=activeTitle;
    active.removeAttribute("title");
    if(!activeTitle){hide();return;}
    if(label){label.textContent=activeTitle;place();}
  });

  function getTarget(node){
    if(!(node instanceof Element))return null;
    const item=node.closest(targets);
    if(!item)return null;
    return item.hasAttribute("title")||item.hasAttribute("data-floew-tooltip-title")?item:null;
  }

  function makeLabel(){
    if(label)return;
    label=document.createElement("div");
    label.id="floew-instant-tooltip";
    label.hidden=true;
    label.setAttribute("role","tooltip");
    label.setAttribute("aria-hidden","true");
    document.body.appendChild(label);
  }

  function place(){
    if(!active||!label||label.hidden)return;
    if(!active.isConnected){hide();return;}
    const rect=active.getBoundingClientRect();
    const w=label.offsetWidth,h=label.offsetHeight,edge=8;
    const availableW=window.innerWidth,availableH=window.innerHeight;
    let left,top;

    // Sağ üstteki dikey araç menüsünün etiketleri solunda açılır.
    if(active.closest("#control-menu-panel")){
      left=rect.left-w-10;
      if(left<edge)left=rect.right+10;
      top=rect.top+(rect.height-h)/2;
    }else{
      left=rect.left+(rect.width-w)/2;
      top=rect.top-h-9;
      if(top<edge)top=rect.bottom+9;
      if(top+h>availableH-edge)top=rect.top-h-9;
    }
    left=Math.min(Math.max(edge,left),Math.max(edge,availableW-w-edge));
    top=Math.min(Math.max(edge,top),Math.max(edge,availableH-h-edge));
    label.style.transform="translate3d("+Math.round(left)+"px,"+Math.round(top)+"px,0)";
  }

  function hide(){
    titleObserver.disconnect();
    if(active){
      // Tarayıcının yerleşik title gecikmesini yalnız hover boyunca sustur.
      if(active.isConnected && !active.hasAttribute("title") && activeTitle)
        active.setAttribute("title",activeTitle);
      delete active.dataset.floewTooltipTitle;
    }
    active=null;
    activeTitle="";
    if(label){
      label.hidden=true;
      label.setAttribute("aria-hidden","true");
    }
  }

  function show(target){
    if(active===target)return;
    hide();
    if(!target || target.closest("[inert]") || target.matches(":disabled"))return;
    const title=(target.getAttribute("title")||target.dataset.floewTooltipTitle||"").trim();
    if(!title)return;
    active=target;
    activeTitle=title;
    active.dataset.floewTooltipTitle=title;

    if(!target.hasAttribute("aria-label") && !target.textContent.trim() &&
        (target.matches("button") || target.matches("[role='button']")))
      target.setAttribute("aria-label",title);

    target.removeAttribute("title");
    titleObserver.observe(target,{attributes:true,attributeFilter:["title"]});
    makeLabel();
    label.textContent=title;
    label.hidden=false;
    label.setAttribute("aria-hidden","false");
    place();
  }

  // Delegasyon: daha sonra oluşan haber butonlarında da çalışır.
  document.addEventListener("pointerover",e=>{
    if(e.pointerType==="touch")return;
    const target=getTarget(e.target);
    if(target)show(target);
  },true);
  document.addEventListener("pointerout",e=>{
    if(!active || e.pointerType==="touch")return;
    if(active===e.target || active.contains(e.target)){
      if(!(e.relatedTarget instanceof Node) || !active.contains(e.relatedTarget))
        hide();
    }
  },true);
  document.addEventListener("focusin",e=>{
    const target=getTarget(e.target);
    if(target && target.matches(":focus-visible"))show(target);
  },true);
  document.addEventListener("focusout",e=>{
    if(active && active.contains(e.target) && !active.matches(":hover"))hide();
  },true);
  window.addEventListener("scroll",()=>{if(active)place();},true);
  window.addEventListener("resize",()=>{if(active)place();});
  window.addEventListener("blur",hide);
  document.addEventListener("keydown",e=>{if(e.key==="Escape")hide();},true);
})();
