/* Flüsh native Advertising Center. Auth via FLUSH_AUTH service binding in the Ad Center Worker. */
(()=>{
"use strict";
const BASE="https://flowery.xn--flw-tna.tr";
const esc=x=>String(x??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const nf=new Intl.NumberFormat("tr-TR");
const allowed=new Set(["image/jpeg","image/png","image/webp","image/gif","image/avif","video/mp4","video/webm","video/quicktime"]);
const date=x=>String(x??"").match(/^\d{4}-\d\d-\d\d$/)?String(x).slice(8)+"."+String(x).slice(5,7)+"."+String(x).slice(0,4):"—";
async function call(path,options={}){
 const response=await fetch(BASE+path,{method:options.method||"GET",credentials:"include",cache:"no-store",headers:{Accept:"application/json",...(options.body instanceof Blob?{"Content-Type":options.body.type,"X-File-Name":encodeURIComponent(options.filename||"reklam")}:(options.body?{"Content-Type":"application/json"}:{}))},body:options.body instanceof Blob?options.body:options.body?JSON.stringify(options.body):undefined});
 const data=await response.json().catch(()=>({}));
 if(!response.ok)throw Error(data.error||"HTTP "+response.status);
 return data;
}
function safeMediaUrl(obj){
 const path=String(obj?.mediaUrl||"");
 return /^\/m\/[a-zA-Z0-9._%-]+$/.test(path)?BASE+path:"";
}
function status(ad,today){
 if(ad.end_date<today)return ["Süresi doldu","expired"];
 if(!ad.active)return ["Pasif","off"];
 if(ad.start_date>today)return ["Planlandı","scheduled"];
 return ["Yayında","on"];
}
function media(obj,kind){
 const u=safeMediaUrl(obj);
 if(!u)return '<div class="fac-empty-media">'+esc(kind)+" medya yok</div>";
 if(obj.mediaType==="video")return '<video controls preload="metadata" playsinline src="'+esc(u)+'"></video>';
 return '<img loading="lazy" src="'+esc(u)+'" alt="'+esc(kind)+' reklam görseli">';
}
function mount(host){
 let ads=[],admin=false,categories=[],today="",busy=false,editing=null;
 host.dataset.flushModule="flowery";
 host.innerHTML=[
 '<header class="fn-toolbar"><div><div class="fn-eyebrow">FLÜSH / YÖNETİM</div><h2>Reklam Merkezi</h2><p>Reklamları ekle, planla, yayınla ve düzenle.</p></div>',
 '<div class="fac-toolbar-actions"><button type="button" class="fn-secondary" data-fac-action="refresh">Yenile</button>',
 '<button type="button" class="fn-secondary fac-primary" id="facAdd" data-fac-action="add" hidden>+ Yeni reklam</button></div></header>',
 '<p id="facStatus" class="fac-status" role="status">Reklamlar yükleniyor…</p>',
 '<div id="facStats"></div><div id="facFeed"></div><div id="facModal"></div>'
 ].join("");
 const el=id=>host.querySelector("#"+id),active=()=>host.dataset.flushModule==="flowery"&&host.isConnected;
 const notify=x=>el("facStatus").textContent=x;
 function draw(){
  if(!active())return;
  el("facAdd").hidden=!admin;
  el("facStats").innerHTML='<div class="fn-metrics">'+[
   ["Toplam reklam",nf.format(ads.length)],
   ["Yayında",nf.format(ads.filter(x=>status(x,today)[1]==="on").length)],
   ["Planlanmış",nf.format(ads.filter(x=>status(x,today)[1]==="scheduled").length)],
   ["Pasif",nf.format(ads.filter(x=>!x.active).length)]
  ].map(([k,v])=>'<div class="fn-metric"><span>'+esc(k)+'</span><strong>'+esc(v)+'</strong></div>').join("")+"</div>";
  const banner=admin?'<p class="fac-info">Flüsh oturumu doğrulandı. Pasif ve planlanmış reklamlar da listeleniyor.</p>':
   '<div class="fn-error fac-info">Reklam Merkezi henüz Flüsh oturumunu doğrulayamıyor. Yeni reklam eklemek ve düzenlemek için Reklam Merkezi Worker’ına FLUSH_AUTH bağlantısını kurun. <a href="'+BASE+'" target="_blank" rel="noopener noreferrer">Bağımsız Reklam Merkezi</a> çalışmaya devam eder.</div>';
  const list=ads.map(ad=>{
   const [label,klass]=status(ad,today);
   const can=admin;
   return '<article class="fac-card"><div class="fac-card-media"><div><span>YATAY</span>'+media(ad.horizontalMedia,"Yatay")+'</div><div><span>DİKEY</span>'+media(ad.verticalMedia,"Dikey")+'</div></div>'+
    '<div class="fac-card-body"><div><b>'+esc(ad.title||"Başlıksız reklam")+'</b><p>'+esc(ad.category||"—")+' · '+esc(date(ad.start_date))+' / '+esc(date(ad.end_date))+'</p></div>'+
    '<span class="fac-status-pill fac-'+klass+'">'+esc(label)+'</span></div>'+
    (can?'<div class="fac-actions"><label class="fac-active"><input type="checkbox" data-fac-toggle="'+esc(ad.id)+'" '+(ad.active?'checked':'')+'> Aktif</label><button class="fn-secondary" data-fac-action="edit" data-fac-id="'+esc(ad.id)+'">Düzenle</button><button class="fn-secondary fac-danger" data-fac-action="delete" data-fac-id="'+esc(ad.id)+'">Sil</button></div>':"")+
    '</article>';
  }).join("");
  el("facFeed").innerHTML=banner+'<section class="fac-grid">'+(list||'<div class="fn-empty">Henüz reklam yok.</div>')+"</section>";
 }
 async function refresh(){
  notify("Reklamlar yükleniyor…");
  try{
   const [auth,cats,listing]=await Promise.all([call("/api/session"),call("/api/categories"),call("/api/flowery")]);
   if(!active())return;
   admin=Boolean(auth.authenticated&&listing.admin);
   categories=Array.isArray(cats.categories)?cats.categories:[];
   ads=Array.isArray(listing.ads)?listing.ads:[];
   today=String(listing.today||new Date().toISOString().slice(0,10));
   notify(nf.format(ads.length)+" reklam · Güncellendi: "+new Date().toLocaleString("tr-TR"));
   draw();
  }catch(e){
   if(!active())return;
   admin=false;
   el("facAdd").hidden=true;
   notify("Reklam Merkezi bağlantısı tamamlanamadı.");
   el("facFeed").innerHTML='<div class="fn-error">Yeni arayüz Reklam Merkezi API’sine bağlanamadı: '+esc(e.message)+'. Önce Reklam Merkezi Worker’ına Flüsh SSO sürümünü yükleyin. <a href="'+BASE+'" target="_blank" rel="noopener noreferrer">Eski paneli aç</a>.</div>';
  }
 }
 function openEditor(ad=null){
  if(!admin)return;
  editing=ad;
  const start=today||new Date().toISOString().slice(0,10);
  const end=(d=>{d.setDate(d.getDate()+30);return d.toISOString().slice(0,10)})(new Date(start+"T12:00:00Z"));
  const options='<option value="">Kategori seç</option>'+categories.map(c=>'<option value="'+esc(c.code)+'" '+(ad?.category===c.code?'selected':'')+'>'+esc(c.code+" · "+c.label)+'</option>').join("");
  const hint=(obj,label)=>obj?'<small>Mevcut '+label+': '+esc(obj.mediaName||obj.mediaKey)+'</small>':"<small>Yüklü dosya yok</small>";
  el("facModal").innerHTML=[
   '<div class="fac-overlay" data-fac-action="close"><section class="fac-dialog" role="dialog" aria-modal="true" aria-label="Reklam düzenleme">',
   '<div class="fac-dialog-head"><div><div class="fn-eyebrow">REKLAM YÖNETİMİ</div><h2>',esc(ad?"Reklamı düzenle":"Yeni reklam ekle"),'</h2></div><button type="button" class="fn-secondary" data-fac-action="close">Kapat</button></div>',
   '<form id="facForm"><label class="fac-field fac-full">Reklam adı<input id="facTitle" required maxlength="160" value="',esc(ad?.title||""),'"></label>',
   '<label class="fac-field">Kategori<select id="facCategory" required>',options,'</select></label>',
   '<label class="fac-field">Yayın başlangıcı<input type="date" id="facStart" required value="',esc(ad?.start_date||start),'"></label>',
   '<label class="fac-field">Yayın bitişi<input type="date" id="facEnd" required value="',esc(ad?.end_date||end),'"></label>',
   '<label class="fac-field">Yatay medya<input type="file" id="facHor" accept="image/jpeg,image/png,image/webp,image/gif,image/avif,video/mp4,video/webm,video/quicktime">',hint(ad?.horizontalMedia,"yatay"),'</label>',
   '<label class="fac-field">Dikey medya<input type="file" id="facVer" accept="image/jpeg,image/png,image/webp,image/gif,image/avif,video/mp4,video/webm,video/quicktime">',hint(ad?.verticalMedia,"dikey"),'</label>',
   '<p class="fac-full fac-hint">En az bir yatay veya dikey medya gerekli. Her dosya en fazla 10 MB. Düzenleme sırasında yeni dosya seçilmezse mevcut medya korunur.</p>',
   '<p class="fac-full fac-form-message" id="facFormMessage" role="status"></p>',
   '<div class="fac-full fac-form-actions"><button type="button" class="fn-secondary" data-fac-action="close">Vazgeç</button><button type="submit" id="facSave" class="fn-secondary fac-primary">',esc(ad?"Değişiklikleri kaydet":"Reklamı kaydet"),'</button></div>',
   '</form></section></div>'
  ].join("");
  el("facTitle").focus();
 }
 function close(){el("facModal").replaceChildren();editing=null}
 async function upload(file){
  if(!file)return null;
  if(!allowed.has(file.type))throw Error("Desteklenmeyen medya türü: "+file.name);
  if(file.size<1||file.size>10*1024*1024)throw Error("Dosya 10 MB sınırını aşıyor: "+file.name);
  const out=await call("/api/upload",{method:"POST",body:file,filename:file.name});
  if(out.ok!==true)throw Error("Medya yüklenemedi");
  return {mediaKey:out.mediaKey,mediaName:out.mediaName,mediaType:out.mediaType,mediaContentType:out.mediaContentType,mediaSize:out.mediaSize};
 }
 async function save(e){
  e.preventDefault();if(busy||!admin)return;
  const title=el("facTitle").value.trim(),category=el("facCategory").value,
        startDate=el("facStart").value,endDate=el("facEnd").value,
        horizontalFile=el("facHor").files[0],verticalFile=el("facVer").files[0];
  const msg=el("facFormMessage");
  if(!title||!category||!startDate||!endDate||startDate>endDate){msg.textContent="Başlığı, kategoriyi ve tarihleri kontrol edin.";return}
  if(!editing&&!horizontalFile&&!verticalFile){msg.textContent="En az bir medya dosyası seçin.";return}
  busy=true;el("facSave").disabled=true;msg.textContent="Reklam hazırlanıyor…";
  try{
   const horizontal=horizontalFile?await upload(horizontalFile):editing?.horizontalMedia||null;
   msg.textContent="Medya kontrol edildi. Reklam kaydediliyor…";
   const vertical=verticalFile?await upload(verticalFile):editing?.verticalMedia||null;
   const data={title,category,startDate,endDate,horizontal,vertical};
   if(editing)await call("/api/flowery/"+encodeURIComponent(editing.id),{method:"PATCH",body:data});
   else await call("/api/flowery",{method:"POST",body:data});
   close();await refresh();notify("Reklam kaydedildi.");
  }catch(err){msg.textContent="Kayıt yapılamadı: "+err.message}
  finally{busy=false;const btn=el("facSave");if(btn)btn.disabled=false}
 }
 async function remove(id){
  if(!admin||!confirm("Reklam kalıcı olarak silinsin mi?"))return;
  try{await call("/api/flowery/"+encodeURIComponent(id),{method:"DELETE"});await refresh();notify("Reklam silindi.")}
  catch(e){alert("Reklam silinemedi: "+e.message)}
 }
 async function toggle(id,checked,control){
  if(!admin)return;
  control.disabled=true;
  try{await call("/api/flowery/"+encodeURIComponent(id),{method:"PATCH",body:{active:checked}});await refresh()}
  catch(e){control.checked=!checked;control.disabled=false;alert("Reklam durumu değiştirilemedi: "+e.message)}
 }
 host.onclick=e=>{
  const node=e.target.closest("[data-fac-action]");
  if(!node||!host.contains(node))return;
  const action=node.dataset.facAction;
  if(action==="close"){if(node.classList.contains("fac-overlay")&&node!==e.target)return;close()}
  if(action==="refresh")refresh();
  if(action==="add")openEditor();
  if(action==="edit")openEditor(ads.find(x=>x.id===node.dataset.facId));
  if(action==="delete")remove(node.dataset.facId);
 };
 host.onchange=e=>{const node=e.target.closest("[data-fac-toggle]");if(node)toggle(node.dataset.facToggle,node.checked,node)};
 host.onsubmit=e=>{if(e.target.id==="facForm")save(e)};
 host.onkeydown=e=>{if(e.key==="Escape"&&el("facModal").children.length){e.preventDefault();close()}};
 refresh();
}
window.FlushAdCenterNative={mount};
})();
