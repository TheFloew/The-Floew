const API="https://thefloew.thefloewback.workers.dev/news";
const VIDEO_API="https://thefloew.thefloewback.workers.dev/video";
const META_API="https://thefloew.thefloewback.workers.dev/meta";
const IMAGE_PROXY_API="https://thefloew.thefloewback.workers.dev/image";
const NEWS_BATCH_COUNT=4;
const SHOW_MS=10000;
const REFRESH_MS=120000;
const SWIPE=70;

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

function normalizeText(v){
  return String(v||"")
    .toLocaleLowerCase("tr-TR")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g,"");
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

function activeStories(){
  return rawStories.filter(s=>
    filters.sources.has(sourceKey(s.source)) &&
    (
      filters.categories.has(s.flowCategory) ||
      (s.flowBreaking && filters.categories.has("#SonDakika"))
    )
  );
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
  const currentLink=state.stories[state.index]?.link;
  const list=activeStories();

  renderOptions();

  if(!list.length){
    status("Seçtiğiniz kaynak ve kategorilerde haber bulunamadı.");
    return;
  }

  clearStatus();
  state.stories=list;

  let idx=currentLink ? list.findIndex(x=>x.link===currentLink) : -1;
  if(idx<0){
    idx=0;
    state.index=0;
    state.history=[0];
    state.historyPos=0;
    fill(slides[state.active],list[0]);
    slides[state.active].className="slide active";
  }else{
    state.index=idx;
    state.history=[idx];
    state.historyPos=0;
  }

  timer();
}


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

function showEmbedVideo(el,story,media,token){
  const image=el.querySelector(".slide-image");
  const embed=el.querySelector(".slide-embed");

  if(!embed || !media?.url)return;

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

  embed.src=media.url;
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

function timer(){
  clearTimeout(state.timer);
  state.timer=setTimeout(()=>move(1),SHOW_MS);
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

async function move(dir){
  if(state.busy||state.stories.length<2)return;

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
    Böylece ileri/geri arasında deterministik gezinme olur.
  */
  if(state.historyPos < state.history.length-1){
    const target=
      state.history[state.historyPos+1];

    await transitionTo(target,true,dir);

    state.historyPos++;

    return;
  }

  const next=chooseForward();

  if(next<0)return;

  await transitionTo(next,false,dir);

  state.history.push(next);
  state.historyPos=state.history.length-1;
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
  const forward=dir>0;
  const directionMap={
    up:    forward ? ["enter-up","exit-up"]       : ["enter-down","exit-down"],
    down:  forward ? ["enter-down","exit-down"]   : ["enter-up","exit-up"],
    left:  forward ? ["enter-left","exit-left"]   : ["enter-right","exit-right"],
    right: forward ? ["enter-right","exit-right"] : ["enter-left","exit-left"]
  };
  const [enterClass,exitClass]=directionMap[transitionDirection]||directionMap.up;

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
    for(const item of successful){
      if(!item||!item.title||!item.image)continue;
      const key=item.link||`${item.source||""}|${item.title}`;
      if(!unique.has(key))unique.set(key,item);
    }

    const incoming=[...unique.values()];

    if(!incoming.length){
      const firstError=failures[0]?.result?.reason;
      throw firstError||new Error("Görselli haber yok");
    }

    rawStories=enrichStories(incoming);

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
      return;
    }

    if(!state.stories.length){
      state.stories=list;
      state.index=0;
      state.history=[0];
      state.historyPos=0;
      fill(slides[0],list[0]);
      slides[0].className="slide active";
      clearStatus();
      timer();
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
  }catch(err){
    console.error("NEWS WALL:",err);

    if(!state.stories.length){
      let detail=err?.message||"Worker yanıtı okunamadı.";
      if(err?.name==="AbortError"){
        detail="Worker yanıtı zaman aşımına uğradı.";
      }
      status(`Haberler alınamadı. ${detail}`);
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
  fs.classList.add("is-visible");
  pip.classList.add("is-visible");
  menu.classList.add("is-visible");
  clearTimeout(cursorHideTimer);
  cursorHideTimer=setTimeout(()=>{
    fs.classList.remove("is-visible");
    pip.classList.remove("is-visible");
    menu.classList.remove("is-visible");
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

    drawPiPStory(
      ctx,
      pipTransition.from.story,
      pipTransition.from.image,
      oldX,
      oldY
    );

    drawPiPStory(
      ctx,
      pipTransition.to.story,
      pipTransition.to.image,
      newX,
      newY
    );

    if(raw>=1){
      pipCurrent=pipTransition.to;
      pipTransition=null;
    }
  }else if(pipCurrent){
    ctx.clearRect(0,0,W,H);
    drawPiPStory(
      ctx,
      pipCurrent.story,
      pipCurrent.image
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

    if(pipTransition){
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

  return {story,image};
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

  if(
    !from ||
    mediaKey(from.story)!==mediaKey(fromStory)
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

    await setPiPInitialStory(story);
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

function openMenu(){
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
  if(e.key==="Escape")closeMenu();
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
  if(e.target.closest && e.target.closest("#pip-button"))return;
  if(e.target.closest && e.target.closest("#menu-overlay"))return;
  e.preventDefault();
  if(Math.abs(e.deltaY)>=5)move(e.deltaY>0?1:-1);
},{passive:false});

window.addEventListener("keydown",e=>{
  if(e.key==="ArrowDown"||e.key==="PageDown"){e.preventDefault();move(1)}
  else if(e.key==="ArrowUp"||e.key==="PageUp"){e.preventDefault();move(-1)}
  else if(e.key==="f"||e.key==="F"){toggleFullscreen()}
});

window.addEventListener("pointerdown",e=>{
  if(e.button!==0)return;
  if(e.target.closest && e.target.closest("#fullscreen-button"))return;
  if(e.target.closest && e.target.closest("#menu-button"))return;
  if(e.target.closest && e.target.closest("#menu-overlay"))return;
  state.x=e.clientX;state.y=e.clientY;state.t=performance.now();
});

window.addEventListener("pointerup",e=>{
  if(e.button!==0)return;
  if(document.getElementById("menu-overlay").classList.contains("open"))return;
  if(e.target.closest && e.target.closest("#fullscreen-button"))return;
  if(e.target.closest && e.target.closest("#menu-button"))return;
  if(e.target.closest && e.target.closest("#menu-overlay"))return;

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

updateClock();
setInterval(updateClock,1000);

if(new URLSearchParams(location.search).get("pip")==="1"){
  document.body.classList.add("pip-mode");
}
setFullscreenIcon();
load();
setInterval(load,REFRESH_MS);

document.getElementById("status-close")?.addEventListener("click", function(e){
  e.stopPropagation();
  clearStatus();
});
