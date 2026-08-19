/* ========================================================================
   FLÖW FEEDBACK — v1.1.0
   Self-contained feedback flow for the existing "Flöw hakkında" report tab.
   Requires app.js to be loaded first. No Worker change is required: submissions
   use the existing /track endpoint and are stored as feedback_submit events.
   ======================================================================== */
(function(){
  "use strict";

  const FEEDBACK_VERSION="1.1.0";
  const TRACK_ENDPOINT="https://thefloew.thefloewback.workers.dev/track";
  const MAX_NOTE_LENGTH=1600;

  const FALLBACK_CATEGORIES=[
    "#SonDakika","#Türkiye","#Dünya","#Siyaset","#Ekonomi","#Spor",
    "#Yaşam","#Magazin","#Teknoloji","#Kültür-Sanat","#Sinema",
    "#Otomotiv","#Edebiyat","#Müzik","#Televizyon"
  ];

  const stateLocal={
    current:"topic",
    history:[],
    answers:{},
    context:null,
    submitting:false,
    sent:false,
    timerWasRunning:false,
    flowFrozen:false
  };

  const $=(selector,root=document)=>root.querySelector(selector);
  const $$=(selector,root=document)=>Array.from(root.querySelectorAll(selector));

  function escapeHtml(value){
    return String(value??"")
      .replace(/&/g,"&amp;")
      .replace(/</g,"&lt;")
      .replace(/>/g,"&gt;")
      .replace(/"/g,"&quot;")
      .replace(/'/g,"&#039;");
  }

  function currentStory(){
    try{
      if(typeof state!=="undefined" && state?.stories?.length){
        return state.stories[state.index]||null;
      }
    }catch(e){}
    return null;
  }

  function storyPayload(story){
    if(!story)return null;
    try{
      if(typeof telemetryStoryPayload==="function"){
        return telemetryStoryPayload(story);
      }
    }catch(e){}

    return {
      key:String(story?.id||story?.guid||story?.link||""),
      title:String(story?.title||""),
      source:String(story?.source||""),
      category:String(story?.flowCategory||story?.category||""),
      link:String(story?.link||""),
      published:String(story?.published||"")
    };
  }

  function browserName(){
    try{
      if(typeof detectBrowser==="function")return String(detectBrowser()||"");
    }catch(e){}
    const ua=navigator.userAgent||"";
    if(/Edg\//.test(ua))return "Edge";
    if(/Firefox\//.test(ua))return "Firefox";
    if(/Chrome\//.test(ua) && !/Edg\//.test(ua))return "Chrome";
    if(/Safari\//.test(ua) && !/Chrome\//.test(ua))return "Safari";
    return "Tarayıcı";
  }

  function osName(){
    try{
      if(typeof detectOS==="function")return String(detectOS()||"");
    }catch(e){}
    const ua=navigator.userAgent||"";
    if(/Android/i.test(ua))return "Android";
    if(/iPhone|iPad|iPod/i.test(ua))return "iOS/iPadOS";
    if(/Mac/i.test(navigator.platform||ua))return "macOS";
    if(/Win/i.test(navigator.platform||ua))return "Windows";
    if(/Linux/i.test(navigator.platform||ua))return "Linux";
    return "";
  }

  function deviceType(){
    try{
      if(typeof detectDeviceType==="function")return String(detectDeviceType()||"");
    }catch(e){}
    if(globalThis.matchMedia?.("(pointer: coarse)")?.matches){
      return Math.min(innerWidth,innerHeight)<600 ? "mobile" : "tablet";
    }
    return "desktop";
  }

  function captureContext(){
    const story=currentStory();
    return {
      captured_at:Date.now(),
      story,
      story_payload:storyPayload(story),
      app_version:String(window.__floewAppVersion||""),
      browser:browserName(),
      os:osName(),
      device_type:deviceType(),
      viewport_w:innerWidth||0,
      viewport_h:innerHeight||0,
      screen_w:window.screen?.width||0,
      screen_h:window.screen?.height||0,
      dpr:window.devicePixelRatio||1,
      language:navigator.language||"",
      page:location.pathname||"/"
    };
  }

  function getCategories(){
    const found=[];
    $$("#category-options button").forEach(button=>{
      const strong=$("strong",button);
      const raw=(strong?.textContent||button.textContent||"").trim();
      const match=raw.match(/#[\p{L}\p{N}_-]+/u);
      const value=(match?.[0]||raw.split(/\s{2,}|\n/)[0]||"").trim();
      if(value && value.length<40 && !found.includes(value))found.push(value);
    });
    return found.length ? found : FALLBACK_CATEGORIES;
  }

  function getSources(){
    const names=[];
    const add=value=>{
      const name=String(value||"").trim();
      if(name && name.length<80 && !names.some(x=>x.toLocaleLowerCase("tr")===name.toLocaleLowerCase("tr"))){
        names.push(name);
      }
    };

    try{
      if(typeof knownSources!=="undefined")knownSources.forEach(item=>add(item?.name||item?.source||item));
      if(typeof knownForeignSources!=="undefined")knownForeignSources.forEach(item=>add(item?.name||item?.source||item));
      if(typeof state!=="undefined")state?.stories?.forEach(item=>add(item?.source));
    }catch(e){}

    $$("#source-options button").forEach(button=>{
      const strong=$("strong",button);
      add(strong?.textContent||button.textContent?.split(/\n/)[0]);
    });

    const current=stateLocal.context?.story?.source;
    if(current){
      const index=names.findIndex(x=>x.toLocaleLowerCase("tr")===String(current).toLocaleLowerCase("tr"));
      if(index>0){
        const [item]=names.splice(index,1);
        names.unshift(item);
      }else if(index<0){
        names.unshift(String(current));
      }
    }

    return names.slice(0,36);
  }

  const topicOptions=[
    {v:"story",l:"Haber",i:"▤",next:"story_issue"},
    {v:"image",l:"Görseller",i:"▧",next:"image_issue"},
    {v:"scroll",l:"Kaydırma",i:"↕",next:"scroll_issue"},
    {v:"usability",l:"Kullanım",i:"◌",next:"usability_area"},
    {v:"sources",l:"Kaynaklar",i:"⌁",next:"source_kind"},
    {v:"categories",l:"Kategoriler",i:"#",next:"category_issue"},
    {v:"bug",l:"Bir şey bozuk",i:"!",next:"bug_issue"},
    {v:"suggestion",l:"Önerim var",i:"+",next:"suggestion_area"}
  ];

  const frequencyOptions=[
    {v:"once",l:"İlk kez"},
    {v:"sometimes",l:"Bazen"},
    {v:"often",l:"Sık sık"},
    {v:"always",l:"Sürekli"}
  ];

  const questions={
    topic:{
      title:"Neyle ilgili?",
      hint:"Birini seç.",
      key:"topic",
      options:()=>topicOptions
    },
    story_issue:{
      title:"Haberde ne sorun var?",
      key:"issue",
      options:()=>[
        {v:"title_wrong",l:"Başlık yanlış / yanıltıcı",next:"frequency"},
        {v:"old",l:"Haber eski",next:"frequency"},
        {v:"duplicate",l:"Haber tekrarlanıyor",next:"frequency"},
        {v:"wrong_category",l:"Yanlış kategori",next:"category_target"},
        {v:"wrong_source",l:"Yanlış kaynak bilgisi",next:"frequency"},
        {v:"cannot_open",l:"Haber açılmıyor",next:"frequency"},
        {v:"video",l:"Video çalışmıyor",next:"frequency"},
        {v:"dont_want",l:"Bu haberi görmek istemiyorum",next:"frequency"},
        {v:"other",l:"Diğer",next:"final"}
      ]
    },
    image_issue:{
      title:"Görselle ilgili sorun ne?",
      key:"issue",
      options:()=>[
        {v:"wrong_image",l:"Yanlış görsel",next:"frequency"},
        {v:"low_quality",l:"Kalite düşük",next:"frequency"},
        {v:"blurry",l:"Görsel bulanık",next:"frequency"},
        {v:"bad_crop",l:"Kadraj kötü",next:"frequency"},
        {v:"people_cut",l:"İnsanlar kadraj dışında",next:"frequency"},
        {v:"loads_late",l:"Görsel geç yükleniyor",next:"frequency"},
        {v:"jumps",l:"Görsel kayıyor / zıplıyor",next:"frequency"},
        {v:"missing",l:"Görsel hiç gelmiyor",next:"frequency"},
        {v:"other",l:"Diğer",next:"final"}
      ]
    },
    scroll_issue:{
      title:"Kaydırırken ne oluyor?",
      key:"issue",
      options:()=>[
        {v:"late_response",l:"Geç tepki veriyor",next:"direction"},
        {v:"too_sensitive",l:"Fazla hassas",next:"frequency"},
        {v:"not_sensitive",l:"Yeterince hassas değil",next:"frequency"},
        {v:"skips",l:"Haber atlıyor",next:"direction"},
        {v:"returns",l:"Aynı haber geri geliyor",next:"direction"},
        {v:"stutters",l:"Geçiş takılıyor",next:"direction"},
        {v:"image_jumps",l:"Görsel geçişte zıplıyor",next:"direction"},
        {v:"touch_missing",l:"Dokunma algılanmıyor",next:"direction"},
        {v:"auto_advance",l:"Otomatik geçiş rahatsız ediyor",next:"frequency"}
      ]
    },
    direction:{
      title:"Hangi yönde?",
      key:"direction",
      options:()=>[
        {v:"up",l:"Yukarı kaydırırken",next:"frequency"},
        {v:"down",l:"Aşağı kaydırırken",next:"frequency"},
        {v:"both",l:"Her ikisinde",next:"frequency"}
      ]
    },
    usability_area:{
      title:"Hangi bölüm?",
      key:"area",
      options:()=>[
        {v:"menu",l:"Menü",next:"usability_issue"},
        {v:"sources",l:"Kaynak seçimi",next:"usability_issue"},
        {v:"categories",l:"Kategori seçimi",next:"usability_issue"},
        {v:"fullscreen",l:"Tam ekran",next:"usability_issue"},
        {v:"pip",l:"PiP",next:"usability_issue"},
        {v:"open_story",l:"Haber açma",next:"usability_issue"},
        {v:"media",l:"Ses / video",next:"usability_issue"},
        {v:"cookies",l:"Çerez bildirimi",next:"usability_issue"},
        {v:"design",l:"Genel tasarım",next:"usability_issue"},
        {v:"other",l:"Diğer",next:"final"}
      ]
    },
    usability_issue:{
      title:"Sorun ne?",
      key:"issue",
      options:()=>[
        {v:"not_working",l:"Çalışmıyor",next:"frequency"},
        {v:"hard_to_find",l:"Bulması zor",next:"frequency"},
        {v:"unclear",l:"Anlaşılmıyor",next:"frequency"},
        {v:"slow",l:"Çok yavaş",next:"frequency"},
        {v:"wrong_behavior",l:"Yanlış davranıyor",next:"frequency"},
        {v:"design_dislike",l:"Tasarımını beğenmedim",next:"final"}
      ]
    },
    source_kind:{
      title:"Kaynaklarla ilgili ne yapmak istiyorsun?",
      key:"source_kind",
      options:()=>[
        {v:"problem",l:"Bir kaynakla ilgili sorun var",next:"source_select"},
        {v:"new",l:"Yeni kaynak istiyorum",next:"source_type"}
      ]
    },
    source_select:{
      title:"Hangi kaynak?",
      hint:()=>stateLocal.context?.story?.source ? "Şu anki haberin kaynağı en üstte." : "Kaynağı seç.",
      key:"source",
      options:()=>{
        const names=getSources();
        if(!names.length)return [{v:"unknown",l:"Kaynağı listede bulamadım",next:"final",requireText:"Kaynak adı"}];
        return names.map(name=>({v:name,l:name,next:"source_issue"}))
          .concat([{v:"other",l:"Başka bir kaynak",next:"final",requireText:"Kaynak adı"}]);
      }
    },
    source_issue:{
      title:"Kaynakla ilgili sorun ne?",
      key:"issue",
      options:()=>[
        {v:"late_news",l:"Haberler geç geliyor",next:"frequency"},
        {v:"bad_images",l:"Görseller kötü",next:"frequency"},
        {v:"too_many",l:"Çok fazla haber geliyor",next:"frequency"},
        {v:"too_few",l:"Çok az haber geliyor",next:"frequency"},
        {v:"wrong_content",l:"Yanlış içerikler geliyor",next:"frequency"},
        {v:"not_working",l:"Kaynak hiç çalışmıyor",next:"frequency"}
      ]
    },
    source_type:{
      title:"Nasıl bir kaynak?",
      key:"source_type",
      options:()=>[
        {v:"national",l:"Ulusal haber sitesi",next:"final",requireText:"Kaynak adı veya adresi"},
        {v:"local",l:"Yerel haber sitesi",next:"final",requireText:"Kaynak adı veya adresi"},
        {v:"foreign",l:"Yabancı kaynak",next:"final",requireText:"Kaynak adı veya adresi"},
        {v:"economy",l:"Ekonomi",next:"final",requireText:"Kaynak adı veya adresi"},
        {v:"sports",l:"Spor",next:"final",requireText:"Kaynak adı veya adresi"},
        {v:"technology",l:"Teknoloji",next:"final",requireText:"Kaynak adı veya adresi"},
        {v:"culture",l:"Kültür-sanat",next:"final",requireText:"Kaynak adı veya adresi"}
      ]
    },
    category_issue:{
      title:"Kategorilerde sorun ne?",
      key:"issue",
      options:()=>[
        {v:"wrong_category",l:"Haber yanlış kategoride",next:"category_target"},
        {v:"missing",l:"Bir kategori eksik",next:"final",requireText:"Kategori adı"},
        {v:"too_many",l:"Kategoriler fazla",next:"frequency"},
        {v:"unclear_names",l:"Kategori adları anlaşılmıyor",next:"frequency"},
        {v:"filter",l:"Filtre çalışmıyor",next:"frequency"}
      ]
    },
    category_target:{
      title:"Sence hangi kategoride olmalı?",
      key:"category_target",
      options:()=>getCategories().map(cat=>({v:cat,l:cat,next:"frequency"}))
    },
    bug_issue:{
      title:"Ne bozuldu?",
      key:"issue",
      options:()=>[
        {v:"site_not_open",l:"Site açılmıyor",next:"severity"},
        {v:"news_not_load",l:"Haberler yüklenmiyor",next:"severity"},
        {v:"black_screen",l:"Siyah ekran",next:"severity"},
        {v:"menu",l:"Menü açılmıyor",next:"severity"},
        {v:"video",l:"Video çalışmıyor",next:"severity"},
        {v:"images",l:"Görseller çalışmıyor",next:"severity"},
        {v:"scroll",l:"Kaydırma çalışmıyor",next:"severity"},
        {v:"button",l:"Bir buton çalışmıyor",next:"severity"},
        {v:"freeze",l:"Sayfa donuyor",next:"severity"},
        {v:"other",l:"Diğer",next:"severity"}
      ]
    },
    severity:{
      title:"Ne kadar ciddi?",
      key:"severity",
      options:()=>[
        {v:"low",l:"Kullanabiliyorum",next:"final"},
        {v:"medium",l:"Kullanmak zorlaşıyor",next:"final"},
        {v:"high",l:"Flöw'ü kullanamıyorum",next:"final"}
      ]
    },
    suggestion_area:{
      title:"Neyi geliştirelim?",
      key:"area",
      options:()=>[
        {v:"feature",l:"Yeni özellik",next:"suggestion_feature"},
        {v:"design",l:"Tasarım",next:"suggestion_design"},
        {v:"feed",l:"Haber akışı",next:"suggestion_feed"},
        {v:"source",l:"Yeni kaynak",next:"source_type"},
        {v:"category",l:"Yeni kategori",next:"final",requireText:"Kategori adı"},
        {v:"ads",l:"Reklamlar",next:"suggestion_ads"},
        {v:"personalization",l:"Kişiselleştirme",next:"suggestion_personalization"},
        {v:"media",l:"Video / medya",next:"suggestion_media"},
        {v:"other",l:"Diğer",next:"final"}
      ]
    },
    suggestion_feature:{
      title:"Nasıl bir özellik?",
      key:"suggestion",
      options:()=>[
        {v:"save",l:"Haberi kaydetme",next:"final"},
        {v:"share",l:"Daha kolay paylaşma",next:"final"},
        {v:"search",l:"Haber arama",next:"final"},
        {v:"notifications",l:"Bildirimler",next:"final"},
        {v:"history",l:"İzleme geçmişi",next:"final"},
        {v:"other",l:"Başka bir özellik",next:"final"}
      ]
    },
    suggestion_design:{
      title:"Tasarımda ne değişsin?",
      key:"suggestion",
      options:()=>[
        {v:"cleaner",l:"Daha sade olsun",next:"final"},
        {v:"readability",l:"Metinler daha okunaklı olsun",next:"final"},
        {v:"controls",l:"Kontroller daha kolay bulunsun",next:"final"},
        {v:"mobile",l:"Mobil görünüm iyileşsin",next:"final"},
        {v:"other",l:"Başka",next:"final"}
      ]
    },
    suggestion_feed:{
      title:"Akışta ne değişsin?",
      key:"suggestion",
      options:()=>[
        {v:"faster",l:"Daha hızlı geçiş",next:"final"},
        {v:"slower",l:"Daha yavaş geçiş",next:"final"},
        {v:"more_news",l:"Daha fazla haber",next:"final"},
        {v:"less_repeat",l:"Daha az tekrar",next:"final"},
        {v:"better_images",l:"Daha iyi görseller",next:"final"},
        {v:"better_order",l:"Daha iyi sıralama",next:"final"},
        {v:"other",l:"Başka",next:"final"}
      ]
    },
    suggestion_ads:{
      title:"Reklamlarda ne değişsin?",
      key:"suggestion",
      options:()=>[
        {v:"less",l:"Daha seyrek olsun",next:"final"},
        {v:"shorter",l:"Daha kısa olsun",next:"final"},
        {v:"relevance",l:"Daha ilgili olsun",next:"final"},
        {v:"placement",l:"Yerleşimi değişsin",next:"final"},
        {v:"other",l:"Başka",next:"final"}
      ]
    },
    suggestion_personalization:{
      title:"Neyi kişiselleştirmek istersin?",
      key:"suggestion",
      options:()=>[
        {v:"sources",l:"Kaynaklar",next:"final"},
        {v:"categories",l:"Kategoriler",next:"final"},
        {v:"speed",l:"Akış hızı",next:"final"},
        {v:"appearance",l:"Görünüm",next:"final"},
        {v:"recommendations",l:"Haber önerileri",next:"final"},
        {v:"other",l:"Başka",next:"final"}
      ]
    },
    suggestion_media:{
      title:"Medya tarafında ne değişsin?",
      key:"suggestion",
      options:()=>[
        {v:"autoplay",l:"Video oynatma",next:"final"},
        {v:"controls",l:"Video kontrolleri",next:"final"},
        {v:"images",l:"Görsel kadrajı",next:"final"},
        {v:"quality",l:"Görüntü kalitesi",next:"final"},
        {v:"other",l:"Başka",next:"final"}
      ]
    },
    frequency:{
      title:"Ne kadar sık oluyor?",
      key:"frequency",
      options:()=>frequencyOptions.map(item=>({...item,next:"final"}))
    }
  };

  function reportPanel(){
    return $('[data-about-panel="report"]');
  }

  function requiredTextLabel(){
    return stateLocal.answers.__requiredTextLabel||"";
  }

  function setRequiredTextLabel(label){
    if(label)stateLocal.answers.__requiredTextLabel=String(label);
    else delete stateLocal.answers.__requiredTextLabel;
  }

  function resetFeedback(capture=true){
    stateLocal.current="topic";
    stateLocal.history=[];
    stateLocal.answers={};
    stateLocal.submitting=false;
    stateLocal.sent=false;
    if(capture || !stateLocal.context)stateLocal.context=captureContext();
    render();
  }

  function answerLabel(answer){
    return String(answer?.label||"").trim();
  }

  function summaryAnswers(){
    const order=["topic","area","source_kind","source","source_type","issue","suggestion","direction","category_target","frequency","severity"];
    return order.map(key=>stateLocal.answers[key]).filter(Boolean).map(answerLabel).filter(Boolean);
  }

  function go(next,answerKey,option){
    const current=stateLocal.current;
    stateLocal.history.push({step:current,answers:{...stateLocal.answers}});
    stateLocal.answers[answerKey]={value:option.v,label:option.l};
    setRequiredTextLabel(option.requireText||"");
    stateLocal.current=next||"final";
    render();
  }

  function back(){
    const previous=stateLocal.history.pop();
    if(!previous)return;
    stateLocal.current=previous.step;
    stateLocal.answers={...previous.answers};
    stateLocal.submitting=false;
    stateLocal.sent=false;
    render();
  }

  function progressHtml(){
    const depth=Math.min(4,stateLocal.history.length+1);
    return `<div class="floew-feedback-progress" aria-label="Geri bildirim adımı">${[1,2,3,4].map(i=>`<span class="floew-feedback-dot${i<=depth?" on":""}"></span>`).join("")}</div>`;
  }

  function renderQuestion(){
    const panel=reportPanel();
    const q=questions[stateLocal.current];
    if(!panel || !q)return;
    const options=typeof q.options==="function" ? q.options() : [];
    const hint=typeof q.hint==="function" ? q.hint() : (q.hint||"");

    panel.innerHTML=`
      <div class="floew-feedback">
        <div class="floew-feedback-step">
          <div class="floew-feedback-head">
            <button class="floew-feedback-back" type="button" ${stateLocal.history.length?"":"hidden"}>← Geri</button>
            ${progressHtml()}
          </div>
          <div class="floew-feedback-copy">
            <h3 class="floew-feedback-title">${escapeHtml(q.title)}</h3>
            <div class="floew-feedback-hint">${escapeHtml(hint)}</div>
          </div>
          <div class="floew-feedback-options">
            ${options.map(option=>`
              <button class="floew-feedback-option" type="button" data-feedback-value="${escapeHtml(option.v)}">
                ${option.i?`<span class="floew-feedback-icon" aria-hidden="true">${escapeHtml(option.i)}</span>`:""}
                <span>${escapeHtml(option.l)}</span>
              </button>
            `).join("")}
          </div>
        </div>
      </div>`;

    $(".floew-feedback-back",panel)?.addEventListener("click",back);
    $$("[data-feedback-value]",panel).forEach(button=>{
      button.addEventListener("click",()=>{
        const option=options.find(item=>String(item.v)===button.dataset.feedbackValue);
        if(!option)return;
        go(option.next||"final",q.key,option);
      });
    });
  }

  function renderFinal(){
    const panel=reportPanel();
    if(!panel)return;
    const requiredLabel=requiredTextLabel();
    const context=stateLocal.context||captureContext();
    const summary=summaryAnswers();
    const story=context.story_payload;

    panel.innerHTML=`
      <div class="floew-feedback">
        <div class="floew-feedback-step">
          <div class="floew-feedback-head">
            <button class="floew-feedback-back" type="button">← Geri</button>
            ${progressHtml()}
          </div>
          <div class="floew-feedback-copy">
            <h3 class="floew-feedback-title">Son bir şey</h3>
            <div class="floew-feedback-hint">İstersen hiçbir şey yazmadan gönderebilirsin.</div>
          </div>
          <div class="floew-feedback-summary">${summary.map(text=>`<span class="floew-feedback-chip">${escapeHtml(text)}</span>`).join("")}</div>
          ${requiredLabel?`
            <label class="floew-feedback-field">
              <span class="floew-feedback-field-label">${escapeHtml(requiredLabel)}</span>
              <input id="floew-feedback-required" type="text" maxlength="240" autocomplete="off" spellcheck="false" placeholder="${escapeHtml(requiredLabel)}">
            </label>
          `:""}
          <label class="floew-feedback-field">
            <span class="floew-feedback-field-label">Eklemek istediğin bir şey var mı? <span style="opacity:.48">(isteğe bağlı)</span></span>
            <textarea id="floew-feedback-note" maxlength="${MAX_NOTE_LENGTH}" placeholder="Kısaca yazabilirsin..."></textarea>
          </label>
          <div class="floew-feedback-actions">
            <button id="floew-feedback-submit" class="floew-feedback-submit" type="button" ${requiredLabel?"disabled":""}>Gönder</button>
          </div>
          <div class="floew-feedback-tech">
            Tarayıcı, cihaz türü, ekran boyutu, Flöw sürümü ve ilgili haber bilgileri geri bildirimle birlikte gönderilir.
            <details>
              <summary>Gönderilecek teknik bilgileri göster</summary>
              <div class="floew-feedback-tech-line">${escapeHtml([
                context.app_version?`Flöw ${context.app_version}`:"Flöw",
                [context.device_type,context.os,context.browser].filter(Boolean).join(" / "),
                `${context.viewport_w}×${context.viewport_h}`,
                story?.source?`Kaynak: ${story.source}`:"",
                story?.title?`Haber: ${story.title}`:""
              ].filter(Boolean).join(" · "))}</div>
            </details>
          </div>
          <div id="floew-feedback-error" class="floew-feedback-error" hidden></div>
        </div>
      </div>`;

    $(".floew-feedback-back",panel)?.addEventListener("click",back);
    const requiredInput=$("#floew-feedback-required",panel);
    const submit=$("#floew-feedback-submit",panel);
    requiredInput?.addEventListener("input",()=>{
      submit.disabled=!requiredInput.value.trim();
    });
    submit?.addEventListener("click",submitFeedback);
  }

  function renderSuccess(){
    const panel=reportPanel();
    if(!panel)return;
    panel.innerHTML=`
      <div class="floew-feedback">
        <div class="floew-feedback-success">
          <div>
            <div class="floew-feedback-success-mark" aria-hidden="true">✓</div>
            <h3>Aldık.</h3>
            <p>Geri bildirimin için teşekkürler.</p>
            <button class="floew-feedback-again" type="button">Başka bir şey gönder</button>
          </div>
        </div>
      </div>`;
    $(".floew-feedback-again",panel)?.addEventListener("click",()=>resetFeedback(true));
  }

  function render(){
    if(stateLocal.sent){renderSuccess();return;}
    if(stateLocal.current==="final"){renderFinal();return;}
    renderQuestion();
  }

  function feedbackMeta(note,requiredText){
    const context=stateLocal.context||captureContext();
    const a=stateLocal.answers;
    return {
      feedback_version:FEEDBACK_VERSION,
      topic:a.topic?.value||"",
      topic_label:a.topic?.label||"",
      area:a.area?.value||"",
      area_label:a.area?.label||"",
      issue:a.issue?.value||"",
      issue_label:a.issue?.label||"",
      suggestion:a.suggestion?.value||"",
      suggestion_label:a.suggestion?.label||"",
      frequency:a.frequency?.value||"",
      frequency_label:a.frequency?.label||"",
      severity:a.severity?.value||"",
      severity_label:a.severity?.label||"",
      direction:a.direction?.value||"",
      direction_label:a.direction?.label||"",
      source_kind:a.source_kind?.value||"",
      source:a.source?.label||"",
      source_type:a.source_type?.label||"",
      category_target:a.category_target?.label||"",
      required_text:String(requiredText||"").slice(0,240),
      note:String(note||"").slice(0,MAX_NOTE_LENGTH),
      app_version:context.app_version,
      browser:context.browser,
      os:context.os,
      device_type:context.device_type,
      viewport_w:context.viewport_w,
      viewport_h:context.viewport_h,
      screen_w:context.screen_w,
      screen_h:context.screen_h,
      dpr:context.dpr,
      language:context.language,
      page:context.page,
      story_key:String(context.story_payload?.key||"").slice(0,500),
      story_title:String(context.story_payload?.title||"").slice(0,500),
      story_link:String(context.story_payload?.link||"").slice(0,1200),
      story_published:String(context.story_payload?.published||"").slice(0,160),
      story_source:String(context.story_payload?.source||"").slice(0,240),
      story_category:String(context.story_payload?.category||"").slice(0,160),
      feedback_captured_at:context.captured_at
    };
  }

  function clientSnapshotFallback(){
    const context=stateLocal.context||captureContext();
    return {
      browser:context.browser,
      os:context.os,
      device_type:context.device_type,
      screen_w:context.screen_w,
      screen_h:context.screen_h,
      viewport_w:context.viewport_w,
      viewport_h:context.viewport_h,
      dpr:context.dpr,
      language:context.language,
      online:navigator.onLine
    };
  }

  function eventId(){
    try{
      if(typeof telemetryId==="function")return telemetryId();
    }catch(e){}
    if(globalThis.crypto?.randomUUID)return globalThis.crypto.randomUUID();
    return `feedback-${Date.now().toString(36)}-${Math.random().toString(36).slice(2,12)}`;
  }

  async function submitFeedback(){
    if(stateLocal.submitting)return;
    const panel=reportPanel();
    if(!panel)return;

    const requiredInput=$("#floew-feedback-required",panel);
    const requiredText=String(requiredInput?.value||"").trim();
    const requiredLabel=requiredTextLabel();
    if(requiredLabel && !requiredText){
      requiredInput?.focus();
      return;
    }

    const note=String($("#floew-feedback-note",panel)?.value||"").trim();
    const submit=$("#floew-feedback-submit",panel);
    const error=$("#floew-feedback-error",panel);
    stateLocal.submitting=true;
    if(submit){submit.disabled=true;submit.textContent="Gönderiliyor...";}
    if(error){error.hidden=true;error.textContent="";}

    const context=stateLocal.context||captureContext();
    const meta=feedbackMeta(note,requiredText);
    const issueLabel=stateLocal.answers.issue?.label || stateLocal.answers.suggestion?.label || stateLocal.answers.area?.label || stateLocal.answers.topic?.label || "Geri bildirim";

    const event={
      id:eventId(),
      seq:Date.now(),
      event:"feedback_submit",
      ts:Date.now(),
      visitor_id:String(window.FloewAnalytics?.visitorId||""),
      session_id:String(window.FloewAnalytics?.sessionId||""),
      feed_mode:(typeof feedMode!=="undefined" ? String(feedMode||"") : ""),
      story:context.story_payload,
      mode:String(stateLocal.answers.topic?.value||"feedback"),
      value_text:String(note||requiredText||issueLabel).slice(0,2000),
      meta
    };

    let client=clientSnapshotFallback();
    try{
      if(typeof telemetryClientSnapshot==="function")client=telemetryClientSnapshot();
    }catch(e){}

    try{
      const response=await fetch(TRACK_ENDPOINT,{
        method:"POST",
        mode:"cors",
        credentials:"omit",
        cache:"no-store",
        keepalive:true,
        headers:{"Content-Type":"application/json","Accept":"application/json"},
        body:JSON.stringify({client,events:[event]})
      });
      if(!response.ok)throw new Error(`HTTP ${response.status}`);
      stateLocal.sent=true;
      stateLocal.submitting=false;
      renderSuccess();
    }catch(err){
      stateLocal.submitting=false;
      if(submit){submit.disabled=Boolean(requiredLabel && !requiredText);submit.textContent="Tekrar dene";}
      if(error){
        error.hidden=false;
        error.textContent=navigator.onLine
          ? "Geri bildirim gönderilemedi. Tekrar deneyebilirsin."
          : "İnternet bağlantısı yok. Bağlantı gelince tekrar deneyebilirsin.";
      }
      console.warn("Flöw feedback:",err);
    }
  }

  function freezeFlow(){
    if(stateLocal.flowFrozen)return;
    stateLocal.flowFrozen=true;
    try{
      stateLocal.timerWasRunning=Boolean(typeof state!=="undefined" && state?.timer);
      if(typeof state!=="undefined" && state?.timer){
        clearTimeout(state.timer);
        state.timer=null;
      }
    }catch(e){}
  }

  function unfreezeFlow(){
    if(!stateLocal.flowFrozen)return;
    stateLocal.flowFrozen=false;
    try{
      if(stateLocal.timerWasRunning && typeof autoAdvancePaused!=="undefined" && !autoAdvancePaused && typeof timer==="function"){
        timer();
      }
    }catch(e){}
    stateLocal.timerWasRunning=false;
  }

  function activateFeedback(){
    stateLocal.context=captureContext();
    freezeFlow();
    if(!stateLocal.sent)resetFeedback(false);
  }

  function bindInlineFeedbackButtons(){
    $$(".feedback-inline-link").forEach(button=>{
      if(button.dataset.floewFeedbackBound==="1")return;
      button.dataset.floewFeedbackBound="1";

      for(const eventName of [
        "pointerdown",
        "pointerup",
        "mousedown",
        "mouseup",
        "touchstart",
        "touchend",
        "dblclick",
        "contextmenu",
        "wheel"
      ]){
        button.addEventListener(
          eventName,
          event=>event.stopPropagation(),
          eventName==="wheel" ? {passive:true} : {passive:false}
        );
      }

      button.addEventListener("click",event=>{
        event.preventDefault();
        event.stopPropagation();
        resetFeedback(true);
        try{
          if(typeof openStatsOverlay==="function")openStatsOverlay();
          if(typeof switchAboutTab==="function")switchAboutTab("report");
        }catch(e){}
        $('[data-about-tab="report"]')?.click();
      });
    });
  }

  function init(){
    const tab=$('[data-about-tab="report"]');
    const panel=reportPanel();
    if(!tab || !panel)return;

    tab.textContent="Geri bildirim";
    tab.setAttribute("aria-label","Geri bildirim");
    panel.innerHTML='<div class="floew-feedback"><div class="floew-feedback-success"><div><p>Geri bildirim ekranı hazırlanıyor...</p></div></div></div>';
    resetFeedback(true);

    $$(".about-tab").forEach(button=>{
      button.addEventListener("click",()=>{
        if(button.dataset.aboutTab==="report"){
          activateFeedback();
        }else{
          unfreezeFlow();
        }
      });
    });

    $("#stats-close")?.addEventListener("click",unfreezeFlow);

    const overlay=$("#stats-overlay");
    if(overlay && window.MutationObserver){
      new MutationObserver(()=>{
        if(!overlay.classList.contains("open"))unfreezeFlow();
      }).observe(overlay,{attributes:true,attributeFilter:["class"]});
    }

    window.FloewFeedback={
      version:FEEDBACK_VERSION,
      reset:()=>resetFeedback(true),
      open:()=>{
        try{
          if(typeof openStatsOverlay==="function")openStatsOverlay();
          if(typeof switchAboutTab==="function")switchAboutTab("report");
        }catch(e){}
        const reportTab=$('[data-about-tab="report"]');
        reportTab?.click();
      }
    };
    bindInlineFeedbackButtons();
  }

  if(document.readyState==="loading"){
    document.addEventListener("DOMContentLoaded",init,{once:true});
  }else{
    init();
  }
})();
