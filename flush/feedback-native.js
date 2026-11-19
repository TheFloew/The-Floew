/* Native Flüsh Feedback: all requests go through the role-scoped Flüsh auth proxy. */
(()=>{
 "use strict";
 const esc=v=>String(v??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
 const pick=(...xs)=>xs.map(x=>String(x??"").trim()).find(Boolean)||"";
 const nf=new Intl.NumberFormat("tr-TR");
 const date=ms=>ms?new Date(Number(ms)).toLocaleString("tr-TR",{timeZone:"Europe/Istanbul",dateStyle:"short",timeStyle:"short"}):"—";
 const parse=x=>{try{const y=typeof x==="string"?JSON.parse(x):x;return y&&typeof y==="object"&&!Array.isArray(y)?y:{}}catch{return {}}};
 const topic=x=>pick(x.topic_label,x.topic,"Diğer");
 const label=x=>pick(x.issue_label,x.suggestion_label,x.area_label,x.topic_label,"Geri bildirim");
 const source=x=>pick(x.source,x.story_source);
 const note=x=>pick(x.note,x.required_text);
 const group=(rows,fn)=>{const m=new Map();rows.forEach(r=>{const k=pick(fn(r),"Belirsiz");m.set(k,(m.get(k)||0)+1)});return [...m].sort((a,b)=>b[1]-a[1])};
 const unique=(rows,fn)=>[...new Set(rows.map(fn).filter(Boolean))].sort((a,b)=>a.localeCompare(b,"tr"));
 function norm(row,i){
  const m=parse(row.meta_json);
  return {id:String(row.event_id||"row-"+i),event_id:String(row.event_id||""),occurred_at:Number(row.occurred_at)||0,visitor_id:String(row.visitor_id||""),session_id:String(row.session_id||""),
   topic:pick(m.topic),topic_label:pick(m.topic_label),area_label:pick(m.area_label),
   issue_label:pick(m.issue_label),suggestion_label:pick(m.suggestion_label),
   frequency_label:pick(m.frequency_label),severity_label:pick(m.severity_label),direction_label:pick(m.direction_label),
   source:pick(m.source),story_source:pick(m.story_source,row.source),story_category:pick(m.story_category,row.category),
   story_title:pick(m.story_title),story_link:pick(m.story_link),story_key:pick(m.story_key),category_target:pick(m.category_target),
   note:pick(m.note),required_text:pick(m.required_text),device_type:pick(m.device_type),browser:pick(m.browser),os:pick(m.os),feed_mode:pick(row.feed_mode),
   app_version:pick(m.app_version),value_text:pick(row.value_text)};
 }
 async function request(auth,path,opts={}){
  const r=await fetch(auth+"/api/proxy/analytics"+path,{method:opts.method||"GET",credentials:"include",cache:"no-store",headers:{Accept:"application/json",...(opts.body?{"Content-Type":"application/json"}:{})},body:opts.body?JSON.stringify(opts.body):undefined});
  const data=await r.json().catch(()=>({}));if(!r.ok)throw Error(data.error||"HTTP "+r.status);return data;
 }
 function card(title,body){return '<article class="fn-card"><div class="fn-card-head"><h3>'+esc(title)+'</h3></div>'+body+'</article>'}
 function bars(groups){
  if(!groups.length)return '<div class="fn-empty">Henüz veri yok.</div>';
  const max=Math.max(1,...groups.map(x=>x[1]));
  return '<div class="fn-bars">'+groups.slice(0,8).map(([label,n])=>'<div class="fn-bar"><div class="fn-bar-meta"><span title="'+esc(label)+'">'+esc(label)+'</span><b>'+nf.format(n)+'</b></div><div class="fn-track"><div class="fn-fill" style="width:'+Math.max(1,n/max*100)+'%"></div></div></div>').join("")+"</div>";
 }
 function download(filename,mime,payload){
  const blob=new Blob([payload],{type:mime}),url=URL.createObjectURL(blob),a=document.createElement("a");
  a.href=url;a.download=filename;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1500);
 }
 function csvCell(value){
  let s=String(value??"").replace(/[\r\n\t]+/g," ").trim();
  if(/^[=+\-@\uFF1D\uFF0B\uFF0D\uFF20]/.test(s))s="'"+s;
  return '"'+s.replace(/"/g,'""')+'"';
 }
 function mount(host,auth){
  let rows=[],total=0,range="7d",search="",topicFilter="",sourceFilter="",deviceFilter="",visible=[],status="";
  host.dataset.flushModule="feedback";
  host.innerHTML=[
   '<div class="fn-toolbar"><div><div class="fn-eyebrow">FLÜSH / YÖNETİM</div><h2>Feedback</h2><p>Geri bildirimleri incele, filtrele ve yönet.</p></div>',
   '<div class="nfd-actions"><button class="fn-secondary" data-fact="refresh" type="button">Yenile</button><button class="fn-secondary" data-fact="csv" type="button">CSV</button><button class="fn-secondary" data-fact="json" type="button">JSON</button></div></div>',
   '<div class="nfd-range"><button type="button" class="fn-secondary" data-frange="24h">24 saat</button><button type="button" class="fn-secondary active" data-frange="7d">7 gün</button><button type="button" class="fn-secondary" data-frange="all">Tüm zamanlar</button></div>',
   '<p id="nfdStatus" role="status" class="nfd-status">Veriler yükleniyor…</p><div id="nfdMetrics"></div>',
   '<div class="nfd-filter"><input id="nfdSearch" type="search" placeholder="Sorun, not, kaynak veya haber ara…" aria-label="Geri bildirimlerde ara">',
   '<select id="nfdTopic" aria-label="Konu"><option value="">Tüm konular</option></select>',
   '<select id="nfdSource" aria-label="Kaynak"><option value="">Tüm kaynaklar</option></select>',
   '<select id="nfdDevice" aria-label="Cihaz"><option value="">Tüm cihazlar</option></select></div>',
   '<div id="nfdCharts"></div><div id="nfdList"></div><div id="nfdModal"></div>'
  ].join("");
  const el=id=>host.querySelector("#"+id),active=()=>host.dataset.flushModule==="feedback"&&host.isConnected;
  function fillOptions(id,items,title){
   const node=el(id),prev=node.value;
   node.innerHTML='<option value="">'+esc(title)+'</option>'+items.map(x=>'<option value="'+esc(x)+'">'+esc(x)+'</option>').join("");
   if(items.includes(prev))node.value=prev;
  }
  function render(){
   if(!active())return;
   const since=range==="24h"?Date.now()-86400000:range==="7d"?Date.now()-604800000:0;
   const period=rows.filter(x=>!since||x.occurred_at>=since);
   const q=search.trim().toLocaleLowerCase("tr-TR");
   visible=period.filter(x=>(!topicFilter||topic(x)===topicFilter)&&(!sourceFilter||source(x)===sourceFilter)&&(!deviceFilter||x.device_type===deviceFilter)&&(!q||[topic(x),label(x),source(x),note(x),x.story_title,x.story_category,x.device_type,x.os,x.browser,x.value_text].join(" ").toLocaleLowerCase("tr-TR").includes(q)));
   host.querySelectorAll("[data-frange]").forEach(b=>b.classList.toggle("active",b.dataset.frange===range));
   el("nfdStatus").textContent=status||nf.format(visible.length)+" kayıt görüntüleniyor";
   el("nfdMetrics").innerHTML='<div class="fn-metrics">'+[
    ["Geri bildirim",nf.format(period.length)],["Saklanan toplam",nf.format(total||rows.length)],
    ["Yazılı not",nf.format(period.filter(x=>note(x)).length)],["Tekil ziyaretçi",nf.format(new Set(period.map(x=>x.visitor_id).filter(Boolean)).size)]
   ].map(([a,b])=>'<div class="fn-metric"><span>'+esc(a)+'</span><strong>'+esc(b)+'</strong></div>').join("")+"</div>";
   el("nfdCharts").innerHTML='<div class="nfd-three">'+card("Konular",bars(group(visible,topic)))+card("En sık geri bildirimler",bars(group(visible,label)))+card("Cihazlar",bars(group(visible,x=>x.device_type||"Belirsiz")))+"</div>";
   const list=visible.map(x=>{
    const story=pick(x.story_title,x.story_source,x.story_category,"Habere bağlı değil"),device=pick([x.device_type,x.os,x.browser].filter(Boolean).join(" · "),"—");
    return '<button type="button" class="nfd-entry" data-fitem="'+esc(x.id)+'"><span>'+esc(date(x.occurred_at))+'</span><span class="nfd-entry-main"><b>'+esc(label(x))+'</b><small>'+esc(topic(x))+(note(x)?' · Yazılı not':"")+'</small></span><span title="'+esc(story)+'">'+esc(story)+'</span><span title="'+esc(device)+'">'+esc(device)+'</span></button>';
   }).join("");
   el("nfdList").innerHTML=card("Geri bildirimler · "+nf.format(visible.length)+" kayıt",'<div class="nfd-list">'+(list||'<div class="fn-empty">Bu filtrelerle eşleşen geri bildirim yok.</div>')+"</div>");
  }
  function showDetail(id){
   const x=rows.find(v=>v.id===id);if(!x)return;
   const props=[["Konu",topic(x)],["Alan",x.area_label],["Sorun",x.issue_label],["Öneri",x.suggestion_label],
    ["Sıklık",x.frequency_label],["Ciddiyet",x.severity_label],["Yön",x.direction_label],["Seçilen kaynak",x.source],["Haber kaynağı",x.story_source],
    ["Haber",x.story_title],["Kategori",x.story_category],["Kategori hedefi",x.category_target],["Cihaz",x.device_type],["Tarayıcı",x.browser],["OS",x.os],
    ["Uygulama",x.app_version],["Akış",x.feed_mode],["Tarih",date(x.occurred_at)],["Visitor ID",x.visitor_id],["Session ID",x.session_id]]
    .filter(([,v])=>v).map(([k,v])=>'<div class="nfd-detail-item"><span>'+esc(k)+'</span><b>'+esc(v)+'</b></div>').join("");
   let link="";try{const u=new URL(x.story_link);if(["https:","http:"].includes(u.protocol))link=u.href}catch{}
   el("nfdModal").innerHTML='<div class="nfd-overlay" data-fact="close"><section class="nfd-dialog" role="dialog" aria-modal="true" aria-label="Geri bildirim ayrıntısı">'+
    '<header class="nfd-dialog-head"><div><div class="fn-eyebrow">GERİ BİLDİRİM AYRINTISI</div><h2>'+esc(label(x))+'</h2></div><button class="fn-secondary" type="button" data-fact="close">Kapat</button></header>'+
    '<div class="nfd-detail-grid">'+props+'</div>'+
    (x.required_text?'<div class="nfd-note"><span>Kısa yanıt</span><p>'+esc(x.required_text)+'</p></div>':"")+
    (x.note?'<div class="nfd-note"><span>Not</span><p>'+esc(x.note)+'</p></div>':"")+
    (link?'<a class="fn-secondary nfd-link" href="'+esc(link)+'" target="_blank" rel="noopener noreferrer">Haberi aç</a>':"")+
    (x.event_id?'<button type="button" class="fn-secondary nfd-danger" data-fact="delete" data-fid="'+esc(x.event_id)+'">Geri bildirimi sil</button>':"")+
    '</section></div>';
   el("nfdModal").querySelector(".nfd-dialog button").focus();
  }
  function close(){el("nfdModal").replaceChildren()}
  async function remove(id){
   if(!confirm("Bu geri bildirim kalıcı olarak silinsin mi?"))return;
   const button=host.querySelector('[data-fact="delete"]');if(button)button.disabled=true;
   try{
    const result=await request(auth,"/admin/feedback-delete",{method:"POST",body:{event_id:id}});
    if(result.ok!==true)throw Error(result.error||"Silme tamamlanamadı");
    rows=rows.filter(x=>x.event_id!==id);total=Math.max(0,total-(Number(result.deleted)||1));status="Geri bildirim silindi.";close();render();
   }catch(e){alert("Geri bildirim silinemedi: "+e.message);if(button)button.disabled=false}
  }
  async function refresh(){
   status="Geri bildirimler yükleniyor…";el("nfdStatus").textContent=status;
   try{
    const fetched=[];let cursor="",count=0,limited=false;
    for(let i=0;i<50;i++){
     const qs=new URLSearchParams({limit:"250"});if(cursor)qs.set("cursor",cursor);
     const r=await request(auth,"/admin/feedback?"+qs);
     if(r.ok!==true)throw Error(r.error||"Geri bildirimler alınamadı");
     count=Number(r.total)||count;const entries=Array.isArray(r.items)?r.items:[];
     fetched.push(...entries);cursor=String(r.nextCursor||"");
     if(!cursor||!entries.length)break;
     if(i===49)limited=true;
    }
    if(!active())return;
    rows=fetched.map(norm).sort((a,b)=>b.occurred_at-a.occurred_at);total=count;
    fillOptions("nfdTopic",unique(rows,topic),"Tüm konular");
    fillOptions("nfdSource",unique(rows,source),"Tüm kaynaklar");
    fillOptions("nfdDevice",unique(rows,x=>x.device_type),"Tüm cihazlar");
    status=(limited?"İlk "+nf.format(rows.length)+" kayıt gösteriliyor.":nf.format(rows.length)+" kayıt yüklendi.")+" · "+date(Date.now());
   }catch(e){status="Geri bildirimler alınamadı: "+e.message}
   render();
  }
  host.onclick=e=>{
   const node=e.target.closest("[data-fact],[data-frange],[data-fitem]");
   if(!node||!host.contains(node))return;
   if(node.dataset.frange){range=node.dataset.frange;render();return}
   if(node.dataset.fitem){showDetail(node.dataset.fitem);return}
   const action=node.dataset.fact;
   if(action==="close"){if(node.classList.contains("nfd-overlay")&&node!==e.target)return;close()}
   if(action==="refresh")refresh();
   if(action==="delete")remove(node.dataset.fid);
   if(action==="csv"){
    const table=[["Zaman","Konu","Etiket","Kaynak","Haber","Cihaz","Not","Visitor ID","Event ID"],...visible.map(x=>[date(x.occurred_at),topic(x),label(x),source(x),x.story_title,x.device_type,note(x),x.visitor_id,x.event_id])];
    download("floew-feedback-"+new Date().toISOString().slice(0,10)+".csv","text/csv;charset=utf-8","\uFEFF"+table.map(r=>r.map(csvCell).join(",")).join("\r\n"));
   }
   if(action==="json")download("floew-feedback-"+new Date().toISOString().slice(0,10)+".json","application/json;charset=utf-8",JSON.stringify(visible,null,2));
  };
  host.oninput=e=>{if(e.target.id==="nfdSearch"){search=e.target.value;render()}};
  host.onchange=e=>{const id=e.target.id;if(id==="nfdTopic")topicFilter=e.target.value;else if(id==="nfdSource")sourceFilter=e.target.value;else if(id==="nfdDevice")deviceFilter=e.target.value;else return;render()};
  host.onkeydown=e=>{if(e.key==="Escape"&&el("nfdModal").children.length){e.preventDefault();close()}};
  refresh();
 }
 window.FlushFeedbackNative={mount};
})();
