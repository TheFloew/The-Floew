import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {runInNewContext} from "node:vm";

const app=readFileSync(new URL("../js/app.js",import.meta.url),"utf8");
const modelStart=app.indexOf("function parseKeywordList(value){");
const modelEnd=app.indexOf("function storyKeywordText(story){",modelStart);
const matchEnd=app.indexOf("function updateKeywordAlert(story){",modelEnd);
const actionsStart=app.indexOf("function recordKeywordRuleChange(kind,action,words){");
const actionsEnd=app.indexOf("function renderTimeRangeControl(){",actionsStart);
assert.ok(modelStart>=0 && modelEnd>modelStart);
assert.ok(matchEnd>modelEnd && actionsStart>matchEnd && actionsEnd>actionsStart);
const extracted=app.slice(modelStart,modelEnd)+
  "\n"+app.slice(modelEnd,matchEnd)+
  "\n"+app.slice(actionsStart,actionsEnd)+
  "\n;({parseKeywordEntries,parseKeywordList,loadKeywordRules,saveKeywordRules,"+
  "passesKeywordFilter,currentKeywordWatchKeywords,addKeywordRule,"+
  "removeKeywordRule,applyKeywordFilter,applyKeywordWatch,read:()=>keywordRules})";

function setup(initial={}){
  const stored=new Map(Object.entries(initial));
  const events=[],feedback=[];
  const state={filters:0,alerts:0,renders:0};
  const input={value:"",focus(){}};
  const ctx={
    KEYWORD_FILTER_KEY:"keywordFilter",
    KEYWORD_WATCH_KEY:"keywordWatch",
    KEYWORD_RULES_KEY:"keywordRules",
    localStorage:{
      getItem:key=>stored.has(key)?stored.get(key):null,
      setItem:(key,value)=>stored.set(key,value)
    },
    normalizeText:value=>String(value||"").normalize("NFD")
      .replace(/[\u0300-\u036f]/g,"").toLowerCase(),
    document:{getElementById:id=>id==="keyword-filter-input"?input:null},
    console:{warn(){}},
    iddqdModeActive:false,
    iddqdTrustedActionGate:"",
    isExactIddqdInput:value=>value==="IDDQD",
    setKeywordManagerFeedback:msg=>feedback.push(msg),
    renderKeywordFilterControl:()=>{state.renders++},
    applyFilters:()=>{state.filters++},
    updateKeywordAlert:()=>{state.alerts++},
    telemetryQueueEvent:(type,payload)=>events.push({type,payload}),
    state:{stories:[],index:0}
  };
  const api=runInNewContext(extracted,ctx);
  return {api,stored,input,events,feedback,state,ctx};
}

const flat=items=>Array.from(items);

test("old Göster filter and Uyar words migrate without data loss",()=>{
  const f=setup({
    keywordFilter:JSON.stringify({text:"Ekonomi, İstanbul",mode:"show"}),
    keywordWatch:"deprem, seçim"
  });
  assert.deepEqual(flat(f.api.read().show),["Ekonomi","İstanbul"]);
  assert.deepEqual(flat(f.api.read().hide),[]);
  assert.deepEqual(flat(f.api.read().alert),["deprem","seçim"]);
});

test("old Gizle mode migrates into the hide column",()=>{
  const f=setup({
    keywordFilter:JSON.stringify({text:"Spor, Teknoloji",mode:"hide"})
  });
  assert.deepEqual(flat(f.api.read().show),[]);
  assert.deepEqual(flat(f.api.read().hide),["Spor","Teknoloji"]);
});

test("new list settings take priority over stale legacy values",()=>{
  const f=setup({
    keywordRules:JSON.stringify({
      show:["Bilim"],hide:["reklam"],alert:["iklim"]
    }),
    keywordFilter:JSON.stringify({text:"Eski",mode:"show"})
  });
  assert.deepEqual(flat(f.api.read().show),["Bilim"]);
  assert.deepEqual(flat(f.api.read().hide),["reklam"]);
  assert.deepEqual(flat(f.api.read().alert),["iklim"]);
});

test("text entries are deduplicated while preserving their display spelling",()=>{
  const f=setup();
  assert.deepEqual(flat(f.api.parseKeywordEntries(" Ekonomi,ekonomi,\nBİLİM, bilim ")),
    ["Ekonomi","BİLİM"]);
});

