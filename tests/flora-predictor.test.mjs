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

test("two historical occurrences can inform a headline without relying on one-off terms",()=>{
  const rows=Array.from({length:20},(_,i)=>({
    title:i<2?`Fırtınada vapur seferi iptal ${i}`:`Ulaşım hatlarında gündelik sefer düzeni ${i}`,
    views:6,
    flora:i<2?20:48
  }));
  const model=predictor.build(rows);
  assert.ok(model.terms.some(([term,nScore,n])=>term==="fırtınada"&&n===2));
  const estimate=predictor.estimate("Fırtınada vapur seferi",model);
  assert.ok(Number.isFinite(estimate.score));
  assert.ok(estimate.matchedTerms>=1);
});

test("learned title format distinguishes questions without matching story words",()=>{
  const rows=Array.from({length:60},(_,i)=>({
    title:`Gündelik gelişmeler açıklaması ${i}`+(i<30?"?":""),
    views:8,
    flora:i<30?68:28
  }));
  const model=predictor.build(rows);
  const question=predictor.estimate("Bilinmeyen konu?",model);
  const statement=predictor.estimate("Bilinmeyen konu",model);
  assert.equal(question.matchedTerms,0);
  assert.equal(statement.matchedTerms,0);
  assert.ok(question.score>statement.score);
});

test("increased contrast remains bounded and older models remain compatible",()=>{
  const rows=Array.from({length:40},(_,i)=>({
    title:i<20?`Otomobil enerji batarya teknolojisi ${i}`:`Futbol transfer maç direktör ${i}`,
    views:10,
    flora:i<20?90:10
  }));
  const model=predictor.build(rows);
  for(const title of ["Otomobil enerji batarya","Futbol transfer maç","Bilinmeyen haber"]){
    const result=predictor.estimate(title,model);
    assert.ok(Math.abs(result.score-model.baseline)<=16.1);
  }
  const {features, ...oldModel}=model;
  assert.ok(Number.isFinite(predictor.estimate("Otomobil batarya",oldModel).score));
  assert.ok(model.features.every(row=>Array.isArray(row)&&row.length===3));
});
