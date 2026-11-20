/* Flöw | Görsel Haber Paylaşımı v1
 * Tarayıcıda 1080x1920 hikâye kartı + yerel QR. Sunucuya kart yüklenmez.
 */
(function(){
  "use strict";
  const W=1080,H=1920;
  const NEWS_WORKER=String(window.FLOEW_CONFIG?.newsWorkerBase||"https://thefloew.thefloewback.workers.dev").replace(/\/$/,"");
  const SHORT_RE=/^https:\/\/(?:flöw\.tr|xn--flw-tna\.tr)\/s\/[A-Za-z0-9_-]+\/?$/i;
  let overlay=null,canvas=null,visualButton=null,linkButton=null,status=null;
  let current=null,buildSerial=0,focusBefore=null;

  function el(selector,root=document){return root.querySelector(selector);}
  function textStatus(message,error){
    if(!status)return;
    status.textContent=message||"";
    status.dataset.error=error?"true":"false";
  }

  function ensure(){
    if(overlay)return;
    overlay=document.createElement("div");
    overlay.id="floew-visual-share";
    overlay.className="floew-visual-share";
    overlay.hidden=true;
    overlay.setAttribute("aria-hidden","true");
    overlay.innerHTML=[
      '<section class="floew-visual-share-dialog" role="dialog" aria-modal="true" aria-labelledby="floew-visual-share-title">',
      '<header class="floew-visual-share-header">',
      '<div><div class="floew-visual-share-heading" id="floew-visual-share-title">Haberi paylaş</div>',
      '<div class="floew-visual-share-subtitle">Flöw bağlantısı veya Instagram hikâyesi için görsel</div></div>',
      '<button class="floew-visual-share-close" type="button" title="Kapat" aria-label="Kapat">×</button>',
      '</header>',
      '<div class="floew-visual-share-body">',
      '<div class="floew-visual-share-canvas-wrap">',
      '<canvas id="floew-visual-share-canvas" width="1080" height="1920" aria-label="Paylaşılacak dikey haber kartının önizlemesi"></canvas>',
      '</div>',
      '<div class="floew-visual-share-controls">',
      '<p class="floew-visual-share-note">Başlık ve haber görseliyle hazırlanan kartın QR kodu, Flöw’deki paylaşılmış haber sayfasını açar.</p>',
      '<div class="floew-visual-share-links">',
      '<button type="button" class="floew-visual-share-action secondary" id="floew-visual-share-link">Bağlantı paylaş</button>',
      '<button type="button" class="floew-visual-share-action" id="floew-visual-share-image" disabled>Görsel hazırlanıyor…</button>',
      '</div>',
      '<p class="floew-visual-share-status" id="floew-visual-share-status" role="status" aria-live="polite">Kart oluşturuluyor…</p>',
      '</div></div></section>'
    ].join("");
    document.body.appendChild(overlay);
    canvas=el("#floew-visual-share-canvas",overlay);
    visualButton=el("#floew-visual-share-image",overlay);
    linkButton=el("#floew-visual-share-link",overlay);
    status=el("#floew-visual-share-status",overlay);

    overlay.addEventListener("click",event=>{
      event.stopPropagation();
      if(event.target===overlay)close();
    });
    for(const type of ["pointerdown","pointerup","pointermove","pointercancel",
      "mousedown","mouseup","touchstart","touchmove","touchend",
      "wheel","dblclick","contextmenu"]){
      overlay.addEventListener(type,e=>e.stopPropagation(),{passive:type==="wheel"||type.startsWith("touch")});
    }
    el(".floew-visual-share-close",overlay).addEventListener("click",close);
    linkButton.addEventListener("click",()=>{
      const entry=current;
      if(!entry)return;
      close();
      if(entry.story.shareUrl){
        // Link hazır: OS paylaşım penceresi doğrudan kullanıcı tıklamasında açılır.
        void window.FloewShare?.sharePreparedStory(entry.button,entry.story);
      }else{
        void window.FloewShare?.shareStory(entry.button);
      }
    });
    visualButton.addEventListener("click",()=>{
      if(current?.blob)void shareImage();
    });
    window.addEventListener("keydown",event=>{
      if(!overlay || overlay.hidden)return;
      if(event.key==="Escape"){
        event.preventDefault();event.stopImmediatePropagation();close();return;
      }
      if(["ArrowUp","ArrowDown","ArrowLeft","ArrowRight","PageUp","PageDown"," "].includes(event.key)){
        event.stopImmediatePropagation();
      }
      if(event.key==="Tab"){
        const focusable=Array.from(overlay.querySelectorAll("button:not(:disabled)"));
        const first=focusable[0],last=focusable[focusable.length-1];
        if(event.shiftKey && document.activeElement===first){event.preventDefault();last.focus();}
        else if(!event.shiftKey && document.activeElement===last){event.preventDefault();first.focus();}
      }
    },{capture:true});
    const oldNav=window.navigationBlockingPanelOpen;
    if(typeof oldNav==="function"){
      window.navigationBlockingPanelOpen=()=>!overlay.hidden||oldNav();
    }
    const oldPause=window.anyUiPauseSurfaceOpen;
    if(typeof oldPause==="function"){
      window.anyUiPauseSurfaceOpen=()=>!overlay.hidden||oldPause();
    }
  }

  function close(){
    if(!overlay || overlay.hidden)return;
    buildSerial++;
    overlay.hidden=true;
    overlay.setAttribute("aria-hidden","true");
    document.body.classList.remove("floew-visual-share-open");
    if(typeof window.queueUiFlowResumeCheck==="function")window.queueUiFlowResumeCheck();
    if(focusBefore?.isConnected)focusBefore.focus();
    current=null;
  }

  function image(url,timeoutMs=6500){
    return new Promise((resolve,reject)=>{
      if(!url){reject(new Error("empty_image"));return;}
      const img=new Image();
      let done=false;
      const timer=setTimeout(()=>finish(new Error("image_timeout")),timeoutMs);
      function finish(error){
        if(done)return;
        done=true;
        clearTimeout(timer);
        img.onload=null;
        img.onerror=null;
        if(error)reject(error);
        else resolve(img);
      }
      img.crossOrigin="anonymous";
      img.onload=()=>finish(null);
      img.onerror=()=>finish(new Error("image_failed"));
      img.src=url;
    });
  }

  function proxyUrl(raw,ref){
    if(!raw)return "";
    try{
      let target=new URL(raw,location.href);
      if(target.pathname==="/image"&&target.origin===new URL(NEWS_WORKER).origin){
        const nested=target.searchParams.get("url");
        if(nested)target=new URL(nested);
      }
      if(target.protocol!=="https:"&&target.protocol!=="http:")return "";
      const p=new URL(NEWS_WORKER+"/image");
      p.searchParams.set("url",target.href);
      if(ref)p.searchParams.set("ref",ref);
      return p.href;
    }catch{return "";}
  }

  async function getPhoto(snapshot,story){
    const target=snapshot?.image||"";
    if(!target)return null;
    try{return await image(proxyUrl(target,story.articleUrl));}
    catch{
      try{return await image(target,3200);}catch{return null;}
    }
  }

  function cover(ctx,img,x,y,w,h){
    const iw=img.naturalWidth||img.width,ih=img.naturalHeight||img.height;
    if(!iw||!ih)return;
    const factor=Math.max(w/iw,h/ih);
    const sw=w/factor,sh=h/factor;
    ctx.drawImage(img,(iw-sw)/2,(ih-sh)/2,sw,sh,x,y,w,h);
  }

  function contain(ctx,img,x,y,w,h){
    const iw=img.naturalWidth||img.width,ih=img.naturalHeight||img.height;
    if(!iw||!ih)return;
    // Fotoğrafın orijinal kadrajının tamamı, oranı bozulmadan görünür.
    const scale=Math.min(w/iw,h/ih);
    const dw=iw*scale,dh=ih*scale;
    const dx=x+(w-dw)/2,dy=y+(h-dh)/2;
    ctx.save();
    ctx.shadowColor="rgba(0,0,0,.48)";
    ctx.shadowBlur=32;
    ctx.drawImage(img,dx,dy,dw,dh);
    ctx.restore();
    ctx.strokeStyle="rgba(255,255,255,.15)";
    ctx.lineWidth=2;
    ctx.strokeRect(dx,dy,dw,dh);
  }

  function measureLines(ctx,value,maxWidth){
    const words=String(value||"").split(/\s+/).filter(Boolean),lines=[];
    let line="";
    for(const word of words){
      if(!line){line=word;continue;}
      const together=line+" "+word;
      if(ctx.measureText(together).width<=maxWidth){line=together;continue;}
      lines.push(line);
      line=word;
    }
    if(line)lines.push(line);
    return lines;
  }

  function truncateLine(ctx,line,maxWidth){
    if(ctx.measureText(line).width<=maxWidth)return line;
    let t=line;
    while(t.length>2&&ctx.measureText(t+"…").width>maxWidth)t=t.slice(0,-1);
    return t.trimEnd()+"…";
  }


  function roundedRect(ctx,x,y,w,h,r){
    const radius=Math.min(r,w/2,h/2);
    ctx.beginPath();
    ctx.moveTo(x+radius,y);
    ctx.lineTo(x+w-radius,y);
    ctx.quadraticCurveTo(x+w,y,x+w,y+radius);
    ctx.lineTo(x+w,y+h-radius);
    ctx.quadraticCurveTo(x+w,y+h,x+w-radius,y+h);
    ctx.lineTo(x+radius,y+h);
    ctx.quadraticCurveTo(x,y+h,x,y+h-radius);
    ctx.lineTo(x,y+radius);
    ctx.quadraticCurveTo(x,y,x+radius,y);
    ctx.closePath();
  }

  function qrDraw(ctx,shortUrl,x,y,size){
    if(typeof window.qrcode!=="function")throw new Error("qr_generator_unavailable");
    const qr=window.qrcode(0,"M");
    qr.addData(new URL(shortUrl).href);
    qr.make();
    const count=qr.getModuleCount(),quiet=4,unit=size/(count+quiet*2);
    ctx.save();
    // Küçük QR: metinlerle aynı açık renk, yarı saydam koyu zemin.
    roundedRect(ctx,x,y,size,size,14);
    ctx.fillStyle="rgba(10,13,20,.68)";
    ctx.fill();
    ctx.beginPath();
    roundedRect(ctx,x,y,size,size,14);
    ctx.clip();
    ctx.fillStyle="rgba(255,255,255,.92)";
    for(let row=0;row<count;row++){
      for(let col=0;col<count;col++){
        if(!qr.isDark(row,col))continue;
        const x1=x+(col+quiet)*unit,y1=y+(row+quiet)*unit;
        const x2=x+(col+quiet+1)*unit,y2=y+(row+quiet+1)*unit;
        ctx.fillRect(Math.floor(x1),Math.floor(y1),
          Math.ceil(x2)-Math.floor(x1),Math.ceil(y2)-Math.floor(y1));
      }
    }
    ctx.restore();
  }

  async function getSourceFavicon(snapshot,story){
    let favicon=snapshot?.sourceLogo||"";
    if(!favicon){
      try{favicon=new URL("/favicon.ico",new URL(story.articleUrl).origin).href;}catch{}
    }
    if(!favicon)return null;
    try{return await image(proxyUrl(favicon,story.articleUrl),2600);}
    catch{
      try{return await image(favicon,1600);}catch{return null;}
    }
  }

  async function drawCard(story,snapshot,shortUrl,photo){
    if(document.fonts?.load){
      try{await Promise.race([document.fonts.load('700 62px "Comfortaa"'),
        new Promise(resolve=>setTimeout(resolve,1200))]);}catch{}
    }
    const [brand,favicon]=await Promise.all([
      image("assets/logo.png",2300).catch(()=>null),
      getSourceFavicon(snapshot,story)
    ]);
    const ctx=canvas.getContext("2d",{alpha:false});
    if(!ctx)throw new Error("canvas_unsupported");
    ctx.clearRect(0,0,W,H);
    ctx.textAlign="left";
    ctx.textBaseline="alphabetic";
    ctx.fillStyle="#090b10";ctx.fillRect(0,0,W,H);

    // 1080×1920 hikâye: UI kontrollerinden uzak kalmak için üst/alt güvenli alan.
    const SAFE={x:64,y:206,w:952,h:1430,r:28};
    const inset=36;
    const left=SAFE.x+inset,right=SAFE.x+SAFE.w-inset;

    // Tam fotoğraf, arkada hafifçe bulanıklaşmış kendi görüntüsünün üzerinde.
    if(photo){
      ctx.save();
      ctx.filter="blur(32px) saturate(.86)";
      cover(ctx,photo,-54,-54,W+108,1450);
      ctx.restore();
      ctx.fillStyle="rgba(5,8,13,.38)";
      ctx.fillRect(0,0,W,1390);
    }else{
      const shade=ctx.createLinearGradient(0,0,W,1390);
      shade.addColorStop(0,"#334554");shade.addColorStop(.48,"#18232d");
      shade.addColorStop(1,"#070a0f");
      ctx.fillStyle=shade;ctx.fillRect(0,0,W,1390);
    }
    const shade=ctx.createLinearGradient(0,930,0,1610);
    shade.addColorStop(0,"rgba(11,13,18,0)");
    shade.addColorStop(.34,"rgba(11,13,18,.84)");
    shade.addColorStop(.77,"#0b0d12");
    shade.addColorStop(1,"#0b0d12");
    ctx.fillStyle=shade;ctx.fillRect(0,930,W,680);
    ctx.fillStyle="#0b0d12";ctx.fillRect(0,1608,W,H-1608);

    // Güvenli alanın içi dış çevreden hafif koyu; fotoğraf ve yazılar üstte
    // çizildiği için parlaklıklarını kaybetmezler.
    ctx.save();
    roundedRect(ctx,SAFE.x,SAFE.y,SAFE.w,SAFE.h,SAFE.r);
    ctx.fillStyle="rgba(0,0,0,.25)";
    ctx.fill();
    ctx.restore();

    // Beta yazmayan resmî Flöw logosu, güvenli alanın üstünde.
    if(brand){
      const maxW=214,maxH=85,scale=Math.min(maxW/brand.width,maxH/brand.height);
      ctx.save();
      ctx.shadowColor="rgba(0,0,0,.55)";ctx.shadowBlur=16;
      ctx.drawImage(brand,left,256,brand.width*scale,brand.height*scale);
      ctx.restore();
    }else{
      ctx.fillStyle="#fff";
      ctx.font='700 65px "Comfortaa",sans-serif';
      ctx.fillText("flöw",left,313);
    }

    // Fotoğrafın tüm içeriği görünür: "contain" ile kaynak kadrajına dokunulmaz.
    if(photo)contain(ctx,photo,left,364,right-left,670);

    // Kaynak, anasayfadaki gibi sağa yaslı, yanında gerçek kaynak favicon'u.
    const sourceName=String(snapshot?.source||story.source||"FLÖW").trim();
    const sourceY=1132;
    const iconSize=36;
    let sourceRight=right;
    if(favicon){
      ctx.save();
      roundedRect(ctx,right-iconSize,sourceY-iconSize+6,iconSize,iconSize,7);
      ctx.clip();
      ctx.drawImage(favicon,right-iconSize,sourceY-iconSize+6,iconSize,iconSize);
      ctx.restore();
      sourceRight=right-iconSize-15;
    }
    ctx.textAlign="right";
    ctx.font='700 29px "Comfortaa",sans-serif';
    ctx.fillStyle="rgba(255,255,255,.85)";
    ctx.fillText(sourceName.slice(0,75),sourceRight,sourceY,sourceRight-left);

    // Kategori yok. Kullanıcının o anda gördüğü orijinal/BaitBuster başlık korunur.
    const headline=String(story.title||"Flöw'de bir haber").trim();
    const titleW=right-left,titleH=247;
    let font=60,lineHeight=73,lines=[];
    while(font>=35){
      ctx.font='700 '+font+'px "Comfortaa",sans-serif';
      lines=measureLines(ctx,headline,titleW);
      lineHeight=Math.round(font*1.23);
      if(lines.length*lineHeight<=titleH)break;
      font-=2;
    }
    const maxLines=Math.max(1,Math.floor(titleH/lineHeight));
    if(lines.length>maxLines){
      lines=lines.slice(0,maxLines);
      lines[maxLines-1]=truncateLine(ctx,lines[maxLines-1]+"…",titleW);
    }
    ctx.fillStyle="#fff";
    let titleY=1212;
    for(const line of lines){
      ctx.fillText(truncateLine(ctx,line,titleW),right,titleY,titleW);
      titleY+=lineHeight;
    }

    // Gereksiz CTA/slogan kaldırıldı. Kısa adres ve küçük QR alt köşede.
    const qrSize=155;
    const qrX=right-qrSize,qrY=1452;
    qrDraw(ctx,shortUrl,qrX,qrY,qrSize);
    ctx.font='500 23px "Comfortaa",sans-serif';
    ctx.fillStyle="rgba(255,255,255,.72)";
    const display=shortUrl.replace(/^https:\/\//,"").replace(/^xn--flw-tna\.tr/,"flöw.tr");
    ctx.fillText(display,qrX-21,1592,qrX-left-25);

    // İnce yuvarlatılmış güvenli alan çizgisi tüm öğelerin çevresinde.
    ctx.save();
    roundedRect(ctx,SAFE.x,SAFE.y,SAFE.w,SAFE.h,SAFE.r);
    ctx.strokeStyle="rgba(255,255,255,.38)";
    ctx.lineWidth=2.3;
    ctx.stroke();
    ctx.restore();
    return canvas;
  }

  function reset(){
    visualButton.disabled=true;
    visualButton.textContent="Görsel hazırlanıyor…";
    linkButton.disabled=true;
    linkButton.textContent="Bağlantı hazırlanıyor…";
    textStatus("Flöw kartı hazırlanıyor…",false);
    const ctx=canvas.getContext("2d");
    ctx.fillStyle="#11151c";ctx.fillRect(0,0,W,H);
    ctx.fillStyle="#fff";ctx.textAlign="center";
    ctx.font='700 51px "Comfortaa",sans-serif';ctx.fillText("flöw",W/2,H/2);
    ctx.textAlign="left";
  }

  async function generate(serial){
    const entry=current,share=window.FloewShare;
    if(!entry||!share)return;
    try{
      entry.snapshot=await share.buildShareSnapshot(entry.button,entry.story);
      const shortUrl=await share.shareUrlForArticle(entry.story.articleUrl,entry.snapshot);
      if(!current||serial!==buildSerial)return;
      entry.story.shareUrl=shortUrl;
      linkButton.textContent="Bağlantı paylaş";
      linkButton.disabled=!shortUrl;
      if(!SHORT_RE.test(shortUrl)){
        throw new Error("short_link_unavailable");
      }
      const photo=await getPhoto(entry.snapshot,entry.story);
      if(!current||serial!==buildSerial)return;
      await drawCard(entry.story,entry.snapshot,shortUrl,photo);
      if(!current||serial!==buildSerial)return;
      const blob=await new Promise(resolve=>canvas.toBlob(resolve,"image/png"));
      if(!blob)throw new Error("canvas_export_failed");
      if(!current||serial!==buildSerial)return;
      entry.blob=blob;
      entry.file=new File([blob],"floew-haber.png",{type:"image/png"});
      entry.filename="floew-haber-"+new Date().toISOString().slice(0,10)+".png";
      const nativeFiles=typeof navigator.canShare==="function"&&
        typeof navigator.share==="function"&&navigator.canShare({files:[entry.file]});
      entry.canNativeShare=nativeFiles;
      visualButton.textContent=nativeFiles?"Görsel paylaş":"Görseli indir";
      visualButton.disabled=false;
      textStatus(photo
        ?"1080 × 1920 dikey kart hazır. QR kodu habere yönlendirir."
        :"Haber fotoğrafına erişilemedi; görsel yerine markalı kart hazırlandı.",!photo);
    }catch(error){
      if(serial!==buildSerial)return;
      console.warn("Flöw visual share:",error);
      visualButton.disabled=true;
      // QR kartı oluşturulamadıysa mevcut link paylaşımı yine kullanılabilir.
      linkButton.textContent="Bağlantı paylaş";
      linkButton.disabled=false;
      textStatus(error?.message==="short_link_unavailable"
        ?"QR için kısa Flöw bağlantısı oluşturulamadı. Bağlantı paylaşmayı kullanabilirsin."
        :"Görsel kart oluşturulamadı. Bağlantı paylaşmayı kullanabilirsin.",true);
    }
  }

  function open(button){
    const share=window.FloewShare;
    const story=share?.storyFromButton?.(button);
    if(!story){return false;}
    ensure();
    if(!overlay.hidden)close();
    focusBefore=document.activeElement;
    current={button,story,blob:null,file:null,canNativeShare:false};
    const serial=++buildSerial;
    overlay.hidden=false;
    overlay.setAttribute("aria-hidden","false");
    document.body.classList.add("floew-visual-share-open");
    if(typeof window.pauseFlowForUi==="function")window.pauseFlowForUi();
    reset();
    el(".floew-visual-share-close",overlay).focus();
    void generate(serial);
    return true;
  }

  async function shareImage(){
    const entry=current;
    if(!entry?.blob)return;
    visualButton.disabled=true;
    try{
      if(entry.canNativeShare){
        try{
          // Native share must begin synchronously in the click handler.
          await navigator.share({files:[entry.file],title:entry.story.title});
          window.FloewShare?.telemetry(entry.story,"visual_native");
          textStatus("Görsel paylaşımı açıldı.",false);
          close();return;
        }catch(error){
          if(error?.name==="AbortError"){textStatus("Paylaşım iptal edildi.",false);return;}
          if(error?.name==="NotAllowedError"){textStatus("Paylaşım izni verilmedi.",true);return;}
        }
      }
      const url=URL.createObjectURL(entry.blob);
      const anchor=document.createElement("a");
      anchor.href=url;anchor.download=entry.filename;
      document.body.appendChild(anchor);
      anchor.click();anchor.remove();
      setTimeout(()=>URL.revokeObjectURL(url),30000);
      window.FloewShare?.telemetry(entry.story,"visual_download");
      textStatus("Görsel indirildi. Hikâyende veya başka bir uygulamada paylaşabilirsin.",false);
    }finally{
      if(current===entry)visualButton.disabled=false;
    }
  }

  window.FloewVisualShare={open,close};
})();
