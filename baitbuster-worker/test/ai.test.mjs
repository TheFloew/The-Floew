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
            needsArticle:false,
            reasonCode:"withheld_statement_content",
            missingQuestion:"Sefo açıklamasında ne söyledi?",
            candidateFact:"Bağımsız bir merkezde test verdiğini ve sonuçları paylaşacağını söyledi."
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
          flowTitle:"Sefo, bağımsız merkezde test verdiğini ve sonuçları paylaşacağını açıkladı",
          confidence:.91,
          informationGain:.82,
          addedInformation:["Bağımsız merkezde test verdi","Sonuçları paylaşacağını söyledi"]
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
  const result=await rewriteStory(
    story,
    "Yeterli uzunlukta doğrulanabilir haber metni burada yer alıyor.",
    {
      missingQuestion:"Ne söyledi?",
      candidateFact:"Bağımsız merkezde test verdiğini ve sonuçları paylaşacağını söyledi.",
      reasonCode:"withheld_statement_content"
    },
    env
  );
  assert.equal(result.rewriteStatus,"rewritten");
  assert.equal(result.flowTitle,"Sefo, bağımsız merkezde test verdiğini ve sonuçları paylaşacağını açıkladı");
  assert.equal(result.informationGain,.82);
});

test("classifier fails closed when AI binding is missing",async()=>{
  await assert.rejects(
    classifyStories([{key:"a",title:"Başlık",description:"",source:"",category:""}],{}),
    /workers_ai_binding_missing/
  );
});

test("classifier splits large batches into parallel groups of four",async()=>{
  const calls=[];
  const env={
    AI:{
      async run(model,input){
        const payload=JSON.parse(input.messages[1].content);
        calls.push(payload.stories.map(story=>story.key));
        return {
          response:{
            results:payload.stories.map(story=>({
              key:story.key,
              clickbait:false,
              confidence:.8,
              needsArticle:false,
              reasonCode:"clear_headline",
              missingQuestion:"",
              candidateFact:""
            }))
          }
        };
      }
    }
  };

  const stories=Array.from({length:9},(_,i)=>({
    key:String(i),
    url:`https://example.com/${i}`,
    title:`Başlık ${i}`,
    description:`Açıklama ${i}`,
    source:"Kaynak",
    category:"Gündem"
  }));

  const rows=await classifyStories(stories,env);
  assert.equal(rows.length,9);
  assert.equal(calls.length,3);
  assert.deepEqual(calls.map(group=>group.length).sort((a,b)=>a-b),[1,4,4]);
});
