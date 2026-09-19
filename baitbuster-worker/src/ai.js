import {
  sanitizeClassificationResult,
  sanitizeRewriteResult
} from "./core.js";

const DEFAULT_MODEL="@cf/meta/llama-3.3-70b-instruct-fp8-fast";
const AI_TIMEOUT_MS=18000;

const CLASSIFICATION_PROMPT=`For each Turkish news item, judge headline informativeness semantically, not with keyword matching. The field clickbait means the headline should be BaitBusted: set it to true when the supplied description contains a concrete, newsworthy central fact that would make the headline materially more informative, but the headline withholds, obscures, generalizes or teases that fact. This includes missing identity, action, result, object, amount, location, timing, cause, consequence or practical detail when that omitted fact is central to why the story matters. Do not require exaggerated or sensational wording. Compare headline and description directly: if a reader learns a materially more concrete answer from the description than from the headline, prefer clickbait=true. Keep clickbait=false when the headline already communicates the central event adequately and extra details are merely secondary. Do not rewrite in this step. Return one result for every supplied key. Set needsArticle=false when the description itself contains enough explicit information to write a meaningfully more direct headline. Set needsArticle=true only when the headline needs improvement but the description still lacks the concrete fact required for a safe rewrite.`;

const REWRITE_PROMPT=`Produce a more informative Turkish news headline only when the supplied publisher description and/or article text contain explicit facts that materially improve on the original headline. Use the description when it already reveals the missing central fact; article text is supplemental when needed. Never infer motives, causes, numbers, identities, outcomes or certainty that are not explicit. Preserve attribution and uncertainty. Prefer concrete subject + action/result over suspense or vague summary. If the available material still does not support a meaningfully more informative headline, return insufficient_content. If rewritten, normally use 7-18 words, keep it neutral and natural, and do not add commentary, labels, quotation marks or facts absent from the supplied material.`;

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
          reasonCode:{type:"string"}
        },
        required:["key","clickbait","confidence","needsArticle","reasonCode"]
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
    confidence:{type:"number"}
  },
  required:["rewriteStatus","flowTitle","confidence"]
};

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

async function runStructured({env,systemPrompt,payload,schema,maxTokens}){
  if(!env?.AI||typeof env.AI.run!=="function"){
    throw new Error("workers_ai_binding_missing");
  }

  const model=String(env.AI_MODEL||DEFAULT_MODEL).trim()||DEFAULT_MODEL;
  const result=await runWithTimeout(
    env.AI.run(model,{
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

export async function classifyStories(stories,env){
  if(!Array.isArray(stories)||!stories.length)return [];

  const parsed=await runStructured({
    env,
    systemPrompt:CLASSIFICATION_PROMPT,
    payload:{
      stories:stories.map(story=>({
        key:story.key,
        title:story.title,
        description:story.description,
        source:story.source,
        category:story.category
      }))
    },
    schema:classificationSchema,
    maxTokens:1200
  });

  const knownKeys=new Set(stories.map(story=>story.key));
  const sanitized=sanitizeClassificationResult(parsed.results,knownKeys);
  if(sanitized.length!==knownKeys.size){
    throw new Error("workers_ai_incomplete_classification");
  }
  return sanitized;
}

export async function rewriteStory(story,articleText,env){
  const parsed=await runStructured({
    env,
    systemPrompt:REWRITE_PROMPT,
    payload:{
      story:{
        key:story.key,
        title:story.title,
        description:story.description,
        source:story.source,
        category:story.category
      },
      articleText:String(articleText||"").slice(0,18000)
    },
    schema:rewriteSchema,
    maxTokens:220
  });

  return sanitizeRewriteResult(parsed,story);
}

export const AI_MODEL_DEFAULT=DEFAULT_MODEL;
