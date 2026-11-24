import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {runInNewContext} from "node:vm";

const read=path=>readFileSync(new URL("../"+path,import.meta.url),"utf8");
const app=read("js/app.js");
const savedStyle=read("css/saved-stories.css");
const styles=read("css/styles.css");
const html=read("index.html");

const begin=app.indexOf("function closeTimeRangePanel(){");
const end=app.indexOf("/* Keyboard users can navigate all three columns",begin);
assert.ok(begin>=0&&end>begin,"tool-screen lifecycle functions are present");
const lifecycle=app.slice(begin,end);

function fixture(){
  const nodes=new Map();
  function element(){
    const classes=new Set();
    const attributes=new Map();
    return {
      value:"",
      classList:{
        add:key=>classes.add(key),
        remove:key=>classes.delete(key),
        contains:key=>classes.has(key)
      },
      setAttribute:(key,value)=>attributes.set(key,value),
      removeAttribute:key=>attributes.delete(key),
      getAttribute:key=>attributes.get(key),
      focus(){}
    };
  }
  for(const id of [
    "time-range-panel","keyword-filter-panel","time-range-close",
    "keyword-filter-close","keyword-filter-input","control-menu-panel"
  ])nodes.set(id,element());

  const menu=nodes.get("control-menu-panel");
  menu.classList.add("open");
  menu.setAttribute("aria-hidden","false");
  let closeMenuCount=0,resumeChecks=0;
  const ctx={
    document:{getElementById:id=>nodes.get(id)||null},
    window:{matchMedia:()=>({matches:false})},
    iddqdModeActive:false,IDDQD_CODE:"IDDQD",
    pauseFlowForUi(){},closeFloraPopover(){},closeMenu(){},
    closeStatsOverlay(){},showFullscreenButton(){},
    renderTimeRangeControl(){},renderKeywordFilterControl(){},
    setKeywordManagerFeedback(){},
    queueUiFlowResumeCheck(){resumeChecks++},
    closeControlMenu(){closeMenuCount++}
  };
  const api=runInNewContext(lifecycle+
    "\n;({openTimeRangePanel,closeTimeRangePanel,openKeywordFilterPanel,closeKeywordFilterPanel})",ctx);
  return {api,nodes,menu,closed:()=>closeMenuCount,resumed:()=>resumeChecks};
}

test("Akış opens and closes without collapsing the hamburger tray",()=>{
  const f=fixture();
  f.api.openTimeRangePanel();
  assert.equal(f.nodes.get("time-range-panel").classList.contains("open"),true);
  assert.equal(f.menu.classList.contains("open"),true);
  f.api.closeTimeRangePanel();
  assert.equal(f.nodes.get("time-range-panel").classList.contains("open"),false);
  assert.equal(f.menu.classList.contains("open"),true);
  assert.equal(f.closed(),0);
  assert.equal(f.resumed(),1);
});

test("Anahtar kelimeler opens and closes without collapsing the hamburger tray",()=>{
  const f=fixture();
  f.api.openKeywordFilterPanel();
  assert.equal(f.nodes.get("keyword-filter-panel").classList.contains("open"),true);
  assert.equal(f.menu.classList.contains("open"),true);
  f.api.closeKeywordFilterPanel();
  assert.equal(f.nodes.get("keyword-filter-panel").classList.contains("open"),false);
  assert.equal(f.menu.classList.contains("open"),true);
  assert.equal(f.closed(),0);
  assert.equal(f.resumed(),1);
});

test("saved icon no longer overrides shared hamburger visibility or pointer states",()=>{
  const defaultRule=savedStyle.match(/#control-menu-panel #saved-stories-button\s*\{([^}]*)\}/)?.[1];
  assert.ok(defaultRule,"saved icon default rule exists");
  assert.doesNotMatch(defaultRule,/visibility\s*:\s*visible\s*!important/);
  assert.doesNotMatch(defaultRule,/pointer-events\s*:\s*auto\s*!important/);
  assert.match(styles,/#control-menu-panel\.is-closing \.control-menu-item\s*\{/);
  assert.match(styles,/#control-menu-panel:not\(\.open\) \.control-menu-item/);
  assert.match(read("js/saved-stories.js"),/"control-menu-item floew-saved-menu fi fi-bookmark"/);
});

test("keyword list close icons are still accessible but do not spawn Sil tooltips",()=>{
  const start=app.indexOf('remove.className="keyword-manager-remove fi fi-close";');
  const end=app.indexOf("row.append(label,remove);",start);
  assert.ok(start>=0&&end>start);
  const removeCode=app.slice(start,end);
  assert.match(removeCode,/remove\.setAttribute\("aria-label",/);
  assert.doesNotMatch(removeCode,/remove\.title\s*=|remove\.setAttribute\("title",/);
});

test("updated menu-related assets have fresh cache keys",()=>{
  assert.match(html,/keywords-screen1-menu-close1/);
  assert.match(html,/saved-stories\.js\?v=22-menu-close1/);
  assert.match(read("js/saved-stories.js"),/saved-stories\.css\?v=20-menu-close1/);
});
