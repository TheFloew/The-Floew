import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {runInNewContext} from "node:vm";

const read=path=>readFileSync(new URL("../"+path,import.meta.url),"utf8");
const app=read("js/app.js");
const css=read("css/styles.css");
const html=read("index.html");
const begin=app.indexOf("function newsVideoScaleMode(){");
const end=app.indexOf("function renderVideoSetting(){",begin);
assert.ok(begin>=0 && end>begin,"video-fit state and handlers exist");
const fitCode=app.slice(begin,end);

function fixture(initialPortrait=true){
  const classes=new Set();
  const buttonClasses=new Set();
  const attributeValues=new Map();
  const state={textContent:""};
  const modes=[];
  const host={
    dataset:{retired:"0"},
    __floewDailymotionPlayer:{setScaleMode(mode){modes.push(mode)}}
  };
  let portraitListener=()=>{};
  const portraitQuery={
    matches:initialPortrait,
    addEventListener(event,callback){
      assert.equal(event,"change");
      portraitListener=callback;
    }
  };
  const button={
    classList:{toggle:(key,on)=>on?buttonClasses.add(key):buttonClasses.delete(key)},
    setAttribute:(key,value)=>attributeValues.set(key,value),
    querySelector:()=>state
  };
  const context={
    videoFitEnabled:false,
    newsVideoPortraitQuery:portraitQuery,
    document:{
      body:{classList:{toggle:(key,on)=>on?classes.add(key):classes.delete(key)}},
      getElementById:id=>id==="video-fit-setting"?button:null,
      querySelectorAll:selector=>selector===".slide-dailymotion"?[host]:[]
    },
    window:{innerHeight:900,innerWidth:400,addEventListener(){}},
    Promise
  };
  const api=runInNewContext(fitCode+
    "\n;({newsVideoScaleMode,applyVideoFitSetting,syncNewsVideoScaleMode})",context);
  return {
    api,context,classes,buttonClasses,attributeValues,state,modes,portraitQuery,
    rotate(toPortrait){
      portraitQuery.matches=toPortrait;
      portraitListener();
    }
  };
}

test("Görünüm includes a default-off video fit switch between the video settings",()=>{
  const normal=html.indexOf('id="video-setting"');
  const fit=html.indexOf('id="video-fit-setting"');
  const only=html.indexOf('id="video-only-setting"');
  assert.ok(normal>=0 && normal<fit && fit<only);
  assert.match(html,/id="video-fit-setting"[^>]+aria-pressed="false"/);
  assert.match(html,/Dikey ekranlarda videonun tamamını kırpmadan göster/);
});

test("fit is opt-in and live-switches Dailymotion without restarting playback",()=>{
  const f=fixture();
  f.api.applyVideoFitSetting();
  assert.equal(f.api.newsVideoScaleMode(),"fill");
  assert.equal(f.classes.has("news-video-contain"),false);
  assert.equal(f.attributeValues.get("aria-pressed"),"false");
  assert.equal(f.state.textContent,"Kapalı");

  f.context.videoFitEnabled=true;
  f.api.applyVideoFitSetting();
  assert.equal(f.api.newsVideoScaleMode(),"fit");
  assert.equal(f.classes.has("news-video-contain"),true);
  assert.equal(f.buttonClasses.has("active"),true);
  assert.equal(f.attributeValues.get("aria-pressed"),"true");
  assert.equal(f.state.textContent,"Açık");
  assert.deepEqual(f.modes,["fill","fit"]);

  f.rotate(false);
  assert.equal(f.api.newsVideoScaleMode(),"fill");
  f.rotate(true);
  assert.equal(f.api.newsVideoScaleMode(),"fit");
  assert.deepEqual(f.modes,["fill","fit","fill","fit"]);
});

test("video layout is portrait scoped, and never changes advertising video styles",()=>{
  const start=css.indexOf("/* V31.82.0 -");
  assert.ok(start>0);
  const fitRules=css.slice(start);
  assert.match(fitRules,/@media \(orientation:portrait\)/);
  assert.match(fitRules,/body\.news-video-contain \.slide-video\s*\{\s*object-fit:contain !important/);
  assert.match(fitRules,/body\.news-video-contain \.slide-embed\[data-provider="youtube"\]/);
  assert.match(fitRules,/body\.news-video-contain \.slide-embed\[data-provider="vimeo"\]/);
  assert.doesNotMatch(fitRules,/#ad-video|\.ad-video/);
});

test("existing preferences persist the fit choice and retain exported backups",()=>{
  assert.match(app,/videoFitEnabled:p\.videoFitEnabled===true/);
  assert.match(app,/let videoFitEnabled=savedPreferences\.videoFitEnabled===true/);
  assert.match(app,/videoOnlyEnabled,\s*videoFitEnabled\s*\}\)\);/);
  assert.match(app,/function preferenceTransferKeys\(\)\{[\s\S]*?PREFS_KEY/);
  assert.match(app,/scaleMode:newsVideoScaleMode\(\)/);
  assert.match(app,/player\.setScaleMode\?\.\(newsVideoScaleMode\(\)\)/);
  assert.match(html,/css\/styles\.css\?v=20261126-portrait-video-fit1/);
  assert.match(html,/js\/app\.js\?v=20261126-portrait-video-fit1/);
});
