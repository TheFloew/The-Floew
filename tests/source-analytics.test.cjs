'use strict';
(function sourceAnalyticsTests(){
"use strict";
const {test}=require("node:test");
const assert=require("node:assert/strict");
const {readFileSync}=require("node:fs");
const {resolve}=require("node:path");
const worker=readFileSync(resolve(__dirname,"../analytics/worker-flora-prediction.js"),"utf8")
 .replace(/\bexport\s+default\s*\{/,"const __worker_export__ = {");
const api=new Function(worker+"\nreturn {sourceStatsReport,sourceReportHtml,calculateFlora};")();
const name="Örnek <haber> & kaynak";
function db(kind){
 return {prepare(sql){
  return {
   bind(){return this},
   first:async()=>({value:"1"}),
   all:async()=>{
    if(kind==="content"){
     if(sql.includes("COUNT(DISTINCT"))return {results:[
      {source:name,stories:2,views:10,dwell_sum_ms:62000,dwell_count:5},
      {source:"Başka",stories:1,views:3,dwell_sum_ms:3000,dwell_count:1}
     ]};
     return {results:[
      {source:name,story_key:"first",views:8,avg_dwell_ms:9000,avg_target_ms:11000,completes:5,skips:0,backs:1,source_opens:1},
      {source:name,story_key:"second",views:2,avg_dwell_ms:1500,avg_target_ms:11000,completes:0,skips:1,backs:0,source_opens:0},
      {source:"Başka",story_key:"third",views:3,avg_dwell_ms:1000,avg_target_ms:11000,completes:0,skips:0,backs:0,source_opens:0}
     ]};
    }
    if(sql.includes("COUNT(DISTINCT"))return {results:[
     {source:name,visitors:4,shares:6,tracked_views:10},
     {source:"Başka",visitors:2,shares:0,tracked_views:3}
    ]};
    return {results:[
     {source:name,device:"desktop",browser:"Firefox",views:7},
     {source:name,device:"mobile",browser:"Safari",views:3},
     {source:"Başka",device:"Bilinmiyor",browser:"Bilinmiyor",views:3}
    ]};
   }
  };
 }};
}
test("Source reach, shares and per-visitor time use independent totals",async()=>{
 const data=await api.sourceStatsReport({CONTENT_DB:db("content"),BEHAVIOR_DB:db("behavior")},"7d");
 assert.equal(data.sources.length,2);
 const first=data.sources.find(s=>s.source===name);
 assert.equal(first.stories,2);
 assert.equal(first.views,10);
 assert.equal(first.visitors,4);
 assert.equal(first.shares,6);
 assert.equal(first.dwell_sum_ms,62000);
 assert.equal(first.avg_user_dwell_ms,15500);
 assert.deepEqual(first.devices.map(d=>d.views),[7,3]);
 assert.equal(first.age.length,0);
 assert.match(first.demographic_status,/henüz mevcut değil/);
 assert.ok(first.avg_flora>=0&&first.avg_flora<=100);
 assert.equal(first.flora_story_count,2);
 assert.equal(first.flora_sampled,false);
});
test("Export escapes source text, excludes raw IDs and filters per source",async()=>{
 const data=await api.sourceStatsReport({CONTENT_DB:db("content"),BEHAVIOR_DB:db("behavior")},"7d");
 const html=api.sourceReportHtml(data,name);
 assert.match(html,/Örnek &lt;haber&gt; &amp; kaynak/);
 assert.doesNotMatch(html,/<haber>/);
 assert.doesNotMatch(html,/visitor_id|session_id/i);
 assert.doesNotMatch(html,/>Başka</);
 assert.equal(api.sourceReportHtml(data,"missing"),null);
 assert.ok(api.sourceReportHtml(data,"").includes("Kaynak karşılaştırması"));
});
})();
