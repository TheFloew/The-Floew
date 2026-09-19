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
    "Bu haberin manşeti Flöw yapay zekası ile değiştirildi. Orijinal metni görmek için tıklayın."
  );
});

test("original mode tooltip offers returning to AI version",async()=>{
  const ui=await loadUI();
  assert.equal(
    ui.markerTitleForMode("original"),
    "Bu haberin manşeti Flöw yapay zekası ile değiştirildi. Yapay zeka versiyonunu görmek için tıklayın."
  );
});
