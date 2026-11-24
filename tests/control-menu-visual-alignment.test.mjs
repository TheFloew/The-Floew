import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";

const read=path=>readFileSync(new URL("../"+path,import.meta.url),"utf8");
const styles=read("css/styles.css");
const icons=read("css/flow-icons.css");
const saved=read("css/saved-stories.css");
const savedScript=read("js/saved-stories.js");
const index=read("index.html");

test("desktop icon menu aligns to the fullscreen/hamburger axis without moving those buttons",()=>{
  const tail=styles.slice(styles.indexOf("V31.96 — Araç menüsü ikonları"));
  assert.ok(tail.length>0);
  assert.match(tail,/@media\(min-width:701px\)\{\s*#control-menu-panel\{/);
  assert.match(tail,/top:calc\(max\(2\.2vh,env\(safe-area-inset-top\)\) \+ 90px\) !important/);
  assert.match(tail,/right:calc\(max\(2\.2vw,env\(safe-area-inset-right\)\) - 3px\) !important/);
  assert.match(tail,/gap:8px !important/);
  assert.doesNotMatch(tail,/#fullscreen-button|#control-menu-button/);
});

test("only the icon drawings receive individual optical corrections",()=>{
  const expected=[
    ["pip-button", "translateX(-1px)"],
    ["time-range-button","translateY(-2px)"],
    ["keyword-filter-button","none"],
    ["keyword-watch-button","translate(-3px,-6px)"],
    ["info-button","translateX(-3px)"],
    ["menu-button","none"]
  ];
  for(const [id,transform] of expected){
    const line=icons.split("\n").find(row=>row.startsWith("#control-menu-panel #"+id+".fi::before"));
    assert.ok(line,"missing "+id);
    assert.ok(line.includes("transform:"+transform+" !important"),id);
  }
  assert.match(saved,/transform:translate\(-6px,-12px\)!important/);
  assert.match(saved,/left:calc\(50% - 6px\)/);
  assert.match(saved,/top:calc\(47% - 12px\)/);
});

test("responsive toolbar keeps the existing mobile top anchor and a small gap",()=>{
  const tail=styles.slice(styles.indexOf("V31.96 — Araç menüsü ikonları"));
  assert.match(tail,/@media\(max-width:700px\)\{\s*#control-menu-panel\{/);
  assert.match(tail,/right:calc\(max\(2\.2vw,env\(safe-area-inset-right\)\) - 2px\) !important/);
  assert.doesNotMatch(tail,/@media\(max-width:700px\)\{[\s\S]*?top:/);
});

test("all affected stylesheets and saved-story script use fresh URLs",()=>{
  assert.match(index,/css\/styles\.css\?v=20261124-icon-alignment1/);
  assert.match(index,/css\/flow-icons\.css\?v=10\.23/);
  assert.match(index,/js\/saved-stories\.js\?v=21/);
  assert.match(savedScript,/saved-stories\.css\?v=19/);
});
