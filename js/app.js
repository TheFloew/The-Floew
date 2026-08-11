window.__floewAppStarted=true;
window.__floewAppVersion="31.13.3";
const API="https://thefloew.thefloewback.workers.dev/news";
const VIDEO_API="https://thefloew.thefloewback.workers.dev/video";
const META_API="https://thefloew.thefloewback.workers.dev/meta";
const IMAGE_PROXY_API="https://thefloew.thefloewback.workers.dev/image";
const NEWS_BATCH_COUNT=12;
const DEFAULT_SHOW_SECONDS=10;
const SHOW_SECONDS_KEY="thefloew.showSeconds.v1";
const TIME_RANGE_KEY="thefloew.timeRange.v1";
const WEATHER_PREFS_KEY="thefloew.weather.v1";
const COOKIE_NOTICE_KEY="thefloew.cookieNotice.v1";
const REFRESH_MS=120000;
const SWIPE=70;

const ADS_API="https://thefloew.thefloewback.workers.dev/ads";
const ADS_CACHE_KEY="thefloew.adsCatalog.v5";
const ADS_TEST_MODE=new URLSearchParams(location.search).get("adtest")==="1";
const ADS_INTERVAL_NEWS=10;
const AD_IMAGE_MS=15000;
const ADS_REFRESH_MS=5*60*1000;
let adsCatalogPromise=null;
let adsCatalogPromiseLayout="";
let adCatalogLayout="";
let adLayoutRefreshTimer=null;
let adTestRan=false;

function loadShowDuration(){
  try{
    const saved=Number(localStorage.getItem(SHOW_SECONDS_KEY));
    if(Number.isFinite(saved)){
      return Math.min(60,Math.max(5,Math.round(saved)));
    }
  }catch(e){}
  return DEFAULT_SHOW_SECONDS;
}

let showDurationSeconds=loadShowDuration();

const TIME_RANGE_OPTIONS=[
  {value:"1",hours:1,label:"1 saat"},
  {value:"2",hours:2,label:"2 saat"},
  {value:"4",hours:4,label:"4 saat"},
  {value:"8",hours:8,label:"8 saat"},
  {value:"16",hours:16,label:"16 saat"},
  {value:"24",hours:24,label:"1 gün"},
  {value:"120",hours:120,label:"5 gün"},
  {value:"all",hours:Infinity,label:"Tüm zamanlar"}
];

function normalizeTimeRangeValue(value){
  const raw=String(value??"all");
  return TIME_RANGE_OPTIONS.some(option=>option.value===raw)
    ? raw
    : "all";
}

function loadTimeRange(){
  try{
    return normalizeTimeRangeValue(
      localStorage.getItem(TIME_RANGE_KEY)
    );
  }catch(e){
    return "all";
  }
}

let timeRangeValue=loadTimeRange();

function saveTimeRange(){
  try{
    localStorage.setItem(
      TIME_RANGE_KEY,
      timeRangeValue
    );
  }catch(e){}
}

function currentTimeRangeOption(){
  return TIME_RANGE_OPTIONS.find(
    option=>option.value===timeRangeValue
  ) || TIME_RANGE_OPTIONS[TIME_RANGE_OPTIONS.length-1];
}

function saveShowDuration(){
  try{
    localStorage.setItem(
      SHOW_SECONDS_KEY,
      String(showDurationSeconds)
    );
  }catch(e){}
}

function loadWeatherPreferences(){
  try{
    const raw=localStorage.getItem(WEATHER_PREFS_KEY);
    if(!raw){
      return {
        city:"İstanbul",
        label:"İstanbul",
        unit:"celsius",
        lat:null,
        lon:null
      };
    }

    const p=JSON.parse(raw)||{};

    return {
      city:String(p.city||"İstanbul"),
      label:String(p.label||p.city||"İstanbul"),
      unit:p.unit==="fahrenheit"?"fahrenheit":"celsius",
      lat:Number.isFinite(p.lat)?p.lat:null,
      lon:Number.isFinite(p.lon)?p.lon:null
    };
  }catch(e){
    return {
      city:"İstanbul",
      label:"İstanbul",
      unit:"celsius",
      lat:null,
      lon:null
    };
  }
}

let weatherPreferences=loadWeatherPreferences();

function saveWeatherPreferences(){
  try{
    localStorage.setItem(
      WEATHER_PREFS_KEY,
      JSON.stringify(weatherPreferences)
    );
  }catch(e){}
}

const SOURCE_LOGOS={
  "cnn türk":"https://icons.duckduckgo.com/ip3/cnnturk.com.ico",
  "cnn turk":"https://icons.duckduckgo.com/ip3/cnnturk.com.ico",
  "sözcü":"https://icons.duckduckgo.com/ip3/sozcu.com.tr.ico",
  "sozcu":"https://icons.duckduckgo.com/ip3/sozcu.com.tr.ico",
  "anadolu ajansı":"https://icons.duckduckgo.com/ip3/aa.com.tr.ico",
  "aa":"https://icons.duckduckgo.com/ip3/aa.com.tr.ico",
  "trt haber":"https://icons.duckduckgo.com/ip3/trthaber.com.ico",
  "ntv":"https://icons.duckduckgo.com/ip3/ntv.com.tr.ico",
  "habertürk":"https://icons.duckduckgo.com/ip3/haberturk.com.ico",
  "haberturk":"https://icons.duckduckgo.com/ip3/haberturk.com.ico",
  "hürriyet":"https://icons.duckduckgo.com/ip3/hurriyet.com.tr.ico",
  "hurriyet":"https://icons.duckduckgo.com/ip3/hurriyet.com.tr.ico",
  "cumhuriyet":"https://icons.duckduckgo.com/ip3/cumhuriyet.com.tr.ico",
  "milliyet":"https://icons.duckduckgo.com/ip3/milliyet.com.tr.ico",
  "bbc türkçe":"https://icons.duckduckgo.com/ip3/bbc.com.ico",
  "dw türkçe":"https://icons.duckduckgo.com/ip3/dw.com.ico",
  "mynet":"https://icons.duckduckgo.com/ip3/mynet.com.ico",
  "sputnik türkiye":"https://icons.duckduckgo.com/ip3/sputniknews.com.ico",
  "bigpara":"https://icons.duckduckgo.com/ip3/bigpara.hurriyet.com.tr.ico",
  "ekoseyir":"https://icons.duckduckgo.com/ip3/ekoseyir.com.ico",

  "shiftdelete.net":"https://icons.duckduckgo.com/ip3/shiftdelete.net.ico",
  "onedio":"https://icons.duckduckgo.com/ip3/onedio.com.ico",
  "beyazperde":"https://icons.duckduckgo.com/ip3/beyazperde.com.ico",
  "motor1 türkiye":"https://icons.duckduckgo.com/ip3/tr.motor1.com.ico",
  "evrim ağacı":"https://icons.duckduckgo.com/ip3/evrimagaci.org.ico",
  "bant mag.":"https://icons.duckduckgo.com/ip3/bantmag.com.ico",
  "bir baba indie":"https://icons.duckduckgo.com/ip3/birbabaindie.com.ico",
  "edebiyat haber":"https://icons.duckduckgo.com/ip3/edebiyathaber.net.ico",
  "elle türkiye":"https://icons.duckduckgo.com/ip3/elle.com.tr.ico",
  "marie claire türkiye":"https://icons.duckduckgo.com/ip3/marieclaire.com.tr.ico",
  "istanbul life":"https://icons.duckduckgo.com/ip3/istanbullife.com.tr.ico",
  "live to bloom":"https://icons.duckduckgo.com/ip3/livetobloom.com.ico",
  "elele":"https://icons.duckduckgo.com/ip3/elele.com.tr.ico",
  "arkeofili":"https://icons.duckduckgo.com/ip3/arkeofili.com.ico",
  "işin detayı":"https://icons.duckduckgo.com/ip3/isindetayi.com.ico"

};

const slides=[document.getElementById("a"),document.getElementById("b")];

const adOverlay=document.getElementById("ad-overlay");
const adImage=document.getElementById("ad-image");
const adVideo=document.getElementById("ad-video");

let adCatalog=[];
let adActive=false;
let newsShownSinceAd=0;
let lastAdName="";
let adCatalogRefreshTimer=null;
let adPlaybackFinish=null;
let adHasEntered=false;
let adSkipRequestedDirection=0;

/*
  Reklamı açan wheel/swipe hareketinin kalan momentum event'leri reklamı
  yanlışlıkla hemen atlamasın. Reklam tamamen girdikten kısa süre sonra
  kullanıcı skip hareketlerini kabul etmeye başlarız.
*/
let adSkipEnabledAt=0;
const AD_SKIP_GRACE_MS=450;

let currentAd=null;
let adEntryDirection=1;

/*
  Haber history dizisini bozmadan reklamı gerçek bir gezinme durağı gibi
  davranacak şekilde araya yerleştiriyoruz.

  skippedAdHistory yalnızca kullanıcı reklamı bitmeden ileri geçtiğinde kurulur.
  Böylece:
    haber A -> reklam -> haber B
  dizisinde B'den geri gidildiğinde reklama, reklamdan da A'ya dönülebilir.
*/
let skippedAdHistory=null;
let historicalAdContext=null;

const state={
  stories:[],
  index:0,
  active:0,
  busy:false,
  timer:null,
  x:0,y:0,t:0,
  history:[],
  historyPos:0
};
const CATEGORIES=[
  "#SonDakika","#Yaşam","#Türkiye","#Dünya","#Siyaset",
  "#Ekonomi","#Magazin","#Teknoloji","#Kültür-Sanat","#Sinema",
  "#Otomotiv","#Edebiyat","#Müzik","#Televizyon","#Spor",
  "#Sağlık","#Bilim","#Moda","#Tarih","#Gezi"
];

const PREFS_KEY="thefloew.preferences.v5";
const NEW_CATEGORIES=["#Yaşam","#Sağlık","#Otomotiv","#Sinema","#Müzik","#Edebiyat","#Televizyon","#Bilim","#Moda","#Tarih","#Gezi"];
const NEW_SOURCES=["shiftdelete.net","onedio","beyazperde","motor1 türkiye","evrim ağacı","bant mag.","bir baba indie","edebiyat haber","elle türkiye","marie claire türkiye","istanbul life","live to bloom","elele","arkeofili","işin detayı"];

function loadPreferences(){
  try{
    const raw=localStorage.getItem(PREFS_KEY);
    if(!raw)return {sources:null,categories:null,direction:"up",videoEnabled:true};
    const p=JSON.parse(raw)||{};

    let categories=Array.isArray(p.categories)?p.categories.filter(c=>c!=="#Gündem"):null;
    if(categories){
      for(const cat of NEW_CATEGORIES){
        if(!categories.includes(cat))categories.push(cat);
      }
    }

    return {
      sources:Array.isArray(p.sources)?p.sources:null,
      categories,
      direction:["up","down","left","right"].includes(p.direction)?p.direction:"up",
      videoEnabled:p.videoEnabled!==false
    };
  }catch(e){
    console.warn("Preferences:",e);
    return {sources:null,categories:null,direction:"up",videoEnabled:true};
  }
}

const savedPreferences=loadPreferences();
let transitionDirection=savedPreferences.direction||"up";
let videoEnabled=savedPreferences.videoEnabled!==false;
let sourcePreferencesApplied=false;

function savePreferences(){
  try{
    localStorage.setItem(PREFS_KEY,JSON.stringify({
      sources:[...filters.sources],
      categories:[...filters.categories],
      direction:transitionDirection,
      videoEnabled
    }));
  }catch(e){
    console.warn("Preferences:",e);
  }
}


const filters={
  sources:new Set(),
  categories:Array.isArray(savedPreferences.categories)
    ? new Set(savedPreferences.categories.filter(c=>CATEGORIES.includes(c)))
    : new Set(CATEGORIES)
};

let knownSources=[];
let rawStories=[];

/*
  Bir kaynak/kategori geçici olarak kapatıldığı için ekrandaki haber
  filtre dışına çıkarsa, kullanıcının geri açması halinde aynı haberi
  geri getirmek için link tabanlı bir dönüş noktası tutuyoruz.
  Normal gezinme başladığında bu dönüş noktası bırakılır.
*/
let filterReturnStoryKey="";

function normalizeText(v){
  return String(v||"")
    .toLocaleLowerCase("tr-TR")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g,"");
}

function storyIdentity(story){
  if(!story)return "";
  if(story.link)return String(story.link);
  return `${String(story.source||"").trim().toLocaleLowerCase("tr-TR")}|${String(story.title||"").trim()}`;
}

