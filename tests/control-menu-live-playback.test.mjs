import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {runInNewContext} from "node:vm";

const read=path=>readFileSync(new URL("../"+path,import.meta.url),"utf8");
const app=read("js/app.js");
const html=read("index.html");
const css=read("css/styles.css");

test("hamburger opens without pausing auto-advance, including an existing mouse pause",()=>{
  const begin=app.indexOf("let controlMenuExitTimer=null;");
  const end=app.indexOf("function closeStatsOverlay(){",begin);
  assert.ok(begin>=0 && end>begin);
  const functions=app.slice(begin,end);

  function element(){
    const classes=new Set();
    const attributes=new Map();
    return {
      classList:{
        add:x=>classes.add(x),
        remove:x=>classes.delete(x),
        contains:x=>classes.has(x)
      },
      setAttribute:(key,value)=>attributes.set(key,value),
      removeAttribute:key=>attributes.delete(key),
      getAttribute:key=>attributes.get(key)
    };
  }
  const panel=element();
  const button=element();
  const nodes={
    "control-menu-panel":panel,
    "control-menu-button":button
  };
  let pauses=0;
  const timers=[];
  const ctx={
    controlMenuOpen:false,mouseFlowPaused:true,mouseFlowResumeTimer:5,
    uiFlowPauseActive:false,sourceViewerOpen:false,adActive:false,
    autoAdvancePaused:false,showDurationSeconds:10,
    state:{stories:[{}],busy:false,timerRemainingMs:2400},
    window:{matchMedia:()=>({matches:false})},
    document:{getElementById:id=>nodes[id]||null},
    clearTimeout(){},setTimeout(){return 9},
    closeQuickPanels(){},closeMenu(){},closeStatsOverlay(){},
    pauseFlowForUi(){pauses++},
    timer:ms=>timers.push(ms),
    queueUiFlowResumeCheck(){},showFullscreenButton(){}
  };
  const api=runInNewContext(functions+";({openControlMenu,closeControlMenu})",ctx);
  api.openControlMenu();

  assert.equal(pauses,0);
  assert.equal(ctx.mouseFlowPaused,false);
  assert.deepEqual(timers,[2400]);
  assert.equal(panel.classList.contains("open"),true);
  assert.equal(button.getAttribute("aria-expanded"),"true");
  api.closeControlMenu();
  assert.equal(panel.classList.contains("open"),false);
  assert.equal(button.getAttribute("aria-expanded"),"false");
});

test("hamburger is not a modal pause surface and click-outside uses capture",()=>{
  const start=app.indexOf("function anyUiPauseSurfaceOpen(){");
  const end=app.indexOf("function pauseFlowForUi(){",start);
  assert.ok(start>=0 && end>start);
  assert.doesNotMatch(app.slice(start,end),/control-menu-panel/);
  assert.match(app,/document\.addEventListener\("click",e=>\{[\s\S]*?if\(!controlMenuOpen\)return;[\s\S]*?e\.target\?\.closest\?\.\("#control-menu-button, #control-menu-panel"\)[\s\S]*?closeControlMenu\(\);\s*\},true\);/);
  assert.match(app,/document\.getElementById\("control-menu-panel"\)\?\.classList\.contains\("open"\)\s*\)\{\s*return;/);
});

test("toolbar play/pause shares the existing auto-advance setting",()=>{
  assert.match(html,/id="fullscreen-button"[\s\S]*?id="feed-play-pause-button"[\s\S]*?id="control-menu-button"/);
  assert.match(html,/id="feed-play-pause-button" class="fi fi-pause"/);
  const start=app.indexOf("function renderAutoAdvanceSetting(){");
  const end=app.indexOf("function setAutoAdvancePaused(paused){",start);
  const render=app.slice(start,end);
  assert.ok(start>=0 && end>start);
  assert.match(render,/playback\.classList\.toggle\("fi-play",autoAdvancePaused\)/);
  assert.match(render,/playback\.classList\.toggle\("fi-pause",!autoAdvancePaused\)/);
  assert.match(app,/setAutoAdvancePaused\(!autoAdvancePaused\);\s*showFullscreenButton\(\);/);
});

test("toolbar positions do not overlap on desktop or mobile",()=>{
  const section=css.slice(css.indexOf("V31.103 — Non-blocking hamburger"));
  assert.match(section,/\+ 50px\)/);
  assert.match(section,/\+ 100px\) !important/);
  assert.match(section,/\+ 140px\) !important/);
  assert.match(section,/\+ 44px\) !important/);
  assert.match(section,/\+ 86px\) !important/);
});
