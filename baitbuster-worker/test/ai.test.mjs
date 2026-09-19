import test from "node:test";
import assert from "node:assert/strict";
import {classifyStories,rewriteStory,AI_MODEL_DEFAULT} from "../src/ai.js";

test("classifier uses Workers AI JSON schema and default model",async()=>{
  let call=null;
  const env={
    AI:{
      async run(model,input){
        call={model,input};
        return {response:{
          results:[{
            key:"a",
            clickbait:true,
            confidence:.82,
            needsArticle:true,
            reasonCode:"withheld_core_fact"
          }]
        }};
      }
    }
  };

  const rows=await classifyStories([{
    key:"a",
    url:"https://example.com/a",
    title:"Başlık",
    description:"Açıklama",
    source:"Kaynak",
    category:"Gündem"
  }],env);

  assert.equal(rows.length,1);
  assert.equal(rows[0].clickbait,true);
  assert.equal(call.model,AI_MODEL_DEFAULT);
  assert.equal(call.input.response_format.type,"json_schema");
  assert.equal(call.input.max_tokens,1200);
});

test("rewriter accepts structured Workers AI response",async()=>{
  const env={
    AI:{
      async run(){
        return {response:{
          rewriteStatus:"rewritten",
          flowTitle:"Açık ve doğrudan haber başlığı",
          confidence:.91
        }};
      }
    }
  };

  const story={
    key:"a",
    url:"https://example.com/a",
    title:"Orijinal",
    description:"",
    source:"Kaynak",
    category:"Gündem"
  };
  const result=await rewriteStory(story,"Yeterli uzunlukta doğrulanabilir haber metni burada yer alıyor.",env);
  assert.equal(result.rewriteStatus,"rewritten");
  assert.equal(result.flowTitle,"Açık ve doğrudan haber başlığı");
});

test("classifier fails closed when AI binding is missing",async()=>{
  await assert.rejects(
    classifyStories([{key:"a",title:"Başlık",description:"",source:"",category:""}],{}),
    /workers_ai_binding_missing/
  );
});
