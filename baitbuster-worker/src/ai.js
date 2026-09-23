import {
  sanitizeClassificationResult,
  sanitizeRewriteResult
} from "./core.js";

const DEFAULT_MODEL="@cf/meta/llama-3.3-70b-instruct-fp8-fast";
const DEFAULT_GATE_MODEL="@cf/meta/llama-3.1-8b-instruct-fp8";
const AI_TIMEOUT_MS=18000;
export const GATE_CONFIDENCE_THRESHOLD=.90;

const GATE_PROMPT=`Act as a conservative first-pass filter for Turkish news headlines. Your only job is to decide which headlines are so clearly informative and non-clickbait that a larger model can safely skip reviewing them.

Mark clear ONLY when the headline itself states the central event or fact plainly enough that a reader understands the main news without opening the article. If the headline withholds an answer, result, identity, reason, statement, development, amount, date, or other central fact; asks a question whose answer is central; uses a teaser; is ambiguous; or you are not highly confident, mark review.

The description may help you understand context, but do not mark a vague headline clear merely because the description contains the missing fact. When uncertain, always choose review.

Return exactly one plain-text line for every supplied story and nothing else:
key|clear|confidence
or
key|review|confidence

confidence must be a number from 0 to 1 measuring confidence that the decision is safe. Keep the supplied compact key unchanged.`;

const CLASSIFICATION_PROMPT=`Judge each Turkish headline by how much of the central news fact it lets a reader understand without opening the article. Work semantically, never by keyword matching.

The headline itself can establish the information gap even when the supplied description is equally vague. Set clickbait=true whenever the headline's communicative function is mainly to announce that an answer, development, statement, identity, reason, result or detail exists while withholding the central substance a reader would need to understand the news.

Treat a question-form headline as an information gap when the article is expected to contain a factual answer that is central to the story. Examples of the semantic pattern include asking what a film is about, who a person is, why something happened, when something will happen, how much something costs, or what a result means. Do not require those exact words. If the description explicitly contains the answer, put it in candidateFact and set needsArticle=false. If the description does not reveal the answer, set needsArticle=true so the article can be checked.

Likewise treat teaser-style announcements as information gaps when they promise central information without stating it: a new development without saying what changed, a first statement without saying what was said, revealed who without naming the person, explained why without giving the reason, announced the result without stating the result, or equivalent constructions. Again, these are semantic archetypes, not a keyword list.

Keep clickbait=false when the headline already communicates the central event adequately and the omitted material is merely secondary detail. For clickbait=true, missingQuestion must be a short Turkish question describing exactly what central fact the headline leaves unanswered. candidateFact must contain the concrete answer from the description only when the description actually provides it; never use a paraphrase of the headline itself as candidateFact. Set needsArticle=false only when candidateFact is concrete enough to produce a materially more informative headline. Otherwise set needsArticle=true. Return one result for every supplied key.`;

const REWRITE_PROMPT=`The goal is INFORMATION GAIN, not paraphrasing. Write a Turkish headline that lets the reader understand materially more about the news without opening the article.

First compare the original headline with missingQuestion, candidateFact, publisher description and article text. Answer the missingQuestion directly whenever the supplied material contains a supported answer. If the original headline is a question-form headline and the answer is available, write a declarative answer headline; do not output another question. If the original only announces a new development, first statement, revealed identity, reason, result or similar teaser, the rewrite must state the central substance instead of repeating that an announcement or development exists.

addedInformation must list 1-3 concrete facts that are explicit in the supplied material and semantically absent from the original headline. Restating the same event with synonyms, adding generic labels, or merely saying that someone made a statement/announcement does NOT count as added information. If candidateFact is non-empty, the rewritten headline must communicate its substantive content unless article text provides a more precise supported answer to the same missingQuestion.

If you cannot identify at least one central concrete fact absent from the original, return insufficient_content. informationGain is 0 to 1: 0 means essentially a paraphrase, 1 means the headline now reveals the central fact that the original withheld. Use rewriteStatus=rewritten only when informationGain is at least 0.35 and flowTitle actually contains at least one item from addedInformation. Prefer one self-contained neutral headline of about 9-24 words. Preserve attribution and uncertainty. Never invent facts, motives, numbers, identities, outcomes or certainty not explicit in the supplied material.`;

const classificationSchema={
  type:"object",
  additionalProperties:false,
  properties:{
    results:{
      type:"array",
      items:{
        type:"object",
        additionalProperties:false,
        properties:{
          key:{type:"string"},
          clickbait:{type:"boolean"},
          confidence:{type:"number"},
          needsArticle:{type:"boolean"},
          reasonCode:{type:"string"},
          missingQuestion:{type:"string"},
          candidateFact:{type:"string"}
        },
        required:["key","clickbait","confidence","needsArticle","reasonCode","missingQuestion","candidateFact"]
      }
    }
  },
  required:["results"]
};