function categoryForStory(story){
  // Worker kategorisi birincil kaynaktır. Frontend sınıflandırması yalnızca
  // eski/eksik cevaplar için güvenli geri dönüş olarak kalır.
  const explicit=story.category || story.categories || story.section || story.topic;
  const explicitText=normalizeText(Array.isArray(explicit)?explicit.join(" "):explicit);

  for(const cat of CATEGORIES){
    if(cat==="#SonDakika")continue;
    const key=normalizeText(cat.replace("#",""));
    if(explicitText.includes(key)) return cat;
  }

  const text=normalizeText([story.title,story.description,story.summary,story.content].join(" "));
  const rules=[
    ["#Sağlık",["sağlık","hastalık","tedavi","doktor","hekim","aşı","kanser","ruh sağlığı"]],
    ["#Bilim",["bilim","bilimsel","fizik","kimya","biyoloji","astronomi","uzay","nasa","evrim","genetik"]],
    ["#Otomotiv",["otomobil","otomotiv","elektrikli araç","suv","sedan","togg","tesla","volkswagen","bmw","mercedes"]],
    ["#Sinema",["sinema","film","vizyon","yönetmen","fragman","box office","oscar","cannes"]],
    ["#Televizyon",["televizyon","dizi","sezon","bölüm","netflix dizisi","show tv","kanal d","star tv","trt 1"]],
    ["#Müzik",["müzik","albüm","single","şarkı","müzisyen","konser","spotify","plak","turne","indie"]],
    ["#Edebiyat",["edebiyat","kitap","roman","öykü","şiir","yazar","şair","yayınevi"]],
    ["#Moda",["moda","fashion","defile","koleksiyon","tasarımcı","giyim","stil","moda haftası","vogue"]],
    ["#Tarih",["tarih","tarihi","osmanlı","bizans","antik","arkeoloji","imparatorluk","medeniyet"]],
    ["#Gezi",["seyahat","gezi","gezilecek","rota","tatil","turizm","otel","seyahat rehberi"]],
    ["#Spor",["futbol","basketbol","voleybol","tenis","formula 1","şampiyon","lig","maç","transfer","gol"]],
    ["#Teknoloji",["teknoloji","yapay zeka","iphone","android","google","apple","microsoft","siber","yazılım","çip","robot"]],
    ["#Magazin",["magazin","ünlü","evlilik","boşanma","kırmızı halı","influencer"]],
    ["#Kültür-Sanat",["kültür","sanat","sergi","müze","tiyatro","opera","bale","bienal"]],
    ["#Ekonomi",["ekonomi","borsa","dolar","euro","altın","faiz","enflasyon","merkez bankası","vergi"]],
    ["#Siyaset",["siyaset","hükümet","bakan","milletvekili","meclis","parti","seçim","cumhurbaşkanı","tbmm"]],
    ["#Dünya",["abd","amerika","avrupa","rusya","ukrayna","israil","filistin","iran","suriye","almanya","fransa","çin","nato"]],
    ["#Türkiye",["türkiye","istanbul","ankara","izmir","deprem","belediye","valilik","jandarma","emniyet","yangın"]],
    ["#Yaşam",["yaşam","hayat","dekorasyon","gastronomi","yemek","ilişki","aile","wellness"]]
  ];

  for(const [cat,words] of rules){
    if(words.some(w=>text.includes(normalizeText(w)))) return cat;
  }

  return "#Yaşam";
}

function enrichStories(list){
  return list.map(s=>({
    ...s,
    flowCategory:categoryForStory(s),
    flowBreaking:Boolean(s.breaking) || normalizeText(s.category).includes("sondakika")
  }));
}

function storyInTimeRange(story){
  const option=currentTimeRangeOption();

  if(!Number.isFinite(option.hours)){
    return true;
  }

  const publishedAt=new Date(story?.published).getTime();

  /*
    Zamanı bilinmeyen bir haber sonlu aralıkta güvenle sınıflandırılamaz.
    "Tüm zamanlar" seçildiğinde ise bu haberler yine gösterilir.
  */
  if(!Number.isFinite(publishedAt)){
    return false;
  }

  const ageMs=Date.now()-publishedAt;
  const limitMs=option.hours*60*60*1000;

  /*
    Kaynak saatindeki küçük ileri sapmalar yeni haberi yanlışlıkla elemesin.
    Negatif yaş doğal olarak limitin altında kalır ve gösterilir.
  */
  return ageMs<=limitMs;
}

function activeStories(){
  return rawStories.filter(s=>{
    if(!storyInTimeRange(s))return false;
    if(!filters.sources.has(sourceKey(s.source)))return false;

    /*
      Normal kategori her zaman açık olmalı.
      Böylece #Spor kapalıyken "son dakika" etiketi taşıyan bir spor haberi
      #SonDakika üzerinden filtreyi delip ekrana gelemez.
    */
    if(!filters.categories.has(s.flowCategory))return false;

    /*
      breaking:true normal kategoriyi değiştirmez; ek bir etikettir.
      #SonDakika kapalıysa breaking haberler de gizlenir.
    */
    if(
      s.flowBreaking &&
      !filters.categories.has("#SonDakika")
    ) return false;

    return true;
  });
}

function renderOptions(){
  const sourceBox=document.getElementById("source-options");
  const categoryBox=document.getElementById("category-options");

  sourceBox.innerHTML="";
  categoryBox.innerHTML="";

  for(const source of knownSources){
    const key=sourceKey(source);
    const on=filters.sources.has(key);
    const el=document.createElement("div");
    el.className="option"+(on?" on":"");
    el.dataset.key=key;
    el.innerHTML=`<span class="option-name">${source}</span><span class="option-check">${on?"✓":""}</span>`;
    el.addEventListener("click",()=>toggleSource(key));
    sourceBox.appendChild(el);
  }

  for(const category of CATEGORIES){
    const on=filters.categories.has(category);
    const el=document.createElement("div");
    el.className="option"+(on?" on":"");
    el.dataset.key=category;
    el.innerHTML=`<span class="option-name">${category}</span><span class="option-check">${on?"✓":""}</span>`;
    el.addEventListener("click",()=>toggleCategory(category));
    categoryBox.appendChild(el);
  }

  updateFilterCount();
}

function updateFilterCount(){
  const count=document.getElementById("filter-count");
  const totalSources=knownSources.length;
  count.textContent=`${filters.sources.size}/${totalSources} kaynak · ${filters.categories.size}/${CATEGORIES.length} kategori açık`;
}

function toggleSource(key){
  if(filters.sources.has(key)) filters.sources.delete(key);
  else filters.sources.add(key);
  savePreferences();
  applyFilters();
}

function toggleCategory(cat){
  if(filters.categories.has(cat)) filters.categories.delete(cat);
  else filters.categories.add(cat);
  savePreferences();
  applyFilters();
}


function applyFilters(){
  const previousStory=state.stories[state.index]||null;
  const previousKey=storyIdentity(previousStory);
  const list=activeStories();

  renderOptions();

  if(!list.length){
    if(!filterReturnStoryKey && previousKey){
      filterReturnStoryKey=previousKey;
    }

    status("Seçtiğiniz kaynak ve kategorilerde haber bulunamadı.");
    return;
  }

  clearStatus();
  state.stories=list;

  const preferredKey=
    filterReturnStoryKey ||
    previousKey;

  let idx=
    preferredKey
      ? list.findIndex(x=>storyIdentity(x)===preferredKey)
      : -1;

  if(idx<0){
    if(!filterReturnStoryKey && previousKey){
      filterReturnStoryKey=previousKey;
    }

    idx=0;
  }

  const targetStory=list[idx];
  const targetKey=storyIdentity(targetStory);

  state.index=idx;
  state.history=[idx];
  state.historyPos=0;
  skippedAdHistory=null;
  historicalAdContext=null;

  /*
    Eski kod state'i geri taşıyıp ekrandaki slide'ı değiştirmeyebiliyordu.
    Hedef haber farklıysa görünür slide da aynı anda güncellenir.
  */
  if(targetKey!==previousKey){
    fill(slides[state.active],targetStory);
    slides[state.active].className="slide active";
  }

  if(
    filterReturnStoryKey &&
    targetKey===filterReturnStoryKey
  ){
    filterReturnStoryKey="";
  }

  timer();
}


const INITIAL_LOADING_MIN_MS=1200;
const INITIAL_LOADING_MAX_MS=12000;
const initialLoadingStartedAt=Date.now();
let initialLoadFinished=false;
let initialLoadingWatchdog=null;

function finishInitialLoading(forceImmediate=false){
  if(initialLoadFinished)return;
  initialLoadFinished=true;

  if(initialLoadingWatchdog){
    clearTimeout(initialLoadingWatchdog);
    initialLoadingWatchdog=null;
  }

  const screen=document.getElementById("loading-screen");
  if(!screen){
    if(!window.__floewInitialReady){
      window.__floewInitialReady=true;
      window.dispatchEvent(new Event("floew:ready"));
    }
    return;
  }

  const remove=()=>{
    if(screen.isConnected)screen.remove();

    if(!window.__floewInitialReady){
      window.__floewInitialReady=true;
      window.dispatchEvent(new Event("floew:ready"));
    }
  };

  if(forceImmediate){
    remove();
    return;
  }

  const elapsed=Date.now()-initialLoadingStartedAt;
  const wait=Math.max(0,INITIAL_LOADING_MIN_MS-elapsed);

  setTimeout(()=>{
    requestAnimationFrame(()=>{
      screen.classList.add("is-done");
      screen.addEventListener("transitionend",remove,{once:true});
      // Güvenlik: transitionend herhangi bir nedenle gelmezse overlay kalmasın.
      setTimeout(remove,700);
    });
  },wait);
}

/*
  Worker cevapları uzarsa loading katmanının sayfayı sonsuza kadar
  kilitlemesine izin verme. Haberler daha sonra gelirse normal akış devam eder.
*/
initialLoadingWatchdog=setTimeout(
  ()=>finishInitialLoading(true),
  INITIAL_LOADING_MAX_MS
);

function status(msg){
  const e=document.getElementById("status");
  e.innerHTML="";
  const band=document.createElement("div");
  band.className="status-band";

  const text=document.createElement("span");
  text.className="status-message";
  text.textContent=msg;

  const close=document.createElement("button");
  close.className="status-close";
  close.type="button";
  close.setAttribute("aria-label","Uyarıyı kapat");
  close.textContent="×";
  close.addEventListener("pointerdown",ev=>ev.stopPropagation());
  close.addEventListener("pointerup",ev=>ev.stopPropagation());
  close.addEventListener("click",ev=>{
    ev.stopPropagation();
    clearStatus();
  });

  band.append(text,close);
  e.appendChild(band);
  e.hidden=false;
}
function clearStatus(){
  const e=document.getElementById("status");
  e.hidden=true;
  e.innerHTML="";
}

function sourceKey(source){return String(source||"").trim().toLocaleLowerCase("tr-TR")}

function sourceLogo(source){
  const key=sourceKey(source);
  return SOURCE_LOGOS[key] || "https://icons.duckduckgo.com/ip3/news.google.com.ico";
}

function timeText(v){
  const d=new Date(v);
  if(!v||Number.isNaN(d.getTime()))return "";
  const m=Math.max(0,Math.floor((Date.now()-d.getTime())/60000));
  if(m<1)return "az önce";
  if(m<60)return m+" dakika önce";
  const h=Math.floor(m/60);
  if(h<24)return h+" saat önce";
  return d.toLocaleDateString("tr-TR",{day:"2-digit",month:"2-digit",year:"numeric"});
}


const storyMediaCache=new Map();

function mediaKey(story){
  return String(
    story?.link ||
    `${story?.source||""}|${story?.title||""}`
  );
}

function resetSlideMedia(el){
  el.dataset.mediaToken=String(
    (Number(el.dataset.mediaToken)||0)+1
  );

  const image=el.querySelector(".slide-image");
  const video=el.querySelector(".slide-video");
  const embed=el.querySelector(".slide-embed");

  if(image){
    image.style.display="block";
    image.style.visibility="visible";
  }

  if(video){
    try{video.pause()}catch(e){}
    video.removeAttribute("src");
    video.load();
    video.classList.remove("media-visible");
    video.setAttribute("aria-hidden","true");
  }

  if(embed){
    embed.src="about:blank";
    embed.classList.remove("media-visible");
    embed.setAttribute("aria-hidden","true");
    embed.removeAttribute("data-provider");
  }
}

function stopSlideMedia(el){
  if(!el)return;
  resetSlideMedia(el);
}

async function resolveStoryMedia(story){
  if(!videoEnabled || !story)return null;

  if(story.video){
    return {
      kind:"video",
      url:story.video,
      type:story.videoType||""
    };
  }

  if(!story.link)return null;

  const key=mediaKey(story);
  if(storyMediaCache.has(key)){
    return storyMediaCache.get(key);
  }

  const promise=(async()=>{
    const controller=new AbortController();
    const timeout=setTimeout(
      ()=>controller.abort(),
      8500
    );

    try{
      const url=
        `${VIDEO_API}?url=${encodeURIComponent(story.link)}`;

      const r=await fetch(url,{
        method:"GET",
        mode:"cors",
        credentials:"omit",
        cache:"default",
        signal:controller.signal,
        headers:{
          "Accept":"application/json"
        }
      });

      if(!r.ok)return null;

      const data=await r.json();
      return data?.media||null;
    }catch(err){
      console.warn(
        "Video resolve:",
        story.link,
        err
      );
      return null;
    }finally{
      clearTimeout(timeout);
    }
  })();

  storyMediaCache.set(key,promise);
  return promise;
}

