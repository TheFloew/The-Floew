const BASE="https://thefloew.thefloewback.workers.dev";
let token=sessionStorage.getItem("floew.adminToken.v1")||"";
let range="7d";
const nf=new Intl.NumberFormat("tr-TR");

function esc(value){
  return String(value??"")
    .replace(/&/g,"&amp;")
    .replace(/</g,"&lt;")
    .replace(/>/g,"&gt;")
    .replace(/"/g,"&quot;");
}
function duration(ms){
  const sec=Math.round((Number(ms)||0)/1000);
  if(sec<60)return `${sec} sn`;
  const min=Math.floor(sec/60);
  if(min<60)return `${min} dk ${sec%60} sn`;
  return `${Math.floor(min/60)} sa ${min%60} dk`;
}
function metric(label,value){
  return `<div class="metric"><span>${esc(label)}</span><strong>${esc(value)}</strong></div>`;
}
function bars(rows,labelKey="label",valueKey="count"){
  const max=Math.max(1,...(rows||[]).map(x=>Number(x[valueKey])||0));
  if(!rows?.length)return `<div class="empty">Veri yok.</div>`;
  return rows.slice(0,25).map(row=>{
    const value=Number(row[valueKey])||0;
    return `<div class="bar-row">
      <div class="bar-label">${esc(row[labelKey]||"Bilinmiyor")}</div>
      <div class="bar"><i style="width:${Math.max(1,value/max*100)}%"></i></div>
      <div class="bar-value">${nf.format(value)}</div>
    </div>`;
  }).join("");
}
function table(rows,cols){
  return `<table><thead><tr>${cols.map(c=>`<th>${esc(c.label)}</th>`).join("")}</tr></thead>
  <tbody>${(rows||[]).map(row=>`<tr>${cols.map(c=>`<td>${esc(c.format?c.format(row[c.key],row):row[c.key])}</td>`).join("")}</tr>`).join("")||`<tr><td colspan="${cols.length}">Veri yok.</td></tr>`}</tbody></table>`;
}

async function api(path,options={}){
  const r=await fetch(`${BASE}${path}`,{
    ...options,
    cache:"no-store",
    headers:{
      ...(options.headers||{}),
      "Authorization":`Bearer ${token}`
    }
  });
  const type=r.headers.get("content-type")||"";
  if(type.includes("application/json")){
    const data=await r.json();
    if(!r.ok)throw new Error(data.error||`HTTP ${r.status}`);
    return data;
  }
  if(!r.ok)throw new Error(`HTTP ${r.status}`);
  return r;
}

async function authenticate(){
  token=document.getElementById("admin-token").value.trim()||token;
  const status=document.getElementById("login-status");
  status.textContent="Kontrol ediliyor...";
  try{
    await api("/admin/ping");
    sessionStorage.setItem("floew.adminToken.v1",token);
    document.getElementById("login-card").classList.add("hidden");
    document.getElementById("dashboard").classList.remove("hidden");
    await loadDashboard();
  }catch(err){
    status.textContent=`Giriş başarısız: ${err.message||err}`;
  }
}

async function loadDashboard(){
  document.querySelectorAll("[data-range]").forEach(btn=>{
    btn.classList.toggle("active",btn.dataset.range===range);
  });
  const status=document.getElementById("dashboard-status");
  status.textContent="Veriler yükleniyor...";

  try{
    const [a,b]=await Promise.all([
      api(`/admin/audience?range=${range}`),
      api(`/admin/behavior?range=${range}`)
    ]);

    document.getElementById("audience-metrics").innerHTML=[
      metric("Tekil ziyaretçi",nf.format(a.totals.visitors||0)),
      metric("Oturum",nf.format(a.totals.sessions||0)),
      metric("Yeni",nf.format(a.totals.new_visitors||0)),
      metric("Geri dönen",nf.format(a.totals.returning_visitors||0)),
      metric("Ort. oturum",duration(a.totals.avg_duration_ms||0)),
      metric("Haber görüntüleme",nf.format(a.totals.story_views||0)),
      metric("Toplam event",nf.format(a.totals.event_count||0)),
      metric("Toplam süre",duration(a.totals.total_duration_ms||0))
    ].join("");

    document.getElementById("audience-country").innerHTML=bars(a.byCountry);
    document.getElementById("audience-city").innerHTML=bars(a.byCity);
    document.getElementById("audience-device").innerHTML=bars(a.byDevice);
    document.getElementById("audience-browser").innerHTML=bars(a.byBrowser);
    document.getElementById("audience-os").innerHTML=bars(a.byOS);

    document.getElementById("audience-latest").innerHTML=table(a.latest,[
      {key:"last_seen",label:"Son görülme",format:v=>new Date(v).toLocaleString("tr-TR")},
      {key:"visitor_id",label:"Visitor ID"},
      {key:"session_id",label:"Session ID"},
      {key:"duration_ms",label:"Süre",format:duration},
      {key:"story_views",label:"Haber",format:v=>nf.format(v||0)},
      {key:"device_type",label:"Cihaz"},
      {key:"browser",label:"Tarayıcı"},
      {key:"os",label:"OS"},
      {key:"ip",label:"IP"},
      {key:"country",label:"Ülke"},
      {key:"city",label:"Şehir"},
      {key:"as_org",label:"Ağ"}
    ]);

    document.getElementById("behavior-metrics").innerHTML=[
      metric("Davranış olayı",nf.format(b.totals.events||0)),
      metric("Oturum",nf.format(b.totals.sessions||0)),
      metric("Ziyaretçi",nf.format(b.totals.visitors||0))
    ].join("");

    document.getElementById("behavior-events").innerHTML=bars(b.eventTypes);
    document.getElementById("behavior-sources").innerHTML=bars(b.sources);
    document.getElementById("behavior-categories").innerHTML=bars(b.categories);

    document.getElementById("behavior-keywords").innerHTML=table(b.keywords,[
      {key:"keyword",label:"Anahtar kelime"},
      {key:"mode",label:"Mod"},
      {key:"count",label:"Adet",format:v=>nf.format(v||0)}
    ]);

    document.getElementById("behavior-latest").innerHTML=table(b.latest,[
      {key:"occurred_at",label:"Zaman",format:v=>new Date(v).toLocaleString("tr-TR")},
      {key:"event_type",label:"Olay"},
      {key:"visitor_id",label:"Visitor"},
      {key:"session_id",label:"Session"},
      {key:"feed_mode",label:"Akış"},
      {key:"source",label:"Kaynak"},
      {key:"category",label:"Kategori"},
      {key:"keyword_text",label:"Kelime"},
      {key:"mode",label:"Mod"},
      {key:"value_text",label:"Değer"}
    ]);

    status.textContent=`${a.label} · ${new Date().toLocaleString("tr-TR")}`;
  }catch(err){
    status.textContent=`Veri alınamadı: ${err.message||err}. D1 tabloları henüz kurulmadıysa “Veritabanlarını hazırla” butonunu kullanın.`;
  }
}

async function setup(){
  const status=document.getElementById("dashboard-status");
  status.textContent="D1 tabloları hazırlanıyor...";
  try{
    await api("/admin/setup",{method:"POST"});
    status.textContent="D1 tabloları hazır.";
    await loadDashboard();
  }catch(err){
    status.textContent=`Kurulum başarısız: ${err.message||err}`;
  }
}

async function downloadReport(){
  const status=document.getElementById("dashboard-status");
  status.textContent="Son 7 gün + tüm zamanlar HTML raporu hazırlanıyor...";
  try{
    const r=await api("/admin/export");
    const blob=await r.blob();
    const url=URL.createObjectURL(blob);
    const a=document.createElement("a");
    a.href=url;
    a.download=`floew-analytics-${new Date().toISOString().slice(0,10)}.html`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(()=>URL.revokeObjectURL(url),1000);
    status.textContent="HTML raporu indirildi.";
  }catch(err){
    status.textContent=`Rapor oluşturulamadı: ${err.message||err}`;
  }
}

document.getElementById("login-button").addEventListener("click",authenticate);
document.getElementById("admin-token").addEventListener("keydown",e=>{
  if(e.key==="Enter")authenticate();
});
document.getElementById("setup-button").addEventListener("click",setup);
document.getElementById("export-button").addEventListener("click",downloadReport);
document.querySelectorAll("[data-range]").forEach(btn=>{
  btn.addEventListener("click",()=>{
    range=btn.dataset.range||"7d";
    loadDashboard();
  });
});

if(token){
  document.getElementById("admin-token").value=token;
  authenticate();
}
