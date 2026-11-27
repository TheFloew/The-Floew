import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {Script,runInNewContext} from "node:vm";
import test from "node:test";

const read=path=>readFileSync(new URL("../"+path,import.meta.url),"utf8");
const source=read("js/share-landing-parity.js");
const css=read("css/share-landing-parity.css");
const doc=read("docs/share-landing-parity.md");

test("shared-story parity script parses and exits on the main feed",()=>{
  assert.doesNotThrow(()=>new Script(source));
  const root={dataset:{}};
  const docStub={documentElement:root,getElementById:()=>null};
  assert.doesNotThrow(()=>runInNewContext(source,{document:docStub}));
  assert.deepEqual(root.dataset,{});
});

test("shared page preserves the same short URL for link and visual shares",()=>{
  assert.match(source,/const shortUrl=/);
  assert.match(source,/visual-share\.js\?v=7/);
  assert.match(source,/qrcode-generator\.js\?v=1/);
  assert.match(source,/shareUrlForArticle:\(\)=>Promise\.resolve\(shortUrl\(\)\)/);
  assert.doesNotMatch(source,/\/s\/create|\/create-short/i);
});

test("Flöra does not turn missing information into a fabricated zero",()=>{
  assert.match(source,/stats\/flora-story/);
  assert.match(source,/stats\/flora-vocabulary/);
  assert.match(source,/flora-inline-value"\)\.textContent="—"/);
});

test("source viewer, feed navigation and reduced-motion affordances exist",()=>{
  assert.match(source,/floew-continue-feed/);
  assert.match(source,/https:\/\/flöw\.tr\//);
  assert.match(source,/share-source-overlay/);
  assert.match(source,/sourceFrame\.src="about:blank"/);
  assert.match(css,/safe-area-inset-top/);
  assert.match(css,/prefers-reduced-motion/);
});

test("the deployment guide warns that the Worker must be updated separately",()=>{
  assert.match(doc,/Share Worker'a manuel ekleme/);
  assert.match(doc,/share-landing-parity\.js\?v=1/);
  assert.match(doc,/Güncel Worker'ı eski bir dosyayla tamamen değiştirme/);
});
