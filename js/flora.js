const API=`${String(window.FLOEW_CONFIG?.analyticsWorkerBase||"https://thefloew-analytics.thefloewback.workers.dev").replace(/\/$/,"")}/stats/public`;
let currentRange="7d";

const nf=new Intl.NumberFormat("tr-TR");

function fmtDuration(ms){
  const s=Math.round((Number(ms)||0)/1000);
  if(s<60)return `${s} sn`;
  return `${Math.floor(s/60)} dk ${s%60} sn`;
}

function esc(value){
  return String(value??"")
    .replace(/&/g,"&amp;")
    .replace(/</g,"&lt;")
    .replace(/>/g,"&gt;")
    .replace(/"/g,"&quot;");
}

function metric(label,value){
  return `<div class="metric"><span>${esc(label)}</span><strong>${esc(value)}</strong></div>`;
}

function storyItem(row,index,flora=false){
  const title=esc(row.title||"Başlıksız haber");
  const source=esc(row.source||"");
  const category=esc(row.category||"");
  const href=row.link ? ` href="${esc(row.link)}" target="_blank" rel="noopener noreferrer"` : "";
  const right=flora
    ? `<div class="flora-score">${Number(row.flora||0).toFixed(1)} <small>/100</small></div>`
    : `<div class="flora-score">${nf.format(row.views||0)} <small>görüntüleme</small></div>`;
  return `<div class="item">
    <div class="rank">${index+1}</div>
    <div>
      <a class="item-title"${href}>${title}</a>
      <div class="item-meta">${source}${category?` · ${category}`:""} · ${nf.format(row.views||0)} görüntüleme · ort. ${fmtDuration(row.avg_dwell_ms)}</div>
    </div>
    ${right}
  </div>`;
}

function bars(rows,labelKey="label"){
  const max=Math.max(1,...(rows||[]).map(x=>Number(x.views??x.count)||0));
  if(!rows?.length)return `<div class="empty">Henüz veri yok.</div>`;
  return rows.slice(0,18).map(row=>{
    const value=Number(row.views??row.count)||0;
    return `<div class="bar-row">
      <div class="bar-label">${esc(row[labelKey]||"Bilinmiyor")}</div>
      <div class="bar"><i style="width:${Math.max(1,value/max*100)}%"></i></div>
      <div class="bar-value">${nf.format(value)}</div>
    </div>`;
  }).join("");
}

async function loadStats(range=currentRange){
  currentRange=range;
  document.body.classList.add("loading");
  const status=document.getElementById("flora-status");
  status.textContent="Flöra hesaplanıyor...";

  document.querySelectorAll(".range-tab").forEach(btn=>{
    btn.classList.toggle("active",btn.dataset.range===range);
  });

  try{
    const r=await fetch(`${API}?range=${encodeURIComponent(range)}`,{cache:"no-store"});
    const data=await r.json();
    if(!r.ok||!data.ok)throw new Error(data.error||`HTTP ${r.status}`);

    const o=data.overview||{};
    document.getElementById("flora-metrics").innerHTML=[
      metric("Haber görüntüleme",nf.format(o.views||0)),
      metric("Farklı haber",nf.format(o.stories||0)),
      metric("Kaynağa gidiş",nf.format(o.source_opens||0)),
      metric("Ort. ekranda kalma",fmtDuration(o.avg_dwell_ms||0))
    ].join("");

    const flora=data.flora||[];
    document.getElementById("flora-list").innerHTML=
      flora.length ? flora.slice(0,25).map((x,i)=>storyItem(x,i,true)).join("") :
      `<div class="empty">Flöra için henüz yeterli veri yok.</div>`;

    const viewed=data.mostViewed||[];
    document.getElementById("viewed-list").innerHTML=
      viewed.length ? viewed.slice(0,25).map((x,i)=>storyItem(x,i,false)).join("") :
      `<div class="empty">Henüz görüntüleme verisi yok.</div>`;

    document.getElementById("source-list").innerHTML=bars(data.sources||[],"source");
    document.getElementById("category-list").innerHTML=bars(data.categories||[],"category");

    status.textContent=
      `${data.label} · Son güncelleme: ${new Date(data.generatedAt).toLocaleString("tr-TR")}`;
  }catch(err){
    document.getElementById("flora-metrics").innerHTML="";
    document.getElementById("flora-list").innerHTML=
      `<div class="empty">Flöra verileri henüz hazır değil.</div>`;
    document.getElementById("viewed-list").innerHTML="";
    document.getElementById("source-list").innerHTML="";
    document.getElementById("category-list").innerHTML="";
    status.textContent=`Veri alınamadı: ${err.message||err}`;
  }finally{
    document.body.classList.remove("loading");
  }
}

document.querySelectorAll(".range-tab").forEach(btn=>{
  btn.addEventListener("click",()=>loadStats(btn.dataset.range||"7d"));
});

loadStats("7d");