test("Göster whitelist and Gizle blacklist apply simultaneously",()=>{
  const f=setup({
    keywordRules:JSON.stringify({
      show:["teknoloji","bilim"],
      hide:["reklam"],
      alert:["deprem"]
    })
  });
  assert.equal(f.api.passesKeywordFilter({title:"Yeni bilim haberi"}),true);
  assert.equal(f.api.passesKeywordFilter({title:"Bilim reklam kampanyası"}),false);
  assert.equal(f.api.passesKeywordFilter({title:"Ekonomi gündemi"}),false);
  assert.deepEqual(flat(f.api.currentKeywordWatchKeywords()),["deprem"]);
});

test("Göster and Gizle add cumulatively and move duplicate terms between them",()=>{
  const f=setup();
  f.input.value="Yapay zeka, uzay";
  assert.equal(f.api.addKeywordRule("show"),"keyword-added");
  assert.deepEqual(flat(f.api.read().show),["Yapay zeka","uzay"]);
  assert.equal(f.input.value,"");
  f.input.value="deprem";
  f.api.addKeywordRule("show");
  assert.deepEqual(flat(f.api.read().show),["Yapay zeka","uzay","deprem"]);
  f.input.value="uzay";
  f.api.addKeywordRule("hide");
  assert.deepEqual(flat(f.api.read().show),["Yapay zeka","deprem"]);
  assert.deepEqual(flat(f.api.read().hide),["uzay"]);
  assert.equal(f.state.filters,3);
  assert.ok(f.events.some(event=>event.type==="filter_show"));
  assert.ok(f.events.some(event=>event.type==="filter_hide"));
  assert.ok(f.stored.has("keywordRules"));
});

test("Uyar adds independent highlights and removing one entry leaves others intact",()=>{
  const f=setup();
  f.input.value="deprem, seçim";
  assert.equal(f.api.applyKeywordWatch(),"keyword-added");
  assert.deepEqual(flat(f.api.read().alert),["deprem","seçim"]);
  assert.equal(f.state.filters,0,"highlights must not change the feed filter");
  assert.equal(f.state.alerts,1);
  f.api.removeKeywordRule("alert",0);
  assert.deepEqual(flat(f.api.read().alert),["seçim"]);
  assert.equal(f.state.filters,0);
  assert.equal(f.state.alerts,2);
  assert.ok(f.events.some(event=>event.type==="watch_enable"));
  assert.ok(f.events.some(event=>event.type==="watch_clear"));
});

test("invalid indexes and empty input do not modify saved filters",()=>{
  const f=setup();
  f.api.removeKeywordRule("show",-1);
  assert.equal(f.api.addKeywordRule("show"),"empty");
  assert.deepEqual(flat(f.api.read().show),[]);
  assert.equal(f.state.filters,0);
  assert.equal(f.stored.has("keywordRules"),false);
});

test("special IDDQD command never becomes an ordinary saved keyword",()=>{
  const f=setup();
  f.input.value="IDDQD";
  assert.equal(f.api.applyKeywordFilter("show"),"iddqd-denied");
  assert.equal(f.api.applyKeywordWatch(),"iddqd-denied");
  assert.deepEqual(flat(f.api.read().show),[]);
  assert.deepEqual(flat(f.api.read().alert),[]);
  assert.equal(f.stored.has("keywordRules"),false);
  assert.match(app,/function runTrustedKeywordFilterButtonAction\(mode,event\)/);
  assert.match(app,/iddqdTrustedActionGate==="show"/);
  assert.match(app,/iddqdTrustedActionGate==="hide"/);
});

test("preference backup includes the new list storage alongside legacy keys",()=>{
  const list=app.slice(app.indexOf("function preferenceTransferKeys(){"),
    app.indexOf("function setPreferenceTransferFeedback("));
  assert.match(list,/KEYWORD_FILTER_KEY/);
  assert.match(list,/KEYWORD_WATCH_KEY/);
  assert.match(list,/KEYWORD_RULES_KEY/);
});

test("opening and closing both screens resumes the same pause coordinator",()=>{
  const part=app.slice(app.indexOf("function closeTimeRangePanel(){"),
    app.indexOf("function openMenu(){"));
  assert.match(part,/function openTimeRangePanel\(\)\{\s*pauseFlowForUi\(\)/);
  assert.match(part,/function openKeywordFilterPanel\(\)\{\s*pauseFlowForUi\(\)/);
  assert.match(part,/function closeTimeRangePanel\(\)[\s\S]*?queueUiFlowResumeCheck\(\)/);
  assert.match(part,/function closeKeywordFilterPanel\(\)[\s\S]*?queueUiFlowResumeCheck\(\)/);
  assert.match(part,/closeControlMenu\(\)/);
  assert.match(part,/trapToolScreenFocus/);
});
