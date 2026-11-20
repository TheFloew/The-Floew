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
    const edge=8,gap=13;
    const vw=window.innerWidth,vh=window.innerHeight;
    const actionRow=active.closest(".headline-actions");
    label.style.maxWidth="";
    let left,top;

    if(actionRow){
      // Tüm manşet aksiyonlarının etiketleri aynı düşey çizgide biter.
      // Metinlerin kendisi sola yaslıdır; butonların konumu değişmez.
      const visible=Array.from(actionRow.children).filter(el=>{
        if(!el.getClientRects().length)return false;
        const style=getComputedStyle(el);
        return style.display!=="none"&&style.visibility!=="hidden";
      });
      const firstLeft=visible.length
        ? Math.min(...visible.map(el=>el.getBoundingClientRect().left))
        : rect.left;
      const available=firstLeft-gap-edge;
      if(available>=92){
        label.style.maxWidth=Math.min(300,available)+"px";
        left=firstLeft-gap-label.offsetWidth;
        top=rect.top+(rect.height-label.offsetHeight)/2;
      }else{
        // Dar görünüm: etiketleri buton sırasının altında tut.
        const width=label.offsetWidth;
        left=actionRow.getBoundingClientRect().right-width;
        top=actionRow.getBoundingClientRect().bottom+10;
      }
    }else if(active.matches(".source-line .source, .source-line .category")){
      // Kaynak ve kategori aynı etiket çizgisini kullanır:
      // kategori + logo + kaynak grubunun en solundaki öğenin solunda biter.
      const sourceLine=active.closest(".source-line");
      const visible=Array.from(sourceLine.children).filter(el=>{
        if(!el.getClientRects().length)return false;
        const style=getComputedStyle(el);
        return style.display!=="none"&&style.visibility!=="hidden";
      });
      const firstLeft=visible.length
        ? Math.min(...visible.map(el=>el.getBoundingClientRect().left))
        : rect.left;
      const available=firstLeft-gap-edge;
      if(available>=92){
        label.style.maxWidth=Math.min(300,available)+"px";
        left=firstLeft-gap-label.offsetWidth;
        top=rect.top+(rect.height-label.offsetHeight)/2;
      }else{
        // Dar ekranda üst üste binmek yerine kaynak satırının altında kal.
        left=sourceLine.getBoundingClientRect().right-label.offsetWidth;
        top=sourceLine.getBoundingClientRect().bottom+10;
      }
    }else if(active.matches(".description")){
      // Manşet açıklaması başlığın üzerinde değil, açıklamanın solunda.
      left=rect.left-label.offsetWidth-gap;
      top=rect.top+(rect.height-label.offsetHeight)/2;
      if(left<edge){
        left=rect.left;
        top=rect.bottom+10;
      }
    }else{
      // Diğer bütün etiketlerde sağ kenardan çıkan ok butona döner.
      left=rect.left-label.offsetWidth-gap;
      top=rect.top+(rect.height-label.offsetHeight)/2;
      if(left<edge){
        left=rect.left+(rect.width-label.offsetWidth)/2;
        top=rect.bottom+10;
      }
    }

    const w=label.offsetWidth,h=label.offsetHeight;
    left=Math.min(Math.max(edge,left),Math.max(edge,vw-w-edge));
    top=Math.min(Math.max(edge,top),Math.max(edge,vh-h-edge));
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
    if(!target || target.id==="control-menu-button" || target.closest("[inert]") || target.matches(":disabled"))return;
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
  // Tek ortak etiket DOM’da hazırdır; ilk hover anında oluşturma gecikmesi olmaz.
  if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",makeLabel,{once:true});
  else makeLabel();

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
