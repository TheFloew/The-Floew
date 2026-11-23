import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {runInNewContext} from "node:vm";

const source=readFileSync(new URL("../js/flora-predictor.js",import.meta.url),"utf8");
const predictor=runInNewContext(source+"\n;globalThis.FloewFloraPredictor;");

test("Turkish capitalization, common filler and duplicate words",()=>{
  const terms=predictor.headlineTerms("İSTANBUL için SON DAKİKA: İstanbul İstanbul otomobil!");
  assert.ok(terms.includes("istanbul"));
  assert.ok(terms.includes("otomobil"));
  assert.ok(!terms.includes("son"));
  assert.ok(!terms.includes("dakika"));
  assert.equal(terms.filter(term=>term==="istanbul").length,1);
});

test("stronger historical engagement produces a higher estimated score",()=>{
  const rows=Array.from({length:24},(_,i)=>({
    title:i<12
      ? `Elektrikli otomobil batarya şarj teknolojisi ${i}`
      : `Futbol transfer kulüp teknik direktör ${i}`,
    views:10,
    flora:i<12?86:21
  }));
  const model=predictor.build(rows);
  const high=predictor.estimate("Elektrikli otomobil batarya teknolojisi",model);
  const low=predictor.estimate("Futbol transfer teknik direktör",model);
  const unseen=predictor.estimate("Adı hiç geçmemiş konu",model);
  assert.equal(model.sampleStories,24);
  assert.ok(high.score>low.score);
  assert.equal(high.estimated,true);
  assert.equal(unseen.score,model.baseline);
  assert.equal(unseen.matchedTerms,0);
});

test("sparse historical data cannot masquerade as a model",()=>{
  const model=predictor.build([
    {title:"Elektrikli otomobil",views:10,flora:80}
  ]);
  assert.equal(predictor.estimate("Elektrikli otomobil",model),null);
});

test("training export is aggregates, not historical story records",()=>{
  const model=predictor.build(Array.from({length:12},(_,i)=>({
    title:"Ulaşım elektrikli yeni sistem "+i,views:4,flora:40+i
  })));
  assert.ok(!("stories" in model));
  assert.ok(model.terms.every(row=>Array.isArray(row)&&row.length===3));
});
