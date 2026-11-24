import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";

const read=path=>readFileSync(new URL("../"+path,import.meta.url),"utf8");
const html=read("index.html");
const styles=read("css/styles.css");
const app=read("js/app.js");

test("Akış and Anahtar kelimeler are full-screen blocking dialogs",()=>{
  for(const [panel,title] of [
    ["time-range-panel","Akış"],
    ["keyword-filter-panel","Anahtar kelimeler"]
  ]){
    assert.match(html,new RegExp('<div id="'+panel+'" class="[^"]*floew-tool-screen" aria-hidden="true" inert>'));
    assert.match(html,new RegExp('role="dialog" aria-modal="true"'));
    assert.ok(html.includes(title));
    assert.match(styles,new RegExp('#'+panel+'\\.floew-tool-screen'));
  }
  assert.match(styles,/background:rgba\(0,0,0,\.80\) !important/);
  assert.match(styles,/--floew-panel-motion-duration,\.32s/);
  assert.match(styles,/\.floew-tool-screen\.open \.floew-tool-screen-content/);
});

test("Akış retains order and time range controls",()=>{
  assert.match(html,/id="time-range-panel"[\s\S]*?data-order-mode="algorithmic"/);
  assert.match(html,/data-order-mode="chronological"/);
  assert.match(html,/data-hours="1"/);
  assert.match(html,/data-hours="all"/);
});

test("keyword manager has one textbox, three actions, three list columns",()=>{
  assert.match(html,/id="keyword-filter-input"/);
  assert.equal((html.match(/id="keyword-filter-input"/g)||[]).length,1);
  for(const id of ["keyword-filter-show","keyword-filter-hide","keyword-watch-apply",
    "keyword-show-list","keyword-hide-list","keyword-alert-list"]){
    assert.ok(html.includes('id="'+id+'"'),id);
  }
  assert.doesNotMatch(html,/id="keyword-watch-input"/);
  assert.doesNotMatch(html,/id="keyword-watch-panel"/);
  assert.doesNotMatch(html,/id="keyword-watch-button"/);
  assert.match(styles,/\.keyword-manager-columns\{\s*display:grid;/);
  assert.match(styles,/\.keyword-manager-item:hover \.keyword-manager-remove/);
});

test("separate keyword watch button and quick-panel anchor logic are removed",()=>{
  assert.doesNotMatch(app,/function alignQuickPanelToTrigger|QUICK_PANEL_ANCHORS/);
  assert.doesNotMatch(app,/openKeywordWatchPanel|closeKeywordWatchPanel|keyword-watch-button/);
  assert.match(app,/pauseFlowForUi\(\)/);
  assert.match(app,/function openTimeRangePanel\(\)/);
  assert.match(app,/function openKeywordFilterPanel\(\)/);
  assert.match(app,/setAttribute\("inert",""\)/);
});

test("both screens close with X, backdrop and Escape",()=>{
  for(const closeId of ["time-range-close","keyword-filter-close"]){
    assert.ok(html.includes('id="'+closeId+'"'),closeId);
  }
  assert.match(app,/if\(e\.target===panel\)closeFn\(\)/);
  assert.match(app,/function closeQuickPanels\(except=""\)/);
  assert.match(app,/if\(e\.key==="Escape"\)/);
});

test("new screens respect mobile layout and cache bust",()=>{
  assert.match(styles,/@media\(max-width:700px\)[\s\S]*?\.keyword-manager-columns/);
  assert.match(styles,/@media\(prefers-reduced-motion:reduce\)[\s\S]*?\.floew-tool-screen/);
  assert.match(html,/css\/styles\.css\?v=20261124-keyword-screen1/);
  assert.match(html,/js\/app\.js\?v=[^"]*keywords-screen1/);
});
