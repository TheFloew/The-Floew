import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
const {readFile}=fs;
import vm from "node:vm";

async function loadUI(){
  const source=await fs.readFile(
    new URL("../../js/baitbuster-ui.js",import.meta.url),
    "utf8"
  );
  const context={};
  vm.createContext(context);
  vm.runInContext(source,context,{filename:"baitbuster-ui.js"});
  return context.BaitBusterUI;
}

test("toggle switches between ai and original headline modes",async()=>{
  const ui=await loadUI();
  assert.equal(ui.nextMode("ai"),"original");
  assert.equal(ui.nextMode("original"),"ai");
});

test("headlineForMode returns the requested version",async()=>{
  const ui=await loadUI();
  const state={originalTitle:"Orijinal başlık",flowTitle:"AI başlığı"};
  assert.equal(ui.headlineForMode(state,"ai"),"AI başlığı");
  assert.equal(ui.headlineForMode(state,"original"),"Orijinal başlık");
});

test("AI mode tooltip uses the requested explanation",async()=>{
  const ui=await loadUI();
  assert.equal(
    ui.markerTitleForMode("ai"),
    "Bu haberin manşeti β BaitBuster ile değiştirildi. Orijinal metni görmek için tıklayın."
  );
});

test("original mode tooltip offers returning to AI version",async()=>{
  const ui=await loadUI();
  assert.equal(
    ui.markerTitleForMode("original"),
    "Bu haberin manşeti β BaitBuster ile değiştirildi. Yapay zeka versiyonunu görmek için tıklayın."
  );
});

test("marker uses lowercase beta glyph for superscript display",async()=>{
  const ui=await loadUI();
  assert.equal(ui.markerText(),"β");
});

test("navigation guard prevents default and propagation",async()=>{
  const ui=await loadUI();
  const calls=[];
  ui.stopNavigationEvent({
    preventDefault(){calls.push("preventDefault");},
    stopPropagation(){calls.push("stopPropagation");}
  });
  assert.deepEqual(calls,["preventDefault","stopPropagation"]);
});

test("BaitBuster defaults to enabled and persists off state",async()=>{
  const ui=await loadUI();
  const values=new Map();
  const storage={
    getItem:key=>values.has(key)?values.get(key):null,
    setItem:(key,value)=>values.set(key,value)
  };
  assert.equal(ui.loadEnabled(storage),true);
  ui.saveEnabled(storage,false);
  assert.equal(ui.loadEnabled(storage),false);
  assert.equal(ui.settingLabel(false),"Kapalı");
  assert.equal(ui.settingLabel(true),"Açık");
});

test("stable applied result can reuse the existing beta marker",async()=>{
  const ui=await loadUI();
  const current={
    key:"https://example.com/a|Başlık",
    url:"https://example.com/a",
    flowTitle:"Daha açıklayıcı başlık",
    mode:"ai"
  };
  const story={
    key:"https://example.com/a|Başlık",
    url:"https://example.com/a"
  };

  assert.equal(
    ui.canReusePresentation(current,story,"Daha açıklayıcı başlık",true),
    true
  );
  assert.equal(
    ui.canReusePresentation(current,story,"Başka başlık",true),
    false
  );
  assert.equal(
    ui.canReusePresentation(current,story,"Daha açıklayıcı başlık",false),
    false
  );
});

test("production homepage includes the approved BaitBuster integration",async()=>{
  const html=await readFile(new URL("../../index.html",import.meta.url),"utf8");
  assert.match(html,/id="baitbuster-setting"/);
  assert.match(html,/\.baitbuster-rewrite-mark\{/);
  assert.match(html,/js\/baitbuster-ui\.js\?v=5/);
  assert.match(html,/js\/baitbuster-beta\.js\?v=13/);
  assert.doesNotMatch(html,/name="robots"[^>]*noindex/i);
});

test("production homepage keeps BaitBuster enabled by default in Advanced settings",async()=>{
  const html=await readFile(new URL("../../index.html",import.meta.url),"utf8");
  assert.match(
    html,
    /id="baitbuster-setting"[\s\S]*?aria-pressed="true"[\s\S]*?<span class="media-setting-state">Açık<\/span>/
  );
});

test("production BaitBuster setting stays inside the Advanced media setting group",async()=>{
  const html=await readFile(new URL("../../index.html",import.meta.url),"utf8");
  const panel=html.match(/<div class="media-setting-group advanced-setting-group">([\s\S]*?)<\/div>\s*<div class="preference-transfer-setting">/)?.[1]||"";
  assert.match(panel,/id="near-duplicate-setting"/);
  assert.match(panel,/id="baitbuster-setting"/);
});

test("production keeps BaitBuster styles outside the disposable boot style",async()=>{
  const html=await readFile(new URL("../../index.html",import.meta.url),"utf8");
  const boot=html.match(/<style id="boot-black-style">([\s\S]*?)<\/style>/)?.[1]||"";
  const bait=html.match(/<style id="baitbuster-beta-style">([\s\S]*?)<\/style>/)?.[1]||"";

  assert.doesNotMatch(boot,/baitbuster-rewrite-mark/);
  assert.match(bait,/\.headline h1\[data-baitbuster-applied="1"\]\s*\{\s*display:inline;\s*\}/);
  assert.match(bait,/\.baitbuster-rewrite-mark\{/);
});

test("production constrains BaitBuster tooltip inside mobile viewport",async()=>{
  const html=await readFile(new URL("../../index.html",import.meta.url),"utf8");
  assert.match(
    html,
    /@media\s*\(max-width:900px\)[\s\S]*?\.baitbuster-rewrite-mark::after\s*\{[\s\S]*?position:fixed;[\s\S]*?left:12px;[\s\S]*?right:12px;/
  );
});

test("mobile BaitBuster tooltip is controlled by press state, not sticky hover or focus",async()=>{
  const html=await readFile(new URL("../../index.html",import.meta.url),"utf8");
  const client=await readFile(new URL("../../js/baitbuster-beta.js",import.meta.url),"utf8");

  assert.match(html,/@media\(max-width:900px\)[\s\S]*?\.baitbuster-rewrite-mark\.is-pressing::after\s*\{[\s\S]*?opacity:1;[\s\S]*?visibility:visible;/);
  assert.match(html,/@media\(max-width:900px\)[\s\S]*?\.baitbuster-rewrite-mark:hover::after,[\s\S]*?\.baitbuster-rewrite-mark:focus-visible::after\s*\{[\s\S]*?opacity:0;[\s\S]*?visibility:hidden;/);
  assert.match(client,/pointerdown[\s\S]*?classList\.add\("is-pressing"\)/);
  assert.match(client,/pointerup[\s\S]*?classList\.remove\("is-pressing"\)/);
  assert.match(client,/pointercancel[\s\S]*?classList\.remove\("is-pressing"\)/);
});
