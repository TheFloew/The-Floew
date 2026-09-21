import {readFile} from "node:fs/promises";
import test from "node:test";
import assert from "node:assert/strict";
import {classifyStories,rewriteStory,AI_MODEL_DEFAULT,AI_GATE_MODEL_DEFAULT,GATE_CONFIDENCE_THRESHOLD} from "../src/ai.js";

test("8B gate skips 70B only for clearly non-clickbait headlines at the confidence threshold",async()=>{
  const calls=[];
  const env={
    AI:{
      async run(model,input){
        calls.push({model,input});
        if(model!==AI_GATE_MODEL_DEFAULT)throw new Error("70B should not run");
        return {response:"0|clear|0.90"};
      }
    }
  };

  const rows=await classifyStories([{
    key:"a",
    url:"https://example.com/a",
    title:"Merkez Bankası politika faizini yüzde 42,5'e indirdi",
    description:"Para Politikası Kurulu faiz kararını açıkladı.",
    source:"Kaynak",
    category:"Gündem"
  }],env);

  assert.equal(GATE_CONFIDENCE_THRESHOLD,.90);
  assert.equal(rows.length,1);
  assert.equal(rows[0].clickbait,false);
  assert.equal(rows[0].reasonCode,"clear_headline_8b_gate");
  assert.equal(rows[0].modelVersion,AI_GATE_MODEL_DEFAULT);
  assert.deepEqual(calls.map(call=>call.model),[AI_GATE_MODEL_DEFAULT]);
});

test("8B gate escalates uncertain clear headlines to the 70B classifier",async()=>{
  const calls=[];
  const env={
    AI:{
      async run(model,input){
        calls.push(model);
        if(model===AI_GATE_MODEL_DEFAULT)return {response:"0|clear|0.89"};
        const payload=JSON.parse(input.messages[1].content);
        return {response:{results:[{
          key:payload.stories[0].key,
          clickbait:true,
          confidence:.82,
          needsArticle:false,
          reasonCode:"withheld_statement_content",
          missingQuestion:"Ne açıklandı?",
          candidateFact:"Somut açıklama"
        }]}};
      }
    }
  };

  const rows=await classifyStories([{
    key:"a",
    url:"https://example.com/a",
    title:"Beklenen açıklama geldi",
    description:"Somut açıklama",
    source:"Kaynak",
    category:"Gündem"
  }],env);

  assert.deepEqual(calls,[AI_GATE_MODEL_DEFAULT,AI_MODEL_DEFAULT]);
  assert.equal(rows[0].clickbait,true);
  assert.equal(rows[0].modelVersion,AI_MODEL_DEFAULT);
});

