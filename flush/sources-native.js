(function flushSourcesModule(){
"use strict";
const nf=new Intl.NumberFormat("tr-TR");
const fmtNumber=v=>nf.format(Number(v)||0);
const fmtScore=v=>v===null||v===undefined?"Veri yok":new Intl.NumberFormat("tr-TR",{maximumFractionDigits:1}).format(Number(v));
const fmtTime=v=>{
 const n=Math.max(0,Math.round((Number(v)||0)/1000));
 if(n<60)return n+" sn";
 if(n<3600)return Math.floor(n/60)+" dk "+n%60+" sn";
 if(n<86400)return Math.floor(n/3600)+" sa "+Math.floor(n%3600/60)+" dk";
 return Math.floor(n/86400)+" gün "+Math.floor(n%86400/3600000)+" sa";
};
const esc=v=>String(v??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const state={range:"7d",rows:[],data:null,selected:"",search:"",sort:"views",direction:-1,loading:false,error:"",lastUpdated:"",loadId:0,host:null,auth:""};
const url=(path)=>state.auth+"/api/proxy/analytics"+path;
function active(host){return state.host===host&&host.isConnected&&host.dataset.flushModule==="sources"}
function metric(label,value,tip=""){
 return `<div class="fn-metric"><span>${esc(label)}</span><strong>${esc(value)}</strong>${tip?`<small>${esc(tip)}</small>`:""}</div>`;
}
function bars(rows,title){
 const items=Array.isArray(rows)?rows:[];
 const max=Math.max(1,...items.map(r=>Number(r.views)||0));
 return `<article class="fn-card"><div class="fn-card-head"><h3>${esc(title)}</h3></div><div class="fn-bars">`+
 (items.length?items.slice(0,15).map(r=>`
   <div class="fn-bar"><div class="fn-bar-meta"><span title="${esc(r.label)}">${esc(r.label)}</span><b>${fmtNumber(r.views)}</b></div>
   <div class="fn-track"><div class="fn-fill" style="width:${Math.round(100*(Number(r.views)||0)/max)}%"></div></div></div>
 `).join(""):'<div class="fn-empty">Henüz veri yok.</div>')+"</div></article>";
}
function demographic(rows,title){
 const items=Array.isArray(rows)?rows:[];
 if(!items.length)return `<article class="fn-card"><div class="fn-card-head"><h3>${esc(title)}</h3></div><div class="fn-empty">Bu kaynağa ait raporlanabilir veri bulunmuyor.</div></article>`;
 return `<article class="fn-card"><div class="fn-card-head"><h3>${esc(title)}</h3></div><div class="fns-table-scroll"><table class="fn-table"><thead><tr><th>Grup</th><th>Kullanıcı (GA4)</th></tr></thead><tbody>`+
 items.sort((a,b)=>(Number(b.users)||0)-(Number(a.users)||0)).map(x=>`<tr><td>${esc(x.label)}</td><td>${fmtNumber(x.users)}</td></tr>`).join("")+
 "</tbody></table></div></article>";
}
function visibleRows(){
 const q=state.search.trim().toLocaleLowerCase("tr-TR");
 const rows=state.rows.filter(x=>!q||x.source.toLocaleLowerCase("tr-TR").includes(q));
 const k=state.sort,sign=state.direction;
 return rows.sort((a,b)=>{
   const aa=a[k],bb=b[k];
   if(k==="source")return sign*String(aa).localeCompare(String(bb),"tr");
   const av=aa===null?-1:Number(aa)||0,bv=bb===null?-1:Number(bb)||0;
   return sign*(av-bv)||String(a.source).localeCompare(String(b.source),"tr");
 });
}
function header(){
 const activeRange=x=>state.range===x?"active":"";
 return `<header class="fn-toolbar"><div><div class="fn-eyebrow">FLÜSH / ANALİTİK</div><h2>Haber Kaynakları</h2><p>Yayıncıların akıştaki erişimi, okunma süresi, Flöra ortalaması ve paylaşım performansı.</p></div>
 <div class="fns-header-actions"><div class="fn-range" role="group" aria-label="Zaman aralığı">
 <button type="button" data-fns-range="24h" class="${activeRange("24h")}">24 saat</button>
 <button type="button" data-fns-range="7d" class="${activeRange("7d")}">7 gün</button>
 <button type="button" data-fns-range="all" class="${activeRange("all")}">Tüm zamanlar</button></div>
 <button type="button" class="fn-secondary fns-download" data-fns-action="all" ${!state.data?"disabled":""}>Tüm kaynakları HTML indir</button>
 </div></header>
 <div class="fns-status" role="status">${esc(state.error||state.loading?"Veriler yükleniyor…":state.lastUpdated)}</div>`;
}
function summary(){
 if(!state.data)return "";
 const r=state.rows,visitors=r.reduce((sum,x)=>sum+(Number(x.views)||0),0),
 stories=r.reduce((sum,x)=>sum+(Number(x.stories)||0),0),
 shares=r.reduce((sum,x)=>sum+(Number(x.shares)||0),0);
 return '<div class="fn-metrics fns-summary">'+
 metric("Haber kaynağı",fmtNumber(r.length))+
 metric("Farklı kaynak-haber",fmtNumber(stories),"Her kaynak için ayrı sayılır")+
 metric("Haber gösterimi",fmtNumber(visitors))+
 metric("Paylaşım eylemi",fmtNumber(shares))+
 "</div>";
}
function table(){
 const cols=[["source","Kaynak"],["stories","Haber"],["views","Gösterim"],["visitors","Tekil erişim"],["dwell_sum_ms","Toplam süre"],["avg_user_dwell_ms","Kişi başına"],["avg_flora","Ort. Flöra"],["shares","Paylaşım"]];
 const head=cols.map(([key,label])=>`<th><button type="button" class="fn-sort" data-fns-sort="${key}">${label}<span>${state.sort===key?(state.direction>0?" ↑":" ↓"):""}</span></button></th>`).join("");
 const rows=visibleRows();
 const body=rows.map(x=>`<tr class="${state.selected===x.source?"fns-selected":""}">
 <td><button type="button" class="fns-source-link" data-fns-source="${esc(x.source)}" title="Kaynak ayrıntısını göster">${esc(x.source)}</button></td>
 <td>${fmtNumber(x.stories)}</td><td>${fmtNumber(x.views)}</td><td>${fmtNumber(x.visitors)}</td>
 <td>${fmtTime(x.dwell_sum_ms)}</td><td>${fmtTime(x.avg_user_dwell_ms)}</td>
 <td>${x.avg_flora===null?"—":fmtScore(x.avg_flora)+(x.flora_sampled?" ≈":"")}</td>
 <td>${fmtNumber(x.shares)}</td>
 </tr>`).join("");
 return `<article class="fn-card fns-list"><div class="fn-card-head fns-card-head">
 <div><h3>Kaynak karşılaştırması</h3><small>Satırdaki kaynağa tıklayarak ayrıntılarını açabilirsin.</small></div>
 <label class="fns-search-label"><span>Kaynak ara</span><input type="search" data-fns-search placeholder="Kaynak adı" value="${esc(state.search)}"></label>
 </div><div class="fn-table-wrap"><table class="fn-table fns-table"><thead><tr>${head}</tr></thead>
 <tbody>${body||'<tr><td colspan="8" class="fn-empty">Bu aralıkta eşleşen kaynak yok.</td></tr>'}</tbody></table></div></article>`;
}
function details(){
 const x=state.rows.find(r=>r.source===state.selected);
 if(!x)return '<div class="fns-prompt">Ayrıntılarını incelemek için tablodan bir haber kaynağı seç.</div>';
 const score=x.avg_flora===null?"Veri yok":fmtScore(x.avg_flora)+(x.flora_sampled?" ≈":"");
 return `<section class="fns-detail" aria-label="Kaynak ayrıntıları">
  <div class="fns-detail-header"><div><div class="fn-eyebrow">KAYNAK AYRINTISI</div><h2>${esc(x.source)}</h2></div>
  <div class="fns-detail-actions"><button type="button" class="fn-secondary" data-fns-action="single">Bu kaynağın HTML raporu</button>
  <button type="button" class="fn-secondary" data-fns-action="close">Kapat</button></div></div>
  <div class="fn-metrics">${[
    metric("Farklı haber",fmtNumber(x.stories)),
    metric("Gösterim",fmtNumber(x.views)),
    metric("Tekil erişim",fmtNumber(x.visitors)),
    metric("Toplam görüntüleme",fmtTime(x.dwell_sum_ms)),
    metric("Kişi başına süre",fmtTime(x.avg_user_dwell_ms)),
    metric("Ortalama Flöra",score,x.flora_sampled?`${fmtNumber(x.flora_story_count)}/${fmtNumber(x.stories)} habere dayalı`:""),
    metric("Paylaşım",fmtNumber(x.shares))
  ].join("")}</div>
  <div class="fn-two">${bars(x.devices,"Cihazlar")}${bars(x.browsers,"Tarayıcılar")}</div>
  <div class="fn-two fns-demographics">${demographic(x.age,"Yaş grupları")}${demographic(x.gender,"Cinsiyet")}</div>
  <p class="fns-note">${esc(x.demographic_status)}</p>
 </section>`;
}
function render(){
 const h=state.host;if(!h)return;
 h.innerHTML=header()+(state.error?`<div class="fn-error">${esc(state.error)}</div>`:"")+
 (state.data?summary()+table()+details()+
 `<section class="fns-methods"><h3>Ölçüm notları</h3>
 ${Object.values(state.data.notes||{}).map(s=>`<p>${esc(s)}</p>`).join("")}
 ${state.data.demographics?.subjectToThresholding?"<p>GA4 demografisinde gizlilik eşiklemesi uygulanmış olabilir.</p>":""}
 </section>`:state.loading?'<div class="fns-loading">Kaynak istatistikleri hazırlanıyor…</div>':"");
}
async function refresh(){
 const h=state.host;if(!h)return;
 const id=++state.loadId;
 state.loading=true;state.error="";render();
 try{
   const res=await fetch(url("/admin/sources?range="+encodeURIComponent(state.range)),{
     credentials:"include",cache:"no-store",headers:{Accept:"application/json"}
   });
   const body=await res.json().catch(()=>({}));
   if(!res.ok||body.ok!==true)throw Error(body.error||"HTTP "+res.status);
   if(id!==state.loadId||!active(h))return;
   state.data=body;state.rows=Array.isArray(body.sources)?body.sources:[];
   if(!state.rows.some(x=>x.source===state.selected))state.selected="";
   state.lastUpdated="Güncellendi: "+new Date(body.generatedAt||Date.now()).toLocaleString("tr-TR")+
     " • "+(body.granularity||"");
 }catch(e){
   if(id!==state.loadId||!active(h))return;
   state.error="Veriler alınamadı: "+String(e.message||e)+". Kaynak API'si ve Flüsh proxy erişimini kontrol edin.";
   state.data=null;state.rows=[];
 }finally{if(id===state.loadId&&active(h)){state.loading=false;render()}}
}
async function download(one){
 const h=state.host;if(!h||!state.data)return;
 const query=new URLSearchParams({range:state.range});
 if(one&&state.selected)query.set("source",state.selected);
 const button=h.querySelector(`[data-fns-action="${one?"single":"all"}"]`);
 if(button)button.disabled=true;
 try{
   const res=await fetch(url("/admin/source-report?"+query),{credentials:"include",cache:"no-store",headers:{Accept:"text/html"}});
   if(!res.ok)throw Error("HTTP "+res.status);
   if(!(res.headers.get("Content-Type")||"").includes("text/html"))throw Error("Sunucu HTML rapor döndürmedi");
   const blob=await res.blob(),objectURL=URL.createObjectURL(blob);
   const a=document.createElement("a");
   const slug=one?state.selected.toLocaleLowerCase("tr-TR").normalize("NFD").replace(/[\u0300-\u036f]/g,"").replace(/[^a-z0-9-]+/g,"-").slice(0,55):"tum-kaynaklar";
   a.href=objectURL;a.download=`floew-kaynak-${slug}-${state.range}.html`;
   document.body.append(a);a.click();a.remove();
   setTimeout(()=>URL.revokeObjectURL(objectURL),3000);
 }catch(e){alert("HTML raporu indirilemedi: "+e.message)}
 finally{if(button&&active(h))button.disabled=false}
}
function mount(host,auth){
 if(!host)return;
 state.loadId++;
 state.host=host;state.auth=String(auth||"").replace(/\/$/,"");
 host.dataset.flushModule="sources";
 host.onclick=e=>{
   const b=e.target.closest("button");if(!b||!host.contains(b))return;
   if(b.dataset.fnsRange){state.range=b.dataset.fnsRange;state.selected="";refresh();return}
   if(b.dataset.fnsSort){
     if(state.sort===b.dataset.fnsSort)state.direction*=-1;
     else{state.sort=b.dataset.fnsSort;state.direction=state.sort==="source"?1:-1}
     render();return;
   }
   if(Object.hasOwn(b.dataset,"fnsSource")){state.selected=b.dataset.fnsSource;render();return}
   if(b.dataset.fnsAction==="all")download(false);
   if(b.dataset.fnsAction==="single")download(true);
   if(b.dataset.fnsAction==="close"){state.selected="";render()}
 };
 host.oninput=e=>{
   if(e.target.matches("[data-fns-search]")){
     const caret=e.target.selectionStart;
     state.search=e.target.value;
     const tableHost=host.querySelector(".fns-list");
     const newTable=document.createElement("div");
     newTable.innerHTML=table();
     tableHost.replaceWith(newTable.firstElementChild);
     const field=host.querySelector("[data-fns-search]");
     field.focus();try{field.setSelectionRange(caret,caret)}catch{}
   }
 };
 refresh();
}
function unmount(){state.loadId++;if(state.host){state.host.onclick=null;state.host.oninput=null;delete state.host.dataset.flushModule}state.host=null;}
window.FlushSourcesNative={mount,unmount};
})();