function showDirectVideo(el,story,media,token){
  const image=el.querySelector(".slide-image");
  const video=el.querySelector(".slide-video");

  if(!video || !media?.url)return;

  video.muted=true;
  video.defaultMuted=true;
  video.volume=0;
  video.autoplay=true;
  video.playsInline=true;
  video.controls=false;
  video.poster=story.image||"";

  let settled=false;

  const fallback=()=>{
    if(settled)return;
    settled=true;

    if(
      token!==el.dataset.mediaToken ||
      mediaKey(story)!==el.dataset.storyKey
    ) return;

    try{video.pause()}catch(e){}
    video.removeAttribute("src");
    video.load();
    video.classList.remove("media-visible");
    video.setAttribute("aria-hidden","true");

    if(image)image.style.display="block";
  };

  const reveal=async()=>{
    if(settled)return;

    if(
      !videoEnabled ||
      token!==el.dataset.mediaToken ||
      mediaKey(story)!==el.dataset.storyKey
    ){
      fallback();
      return;
    }

    try{
      await video.play();
    }catch(e){
      // Muted autoplay normally succeeds. If the browser blocks it,
      // keep the still image instead of showing a broken player.
      fallback();
      return;
    }

    settled=true;
    video.classList.add("media-visible");
    video.setAttribute("aria-hidden","false");

    if(image)image.style.display="none";
  };

  video.addEventListener(
    "loadeddata",
    reveal,
    {once:true}
  );
  video.addEventListener(
    "error",
    fallback,
    {once:true}
  );

  const type=String(media.type||"").toLowerCase();
  const isHls=
    type.includes("mpegurl") ||
    /\.m3u8(?:[?#]|$)/i.test(media.url);

  if(
    isHls &&
    !video.canPlayType("application/vnd.apple.mpegurl") &&
    !video.canPlayType("application/x-mpegURL")
  ){
    fallback();
    return;
  }

  video.src=media.url;
  video.load();
}


function cleanEmbedUrl(media){
  if(!media?.url)return "";

  try{
    const u=new URL(media.url);
    const provider=String(media.provider||"").toLowerCase();

    if(provider==="youtube"){
      u.searchParams.set("autoplay","1");
      u.searchParams.set("mute","1");
      u.searchParams.set("controls","0");
      u.searchParams.set("disablekb","1");
      u.searchParams.set("fs","0");
      u.searchParams.set("playsinline","1");
      u.searchParams.set("iv_load_policy","3");
      u.searchParams.set("cc_load_policy","0");
      u.searchParams.set("rel","0");
    }else if(provider==="vimeo"){
      u.searchParams.set("autoplay","1");
      u.searchParams.set("muted","1");
      u.searchParams.set("background","1");
      u.searchParams.set("loop","1");
      u.searchParams.set("controls","0");
      u.searchParams.set("title","0");
      u.searchParams.set("byline","0");
      u.searchParams.set("portrait","0");
      u.searchParams.set("keyboard","0");
      u.searchParams.set("dnt","1");
    }else if(provider==="dailymotion"){
      /*
        Dailymotion'un 2026 embed endpoint'inde eski UI query parametrelerinin
        çoğu artık geçerli değil. mute/loop destekleniyor; kalan arayüzü
        CSS tarafında ekranın dışına kırpıyoruz.
      */
      u.searchParams.set("mute","true");
      u.searchParams.set("loop","true");
    }

    return u.href;
  }catch{
    return String(media.url||"");
  }
}

function showEmbedVideo(el,story,media,token){
  const image=el.querySelector(".slide-image");
  const embed=el.querySelector(".slide-embed");

  if(!embed || !media?.url)return;

  const provider=String(media.provider||"generic").toLowerCase();
  const cleanUrl=cleanEmbedUrl(media);

  if(!cleanUrl)return;

  embed.dataset.provider=provider;
  embed.tabIndex=-1;

  /*
    Harici oynatıcılar mouse/touch/keyboard girdisi almasın.
    Flöw'ün kaydırma/tıklama navigasyonu kesintisiz kalsın.
  */
  embed.setAttribute(
    "allow",
    "autoplay; encrypted-media; picture-in-picture"
  );

  const reveal=()=>{
    if(
      !videoEnabled ||
      token!==el.dataset.mediaToken ||
      mediaKey(story)!==el.dataset.storyKey
    ) return;

    embed.classList.add("media-visible");
    embed.setAttribute("aria-hidden","false");

    if(image)image.style.display="none";
  };

  embed.addEventListener(
    "load",
    reveal,
    {once:true}
  );

  embed.src=cleanUrl;
}

async function prepareSlideMedia(el,story){
  if(!videoEnabled || !story)return;

  const token=el.dataset.mediaToken;
  const media=await resolveStoryMedia(story);

  if(
    !videoEnabled ||
    !media ||
    token!==el.dataset.mediaToken ||
    mediaKey(story)!==el.dataset.storyKey
  ) return;

  if(media.kind==="embed"){
    showEmbedVideo(
      el,
      story,
      media,
      token
    );
  }else if(media.kind==="video"){
    showDirectVideo(
      el,
      story,
      media,
      token
    );
  }
}

function renderVideoSetting(){
  const btn=document.getElementById("video-setting");
  if(!btn)return;

  btn.classList.toggle("active",videoEnabled);
  btn.setAttribute(
    "aria-pressed",
    videoEnabled?"true":"false"
  );

  const state=btn.querySelector(
    ".media-setting-state"
  );

  if(state){
    state.textContent=
      videoEnabled?"Açık":"Kapalı";
  }
}

function applyVideoSetting(){
  renderVideoSetting();

  for(const slide of slides){
    stopSlideMedia(slide);
  }

  const story=state.stories[state.index];

  if(videoEnabled && story){
    const activeSlide=slides[state.active];
    activeSlide.dataset.storyKey=mediaKey(story);
    prepareSlideMedia(activeSlide,story);
  }
}

function fill(el,s){
  resetSlideMedia(el);
  el.dataset.storyKey=mediaKey(s);

  el.querySelector(".slide-image").src=s.image;
  el.querySelector(".slide-image").alt=s.title||"";

  const logo=el.querySelector(".source-logo");
  logo.src=sourceLogo(s.source);
  logo.alt=s.source||"";
  logo.onerror=()=>{logo.style.visibility="hidden"};
  logo.onload=()=>{logo.style.visibility="visible"};

  el.querySelector(".source").textContent=s.source||"";
  const category=el.querySelector(".category");
  if(category) category.textContent=s.flowCategory||"#Yaşam";
  el.querySelector("h1").textContent=s.title||"";

  const description=el.querySelector(".description");
  if(description){
    let text=String(s.description||s.summary||"").trim();

    if(text){
      try{
        const doc=new DOMParser().parseFromString(text,"text/html");
        text=(doc.body?.textContent||text).replace(/\s+/g," ").trim();
      }catch(e){
        text=text.replace(/\s+/g," ").trim();
      }
    }

    description.textContent=text;
    description.hidden=!text;
  }

  el.querySelector(".time").textContent=timeText(s.published);

  const sourceLink=el.querySelector(".source-link");
  if(sourceLink){
    if(s.link){
      sourceLink.href=s.link;
      sourceLink.removeAttribute("aria-hidden");
      sourceLink.style.display="inline-block";
    }else{
      sourceLink.removeAttribute("href");
      sourceLink.setAttribute("aria-hidden","true");
      sourceLink.style.display="none";
    }
  }

  if(videoEnabled){
    prepareSlideMedia(el,s);
  }
}



function isMobileAdDevice(){
  try{
    if(navigator.userAgentData?.mobile===true)return true;
  }catch(e){}

  return /Android|iPhone|iPod|IEMobile|Opera Mini|Mobile/i.test(
    navigator.userAgent||""
  );
}

function getAdsLayout(){
  const portrait=
    window.innerHeight>window.innerWidth ||
    (
      window.matchMedia &&
      window.matchMedia("(orientation: portrait)").matches
    );

  /*
    Telefonda yatay tutulsa bile mobil kreatifi kullan.
    Masaüstünde ise pencere dikey oranlara çekildiğinde ver'e geç.
  */
  return portrait || isMobileAdDevice()
    ? "ver"
    : "hor";
}

function adsCacheKey(layout=getAdsLayout()){
  return `${ADS_CACHE_KEY}.${layout}`;
}

function normalizeAdEntry(item){
  if(!item)return null;

  const rawSrc=
    typeof item==="string"
      ? item
      : String(item.url||item.src||"");

  const src=rawSrc.trim();
  if(!src)return null;

  const name=
    typeof item==="object"
      ? String(item.name||"")
      : "";

  const layout=
    typeof item==="object" &&
    (item.layout==="ver" || item.layout==="hor")
      ? item.layout
      : "";

  const clean=(name||src)
    .split("?")[0]
    .split("#")[0]
    .toLocaleLowerCase("en-US");

  let type=
    typeof item==="object" && item.type
      ? String(item.type).toLocaleLowerCase("en-US")
      : "";

  if(!type){
    if(clean.endsWith(".mp4"))type="video";
    else if(clean.endsWith(".jpg")||clean.endsWith(".jpeg"))type="image";
  }

  if(type!=="video" && type!=="image")return null;

  try{
    return {
      src:new URL(src,document.baseURI).href,
      type,
      name:name||clean.split("/").pop()||"",
      layout
    };
  }catch(e){
    return null;
  }
}

function loadCachedAdsCatalog(layout=getAdsLayout()){
  try{
    const raw=localStorage.getItem(
      adsCacheKey(layout)
    );

    if(!raw)return [];

    const data=JSON.parse(raw);
    const list=Array.isArray(data?.ads)?data.ads:[];

    return list
      .map(normalizeAdEntry)
      .filter(Boolean);
  }catch(e){
    return [];
  }
}

function saveCachedAdsCatalog(list,layout=getAdsLayout()){
  try{
    localStorage.setItem(
      adsCacheKey(layout),
      JSON.stringify({
        savedAt:Date.now(),
        layout,
        ads:list.map(item=>({
          src:item.src,
          type:item.type,
          name:item.name||"",
          layout:item.layout||layout
        }))
      })
    );
  }catch(e){}
}

async function actuallyLoadAdsCatalog(layout=getAdsLayout()){
  const controller=new AbortController();
  const timeout=setTimeout(
    ()=>controller.abort(),
    10000
  );

  try{
    const separator=ADS_API.includes("?")?"&":"?";
    const response=await fetch(
      `${ADS_API}${separator}layout=${encodeURIComponent(layout)}&t=${Date.now()}`,
      {
        method:"GET",
        mode:"cors",
        credentials:"omit",
        cache:"no-store",
        signal:controller.signal,
        headers:{
          "Accept":"application/json"
        }
      }
    );

    if(!response.ok){
      throw new Error(`Ads HTTP ${response.status}`);
    }

    const data=await response.json();
    const list=Array.isArray(data)
      ? data
      : Array.isArray(data?.ads)
        ? data.ads
        : [];

    const normalized=list
      .map(item=>normalizeAdEntry({
        ...(typeof item==="object" ? item : {url:item}),
        layout:
          typeof item==="object" && item?.layout
            ? item.layout
            : layout
      }))
      .filter(Boolean);

    /*
      Pencere katalog isteği sürerken başka orana döndüyse eski isteğin
      sonucu yeni yönü ezmesin.
    */
    if(layout!==getAdsLayout()){
      return adCatalog;
    }

    adCatalog=[...new Map(
      normalized.map(item=>[item.name||item.src,item])
    ).values()];

    adCatalogLayout=layout;
    saveCachedAdsCatalog(adCatalog,layout);

    console.info(
      `Flöw ads (${layout}):`,
      adCatalog.length,
      "reklam bulundu:",
      adCatalog.map(item=>item.name).join(", ")
    );

    return adCatalog;
  }catch(err){
    console.warn(`Flöw ads Worker (${layout}):`,err);

    if(layout===getAdsLayout()){
      const cached=loadCachedAdsCatalog(layout);

      if(cached.length || !adCatalog.length){
        adCatalog=cached;
        adCatalogLayout=layout;
      }
    }

    return adCatalog;
  }finally{
    clearTimeout(timeout);
  }
}

function loadAdsCatalog(layout=getAdsLayout()){
  if(adsCatalogPromise){
    if(adsCatalogPromiseLayout===layout){
      return adsCatalogPromise;
    }

    /*
      Bir önceki yönün isteği bitince yeni yönü hemen çek.
    */
    return adsCatalogPromise.finally(
      ()=>loadAdsCatalog(layout)
    );
  }

  adsCatalogPromiseLayout=layout;

  adsCatalogPromise=actuallyLoadAdsCatalog(layout)
    .finally(()=>{
      adsCatalogPromise=null;
      adsCatalogPromiseLayout="";
    });

  return adsCatalogPromise;
}

function startAdsCatalogRefresh(){
  const layout=getAdsLayout();
  const cached=loadCachedAdsCatalog(layout);

  adCatalogLayout=layout;

  if(cached.length){
    adCatalog=cached;
  }

  loadAdsCatalog(layout);

  if(adCatalogRefreshTimer){
    clearInterval(adCatalogRefreshTimer);
  }

  adCatalogRefreshTimer=setInterval(
    ()=>loadAdsCatalog(getAdsLayout()),
    ADS_REFRESH_MS
  );
}

function refreshAdsLayoutIfNeeded(){
  const layout=getAdsLayout();

  if(layout===adCatalogLayout)return;

  clearTimeout(adLayoutRefreshTimer);

  adLayoutRefreshTimer=setTimeout(()=>{
    const current=getAdsLayout();

    if(current===adCatalogLayout)return;

    const cached=loadCachedAdsCatalog(current);

    /*
      Yeni oranın cache'i varsa anında kullan; ardından Worker'dan tazele.
      Cache yoksa eski oranın reklamını yeni bir reklam arası için kullanmayız.
    */
    adCatalog=cached;
    adCatalogLayout=current;

    loadAdsCatalog(current);
  },180);
}

function chooseRandomAd(){
  if(!adCatalog.length)return null;

  const candidates=
    adCatalog.length>1
      ? adCatalog.filter(
          item=>(item.name||item.src)!==lastAdName
        )
      : adCatalog;

  const pool=candidates.length?candidates:adCatalog;
  const chosen=pool[Math.floor(Math.random()*pool.length)]||null;

  if(chosen){
    lastAdName=chosen.name||chosen.src;
  }

  return chosen;
}

const FLOW_TRANSITION_CLASSES=[
  "enter-up","exit-up","enter-down","exit-down",
  "enter-left","exit-left","enter-right","exit-right"
];

function transitionPair(dir=1){
  const forward=dir>0;
  const directionMap={
    up:    forward ? ["enter-up","exit-up"]       : ["enter-down","exit-down"],
    down:  forward ? ["enter-down","exit-down"]   : ["enter-up","exit-up"],
    left:  forward ? ["enter-left","exit-left"]   : ["enter-right","exit-right"],
    right: forward ? ["enter-right","exit-right"] : ["enter-left","exit-left"]
  };

  return directionMap[transitionDirection]||directionMap.up;
}

function clearFlowTransitionClasses(el){
  if(!el)return;
  el.classList.remove(...FLOW_TRANSITION_CLASSES);
}

function waitForFlowAnimation(el,timeoutMs=900){
  return new Promise(resolve=>{
    if(!el){resolve();return;}

    let done=false;
    let timerId=null;

    const finish=()=>{
      if(done)return;
      done=true;
      clearTimeout(timerId);
      el.removeEventListener("animationend",onEnd);
      resolve();
    };

    const onEnd=e=>{
      if(e.target===el)finish();
    };

    el.addEventListener("animationend",onEnd);
    timerId=setTimeout(finish,timeoutMs);
  });
}

async function transitionAdIn(dir=adEntryDirection){
  if(!adOverlay)return false;
  if(adHasEntered)return true;

  const currentSlide=slides[state.active];
  const [enterClass,exitClass]=transitionPair(dir);

  showAdOverlay();
  clearFlowTransitionClasses(adOverlay);
  currentSlide.className="slide";

  /*
    PiP de tarayıcıdakiyle aynı anda haberden reklama kayar.
  */
  if(currentAd){
    startPiPAdTransition(
      currentAd,
      dir
    );
  }

  void adOverlay.offsetWidth;

  adOverlay.classList.add(enterClass);
  currentSlide.classList.add(exitClass);

  await waitForFlowAnimation(adOverlay);

  clearFlowTransitionClasses(adOverlay);
  stopSlideMedia(currentSlide);
  adHasEntered=true;
  adSkipEnabledAt=performance.now()+AD_SKIP_GRACE_MS;

  return true;
}

function requestAdSkip(dir=1){
  if(!adActive)return false;

  /*
    Kritik düzeltme:
    Reklamı tetikleyen trackpad/mouse-wheel gesture'ı birden fazla wheel
    olayı üretir. Eski davranışta ilk olay reklamı açıyor, hemen arkasından
    gelen momentum olayları ise reklam henüz giriş animasyonundayken
    adSkipRequestedDirection değerini set ediyordu. Giriş animasyonu
    tamamlanınca reklam yaklaşık 1 saniyede "skip" edilmiş görünüyordu.

    Reklam tamamen görünür olmadan ve kısa grace süresi dolmadan skip
    isteğini kaydetmiyoruz.
  */
  if(
    !adHasEntered ||
    performance.now()<adSkipEnabledAt
  ){
    return false;
  }

  adSkipRequestedDirection=dir<0?-1:1;

  if(adPlaybackFinish){
    adPlaybackFinish(adSkipRequestedDirection);
  }

  return true;
}

function resetAdMedia(){
  if(adImage){
    adImage.hidden=true;
    adImage.removeAttribute("src");
  }

  if(adVideo){
    try{adVideo.pause()}catch(e){}
    adVideo.hidden=true;
    adVideo.removeAttribute("src");
    adVideo.load();
  }
}

function showAdOverlay(){
  document.body.classList.add("ad-mode");

  if(adOverlay){
    adOverlay.hidden=false;
    adOverlay.setAttribute("aria-hidden","false");
  }

  showFullscreenButton();
}

function hideAdOverlay(){
  document.body.classList.remove("ad-mode");

  if(adOverlay){
    adOverlay.hidden=true;
    adOverlay.setAttribute("aria-hidden","true");
  }

  resetAdMedia();
}

function waitForImageAd(src){
  return new Promise(resolve=>{
    if(!adImage){
      resolve({
        shown:false,
        direction:1,
        skipped:false
      });
      return;
    }

    let finished=false;
    let timerId=null;
    let loadTimer=null;

    const finish=(shown,direction=1,skipped=false)=>{
      if(finished)return;
      finished=true;
      clearTimeout(timerId);
      clearTimeout(loadTimer);
      adImage.onload=null;
      adImage.onerror=null;

      if(adPlaybackFinish===skip){
        adPlaybackFinish=null;
      }

      resolve({
        shown:Boolean(shown),
        direction:direction<0?-1:1,
        skipped:Boolean(skipped)
      });
    };

    const skip=direction=>{
      finish(
        adHasEntered,
        direction,
        true
      );
    };

    adPlaybackFinish=skip;

    adImage.onload=async()=>{
      const entered=await transitionAdIn(
        adEntryDirection
      );

      if(!entered){
        finish(false,1,false);
        return;
      }

      if(adSkipRequestedDirection){
        finish(
          true,
          adSkipRequestedDirection,
          true
        );
        return;
      }

      timerId=setTimeout(
        ()=>finish(true,1,false),
        AD_IMAGE_MS
      );
    };

    adImage.onerror=()=>{
      console.warn("Ad image could not load:",src);
      finish(false,1,false);
    };

    adImage.hidden=false;
    adImage.src=src;

    loadTimer=setTimeout(()=>{
      if(!finished && !adImage.complete){
        console.warn("Ad image load timeout:",src);
        finish(false,1,false);
      }
    },10000);
  });
}

function waitForVideoAd(src){
  return new Promise(resolve=>{
    if(!adVideo){
      resolve({
        shown:false,
        direction:1,
        skipped:false
      });
      return;
    }

    let finished=false;
    let started=false;
    let safetyTimer=null;
    let loadTimer=null;

    const cleanup=()=>{
      clearTimeout(safetyTimer);
      clearTimeout(loadTimer);

      adVideo.onloadeddata=null;
      adVideo.oncanplay=null;
      adVideo.onended=null;
      adVideo.onerror=null;
      adVideo.onabort=null;
    };

    const finish=(shown,direction=1,skipped=false)=>{
      if(finished)return;
      finished=true;
      cleanup();

      if(adPlaybackFinish===skip){
        adPlaybackFinish=null;
      }

      resolve({
        shown:Boolean(shown),
        direction:direction<0?-1:1,
        skipped:Boolean(skipped)
      });
    };

    const skip=direction=>{
      finish(
        adHasEntered,
        direction,
        true
      );
    };

    adPlaybackFinish=skip;

    const start=async()=>{
      if(started||finished)return;
      started=true;

      const entered=await transitionAdIn(
        adEntryDirection
      );

      if(!entered){
        finish(false,1,false);
        return;
      }

      if(adSkipRequestedDirection){
        finish(
          true,
          adSkipRequestedDirection,
          true
        );
        return;
      }

      try{
        await adVideo.play();
        if(finished)return;
      }catch(err){
        console.warn("Ad video play:",err);
        finish(true,1,false);
        return;
      }

      safetyTimer=setTimeout(
        ()=>finish(true,1,false),
        30*60*1000
      );
    };

    adVideo.muted=true;
    adVideo.defaultMuted=true;
    adVideo.volume=0;
    adVideo.autoplay=true;
    adVideo.playsInline=true;
    adVideo.loop=false;
    adVideo.preload="auto";
    adVideo.hidden=false;

    adVideo.onloadeddata=start;
    adVideo.oncanplay=start;
    adVideo.onended=()=>finish(true,1,false);
    adVideo.onerror=()=>{
      console.warn("Ad video could not load:",src);
      finish(adHasEntered,1,false);
    };
    adVideo.onabort=()=>finish(adHasEntered,1,false);

    adVideo.src=src;
    adVideo.load();

    loadTimer=setTimeout(()=>{
      if(!started&&!finished){
        console.warn("Ad video load timeout:",src);
        finish(false,1,false);
      }
    },15000);
  });
}

async function playAdBreak(options={}){
  if(adActive||!adCatalog.length)return false;

  const ad=
    options.ad ||
    chooseRandomAd();

  if(!ad)return false;

  currentAd=ad;
  adEntryDirection=
    options.entryDir<0
      ? -1
      : 1;

  historicalAdContext=
    options.historyContext ||
    null;

  adActive=true;
  adHasEntered=false;
  adSkipRequestedDirection=0;
  adSkipEnabledAt=0;
  adPlaybackFinish=null;
  clearTimeout(state.timer);
  resetAdMedia();

  let result={
    shown:false,
    direction:adEntryDirection,
    skipped:false
  };

  try{
    result=
      ad.type==="video"
        ? await waitForVideoAd(ad.src)
        : await waitForImageAd(ad.src);
  }catch(err){
    console.warn("Ad playback:",err);
    result={
      shown:false,
      direction:adEntryDirection,
      skipped:false
    };
  }

  if(!result?.shown){
    hideAdOverlay();
    adActive=false;
    adHasEntered=false;
    adSkipRequestedDirection=0;
    adSkipEnabledAt=0;
    adPlaybackFinish=null;
    currentAd=null;
    historicalAdContext=null;
    slides[state.active].className="slide active";
    return false;
  }

  /*
    İlk normal reklam gösteriminde sayaç sıfırlanır.
    History içinden aynı reklam tekrar ziyaret edildiğinde yeni bir reklam
    gösterimi gibi sayaç sıfırlamayız.
  */
  if(!options.historyContext){
    newsShownSinceAd=0;
  }

  return {
    shown:true,
    direction:result.direction<0?-1:1,
    skipped:Boolean(result.skipped),
    ad
  };
}

function adBreakDue(){
  return (
    !adActive &&
    newsShownSinceAd>=ADS_INTERVAL_NEWS
  );
}

async function tryPlayDueAd(){
  if(!adBreakDue())return false;

  /*
    Önceki sürümde katalog ilk istekte boş kalırsa reklam arası sessizce
    atlanıyordu ve bir sonraki katalog yenilemesine kadar bekliyordu.
    Artık 10. haberden sonra katalog boşsa o anda yeniden yüklemeyi deniyoruz.
  */
  if(!adCatalog.length){
    await loadAdsCatalog();
  }

  if(!adCatalog.length){
    console.warn(
      "Flöw ads: reklam sırası geldi ancak katalog hâlâ boş."
    );
    return false;
  }

  return playAdBreak();
}

function timer(){
  clearTimeout(state.timer);
  state.timer=setTimeout(
    ()=>move(1),
    Math.max(5,showDurationSeconds)*1000
  );
}

/*
  Her geçişte mümkünse mevcut kaynaktan farklı
  bir haber seçilir. Önce farklı kaynaklar filtrelenir;
  ardından o kaynaklardan rastgele bir haber seçilir.
*/
function sourceKey(source){
  return String(source||"").trim().toLocaleLowerCase("tr-TR");
}

/*
  İleri giderken farklı bir kaynak seçilir ve seçilen haber history'ye
  eklenir. Geri giderken history'deki gerçek önceki haber gösterilir;
  böylece aynı haberin yeni bir versiyonu seçilmez.
*/
function chooseForward(){
  if(!state.stories.length)return -1;

  const currentSource=sourceKey(
    state.stories[state.index]?.source
  );

  for(let step=1;step<=state.stories.length;step++){
    const i=(state.index+step)%state.stories.length;

    if(
      sourceKey(state.stories[i]?.source)!==
      currentSource
    ){
      return i;
    }
  }

  return (state.index+1)%state.stories.length;
}

function preloadImage(url){
  return new Promise(resolve=>{
    if(!url){
      resolve();
      return;
    }

    const img=new Image();
    let done=false;

    const finish=()=>{
      if(done)return;
      done=true;
      resolve();
    };

    img.onload=finish;
    img.onerror=finish;

    img.src=url;

    /*
      Çok yavaş bir görsel geçişi sonsuza kadar
      bekletmesin.
    */
    setTimeout(finish,5000);
  });
}


function isAtSkippedAdBefore(){
  return Boolean(
    skippedAdHistory &&
    !adActive &&
    state.historyPos===skippedAdHistory.beforeHistoryPos &&
    state.index===skippedAdHistory.beforeIndex
  );
}

function isAtSkippedAdAfter(){
  return Boolean(
    skippedAdHistory &&
    !adActive &&
    state.historyPos===skippedAdHistory.afterHistoryPos &&
    state.index===skippedAdHistory.afterIndex
  );
}

async function enterSkippedAdHistory(entryDir){
  if(!skippedAdHistory)return false;

  const context={
    ...skippedAdHistory,
    entryDir:entryDir<0?-1:1
  };

  await loadAdsCatalog(getAdsLayout());

  const layoutAd=
    adCatalog.find(
      item=>
        item.name &&
        item.name===context.ad?.name
    ) ||
    context.ad;

  const result=await playAdBreak({
    ad:layoutAd,
    entryDir:context.entryDir,
    historyContext:context
  });

  if(!result?.shown){
    historicalAdContext=null;
    return false;
  }

  /*
    Kullanıcı history reklamında yön seçerse o yön kazanır.
    Reklamı hiç atlamaz ve kendi kendine biterse, history'de hangi yönde
    ilerliyorsa o yönde devam eder.
  */
  const exitDir=
    result.skipped
      ? result.direction
      : context.entryDir;

  if(exitDir<0){
    await transitionFromAdTo(
      context.beforeIndex,
      true,
      -1
    );

    state.historyPos=
      context.beforeHistoryPos;
  }else{
    await transitionFromAdTo(
      context.afterIndex,
      true,
      1
    );

    state.historyPos=
      context.afterHistoryPos;
  }

  historicalAdContext=null;
  return true;
}

async function move(dir,options={}){
  if(
    filterReturnStoryKey &&
    !options.fromAd &&
    !options.preserveFilterReturn
  ){
    filterReturnStoryKey="";
  }

  /*
    Reklam ekrandayken normal gezinme reklamı atlama isteğine dönüşür.
  */
  if(adActive && !options.fromAd){
    requestAdSkip(dir);
    return;
  }

  if(state.busy||state.stories.length<2)return;

  /*
    Kullanıcının bitmeden geçtiği reklam history'de gerçek bir ara duraktır.
    Haber B'den geri -> reklam; haber A'dan ileri -> aynı reklam.
  */
  if(!options.skipHistoricalAd){
    if(dir<0 && isAtSkippedAdAfter()){
      await enterSkippedAdHistory(-1);
      return;
    }

    if(dir>0 && isAtSkippedAdBefore()){
      await enterSkippedAdHistory(1);
      return;
    }
  }

  if(
    dir>0 &&
    !options.skipAd &&
    adBreakDue()
  ){
    const beforeIndex=state.index;
    const beforeHistoryPos=state.historyPos;

    const adResult=await tryPlayDueAd();

    if(adResult?.shown){
      if(adResult.direction<0){
        await transitionAdBackToCurrent(-1);
      }else{
        await move(1,{
          skipAd:true,
          skipHistoricalAd:true,
          fromAd:true
        });

        /*
          Yalnızca kullanıcı reklamı bitmeden ileri geçtiyse history bağlantısı
          kurulur. Reklam doğal olarak bittiyse sonradan geri dönmek zorunlu
          değildir.
        */
        if(adResult.skipped){
          skippedAdHistory={
            ad:adResult.ad,
            beforeIndex,
            beforeHistoryPos,
            afterIndex:state.index,
            afterHistoryPos:state.historyPos
          };
        }
      }

      return;
    }
  }

  /*
    GERİ:
    Daha önce gerçekten gösterilmiş habere dön.
  */
  if(dir<0){
    if(state.historyPos<=0)return;

    const target=
      state.history[state.historyPos-1];

    await transitionTo(target,true,dir);

    state.historyPos--;

    return;
  }

  /*
    İLERİ:
    Eğer geri gelmişsek history'deki sonraki habere dön.
  */
  if(state.historyPos < state.history.length-1){
    const target=
      state.history[state.historyPos+1];

    if(options.fromAd){
      await transitionFromAdTo(target,true,dir);
    }else{
      await transitionTo(target,true,dir);
    }

    state.historyPos++;

    return;
  }

  const next=chooseForward();

  if(next<0)return;

  if(options.fromAd){
    await transitionFromAdTo(next,false,dir);
  }else{
    await transitionTo(next,false,dir);
  }

  state.history.push(next);
  state.historyPos=state.history.length-1;
}

async function transitionFromAdTo(nextIndex,fromHistory,dir=1){
  if(state.busy)return;

  state.busy=true;
  clearTimeout(state.timer);

  const previousSlide=slides[state.active];
  const nextSlide=slides[1-state.active];
  const story=state.stories[nextIndex];

  await preloadImage(story.image);
  fill(nextSlide,story);

  const nextImage=nextSlide.querySelector(".slide-image");
  if(nextImage?.decode){
    try{await nextImage.decode();}catch(e){}
  }

  nextSlide.className="slide";
  clearFlowTransitionClasses(adOverlay);

  void nextSlide.offsetWidth;

  const [enterClass,exitClass]=transitionPair(dir);

  startPiPTransition(
    state.stories[state.index],
    story,
    dir
  );

  nextSlide.classList.add(enterClass);
  adOverlay.classList.add(exitClass);

  await waitForFlowAnimation(nextSlide);

  nextSlide.className="slide active";
  previousSlide.className="slide";
  stopSlideMedia(previousSlide);

  state.active=1-state.active;
  state.index=nextIndex;

  if(dir>0){
    newsShownSinceAd++;
  }

  clearFlowTransitionClasses(adOverlay);
  hideAdOverlay();
  adActive=false;
  adHasEntered=false;
  adSkipRequestedDirection=0;
  adSkipEnabledAt=0;
  adPlaybackFinish=null;
  currentAd=null;
  historicalAdContext=null;
  state.busy=false;

  timer();
}

async function transitionAdBackToCurrent(dir=-1){
  if(state.busy)return;

  state.busy=true;
  clearTimeout(state.timer);

  const currentSlide=slides[state.active];
  const [enterClass,exitClass]=transitionPair(dir);

  clearFlowTransitionClasses(adOverlay);
  currentSlide.className="slide";

  /*
    Reklamdan mevcut habere dönüş PiP'te de aynı yönde gerçekleşir.
    startPiPTransition, pipCurrent reklam ise onu çıkış öğesi olarak kullanır.
  */
  startPiPTransition(
    state.stories[state.index],
    state.stories[state.index],
    dir
  );

  void currentSlide.offsetWidth;

  currentSlide.classList.add(enterClass);
  adOverlay.classList.add(exitClass);

  await waitForFlowAnimation(currentSlide);

  currentSlide.className="slide active";
  clearFlowTransitionClasses(adOverlay);
  hideAdOverlay();

  adActive=false;
  adHasEntered=false;
  adSkipRequestedDirection=0;
  adSkipEnabledAt=0;
  adPlaybackFinish=null;
  currentAd=null;
  historicalAdContext=null;
  state.busy=false;

  timer();
}

async function transitionTo(nextIndex,fromHistory,dir){
  if(state.busy)return;

  state.busy=true;
  clearTimeout(state.timer);

  const currentSlide=
    slides[state.active];

  const nextSlide=
    slides[1-state.active];

  const story=
    state.stories[nextIndex];

  /*
    Yeni görsel tamamen hazır olmadan animasyonu başlatma.
    Böylece geçiş sırasında alttaki/eski görsel görünmez.
  */
  await preloadImage(story.image);

  fill(nextSlide,story);

  const nextImage=
    nextSlide.querySelector(".slide-image");

  if(nextImage.decode){
    try{
      await nextImage.decode();
    }catch(e){}
  }

  currentSlide.className="slide";
  nextSlide.className="slide";

  void nextSlide.offsetWidth;

  /*
    dir > 0 = sonraki haber:
      yeni haber aşağıdan yukarı gelir.

    dir < 0 = önceki haber:
      yeni haber yukarıdan aşağı gelir.
  */
  const [enterClass,exitClass]=transitionPair(dir);

  startPiPTransition(
    state.stories[state.index],
    story,
    dir
  );

  nextSlide.classList.add(enterClass);
  currentSlide.classList.add(exitClass);

  nextSlide.addEventListener(
    "animationend",
    ()=>{
      nextSlide.className="slide active";
      currentSlide.className="slide";
      stopSlideMedia(currentSlide);

      state.active=
        1-state.active;

      state.index=
        nextIndex;

      if(dir>0){
        newsShownSinceAd++;
      }

      state.busy=false;

      timer();
    },
    {once:true}
  );
}


let sourceCatalogLoaded=false;

async function fetchSourceCatalog(){
  if(sourceCatalogLoaded && knownSources.length){
    return knownSources;
  }

  const controller=new AbortController();
  const timeout=setTimeout(()=>controller.abort(),8000);

  try{
    const r=await fetch(META_API,{
      method:"GET",
      mode:"cors",
      credentials:"omit",
      cache:"default",
      signal:controller.signal,
      headers:{
        "Accept":"application/json"
      }
    });

    if(!r.ok)throw new Error(`Meta HTTP ${r.status}`);

    const data=await r.json();
    const sources=Array.isArray(data?.sources)
      ? data.sources.filter(Boolean)
      : [];

    if(sources.length){
      knownSources=[...new Map(
        sources.map(source=>[
          sourceKey(source),
          source
        ])
      ).values()];
      sourceCatalogLoaded=true;
    }

    return knownSources;
  }catch(err){
    console.warn("Source catalog:",err);
    return knownSources;
  }finally{
    clearTimeout(timeout);
  }
}

async function fetchNewsBatch(batch){
  const controller=new AbortController();
  const timeout=setTimeout(()=>controller.abort(),16000);

  try{
    const separator=API.includes("?")?"&":"?";
    const url=`${API}${separator}batch=${batch}`;

    const r=await fetch(url,{
      method:"GET",
      mode:"cors",
      credentials:"omit",
      cache:"no-store",
      signal:controller.signal,
      headers:{
        "Accept":"application/json"
      }
    });

    if(!r.ok)throw new Error(`Batch ${batch}: HTTP ${r.status}`);

    const data=await r.json();
    if(!Array.isArray(data))throw new Error(`Batch ${batch}: Geçersiz Worker yanıtı`);

    return data;
  }finally{
    clearTimeout(timeout);
  }
}

async function load(){
  try{
    /*
      Worker kaynakları dört ayrı çağrıya böler. Böylece tek Worker
      invocation'ında Cloudflare'ın external subrequest sınırına yaklaşmayız.
      Bir batch geçici olarak hata verse bile diğer batch'lerin haberleri
      kullanılmaya devam eder.
    */
    const catalogPromise=
      sourceCatalogLoaded
        ? Promise.resolve(knownSources)
        : fetchSourceCatalog();

    const settled=await Promise.allSettled(
      Array.from({length:NEWS_BATCH_COUNT},(_,batch)=>fetchNewsBatch(batch))
    );

    await catalogPromise;

    const successful=settled
      .filter(result=>result.status==="fulfilled")
      .flatMap(result=>result.value);

    const failures=settled
      .map((result,batch)=>({result,batch}))
      .filter(x=>x.result.status==="rejected");

    for(const failure of failures){
      console.warn(
        `NEWS WALL batch ${failure.batch}:`,
        failure.result.reason
      );
    }

    const unique=new Map();

    function mergeDuplicateStory(existing,candidate){
      if(!existing)return candidate;

      const oldPriority=Number(existing.categoryPriority)||0;
      const newPriority=Number(candidate.categoryPriority)||0;

      let preferred=
        newPriority>oldPriority
          ? candidate
          : existing;

      const other=
        preferred===candidate
          ? existing
          : candidate;

      return {
        ...preferred,
        breaking:Boolean(existing.breaking||candidate.breaking),
        video:preferred.video||other.video||"",
        videoType:preferred.videoType||other.videoType||""
      };
    }

    for(const item of successful){
      if(!item||!item.title||!item.image)continue;

      const key=
        item.link ||
        `${item.source||""}|${item.title}`;

      unique.set(
        key,
        mergeDuplicateStory(
          unique.get(key),
          item
        )
      );
    }

    const incoming=[...unique.values()];

    if(!incoming.length){
      const firstError=failures[0]?.result?.reason;
      throw firstError||new Error("Görselli haber yok");
    }

    rawStories=enrichStories(incoming);

    if(
      filterReturnStoryKey &&
      !rawStories.some(
        story=>storyIdentity(story)===filterReturnStoryKey
      )
    ){
      filterReturnStoryKey="";
    }

    if(!knownSources.length){
      knownSources=[...new Map(
        rawStories.map(s=>[
          sourceKey(s.source),
          s.source||"Bilinmeyen kaynak"
        ])
      ).values()];
    }

    if(!sourcePreferencesApplied){
      const available=new Set(knownSources.map(sourceKey));

      if(Array.isArray(savedPreferences.sources)){
        filters.sources=new Set(
          savedPreferences.sources.filter(key=>available.has(key))
        );
      }else{
        filters.sources=new Set(available);
      }

      sourcePreferencesApplied=true;
    }

    renderOptions();

    const list=activeStories();
    if(!list.length){
      status("Seçtiğiniz kaynak ve kategorilerde haber bulunamadı.");
      finishInitialLoading();
      return;
    }

    if(!state.stories.length){
      state.stories=list;
      state.index=0;
      state.history=[0];
      state.historyPos=0;
      skippedAdHistory=null;
      historicalAdContext=null;
      fill(slides[0],list[0]);
      slides[0].className="slide active";
      newsShownSinceAd=1;
      clearStatus();
      finishInitialLoading();
      timer();

      if(ADS_TEST_MODE){
        setTimeout(runAdTestOnce,900);
      }

      return;
    }

    const currentStory=
      state.stories[state.index];

    const link=currentStory?.link;
    const oldSource=sourceKey(currentStory?.source);

    state.stories=list;

    if(link){
      const idx=list.findIndex(x=>x.link===link);

      if(idx>=0){
        state.index=idx;

        if(state.history.length){
          state.history[state.historyPos]=idx;
        }
      }else{
        const idx2=list.findIndex(
          x=>sourceKey(x.source)!==oldSource
        );

        if(idx2>=0){
          state.index=idx2;
          state.history=[idx2];
          state.historyPos=0;
          fill(slides[state.active],list[idx2]);
        }
      }
    }

    clearStatus();
    finishInitialLoading();
  }catch(err){
    console.error("NEWS WALL:",err);

    if(!state.stories.length){
      let detail=err?.message||"Worker yanıtı okunamadı.";
      if(err?.name==="AbortError"){
        detail="Worker yanıtı zaman aşımına uğradı.";
      }
      status(`Haberler alınamadı. ${detail}`);
      finishInitialLoading();
    }
  }
}

function updateClock(){
  const now=new Date();
  document.getElementById("clock-time").textContent=
    now.toLocaleTimeString("tr-TR",{hour:"2-digit",minute:"2-digit"});
  document.getElementById("clock-date").textContent=
    now.toLocaleDateString("tr-TR",{weekday:"long",day:"2-digit",month:"long",year:"numeric"});
}

let cursorHideTimer = null;

function setFullscreenIcon(){
  const btn=document.getElementById("fullscreen-button");
  const active=!!document.fullscreenElement;
  btn.textContent="⤢";
  btn.title=active?"Tam ekrandan çık":"Tam ekran";
  btn.setAttribute("aria-label",btn.title);
}

function showFullscreenButton(){
  const fs=document.getElementById("fullscreen-button");
  const pip=document.getElementById("pip-button");
  const menu=document.getElementById("menu-button");
  const time=document.getElementById("time-range-button");

  fs.classList.add("is-visible");
  pip.classList.add("is-visible");
  menu.classList.add("is-visible");
  time?.classList.add("is-visible");

  clearTimeout(cursorHideTimer);
  cursorHideTimer=setTimeout(()=>{
    const timePanelOpen=
      document.getElementById("time-range-panel")?.classList.contains("open");

    const menuOpen=
      document.getElementById("menu-overlay")?.classList.contains("open");

    if(timePanelOpen || menuOpen)return;

    fs.classList.remove("is-visible");
    pip.classList.remove("is-visible");
    menu.classList.remove("is-visible");
    time?.classList.remove("is-visible");
  },2000);
}

function handlePointerActivity(e){
  if(e.pointerType==="mouse"){
    showFullscreenButton();
  }
}

async function toggleFullscreen(){
  try{
    if(!document.fullscreenElement){
      await document.documentElement.requestFullscreen();
    }else{
      await document.exitFullscreen();
    }
  }catch(err){
    console.error("Fullscreen:",err);
  }
}

window.addEventListener("pointermove",handlePointerActivity,{passive:true});
window.addEventListener("mousemove",showFullscreenButton,{passive:true});


let pipCanvas=null;
let pipVideo=null;
let pipStream=null;
let pipAnimationFrame=null;
let pipAnimationTimer=null;
let pipActive=false;
let pipCurrent=null;
let pipTransition=null;
const pipImageCache=new Map();

function pipSupportMode(){
  const hasCanvasStream=
    typeof HTMLCanvasElement.prototype.captureStream==="function";

  if(!hasCanvasStream)return "none";

  if(
    typeof HTMLVideoElement.prototype.requestPictureInPicture==="function"
  ){
    return "standard";
  }

  const probe=document.createElement("video");

  if(
    typeof probe.webkitSetPresentationMode==="function" &&
    typeof probe.webkitSupportsPresentationMode==="function" &&
    probe.webkitSupportsPresentationMode("picture-in-picture")
  ){
    return "webkit";
  }

  return "none";
}

function pipSupported(){
  return pipSupportMode()!=="none";
}

async function getPiPImage(url){
  if(!url)return null;
  if(pipImageCache.has(url))return pipImageCache.get(url);

  const promise=(async()=>{
    const proxied=
      `${IMAGE_PROXY_API}?url=${encodeURIComponent(url)}`;

    try{
      const r=await fetch(proxied,{
        mode:"cors",
        credentials:"omit",
        cache:"default"
      });

      if(!r.ok)throw new Error("image "+r.status);

      const blob=await r.blob();

      if(typeof createImageBitmap==="function"){
        return await createImageBitmap(blob);
      }

      return await new Promise((resolve,reject)=>{
        const img=new Image();
        const objectUrl=URL.createObjectURL(blob);

        img.onload=()=>{
          URL.revokeObjectURL(objectUrl);
          resolve(img);
        };

        img.onerror=()=>{
          URL.revokeObjectURL(objectUrl);
          reject(new Error("image decode"));
        };

        img.src=objectUrl;
      });
    }catch(e){
      console.warn("PiP image:",e);
      return null;
    }
  })();

  pipImageCache.set(url,promise);
  return promise;
}

function wrapCanvasText(ctx,text,maxWidth,maxLines=3){
  const words=String(text||"").split(/\s+/);
  const lines=[];
  let line="";

  for(const word of words){
    const test=line ? line+" "+word : word;

    if(ctx.measureText(test).width<=maxWidth){
      line=test;
    }else{
      if(line)lines.push(line);
      line=word;
      if(lines.length===maxLines-1)break;
    }
  }

  if(line && lines.length<maxLines)lines.push(line);

  if(
    lines.length===maxLines &&
    words.join(" ").length>lines.join(" ").length
  ){
    let last=lines[maxLines-1];

    while(
      last.length>2 &&
      ctx.measureText(last+"…").width>maxWidth
    ){
      last=last.slice(0,-1);
    }

    lines[maxLines-1]=last.trim()+"…";
  }

  return lines;
}

function drawPiPStory(ctx,story,img,offsetX=0,offsetY=0){
  if(!pipCanvas)return;

  const W=pipCanvas.width;
  const H=pipCanvas.height;

  ctx.save();
  ctx.translate(offsetX,offsetY);
  ctx.beginPath();
  ctx.rect(0,0,W,H);
  ctx.clip();

  ctx.fillStyle="#090909";
  ctx.fillRect(0,0,W,H);

  if(img){
    const iw=img.width||img.videoWidth||W;
    const ih=img.height||img.videoHeight||H;
    const scale=Math.max(W/iw,H/ih);
    const dw=iw*scale;
    const dh=ih*scale;

    ctx.drawImage(
      img,
      (W-dw)/2,
      (H-dh)/2,
      dw,
      dh
    );
  }

  const grad=ctx.createLinearGradient(0,H*.34,0,H);
  grad.addColorStop(0,"rgba(0,0,0,0)");
  grad.addColorStop(1,"rgba(0,0,0,.92)");
  ctx.fillStyle=grad;
  ctx.fillRect(0,0,W,H);

  ctx.textAlign="right";
  ctx.textBaseline="alphabetic";
  ctx.shadowColor="rgba(0,0,0,.65)";
  ctx.shadowBlur=7;

  ctx.font='700 18px "Comfortaa", Arial, sans-serif';
  ctx.fillStyle="rgba(255,255,255,.88)";
  ctx.fillText(story?.flowCategory||"",W-28,H-132);

  ctx.font='700 20px "Comfortaa", Arial, sans-serif';
  ctx.fillStyle="#fff";
  ctx.fillText(story?.source||"",W-28,H-102);

  ctx.font='700 34px "Comfortaa", Arial, sans-serif';
  const lines=wrapCanvasText(
    ctx,
    story?.title||"Flöw",
    W-56,
    2
  );

  let y=H-58-(lines.length-1)*40;

  for(const line of lines){
    ctx.fillText(line,W-28,y);
    y+=40;
  }

  ctx.shadowBlur=0;
  ctx.restore();
}


function drawPiPAd(ctx,item,offsetX=0,offsetY=0){
  if(!pipCanvas || !item)return;

  const W=pipCanvas.width;
  const H=pipCanvas.height;
  const media=item.media;

  ctx.save();
  ctx.translate(offsetX,offsetY);
  ctx.beginPath();
  ctx.rect(0,0,W,H);
  ctx.clip();

  ctx.fillStyle="#000";
  ctx.fillRect(0,0,W,H);

  if(media){
    const iw=
      media.videoWidth ||
      media.naturalWidth ||
      media.width ||
      W;

    const ih=
      media.videoHeight ||
      media.naturalHeight ||
      media.height ||
      H;

    if(iw>0 && ih>0){
      /*
        Tarayıcıdaki reklam görünümü object-fit: contain kullanıyor.
        PiP de aynı davranışı izler.
      */
      const scale=Math.min(W/iw,H/ih);
      const dw=iw*scale;
      const dh=ih*scale;

      try{
        ctx.drawImage(
          media,
          (W-dw)/2,
          (H-dh)/2,
          dw,
          dh
        );
      }catch(e){}
    }
  }

  /*
    Reklam ibaresi PiP içinde de tarayıcıdaki sade görünümü takip eder:
    çerçevesiz, arka plansız, Comfortaa.
  */
  ctx.textAlign="right";
  ctx.textBaseline="top";
  ctx.shadowColor="rgba(0,0,0,.7)";
  ctx.shadowBlur=6;
  ctx.font='700 18px "Comfortaa", Arial, sans-serif';
  ctx.fillStyle="rgba(255,255,255,.78)";
  ctx.fillText("Reklam",W-24,22);
  ctx.shadowBlur=0;

  ctx.restore();
}

function drawPiPItem(ctx,item,offsetX=0,offsetY=0){
  if(!item)return;

  if(item.kind==="ad"){
    drawPiPAd(
      ctx,
      item,
      offsetX,
      offsetY
    );
    return;
  }

  drawPiPStory(
    ctx,
    item.story,
    item.image,
    offsetX,
    offsetY
  );
}

function pipVector(direction,dir){
  const forward=dir>0;
  const sign=forward?1:-1;

  switch(direction){
    case "down":
      return {x:0,y:-sign};
    case "left":
      return {x:sign,y:0};
    case "right":
      return {x:-sign,y:0};
    case "up":
    default:
      return {x:0,y:sign};
  }
}

function easePiP(t){
  return 1-Math.pow(1-t,3);
}

function drawPiPScene(now=performance.now()){
  if(!pipCanvas)return;

  const ctx=pipCanvas.getContext("2d");
  const W=pipCanvas.width;
  const H=pipCanvas.height;

  if(pipTransition){
    const duration=700;
    const raw=Math.min(
      1,
      Math.max(0,(now-pipTransition.startedAt)/duration)
    );
    const p=easePiP(raw);
    const vector=pipTransition.vector;

    const newX=vector.x*W*(1-p);
    const newY=vector.y*H*(1-p);
    const oldX=-vector.x*W*p;
    const oldY=-vector.y*H*p;

    ctx.clearRect(0,0,W,H);

    drawPiPItem(
      ctx,
      pipTransition.from,
      oldX,
      oldY
    );

    drawPiPItem(
      ctx,
      pipTransition.to,
      newX,
      newY
    );

    if(raw>=1){
      pipCurrent=pipTransition.to;
      pipTransition=null;
    }
  }else if(pipCurrent){
    ctx.clearRect(0,0,W,H);
    drawPiPItem(
      ctx,
      pipCurrent
    );
  }else{
    ctx.fillStyle="#090909";
    ctx.fillRect(0,0,W,H);
  }
}

function stopPiPRenderLoop(){
  if(pipAnimationFrame){
    cancelAnimationFrame(pipAnimationFrame);
    pipAnimationFrame=null;
  }

  if(pipAnimationTimer){
    clearTimeout(pipAnimationTimer);
    pipAnimationTimer=null;
  }
}

function schedulePiPRender(){
  stopPiPRenderLoop();

  const tick=()=>{
    if(!pipActive)return;

    drawPiPScene();

    const liveAdVideo=
      pipCurrent?.kind==="ad" &&
      pipCurrent?.ad?.type==="video" &&
      pipCurrent?.media &&
      !pipCurrent.media.paused &&
      !pipCurrent.media.ended;

    if(pipTransition || liveAdVideo){
      pipAnimationFrame=requestAnimationFrame(tick);
    }else{
      pipAnimationTimer=setTimeout(tick,500);
    }
  };

  pipAnimationFrame=requestAnimationFrame(tick);
}

async function preparePiPStory(story){
  if(!story)return null;

  const loadedImage=story.image
    ? await getPiPImage(story.image)
    : null;

  const image=
    loadedImage ||
    pipCurrent?.image ||
    null;

  return {
    kind:"story",
    story,
    image
  };
}


async function preparePiPAd(ad){
  if(!ad)return null;

  let media=null;

  if(ad.type==="video"){
    if(
      adVideo &&
      !adVideo.hidden &&
      adVideo.readyState>=2
    ){
      media=adVideo;
    }
  }else{
    if(
      adImage &&
      !adImage.hidden &&
      adImage.complete &&
      adImage.naturalWidth>0
    ){
      media=adImage;
    }

    /*
      Normal reklam görseli henüz DOM nesnesinden alınamıyorsa PiP için
      Worker image proxy üzerinden güvenli bir kopya hazırlamayı dene.
    */
    if(!media && ad.src){
      media=await getPiPImage(ad.src);
    }
  }

  return {
    kind:"ad",
    ad,
    media
  };
}

async function setPiPInitialAd(ad){
  const prepared=await preparePiPAd(ad);
  if(!prepared)return;

  pipCurrent=prepared;
  pipTransition=null;
  drawPiPScene();
}

async function startPiPAdTransition(ad,dir=1){
  if(!pipActive || !ad)return;

  const to=await preparePiPAd(ad);

  if(!pipActive || !to)return;

  let from=pipCurrent;

  if(!from){
    from=await preparePiPStory(
      state.stories[state.index]
    );
  }

  if(!from){
    pipCurrent=to;
    pipTransition=null;
    schedulePiPRender();
    return;
  }

  pipTransition={
    from,
    to,
    vector:pipVector(
      transitionDirection,
      dir
    ),
    startedAt:performance.now()
  };

  schedulePiPRender();
}

async function setPiPInitialStory(story){
  const prepared=await preparePiPStory(story);
  if(!prepared)return;

  pipCurrent=prepared;
  pipTransition=null;
  drawPiPScene();
}

async function startPiPTransition(fromStory,toStory,dir){
  if(!pipActive || !toStory)return;

  const to=await preparePiPStory(toStory);

  if(!pipActive || !to)return;

  let from=pipCurrent;

  /*
    Reklam PiP'te görünüyorsa çıkış geçişinin "from" tarafı reklamın kendisidir.
    Haber -> haber geçişlerinde ise eski doğrulama davranışı korunur.
  */
  if(
    !from ||
    (
      from.kind!=="ad" &&
      mediaKey(from.story)!==mediaKey(fromStory)
    )
  ){
    from=await preparePiPStory(fromStory);
  }

  if(!from){
    pipCurrent=to;
    pipTransition=null;
    schedulePiPRender();
    return;
  }

  pipTransition={
    from,
    to,
    vector:pipVector(
      transitionDirection,
      dir
    ),
    startedAt:performance.now()
  };

  schedulePiPRender();
}

async function ensurePiPVideo(){
  if(!pipCanvas){
    pipCanvas=document.createElement("canvas");
    pipCanvas.width=960;
    pipCanvas.height=540;
  }

  if(pipVideo)return pipVideo;

  pipVideo=document.createElement("video");
  pipVideo.muted=true;
  pipVideo.defaultMuted=true;
  pipVideo.volume=0;
  pipVideo.autoplay=true;
  pipVideo.playsInline=true;
  pipVideo.disablePictureInPicture=false;
  pipVideo.setAttribute("playsinline","");
  pipVideo.setAttribute("webkit-playsinline","");
  pipVideo.setAttribute("aria-hidden","true");
  pipVideo.style.position="fixed";
  pipVideo.style.width="2px";
  pipVideo.style.height="2px";
  pipVideo.style.opacity=".01";
  pipVideo.style.pointerEvents="none";
  pipVideo.style.right="0";
  pipVideo.style.bottom="0";
  pipVideo.style.zIndex="-1";

  document.body.appendChild(pipVideo);

  pipStream=pipCanvas.captureStream(30);
  pipVideo.srcObject=pipStream;

  pipVideo.addEventListener(
    "leavepictureinpicture",
    ()=>{
      pipActive=false;
      stopPiPRenderLoop();
    }
  );

  pipVideo.addEventListener(
    "webkitpresentationmodechanged",
    ()=>{
      const active=
        pipVideo.webkitPresentationMode==="picture-in-picture";

      pipActive=active;

      if(active){
        schedulePiPRender();
      }else{
        stopPiPRenderLoop();
      }
    }
  );

  return pipVideo;
}

async function exitPiP(){
  if(
    document.pictureInPictureElement &&
    typeof document.exitPictureInPicture==="function"
  ){
    await document.exitPictureInPicture();
    return true;
  }

  if(
    pipVideo &&
    pipVideo.webkitPresentationMode==="picture-in-picture" &&
    typeof pipVideo.webkitSetPresentationMode==="function"
  ){
    pipVideo.webkitSetPresentationMode("inline");
    return true;
  }

  return false;
}

async function togglePiP(){
  const mode=pipSupportMode();

  if(mode==="none"){
    status(
      "Bu tarayıcı web sayfasından başlatılan Picture-in-Picture özelliğini desteklemiyor. Tarayıcının kendi video PiP kontrolü varsa onu kullanabilirsiniz."
    );
    return;
  }

  try{
    if(await exitPiP())return;

    const video=await ensurePiPVideo();
    const story=state.stories[state.index];

    if(adActive && adHasEntered && currentAd){
      await setPiPInitialAd(currentAd);
    }else{
      await setPiPInitialStory(story);
    }

    await video.play();

    if(mode==="standard"){
      await video.requestPictureInPicture();
      pipActive=true;
      schedulePiPRender();
      return;
    }

    if(mode==="webkit"){
      video.webkitSetPresentationMode("picture-in-picture");
      pipActive=true;
      schedulePiPRender();
    }
  }catch(err){
    console.error("Video PiP:",err);
    pipActive=false;
    stopPiPRenderLoop();

    status(
      "Picture-in-Picture açılamadı. Tarayıcı bu oturumda PiP isteğine izin vermedi."
    );
  }
}



function renderTimeRangeControl(){
  const option=currentTimeRangeOption();
  const current=document.getElementById("time-range-current");
  const trigger=document.getElementById("time-range-button");

  if(current)current.textContent=option.label;

  if(trigger){
    trigger.title=`Zaman aralığı: ${option.label}`;
    trigger.setAttribute("aria-label",trigger.title);
  }

  document.querySelectorAll(".time-range-option").forEach(button=>{
    const active=button.dataset.hours===option.value;
    button.classList.toggle("active",active);
    button.setAttribute("aria-pressed",active?"true":"false");
  });
}

function setTimeRange(value){
  const next=normalizeTimeRangeValue(value);
  if(next===timeRangeValue)return;

  timeRangeValue=next;
  saveTimeRange();
  renderTimeRangeControl();

  /*
    Kaynak/kategori filtrelerinde olduğu gibi applyFilters kullanılır.
    Böylece dar bir zaman aralığı yüzünden kaybolan mevcut haber, aralık
    yeniden genişletildiğinde kullanıcı başka habere geçmediyse geri gelir.
  */
  applyFilters();
}

function renderDurationSetting(){
  const value=document.getElementById("duration-value");
  const minus=document.getElementById("duration-minus");
  const plus=document.getElementById("duration-plus");

  if(value)value.textContent=`${showDurationSeconds} sn`;
  if(minus)minus.disabled=showDurationSeconds<=5;
  if(plus)plus.disabled=showDurationSeconds>=60;
}

function setShowDuration(value){
  const next=Math.min(
    60,
    Math.max(5,Math.round(Number(value)||DEFAULT_SHOW_SECONDS))
  );

  if(next===showDurationSeconds)return;

  showDurationSeconds=next;
  saveShowDuration();
  renderDurationSetting();

  if(state.stories.length){
    timer();
  }
}

document.getElementById("duration-minus")?.addEventListener("click",e=>{
  e.stopPropagation();
  setShowDuration(showDurationSeconds-1);
});

document.getElementById("duration-plus")?.addEventListener("click",e=>{
  e.stopPropagation();
  setShowDuration(showDurationSeconds+1);
});

renderDurationSetting();
renderTimeRangeControl();

document.querySelectorAll(".time-range-option").forEach(button=>{
  button.addEventListener("pointerdown",e=>e.stopPropagation());
  button.addEventListener("pointerup",e=>e.stopPropagation());
  button.addEventListener("click",e=>{
    e.stopPropagation();
    setTimeRange(button.dataset.hours||"all");
  });
});


function showCookieNoticeIfNeeded(){
  try{
    if(localStorage.getItem(COOKIE_NOTICE_KEY)==="dismissed")return;
  }catch(e){}

  const notice=document.getElementById("cookie-notice");
  if(notice)notice.hidden=false;
}

function dismissCookieNotice(){
  const notice=document.getElementById("cookie-notice");
  if(notice)notice.hidden=true;

  try{
    localStorage.setItem(COOKIE_NOTICE_KEY,"dismissed");
  }catch(e){}
}

document.getElementById("cookie-close")?.addEventListener("pointerdown",e=>e.stopPropagation());
document.getElementById("cookie-close")?.addEventListener("pointerup",e=>e.stopPropagation());
document.getElementById("cookie-close")?.addEventListener("click",e=>{
  e.stopPropagation();
  dismissCookieNotice();
});


const WEATHER_GEOCODING_API="https://geocoding-api.open-meteo.com/v1/search";
const WEATHER_FORECAST_API="https://api.open-meteo.com/v1/forecast";
const WEATHER_REFRESH_MS=15*60*1000;
let weatherRefreshTimer=null;
let weatherInitialized=false;

function weatherSymbol(code,isDay=true){
  const c=Number(code);

  if(c===0)return isDay?"☀":"☾";
  if(c===1||c===2)return isDay?"◐":"☁";
  if(c===3)return "☁";
  if(c===45||c===48)return "≋";
  if([51,53,55,56,57].includes(c))return "☂";
  if([61,63,65,66,67,80,81,82].includes(c))return "☂";
  if([71,73,75,77,85,86].includes(c))return "❄";
  if([95,96,99].includes(c))return "⚡";
  return "◌";
}

function renderWeatherUnitOptions(){
  document.querySelectorAll(".weather-unit-option").forEach(btn=>{
    const active=btn.dataset.unit===weatherPreferences.unit;
    btn.classList.toggle("active",active);
    btn.setAttribute("aria-pressed",active?"true":"false");
  });
}

function renderWeatherInput(){
  const input=document.getElementById("weather-city");
  if(input)input.value=weatherPreferences.city||"İstanbul";
  renderWeatherUnitOptions();
}

function setWeatherFeedback(message="",stateName=""){
  const el=document.getElementById("weather-feedback");
  if(!el)return;
  el.textContent=message;
  el.dataset.state=stateName;
}

async function geocodeWeatherCity(city){
  const q=String(city||"").trim();
  if(!q)throw new Error("Şehir adı girin.");

  const controller=new AbortController();
  const timeout=setTimeout(()=>controller.abort(),8000);

  try{
    const url=
      `${WEATHER_GEOCODING_API}?name=${encodeURIComponent(q)}&count=5&language=tr&format=json`;

    const response=await fetch(url,{
      method:"GET",
      mode:"cors",
      credentials:"omit",
      cache:"default",
      signal:controller.signal,
      headers:{"Accept":"application/json"}
    });

    if(!response.ok){
      throw new Error(`Konum HTTP ${response.status}`);
    }

    const data=await response.json();
    const results=Array.isArray(data?.results)
      ? data.results.filter(item=>
          Number.isFinite(Number(item.latitude)) &&
          Number.isFinite(Number(item.longitude))
        )
      : [];

    if(!results.length){
      throw new Error("Şehir bulunamadı.");
    }

    results.sort(
      (a,b)=>(Number(b.population)||0)-(Number(a.population)||0)
    );

    const place=results[0];

    return {
      city:String(place.name||q),
      label:[
        place.name,
        place.admin1 && place.admin1!==place.name
          ? place.admin1
          : ""
      ].filter(Boolean).join(", ") || String(place.name||q),
      lat:Number(place.latitude),
      lon:Number(place.longitude)
    };
  }finally{
    clearTimeout(timeout);
  }
}

async function ensureWeatherCoordinates(){
  if(
    Number.isFinite(weatherPreferences.lat) &&
    Number.isFinite(weatherPreferences.lon)
  ){
    return;
  }

  const place=await geocodeWeatherCity(
    weatherPreferences.city||"İstanbul"
  );

  weatherPreferences={
    ...weatherPreferences,
    ...place
  };

  saveWeatherPreferences();
  renderWeatherInput();
}

async function fetchCurrentWeather(){
  try{
    await ensureWeatherCoordinates();

    const controller=new AbortController();
    const timeout=setTimeout(()=>controller.abort(),8000);

    try{
      const params=new URLSearchParams({
        latitude:String(weatherPreferences.lat),
        longitude:String(weatherPreferences.lon),
        current:"temperature_2m,weather_code,is_day",
        temperature_unit:weatherPreferences.unit,
        timezone:"auto"
      });

      const response=await fetch(
        `${WEATHER_FORECAST_API}?${params.toString()}`,
        {
          method:"GET",
          mode:"cors",
          credentials:"omit",
          cache:"no-store",
          signal:controller.signal,
          headers:{"Accept":"application/json"}
        }
      );

      if(!response.ok){
        throw new Error(`Hava HTTP ${response.status}`);
      }

      const data=await response.json();
      const current=data?.current;

      if(
        !current ||
        !Number.isFinite(Number(current.temperature_2m))
      ){
        throw new Error("Hava durumu alınamadı.");
      }

      const box=document.getElementById("weather-current");
      const icon=document.getElementById("weather-icon");
      const temp=document.getElementById("weather-temp");
      const city=document.getElementById("weather-city-label");

      if(icon){
        icon.textContent=weatherSymbol(
          current.weather_code,
          Number(current.is_day)!==0
        );
      }

      if(temp){
        const unit=weatherPreferences.unit==="fahrenheit"
          ? "°F"
          : "°C";

        temp.textContent=
          `${Math.round(Number(current.temperature_2m))}${unit}`;
      }

      if(city){
        city.textContent=
          weatherPreferences.label||
          weatherPreferences.city;
      }

      if(box)box.hidden=false;

      setWeatherFeedback(
        `${weatherPreferences.label||weatherPreferences.city} için hava durumu güncellendi.`,
        "ok"
      );
    }finally{
      clearTimeout(timeout);
    }
  }catch(err){
    console.warn("Weather:",err);

    setWeatherFeedback(
      err?.name==="AbortError"
        ? "Hava durumu isteği zaman aşımına uğradı."
        : (err?.message||"Hava durumu alınamadı."),
      "error"
    );
  }
}

async function applyWeatherCity(){
  const input=document.getElementById("weather-city");
  const query=String(input?.value||"").trim();

  if(!query){
    setWeatherFeedback("Şehir adı girin.","error");
    return;
  }

  setWeatherFeedback("Şehir aranıyor...","loading");

  try{
    const place=await geocodeWeatherCity(query);

    weatherPreferences={
      ...weatherPreferences,
      ...place
    };

    saveWeatherPreferences();
    renderWeatherInput();
    await fetchCurrentWeather();
  }catch(err){
    console.warn("Weather city:",err);

    setWeatherFeedback(
      err?.name==="AbortError"
        ? "Şehir araması zaman aşımına uğradı."
        : (err?.message||"Şehir bulunamadı."),
      "error"
    );
  }
}

function initWeather(){
  if(weatherInitialized)return;
  weatherInitialized=true;

  renderWeatherInput();

  document.getElementById("weather-apply")?.addEventListener("click",e=>{
    e.stopPropagation();
    applyWeatherCity();
  });

  document.getElementById("weather-city")?.addEventListener("keydown",e=>{
    if(e.key==="Enter"){
      e.preventDefault();
      e.stopPropagation();
      applyWeatherCity();
    }
  });

  document.querySelectorAll(".weather-unit-option").forEach(btn=>{
    btn.addEventListener("click",async e=>{
      e.stopPropagation();

      const unit=btn.dataset.unit==="fahrenheit"
        ? "fahrenheit"
        : "celsius";

      if(unit===weatherPreferences.unit)return;

      weatherPreferences.unit=unit;
      saveWeatherPreferences();
      renderWeatherUnitOptions();
      await fetchCurrentWeather();
    });
  });

  fetchCurrentWeather();

  if(weatherRefreshTimer){
    clearInterval(weatherRefreshTimer);
  }

  weatherRefreshTimer=setInterval(
    fetchCurrentWeather,
    WEATHER_REFRESH_MS
  );
}

/*
  Çerez ve hava durumu başlangıç haber yüklemesinden tamamen ayrıdır.
  Böylece harici hava servisi yavaşlasa veya hata verse bile haber yükleme
  akışını etkileyemez.
*/
window.addEventListener("floew:ready",()=>{
  showCookieNoticeIfNeeded();
  initWeather();
},{once:true});

function renderDirectionOptions(){
  document.querySelectorAll(".direction-option").forEach(btn=>{
    const active=btn.dataset.direction===transitionDirection;
    btn.classList.toggle("active",active);
    btn.setAttribute("aria-pressed",active?"true":"false");
  });
}

document.querySelectorAll(".direction-option").forEach(btn=>{
  btn.addEventListener("click",e=>{
    e.stopPropagation();
    transitionDirection=btn.dataset.direction||"up";
    savePreferences();
    renderDirectionOptions();
  });
});

renderDirectionOptions();
renderVideoSetting();

document.getElementById("video-setting")?.addEventListener("click",e=>{
  e.stopPropagation();
  videoEnabled=!videoEnabled;
  savePreferences();
  applyVideoSetting();
});

function openTimeRangePanel(){
  closeMenu();

  const panel=document.getElementById("time-range-panel");
  panel?.classList.add("open");
  panel?.setAttribute("aria-hidden","false");

  renderTimeRangeControl();
  showFullscreenButton();
}

function closeTimeRangePanel(){
  const panel=document.getElementById("time-range-panel");
  panel?.classList.remove("open");
  panel?.setAttribute("aria-hidden","true");
}

function toggleTimeRangePanel(){
  const panel=document.getElementById("time-range-panel");
  if(!panel)return;

  if(panel.classList.contains("open")){
    closeTimeRangePanel();
  }else{
    openTimeRangePanel();
  }
}

function openMenu(){
  closeTimeRangePanel();

  const overlay=document.getElementById("menu-overlay");
  overlay.classList.add("open");
  overlay.setAttribute("aria-hidden","false");
  showFullscreenButton();
}

function closeMenu(){
  const overlay=document.getElementById("menu-overlay");
  overlay.classList.remove("open");
  overlay.setAttribute("aria-hidden","true");
}

document.getElementById("menu-button").addEventListener("pointerdown",e=>e.stopPropagation());
document.getElementById("menu-button").addEventListener("pointerup",e=>e.stopPropagation());
document.getElementById("menu-button").addEventListener("click",e=>{
  e.stopPropagation();
  openMenu();
});

document.getElementById("time-range-button")?.addEventListener("pointerdown",e=>e.stopPropagation());
document.getElementById("time-range-button")?.addEventListener("pointerup",e=>e.stopPropagation());
document.getElementById("time-range-button")?.addEventListener("click",e=>{
  e.stopPropagation();
  toggleTimeRangePanel();
});

document.getElementById("time-range-panel")?.addEventListener("pointerdown",e=>e.stopPropagation());
document.getElementById("time-range-panel")?.addEventListener("pointerup",e=>e.stopPropagation());
document.getElementById("time-range-panel")?.addEventListener("click",e=>e.stopPropagation());

document.getElementById("menu-close").addEventListener("click",closeMenu);

document.getElementById("menu-overlay").addEventListener("click",e=>{
  if(e.target.id==="menu-overlay")closeMenu();
});

document.querySelectorAll(".menu-tab").forEach(tab=>{
  tab.addEventListener("click",()=>{
    document.querySelectorAll(".menu-tab").forEach(x=>x.classList.remove("active"));
    document.querySelectorAll(".menu-panel").forEach(x=>x.classList.remove("active"));
    tab.classList.add("active");
    document.querySelector(`[data-panel="${tab.dataset.tab}"]`).classList.add("active");
  });
});


document.querySelectorAll(".source-link").forEach(link=>{
  link.addEventListener("pointerdown",e=>e.stopPropagation());
  link.addEventListener("pointerup",e=>e.stopPropagation());
  link.addEventListener("click",e=>e.stopPropagation());
});

document.addEventListener("keydown",e=>{
  if(e.key==="Escape"){
    closeMenu();
    closeTimeRangePanel();
  }
});

document.getElementById("pip-button").addEventListener("pointerdown",e=>{
  e.stopPropagation();
});
document.getElementById("pip-button").addEventListener("pointerup",e=>{
  e.stopPropagation();
});
document.getElementById("pip-button").addEventListener("click",e=>{
  e.stopPropagation();
  togglePiP();
});

document.getElementById("fullscreen-button").addEventListener("pointerdown",e=>{
  e.stopPropagation();
});
document.getElementById("fullscreen-button").addEventListener("pointerup",e=>{
  e.stopPropagation();
});
document.getElementById("fullscreen-button").addEventListener("click",e=>{
  e.stopPropagation();
  toggleFullscreen();
});
document.addEventListener("fullscreenchange",setFullscreenIcon);

window.addEventListener("wheel",e=>{
  if(e.target.closest && e.target.closest("#fullscreen-button"))return;
  if(e.target.closest && e.target.closest("#menu-button"))return;
  if(e.target.closest && e.target.closest("#time-range-button"))return;
  if(e.target.closest && e.target.closest("#time-range-panel"))return;
  if(e.target.closest && e.target.closest("#pip-button"))return;
  if(e.target.closest && e.target.closest("#menu-overlay"))return;
  e.preventDefault();
  if(Math.abs(e.deltaY)>=5)move(e.deltaY>0?1:-1);
},{passive:false});

window.addEventListener("keydown",e=>{
  const menuOpen=
    document.getElementById("menu-overlay")?.classList.contains("open");

  const timeOpen=
    document.getElementById("time-range-panel")?.classList.contains("open");

  if(menuOpen || timeOpen)return;

  if(e.key==="ArrowDown"||e.key==="PageDown"){e.preventDefault();move(1)}
  else if(e.key==="ArrowUp"||e.key==="PageUp"){e.preventDefault();move(-1)}
  else if(e.key==="f"||e.key==="F"){toggleFullscreen()}
});

window.addEventListener("pointerdown",e=>{
  if(e.button!==0)return;
  if(e.target.closest && e.target.closest("#fullscreen-button"))return;
  if(e.target.closest && e.target.closest("#menu-button"))return;
  if(e.target.closest && e.target.closest("#time-range-button"))return;
  if(e.target.closest && e.target.closest("#time-range-panel"))return;
  if(e.target.closest && e.target.closest("#pip-button"))return;
  if(e.target.closest && e.target.closest("#menu-overlay"))return;
  state.x=e.clientX;state.y=e.clientY;state.t=performance.now();
});

window.addEventListener("pointerup",e=>{
  if(e.button!==0)return;
  if(document.getElementById("menu-overlay").classList.contains("open"))return;
  if(e.target.closest && e.target.closest("#fullscreen-button"))return;
  if(e.target.closest && e.target.closest("#menu-button"))return;
  if(e.target.closest && e.target.closest("#time-range-button"))return;
  if(e.target.closest && e.target.closest("#time-range-panel"))return;
  if(e.target.closest && e.target.closest("#pip-button"))return;
  if(e.target.closest && e.target.closest("#menu-overlay"))return;

  const timePanel=document.getElementById("time-range-panel");
  if(timePanel?.classList.contains("open")){
    closeTimeRangePanel();
    return;
  }

  const dx=e.clientX-state.x;
  const dy=e.clientY-state.y;
  const dt=performance.now()-state.t;

  if(Math.abs(dy)>=SWIPE&&Math.abs(dy)>=Math.abs(dx)&&dt<=1000){
    move(dy<0?1:-1);
  }else if(dt<=1000&&Math.abs(dx)<10&&Math.abs(dy)<10){
    move(1);
  }
});

window.addEventListener("dragstart",e=>e.preventDefault());

window.addEventListener(
  "resize",
  refreshAdsLayoutIfNeeded,
  {passive:true}
);

window.addEventListener(
  "orientationchange",
  refreshAdsLayoutIfNeeded,
  {passive:true}
);

updateClock();
setInterval(updateClock,1000);

if(new URLSearchParams(location.search).get("pip")==="1"){
  document.body.classList.add("pip-mode");
}
window.FloewAds={
  refresh:()=>loadAdsCatalog(),
  status:()=>({
    version:window.__floewAppVersion,
    testMode:ADS_TEST_MODE,
    interval:ADS_INTERVAL_NEWS,
    newsShownSinceAd,
    adActive,
    layout:getAdsLayout(),
    catalogLayout:adCatalogLayout,
    catalog:adCatalog.map(item=>({
      name:item.name,
      type:item.type,
      src:item.src
    }))
  }),
  test:async()=>{
    await loadAdsCatalog();
    const result=await playAdBreak();

    if(!result?.shown)return false;

    if(result.direction<0){
      await transitionAdBackToCurrent(-1);
    }else{
      await move(1,{skipAd:true,fromAd:true});
    }

    return true;
  }
};

async function runAdTestOnce(){
  if(!ADS_TEST_MODE || adTestRan)return;
  if(!state.stories.length)return;

  adTestRan=true;
  clearTimeout(state.timer);

  await loadAdsCatalog();

  if(!adCatalog.length){
    status(
      "Reklam testi: Worker ads/ dizininde desteklenen reklam bulamadı."
    );
    timer();
    return;
  }

  status(
    `Reklam testi: ${adCatalog.length} dosya bulundu. Reklam oynatılıyor...`
  );

  await new Promise(resolve=>setTimeout(resolve,700));
  clearStatus();

  const result=await playAdBreak();

  if(!result?.shown){
    status(
      "Reklam testi: dosya listelendi ancak medya yüklenemedi."
    );
    timer();
    return;
  }

  if(result.direction<0){
    await transitionAdBackToCurrent(-1);
  }else{
    await move(1,{skipAd:true,fromAd:true});
  }
}

setFullscreenIcon();
startAdsCatalogRefresh();
load();
setInterval(load,REFRESH_MS);

if(window.__floewInitialReady){
  showCookieNoticeIfNeeded();
  initWeather();
}

document.getElementById("status-close")?.addEventListener("click", function(e){
  e.stopPropagation();
  clearStatus();
});