test("8B gate escalates review decisions even with high confidence",async()=>{
  const calls=[];
  const env={
    AI:{
      async run(model,input){
        calls.push(model);
        if(model===AI_GATE_MODEL_DEFAULT)return {response:"0|review|0.99"};
        const payload=JSON.parse(input.messages[1].content);
        return {response:{results:[{
          key:payload.stories[0].key,
          clickbait:false,
          confidence:.94,
          needsArticle:false,
          reasonCode:"clear_headline",
          missingQuestion:"",
          candidateFact:""
        }]}};
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

  assert.deepEqual(calls,[AI_GATE_MODEL_DEFAULT,AI_MODEL_DEFAULT]);
  assert.equal(rows[0].clickbait,false);
  assert.equal(rows[0].reasonCode,"clear_headline");
});

test("8B gate failure safely falls back to the 70B classifier",async()=>{
  const calls=[];
  const env={
    AI:{
      async run(model,input){
        calls.push(model);
        if(model===AI_GATE_MODEL_DEFAULT)throw new Error("gate unavailable");
        const payload=JSON.parse(input.messages[1].content);
        return {response:{results:[{
          key:payload.stories[0].key,
          clickbait:false,
          confidence:.96,
          needsArticle:false,
          reasonCode:"clear_headline",
          missingQuestion:"",
          candidateFact:""
        }]}};
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

  assert.deepEqual(calls,[AI_GATE_MODEL_DEFAULT,AI_MODEL_DEFAULT]);
  assert.equal(rows[0].clickbait,false);
  assert.equal(rows[0].modelVersion,AI_MODEL_DEFAULT);
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

test("8B gate evaluates the full incoming batch in one compact request",async()=>{
  const calls=[];
  const env={
    AI:{
      async run(model,input){
        calls.push({model,input});
        assert.equal(model,AI_GATE_MODEL_DEFAULT);
        const payload=JSON.parse(input.messages[1].content);
        return {
          response:payload.stories.map(story=>`${story.key}|clear|0.95`).join("\n")
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
  assert.equal(calls.length,1);
  assert.equal(JSON.parse(calls[0].input.messages[1].content).stories.length,9);
});

test("classification policy treats unanswered question-form headlines as information gaps",async()=>{
  const source=await readFile(new URL("../src/ai.js",import.meta.url),"utf8");
  assert.match(source,/question-form headline/i);
  assert.match(source,/headline itself can establish the information gap/i);
  assert.match(source,/description does not reveal the answer/i);
  assert.match(source,/needsArticle=true/i);
});

test("classification policy escalates vague announcements that hide the substantive development",async()=>{
  const source=await readFile(new URL("../src/ai.js",import.meta.url),"utf8");
  assert.match(source,/new development/i);
  assert.match(source,/first statement/i);
  assert.match(source,/revealed who/i);
  assert.match(source,/central substance/i);
});

test("rewrite policy answers the missing question instead of preserving the teaser",async()=>{
  const source=await readFile(new URL("../src/ai.js",import.meta.url),"utf8");
  assert.match(source,/answer the missingQuestion directly/i);
  assert.match(source,/do not output another question/i);
});

test("8B gate uses compact ids instead of long story keys in its payload",async()=>{
  const originalKey="https://example.com/very/long/path|Bu oldukça uzun bir haber başlığıdır";
  let sentKey="";
  const env={
    AI:{
      async run(model,input){
        assert.equal(model,AI_GATE_MODEL_DEFAULT);
        const payload=JSON.parse(input.messages[1].content);
        sentKey=payload.stories[0].key;
        return {response:"0|clear|0.95"};
      }
    }
  };
  const rows=await classifyStories([{
    key:originalKey,
    url:"https://example.com/a",
    title:"Başlık",
    description:"Açıklama",
    source:"Kaynak",
    category:"Gündem"
  }],env);
  assert.equal(sentKey,"0");
  assert.equal(rows[0].key,originalKey);
});

test("70B classifier still splits and retries structured-output parse failures after gate escalation",async()=>{
  const classifierCalls=[];
  const env={
    AI:{
      async run(model,input){
        const payload=JSON.parse(input.messages[1].content);
        if(model===AI_GATE_MODEL_DEFAULT){
          return {response:payload.stories.map(story=>`${story.key}|review|0.99`).join("\n")};
        }
        classifierCalls.push(payload.stories.length);
        if(payload.stories.length>1){
          const error=new Error("JSON Mode couldn't be met");
          error.name="Ai._parseError";
          throw error;
        }
        return {response:{results:[{
          key:payload.stories[0].key,
          clickbait:false,
          confidence:.8,
          needsArticle:false,
          reasonCode:"clear_headline",
          missingQuestion:"",
          candidateFact:""
        }]}};
      }
    }
  };
  const stories=Array.from({length:4},(_,i)=>({
    key:`original-${i}`,
    url:`https://example.com/${i}`,
    title:`Başlık ${i}`,
    description:`Açıklama ${i}`,
    source:"Kaynak",
    category:"Gündem"
  }));
  const rows=await classifyStories(stories,env);
  assert.equal(rows.length,4);
  assert.deepEqual(rows.map(row=>row.key),stories.map(story=>story.key));
  assert.ok(classifierCalls.some(size=>size===4));
  assert.ok(classifierCalls.some(size=>size===2));
  assert.ok(classifierCalls.some(size=>size===1));
});
