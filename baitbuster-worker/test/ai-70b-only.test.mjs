import test from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import {classifyStories,AI_MODEL_DEFAULT} from "../src/ai.js";

test("BaitBuster classification uses only the 70B model",async()=>{
  const calls=[];
  const env={
    AI:{
      async run(model,input){
        calls.push(model);
        const payload=JSON.parse(input.messages[1].content);
        return {response:{results:payload.stories.map(story=>({
          key:story.key,
          clickbait:false,
          confidence:.95,
          needsArticle:false,
          reasonCode:"clear_headline",
          missingQuestion:"",
          candidateFact:""
        }))}};
      }
    }
  };

  const rows=await classifyStories([{
    key:"a",
    url:"https://example.com/a",
    title:"Merkez Bankası faiz kararını açıkladı",
    description:"Politika faizi yüzde 42,5 oldu.",
    source:"Kaynak",
    category:"Gündem"
  }],env);

  assert.deepEqual(calls,[AI_MODEL_DEFAULT]);
  assert.equal(rows.length,1);
  assert.equal(rows[0].modelVersion,AI_MODEL_DEFAULT);
});

test("70B-only source contains no 8B gate model or gate routing",async()=>{
  const source=await readFile(new URL("../src/ai.js",import.meta.url),"utf8");
  assert.doesNotMatch(source,/llama-3\.1-8b-instruct-fp8/);
  assert.doesNotMatch(source,/runGate\(/);
  assert.doesNotMatch(source,/GATE_CONFIDENCE_THRESHOLD/);
});