const rewriteSchema={
  type:"object",
  additionalProperties:false,
  properties:{
    rewriteStatus:{type:"string",enum:["rewritten","insufficient_content"]},
    flowTitle:{type:["string","null"]},
    confidence:{type:"number"},
    informationGain:{type:"number"},
    addedInformation:{
      type:"array",
      items:{type:"string"},
      maxItems:3
    }
  },
  required:["rewriteStatus","flowTitle","confidence","informationGain","addedInformation"]
};

function normalizeModel(value,fallback){
  return String(value||fallback).trim()||fallback;
}

function classifierModel(env){
  return normalizeModel(env?.AI_MODEL,DEFAULT_MODEL);
}

function gateModel(env){
  return normalizeModel(env?.AI_GATE_MODEL,DEFAULT_GATE_MODEL);
}

export function extractWorkersAIObject(value){
  const response=value?.response;

  if(response&&typeof response==="object"&&!Array.isArray(response)){
    return response;
  }

  if(typeof response==="string"&&response.trim()){
    try{
      const parsed=JSON.parse(response);
      if(parsed&&typeof parsed==="object"&&!Array.isArray(parsed))return parsed;
    }catch{}
  }

  const content=value?.choices?.[0]?.message?.content;
  if(content&&typeof content==="object"&&!Array.isArray(content)){
    return content;
  }
  if(typeof content==="string"&&content.trim()){
    try{
      const parsed=JSON.parse(content);
      if(parsed&&typeof parsed==="object"&&!Array.isArray(parsed))return parsed;
    }catch{}
  }

  throw new Error("workers_ai_invalid_json");
}

function extractWorkersAIText(value){
  if(typeof value?.response==="string")return value.response;
  const content=value?.choices?.[0]?.message?.content;
  return typeof content==="string"?content:"";
}

