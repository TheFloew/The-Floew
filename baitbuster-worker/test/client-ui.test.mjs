import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
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
