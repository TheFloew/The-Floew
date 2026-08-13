const BASE="https://thefloew.thefloewback.workers.dev";
let token=sessionStorage.getItem("floew.adminToken.v1")||"";
let range="7d";
let activeTab="audience";
let currentAdId="";
const nf=new Intl.NumberFormat("tr-TR");
const oneDecimal=new Intl.NumberFormat("tr-TR",{maximumFractionDigits:1,minimumFractionDigits:0});

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

function pct(value){
  return `%${oneDecimal.format(Number(value)||0)}`;
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

function table(rows,cols,{rowClass="",rowAttrs=null}={}){
  return `<table><thead><tr>${cols.map(c=>`<th>${esc(c.label)}</th>`).join("")}</tr></thead>
  <tbody>${(rows||[]).map(row=>{
    const attrs=rowAttrs?rowAttrs(row):"";
    return `<tr${rowClass?` class="${esc(rowClass)}"`:""}${attrs?` ${attrs}`:""}>${cols.map(c=>{
      const value=c.format?c.format(row[c.key],row):row[c.key];
      return `<td>${c.html?value:esc(value)}</td>`;
    }).join("")}</tr>`;
  }).join("")||`<tr><td colspan="${cols.length}">Veri yok.</td></tr>`}</tbody></table>`;
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

function setDatabaseStatus(message,state=""){
  const el=document.getElementById("database-status");
  if(!el)return;
  el.className=`database-status${state?` ${state}`:""}`;
  el.textContent=message;
}

function databaseStatusMessage(ping){
  const db=ping?.databases||{};
  const entries=[
    ["CONTENT_DB",db.CONTENT_DB],
    ["AUDIENCE_DB",db.AUDIENCE_DB],
    ["BEHAVIOR_DB",db.BEHAVIOR_DB]
  ];

  const missing=entries
    .filter(([,value])=>!value?.bound)
    .map(([name])=>name);

  if(missing.length){
    return {
      state:"error",
      text:`Worker binding eksik: ${missing.join(", ")}`
    };
  }

  const notReady=entries
    .filter(([,value])=>value?.bound&&!value?.ready)
    .map(([name])=>name);

  if(notReady.length){
    return {
      state:"warning",
      text:`D1 bağlantıları var; tablolar henüz hazır değil: ${notReady.join(", ")}. “Veritabanlarını hazırla” butonuna basın.`
    };
  }

  return {
    state:"ready",
    text:"✓ CONTENT_DB, AUDIENCE_DB ve BEHAVIOR_DB hazır. Reklam analytics tablosu da aktif."
  };
}

async function refreshDatabaseStatus(){
  const ping=await api("/admin/ping");
  const info=databaseStatusMessage(ping);
  setDatabaseStatus(info.text,info.state);
  return ping;
}

function showTab(name){
  activeTab=name;

  document.querySelectorAll("[data-admin-tab]").forEach(btn=>{
    btn.classList.toggle(
      "active",
      btn.dataset.adminTab===name
    );
  });

  document.querySelectorAll("[data-admin-panel]").forEach(panel=>{
    panel.classList.toggle(
      "hidden",
      panel.dataset.adminPanel!==name
    );
  });
}

async function authenticate(){
  token=document.getElementById("admin-token").value.trim()||token;
  const status=document.getElementById("login-status");
  status.textContent="Kontrol ediliyor...";

  try{
    const ping=await api("/admin/ping");
    sessionStorage.setItem("floew.adminToken.v1",token);
    document.getElementById("login-card").classList.add("hidden");
    document.getElementById("dashboard").classList.remove("hidden");

    const info=databaseStatusMessage(ping);
    setDatabaseStatus(info.text,info.state);

    if(ping.allReady){
      await loadDashboard();
    }else{
      document.getElementById("dashboard-status").textContent=
        "D1 tabloları hazırlandıktan sonra istatistikler burada görünecek.";
    }
  }catch(err){
    status.textContent=`Giriş başarısız: ${err.message||err}`;
  }
}

function renderAudience(a){
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
}

function renderGeneralDemographics(data){
  const note=document.getElementById("audience-demographic-note");

  if(!data?.reportingConfigured){
    note.className="database-status warning";
    note.textContent=data?.error
      ? `GA4 demografi verisi alınamadı: ${data.error}`
      : "GA4 raporlama yapılandırıldığında genel yaş/cinsiyet dağılımı ve yaş × saat tablosu burada görünecek.";

    document.getElementById("audience-age").innerHTML='<div class="empty">GA4 demografi verisi yok.</div>';
    document.getElementById("audience-gender").innerHTML='<div class="empty">GA4 demografi verisi yok.</div>';
    document.getElementById("audience-age-hour").innerHTML='<div class="empty">GA4 demografi verisi yok.</div>';
    return;
  }

  const age=(data.age||[]).map(row=>({
    ...row,
    label:demographicLabel(row.label)
  }));

  const gender=(data.gender||[]).map(row=>({
    ...row,
    label:demographicLabel(row.label)
  }));

  const ageHour=(data.ageHour||[]).map(row=>({
    ...row,
    age:demographicLabel(row.age)
  }));

  const notes=[
    `GA4 içinde bilinen yaş oranı: ${pct(data.coverage?.age)}`,
    `bilinen cinsiyet oranı: ${pct(data.coverage?.gender)}`
  ];

  if(data.meta?.timeZone){
    notes.push(`saat dilimi: ${data.meta.timeZone}`);
  }
  if(data.meta?.subjectToThresholding){
    notes.push("Google Analytics veri eşiği uygulanmış olabilir");
  }
  if(data.meta?.dataLossFromOtherRow){
    notes.push("bazı düşük hacimli satırlar gruplanmış olabilir");
  }

  note.className="database-status ready";
  note.textContent=notes.join(" · ");

  document.getElementById("audience-age").innerHTML=table(age,[
    {key:"label",label:"Yaş"},
    {key:"views",label:"Sayfa açılışı",format:v=>nf.format(v||0)},
    {key:"users",label:"Kullanıcı",format:v=>nf.format(v||0)},
    {key:"percent",label:"Pay",format:pct}
  ]);

  document.getElementById("audience-gender").innerHTML=table(gender,[
    {key:"label",label:"Cinsiyet"},
    {key:"views",label:"Sayfa açılışı",format:v=>nf.format(v||0)},
    {key:"users",label:"Kullanıcı",format:v=>nf.format(v||0)},
    {key:"percent",label:"Pay",format:pct}
  ]);

  document.getElementById("audience-age-hour").innerHTML=table(ageHour,[
    {key:"age",label:"Yaş"},
    {key:"hour",label:"Saat"},
    {key:"views",label:"Sayfa açılışı",format:v=>nf.format(v||0)},
    {key:"users",label:"Kullanıcı",format:v=>nf.format(v||0)},
    {key:"percent",label:"Yaş grubunun payı",format:pct}
  ]);
}

function renderBehavior(b){
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
}

function renderAds(data){
  const t=data.totals||{};

  document.getElementById("ads-metrics").innerHTML=[
    metric("Reklam",nf.format(t.ads||0)),
    metric("Gösterim",nf.format(t.views||0)),
    metric("Tekil izleyici",nf.format(t.viewers||0)),
    metric("Ort. izleme",duration(t.avg_dwell_ms||0)),
    metric("Skip",pct(t.skip_rate)),
    metric("Tamamlama",pct(t.completion_rate)),
    metric("Geri dönüş",pct(t.return_rate)),
    metric("Geri dönen kişi",nf.format(t.returners||0)),
    metric("Tekrar karşılaşma",`${nf.format(t.repeat_views||0)} · ${pct(t.repeat_rate)}`)
  ].join("");

  const rows=(data.ads||[]);

  document.getElementById("ads-list").innerHTML=table(rows,[
    {key:"ad_id",label:"ID"},
    {
      key:"brand",
      label:"Reklam",
      format:(v,row)=>{
        const title=[row.brand,row.campaign].filter(Boolean).join(" · ");
        const sub=row.creative||row.filename||"";
        return `<strong>${esc(title||row.ad_id)}</strong><div class="cell-sub">${esc(sub)}</div>`;
      },
      html:true
    },
    {key:"views",label:"Gösterim",format:v=>nf.format(v||0)},
    {key:"avg_dwell_ms",label:"Ort.",format:duration},
    {key:"skip_rate",label:"Skip",format:pct},
    {key:"completion_rate",label:"Tamam",format:pct},
    {key:"return_rate",label:"Geri dönüş",format:pct},
    {key:"repeat_rate",label:"Tekrar",format:pct}
  ],{
    rowClass:"clickable-row",
    rowAttrs:row=>`data-ad-id="${esc(row.ad_id)}" tabindex="0"`
  });

  document.querySelectorAll("#ads-list [data-ad-id]").forEach(row=>{
    const open=()=>loadAdDetail(row.dataset.adId||"");
    row.addEventListener("click",open);
    row.addEventListener("keydown",e=>{
      if(e.key==="Enter"||e.key===" "){
        e.preventDefault();
        open();
      }
    });
  });
}

function adBreakdownLabel(value){
  const raw=String(value??"");
  const key=raw.toLowerCase();

  if(key==="hor"||key==="horizontal")return "Yatay";
  if(key==="ver"||key==="vertical")return "Dikey";
  if(key==="mobile")return "Mobil";
  if(key==="tablet")return "Tablet";
  if(key==="desktop")return "Masaüstü";
  if(key==="tv")return "TV";
  if(key==="other")return "Diğer";
  if(!raw)return "Bilinmiyor";
  return raw;
}

function breakdownTable(rows){
  const localized=(rows||[]).map(row=>({
    ...row,
    label:adBreakdownLabel(row.label)
  }));

  return table(localized,[
    {key:"label",label:"Grup"},
    {key:"views",label:"Gösterim",format:v=>nf.format(v||0)},
    {key:"percent",label:"Pay",format:pct},
    {key:"avg_dwell_ms",label:"Ort.",format:duration},
    {key:"skip_rate",label:"Skip",format:pct},
    {key:"completion_rate",label:"Tamam",format:pct},
    {key:"return_rate",label:"Geri",format:pct},
    {key:"repeat_rate",label:"Tekrar",format:pct}
  ]);
}

function demographicTable(rows,{dual=false}={}){
  const cols=dual
    ? [
        {key:"age",label:"Yaş"},
        {key:"gender",label:"Cinsiyet"}
      ]
    : [
        {key:"label",label:"Grup"}
      ];

  return table(rows,[
    ...cols,
    {key:"views",label:"Gösterim",format:v=>nf.format(v||0)},
    {key:"percent",label:"Pay",format:pct},
    {key:"avg_dwell_ms",label:"Ort.",format:duration},
    {key:"skip_rate",label:"Skip",format:pct},
    {key:"completion_rate",label:"Tamam",format:pct},
    {key:"return_rate",label:"Geri",format:pct},
    {key:"repeat_rate",label:"Tekrar",format:pct}
  ]);
}

function demographicLabel(value){
  const raw=String(value||"");
  if(/^unknown$/i.test(raw))return "Bilinmiyor";
  if(/^male$/i.test(raw))return "Erkek";
  if(/^female$/i.test(raw))return "Kadın";
  return raw;
}

function localizeDemographics(data){
  const clone=typeof structuredClone==="function"
    ? structuredClone(data||{})
    : JSON.parse(JSON.stringify(data||{}));

  clone.age=(clone.age||[]).map(row=>({
    ...row,
    label:demographicLabel(row.label)
  }));

  clone.gender=(clone.gender||[]).map(row=>({
    ...row,
    label:demographicLabel(row.label)
  }));

  clone.ageGender=(clone.ageGender||[]).map(row=>({
    ...row,
    age:demographicLabel(row.age),
    gender:demographicLabel(row.gender)
  }));

  return clone;
}

async function loadAdDetail(adId){
  if(!adId)return;

  const status=document.getElementById("dashboard-status");
  status.textContent="Reklam raporu yükleniyor...";
  currentAdId=adId;

  try{
    const data=await api(
      `/admin/ad?range=${encodeURIComponent(range)}&id=${encodeURIComponent(adId)}`
    );

    const s=data.summary||{};
    const d=localizeDemographics(data.demographics||{});

    document.getElementById("ads-overview").classList.add("hidden");
    document.getElementById("ad-detail").classList.remove("hidden");

    document.getElementById("ad-detail-title").textContent=
      [s.ad_id,s.brand,s.campaign].filter(Boolean).join(" · ");

    document.getElementById("ad-detail-subtitle").textContent=
      [s.creative,s.filename,data.label].filter(Boolean).join(" · ");

    document.getElementById("ad-detail-metrics").innerHTML=[
      metric("Gösterim",nf.format(s.views||0)),
      metric("Tekil izleyici",nf.format(s.viewers||0)),
      metric("Ort. izleme",duration(s.avg_dwell_ms||0)),
      metric("Skip",`${nf.format(s.skips||0)} · ${pct(s.skip_rate)}`),
      metric("Tamamlama",`${nf.format(s.completes||0)} · ${pct(s.completion_rate)}`),
      metric("Geri dönüş",`${nf.format(s.returners||0)} kişi · ${pct(s.return_rate)}`),
      metric("Tekrar karşılaşma",`${nf.format(s.repeat_views||0)} · ${pct(s.repeat_rate)}`)
    ].join("");

    document.getElementById("ad-orientation").innerHTML=breakdownTable(data.orientation||[]);
    document.getElementById("ad-devices").innerHTML=breakdownTable(data.devices||[]);
    document.getElementById("ad-hours").innerHTML=breakdownTable(data.hours||[]);

    const orientationDevice=(data.orientationDevice||[]).map(row=>({
      ...row,
      orientation:adBreakdownLabel(row.orientation),
      device:adBreakdownLabel(row.device)
    }));

    document.getElementById("ad-orientation-device").innerHTML=table(orientationDevice,[
      {key:"orientation",label:"Yön"},
      {key:"device",label:"Cihaz"},
      {key:"views",label:"Gösterim",format:v=>nf.format(v||0)},
      {key:"percent",label:"Pay",format:pct},
      {key:"avg_dwell_ms",label:"Ort.",format:duration},
      {key:"skip_rate",label:"Skip",format:pct},
      {key:"completion_rate",label:"Tamam",format:pct},
      {key:"return_rate",label:"Geri",format:pct},
      {key:"repeat_rate",label:"Tekrar",format:pct}
    ]);

    const note=document.getElementById("ad-demographic-note");

    if(!d.reportingConfigured){
      note.className="database-status warning";
      note.textContent=d.error
        ? `GA4 demografi verisi alınamadı: ${d.error}`
        : "GA4 raporlama henüz yapılandırılmadı. D1 reklam istatistikleri çalışıyor; yaş/cinsiyet bölümü GA4 bağlantısından sonra dolacak.";
    }else{
      const notes=[
        `Yaş kapsama: ${pct(d.coverage?.age)}`,
        `Cinsiyet kapsama: ${pct(d.coverage?.gender)}`
      ];

      if(d.meta?.subjectToThresholding){
        notes.push("Google Analytics veri eşiği uygulanmış olabilir");
      }

      if(d.meta?.dataLossFromOtherRow){
        notes.push("bazı düşük hacimli satırlar (other) içinde gruplanmış olabilir");
      }

      if(d.meta?.metricWarning){
        notes.push("izleme süresi metriği için GA4 custom metric tanımını kontrol edin");
      }

      if(!(d.age||[]).length && !(d.gender||[]).length){
        notes.push("demografi henüz oluşmadı; Google Signals, kullanıcı izni ve veri eşiğini kontrol edin");
      }

      note.className="database-status ready";
      note.textContent=notes.join(" · ");
    }

    document.getElementById("ad-age").innerHTML=demographicTable(d.age||[]);
    document.getElementById("ad-gender").innerHTML=demographicTable(d.gender||[]);
    document.getElementById("ad-age-gender").innerHTML=demographicTable(d.ageGender||[],{dual:true});

    status.textContent=`${data.label} · ${new Date().toLocaleString("tr-TR")}`;
  }catch(err){
    status.textContent=`Reklam verisi alınamadı: ${err.message||err}`;
  }
}

function closeAdDetail(){
  currentAdId="";
  document.getElementById("ad-detail").classList.add("hidden");
  document.getElementById("ads-overview").classList.remove("hidden");
}

async function refreshGa4Status(){
  const el=document.getElementById("ga4-status");
  const button=document.getElementById("ga4-setup-button");

  try{
    const data=await api("/admin/ga4/status");
    const s=data.status||{};

    button.disabled=!s.reportingConfigured;

    if(!s.collectionConfigured){
      el.className="database-status warning";
      el.textContent="GA4 koleksiyonu kapalı: Worker'a GA4_MEASUREMENT_ID eklenince kullanıcı izni sonrası reklam event'leri Google Analytics'e gönderilebilir.";
      return;
    }

    if(!s.reportingConfigured){
      el.className="database-status warning";
      el.textContent="GA4 event koleksiyonu hazır; demografi raporlarını Flöw Analytics'e çekmek için GA4_PROPERTY_ID, GA4_CLIENT_EMAIL ve GA4_PRIVATE_KEY de gerekli.";
      return;
    }

    if(s.error){
      el.className="database-status error";
      el.textContent=`GA4 bağlantı hatası: ${s.error}`;
      return;
    }

    if(!s.definitionsReady){
      el.className="database-status warning";
      el.textContent=`GA4 bağlı; eksik custom tanımlar: ${(s.missingDefinitions||[]).join(", ")}. “GA4 tanımlarını hazırla” butonunu kullanın.`;
      return;
    }

    el.className="database-status ready";
    el.textContent="✓ GA4 koleksiyon + raporlama hazır. ad_id boyutları ve ad_dwell_ms metriği tanımlı.";
  }catch(err){
    el.className="database-status error";
    el.textContent=`GA4 durumu alınamadı: ${err.message||err}`;
  }
}

async function loadDashboard(){
  document.querySelectorAll("[data-range]").forEach(btn=>{
    btn.classList.toggle("active",btn.dataset.range===range);
  });

  const status=document.getElementById("dashboard-status");
  status.textContent="Veriler yükleniyor...";

  try{
    const [a,b,ads,demographics]=await Promise.all([
      api(`/admin/audience?range=${range}`),
      api(`/admin/behavior?range=${range}`),
      api(`/admin/ads?range=${range}`),
      api(`/admin/demographics?range=${range}`).catch(err=>({
        reportingConfigured:false,
        error:String(err?.message||err)
      }))
    ]);

    renderAudience(a);
    renderGeneralDemographics(demographics);
    renderBehavior(b);
    renderAds(ads);
    await refreshGa4Status();

    if(currentAdId){
      await loadAdDetail(currentAdId);
    }

    status.textContent=`${a.label} · ${new Date().toLocaleString("tr-TR")}`;
  }catch(err){
    status.textContent=`Veri alınamadı: ${err.message||err}. D1 tabloları henüz kurulmadıysa “Veritabanlarını hazırla” butonunu kullanın.`;
  }
}

async function setup(){
  const status=document.getElementById("dashboard-status");
  const button=document.getElementById("setup-button");

  button.disabled=true;
  button.textContent="Hazırlanıyor...";
  setDatabaseStatus(
    "D1 tabloları oluşturuluyor. Reklam analytics tablosu da hazırlanacak...",
    "working"
  );
  status.textContent="";

  try{
    const result=await api("/admin/setup",{method:"POST"});

    if(!result?.after?.allReady){
      const info=databaseStatusMessage(result?.after||{});
      setDatabaseStatus(
        `Kurulum çağrısı tamamlandı ancak tüm tablolar doğrulanamadı. ${info.text}`,
        "warning"
      );
      status.textContent="Worker yanıt verdi fakat D1 hazırlığı tamamlanmış görünmüyor.";
      return;
    }

    setDatabaseStatus(
      "✓ Üç D1 veritabanı ve reklam analytics tablosu hazırlandı.",
      "ready"
    );
    await loadDashboard();
    await refreshDatabaseStatus();
  }catch(err){
    setDatabaseStatus(
      `Kurulum başarısız: ${err.message||err}`,
      "error"
    );
  }finally{
    button.disabled=false;
    button.textContent="Veritabanlarını hazırla";
  }
}

async function setupGa4(){
  const el=document.getElementById("ga4-status");
  const button=document.getElementById("ga4-setup-button");
  button.disabled=true;
  el.className="database-status working";
  el.textContent="GA4 custom dimension ve metric tanımları kontrol ediliyor...";

  try{
    const data=await api("/admin/ga4/setup",{method:"POST"});
    const created=data.created||{};
    el.className="database-status ready";
    el.textContent=`✓ GA4 tanımları hazır. Yeni boyut: ${(created.dimensions||[]).length}, yeni metrik: ${(created.metrics||[]).length}.`;
    await refreshGa4Status();
  }catch(err){
    el.className="database-status error";
    el.textContent=`GA4 hazırlığı başarısız: ${err.message||err}`;
  }finally{
    button.disabled=false;
  }
}

async function downloadReport(){
  const status=document.getElementById("dashboard-status");
  status.textContent="Genel HTML raporu hazırlanıyor...";

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

async function downloadAdReport(){
  if(!currentAdId)return;

  const status=document.getElementById("dashboard-status");
  status.textContent=`${currentAdId} HTML raporu hazırlanıyor...`;

  try{
    const r=await api(
      `/admin/ad-report?range=${encodeURIComponent(range)}&id=${encodeURIComponent(currentAdId)}`
    );
    const blob=await r.blob();
    const url=URL.createObjectURL(blob);
    const a=document.createElement("a");
    a.href=url;
    a.download=`floew-ad-${currentAdId}-${range}.html`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(()=>URL.revokeObjectURL(url),1000);
    status.textContent="Reklam HTML raporu indirildi.";
  }catch(err){
    status.textContent=`Reklam raporu oluşturulamadı: ${err.message||err}`;
  }
}

document.getElementById("login-button").addEventListener("click",authenticate);
document.getElementById("admin-token").addEventListener("keydown",e=>{
  if(e.key==="Enter")authenticate();
});

document.getElementById("setup-button").addEventListener("click",setup);
document.getElementById("ga4-setup-button").addEventListener("click",setupGa4);
document.getElementById("export-button").addEventListener("click",downloadReport);
document.getElementById("ad-report-button").addEventListener("click",downloadAdReport);
document.getElementById("ad-detail-back").addEventListener("click",closeAdDetail);

document.querySelectorAll("[data-range]").forEach(btn=>{
  btn.addEventListener("click",()=>{
    range=btn.dataset.range||"7d";
    loadDashboard();
  });
});

document.querySelectorAll("[data-admin-tab]").forEach(btn=>{
  btn.addEventListener("click",()=>{
    showTab(btn.dataset.adminTab||"audience");
  });
});

if(token){
  document.getElementById("admin-token").value=token;
  authenticate();
}
