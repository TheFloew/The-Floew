import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {runInNewContext} from "node:vm";

const text=path=>readFileSync(new URL("../"+path,import.meta.url),"utf8");
const app=text("js/app.js");
const styles=text("css/styles.css");
const saved=text("js/saved-stories.js");
const savedStyle=text("css/saved-stories.css");
const share=text("js/visual-share.js");
const shareStyle=text("css/visual-share.css");
const html=text("index.html");

test("Preferences is the common duration and easing reference for all opening screens",()=>{
  assert.match(styles,/--floew-panel-motion-duration:\.32s/);
  assert.match(styles,/--floew-panel-motion-ease:cubic-bezier\(\.22,\.61,\.36,1\)/);
  for(const selector of [
    "#menu-overlay","#stats-overlay","#source-viewer-overlay",
    "#settings-menu","#public-stats-panel","#source-viewer-panel",
    "#about-doc-viewer",".flora-story-popover","#time-range-panel",
    ".keyword-tool-panel","#control-menu-panel"
  ]){
    assert.ok(styles.slice(styles.indexOf("Flöw panel motion standard")).includes(selector),selector);
  }
  assert.match(styles,/#about-doc-viewer\.open\{[\s\S]*?animation:none !important/);
  assert.match(styles,/prefers-reduced-motion:reduce/);
  assert.match(savedStyle,/\.floew-saved-overlay\.open[\s\S]*?opacity:1/);
  assert.match(savedStyle,/\.floew-saved-overlay\.open \.floew-saved-panel/);
  assert.match(shareStyle,/\.floew-visual-share\.open[\s\S]*?opacity:1/);
  assert.match(shareStyle,/\.floew-visual-share\.open \.floew-visual-share-dialog/);
});

test("Saved and visual-share dialogs do not hide their pixels before the exit completes",()=>{
  for(const source of [saved,share]){
    const start=source.indexOf("function closePanel(){")>=0
      ? source.indexOf("function closePanel(){") : source.indexOf("function close(){");
    const next=source.indexOf("\n  function ",start+10);
    const block=source.slice(start,next);
    const fade=block.indexOf('classList.remove("open")');
    const hidden=block.indexOf(".hidden=true");
    assert.ok(fade>=0 && hidden>fade,source===saved?"saved":"share");
    assert.match(block,/setTimeout\(\(\)=>\{/);
    assert.match(block,/reduced\?0:340/);
    assert.match(block,/queueUiFlowResumeCheck/);
  }
  assert.match(saved,/clearTimeout\(panelExitTimer\)/);
  assert.match(share,/clearTimeout\(overlayExitTimer\)/);
  assert.match(saved,/panel\.setAttribute\("inert",""\)/);
  assert.match(share,/overlay\.setAttribute\("inert",""\)/);
});

test("Flöra popover preserves its fade and ignores late data after closing",()=>{
  assert.match(app,/let floraPopoverExitTimer=null/);
  assert.match(app,/popover\.classList\.remove\("open"\)/);
  assert.match(app,/popover\.classList\.add\("open"\)/);
  assert.match(app,/!floraPopoverOpen \|\|/);
  assert.match(styles,/\.flora-story-popover\.open\{[\s\S]*?opacity:1/);
});

test("Source iframe survives the closing fade but is cleared afterwards",()=>{
  const start=app.indexOf("function closeSourceViewer(){");
  const end=app.indexOf("\n}",start);
  const block=app.slice(start,end);
  assert.match(block,/sourceViewerExitTimer=setTimeout\(\(\)=>\{/);
  assert.match(block,/if\(!sourceViewerOpen\)frame\.src="about:blank"/);
  assert.match(app,/clearTimeout\(sourceViewerExitTimer\);\s*sourceViewerOpen=true;/);
});

test("All new motion assets have fresh HTML version parameters",()=>{
  for(const version of [
    "20261124-keyword-screen1","visual-share.css?v=2",
    "visual-share.js?v=7","saved-stories.js?v=22",
    "keywords-screen1"
  ]){
    assert.ok(html.includes(version),version);
  }
  assert.match(saved,/saved-stories\.css\?v=20/);
});

test("Saved dialog preserves closing fade, keeps navigation blocked, and can reopen mid-exit",()=>{
  const begin=saved.indexOf("function openPanel(){");
  const end=saved.indexOf("function setupPanel(){",begin);
  const code=saved.slice(begin,end);
  const state=new Set(["inert"]);
  const attrs=new Map([["aria-hidden","true"]]);
  const panel={
    hidden:true,
    offsetWidth:760,
    classList:{
      add:k=>state.add(k),remove:k=>state.delete(k),contains:k=>state.has(k)
    },
    setAttribute:(k,v)=>attrs.set(k,v),
    removeAttribute:k=>attrs.delete(k),
    getAttribute:k=>attrs.get(k)
  };
  let nextTimer=1,resumeCount=0,focusCount=0;
  const timers=new Map();
  const context={
    panel,panelExitTimer:null,lastFocus:null,
    document:{
      activeElement:{isConnected:true,focus(){focusCount++}},
      body:{classList:{add(){},remove(){}}}
    },
    window:{
      pauseFlowForUi(){},
      queueUiFlowResumeCheck(){resumeCount++},
      matchMedia:()=>({matches:false})
    },
    render(){},
    $:()=>({focus(){}}),
    setTimeout:(fn,ms)=>{const id=nextTimer++;timers.set(id,{fn,ms});return id},
    clearTimeout:id=>timers.delete(id)
  };
  runInNewContext(code+'\n;globalThis.control={openPanel,closePanel};',context);
  context.control.openPanel();
  assert.equal(panel.hidden,false);
  assert.equal(state.has("open"),true);
  assert.equal(attrs.has("inert"),false);
  context.control.closePanel();
  assert.equal(panel.hidden,false,"visible throughout the exit transition");
  assert.equal(attrs.get("aria-hidden"),"true");
  assert.equal(state.has("open"),false);
  assert.equal(resumeCount,0,"do not resume news while the exit is still visible");
  assert.deepEqual([...timers.values()].map(x=>x.ms),[340]);
  context.control.openPanel();
  assert.equal(timers.size,0,"reopen cancels pending close");
  assert.equal(panel.hidden,false);
  context.control.closePanel();
  for(const entry of [...timers.values()])entry.fn();
  assert.equal(panel.hidden,true);
  assert.equal(resumeCount,1);
  assert.ok(focusCount>=2);
});