function parseGateRows(text,knownKeys){
  const allowed=knownKeys instanceof Set?knownKeys:new Set();
  const rows=new Map();

  for(const rawLine of String(text||"").split(/\r?\n/)){
    const line=rawLine.replace(/[`*]/g,"").trim();
    if(!line)continue;
    const match=line.match(/^([^|\s]+)\s*\|\s*(clear|review)\s*\|\s*(0(?:\.\d+)?|1(?:\.0+)?)\s*$/i);
    if(!match)continue;

    const key=String(match[1]||"");
    if(!allowed.has(key)||rows.has(key))continue;
    const confidence=Math.max(0,Math.min(1,Number(match[3])));
    rows.set(key,{
      decision:String(match[2]).toLowerCase(),
      confidence:Number.isFinite(confidence)?confidence:0
    });
  }

  return rows;
}

async function runWithTimeout(promise,ms=AI_TIMEOUT_MS){
  let timeoutId;
  const timeout=new Promise((_,reject)=>{
    timeoutId=setTimeout(()=>reject(new Error("workers_ai_timeout")),ms);
  });
  try{
    return await Promise.race([promise,timeout]);
  }finally{
    clearTimeout(timeoutId);
  }
}

function requireAI(env){
  if(!env?.AI||typeof env.AI.run!=="function"){
    throw new Error("workers_ai_binding_missing");
  }
}

async function runStructured({env,model,systemPrompt,payload,schema,maxTokens}){
  requireAI(env);
  const selectedModel=normalizeModel(model,classifierModel(env));
  const result=await runWithTimeout(
    env.AI.run(selectedModel,{
      messages:[
        {role:"system",content:systemPrompt},
        {role:"user",content:JSON.stringify(payload)}
      ],
      response_format:{
        type:"json_schema",
        json_schema:schema
      },
      temperature:0.1,
      max_tokens:maxTokens
    })
  );

  return extractWorkersAIObject(result);
}

async function runGate(stories,env){
  requireAI(env);
  if(!stories.length)return new Map();

  const indexed=stories.map((story,index)=>({
    aiKey:String(index),
    story
  }));
  const selectedModel=gateModel(env);
  const result=await runWithTimeout(
    env.AI.run(selectedModel,{
      messages:[
        {role:"system",content:GATE_PROMPT},
        {role:"user",content:JSON.stringify({
          stories:indexed.map(({aiKey,story})=>({
            key:aiKey,
            title:story.title,
            description:story.description,
            source:story.source,
            category:story.category
          }))
        })}
      ],
      temperature:0,
      max_tokens:Math.max(96,Math.min(320,indexed.length*18))
    })
  );

  const compactRows=parseGateRows(
    extractWorkersAIText(result),
    new Set(indexed.map(item=>item.aiKey))
  );
  const rowsByOriginalKey=new Map();

  for(const {aiKey,story} of indexed){
    const row=compactRows.get(aiKey);
    if(!row)continue;
    rowsByOriginalKey.set(story.key,{
      ...row,
      modelVersion:selectedModel
    });
  }

  return rowsByOriginalKey;
}

const CLASSIFICATION_CHUNK_SIZE=4;

function isWorkersAIQuotaExhausted(error){
  const message=String(error?.message||"");
  return (
    /\b4006\b/.test(message) &&
    /daily free allocation/i.test(message)
  );
}

function isStructuredOutputError(error){
  const name=String(error?.name||"");
  const message=String(error?.message||"");
  return (
    name.includes("_parseError") ||
    /JSON Mode couldn't be met/i.test(message) ||
    /workers_ai_invalid_json/i.test(message) ||
    /workers_ai_incomplete_classification/i.test(message)
  );
}

async function classifyStoryChunkOnce(stories,env){
  const indexed=stories.map((story,index)=>({
    aiKey:String(index),
    story
  }));
  const selectedModel=classifierModel(env);

  const parsed=await runStructured({
    env,
    model:selectedModel,
    systemPrompt:CLASSIFICATION_PROMPT,
    payload:{
      stories:indexed.map(({aiKey,story})=>({
        key:aiKey,
        title:story.title,
        description:story.description,
        source:story.source,
        category:story.category
      }))
    },
    schema:classificationSchema,
    maxTokens:700
  });

  const knownKeys=new Set(indexed.map(item=>item.aiKey));
  const sanitized=sanitizeClassificationResult(parsed.results,knownKeys);
  if(sanitized.length!==knownKeys.size){
    throw new Error("workers_ai_incomplete_classification");
  }

  const originalKeyByAiKey=new Map(
    indexed.map(item=>[item.aiKey,item.story.key])
  );

  return sanitized.map(row=>({
    ...row,
    key:originalKeyByAiKey.get(row.key)||row.key,
    modelVersion:selectedModel
  }));
}

async function classifyStoryChunk(stories,env){
  try{
    return await classifyStoryChunkOnce(stories,env);
  }catch(error){
    if(!isStructuredOutputError(error)||stories.length<=1)throw error;

    const middle=Math.ceil(stories.length/2);
    const [left,right]=await Promise.all([
      classifyStoryChunk(stories.slice(0,middle),env),
      classifyStoryChunk(stories.slice(middle),env)
    ]);
    return [...left,...right];
  }
}

async function classifyWithLargeModel(stories,env){
  if(!stories.length)return [];
  const chunks=[];
  for(let i=0;i<stories.length;i+=CLASSIFICATION_CHUNK_SIZE){
    chunks.push(stories.slice(i,i+CLASSIFICATION_CHUNK_SIZE));
  }

  const groups=await Promise.all(
    chunks.map(chunk=>classifyStoryChunk(chunk,env))
  );
  return groups.flat();
}

export async function classifyStories(stories,env){
  if(!Array.isArray(stories)||!stories.length)return [];

  let gateRows=new Map();
  try{
    gateRows=await runGate(stories,env);
  }catch(error){
    console.warn("BaitBuster 8B gate",JSON.stringify({
      name:String(error?.name||""),
      message:String(error?.message||"")
    }));
    if(isWorkersAIQuotaExhausted(error))throw error;
  }

  const finalByKey=new Map();
  const needsLargeModel=[];

  for(const story of stories){
    const gate=gateRows.get(story.key);
    if(
      gate?.decision==="clear" &&
      gate.confidence>=GATE_CONFIDENCE_THRESHOLD
    ){
      finalByKey.set(story.key,{
        key:story.key,
        clickbait:false,
        confidence:gate.confidence,
        needsArticle:false,
        reasonCode:"clear_headline_8b_gate",
        missingQuestion:"",
        candidateFact:"",
        modelVersion:gate.modelVersion
      });
    }else{
      needsLargeModel.push(story);
    }
  }

  const deepRows=await classifyWithLargeModel(needsLargeModel,env);
  for(const row of deepRows)finalByKey.set(row.key,row);

  return stories
    .map(story=>finalByKey.get(story.key))
    .filter(Boolean);
}

export async function rewriteStory(story,articleText,classification,env){
  const parsed=await runStructured({
    env,
    model:classifierModel(env),
    systemPrompt:REWRITE_PROMPT,
    payload:{
      story:{
        key:story.key,
        title:story.title,
        description:story.description,
        source:story.source,
        category:story.category
      },
      informationGap:{
        missingQuestion:String(classification?.missingQuestion||""),
        candidateFact:String(classification?.candidateFact||""),
        reasonCode:String(classification?.reasonCode||"")
      },
      articleText:String(articleText||"").slice(0,18000)
    },
    schema:rewriteSchema,
    maxTokens:420
  });

  return sanitizeRewriteResult(parsed,story);
}

export const AI_MODEL_DEFAULT=DEFAULT_MODEL;
export const AI_GATE_MODEL_DEFAULT=DEFAULT_GATE_MODEL;
