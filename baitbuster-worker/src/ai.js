import {
  sanitizeClassificationResult,
  sanitizeRewriteResult
} from "./core.js";

const DEFAULT_MODEL="@cf/meta/llama-3.3-70b-instruct-fp8-fast";
const AI_TIMEOUT_MS=18000;

const CLASSIFICATION_PROMPT=`Evaluate meaning, not keyword matches. For each Turkish news item, decide whether the headline is materially clickbait. Treat it as clickbait when it withholds a concrete central fact, identity, action, result, object, amount, place or consequence that a reader would reasonably expect from a factual headline; creates an artificial curiosity gap; or foregrounds suspense/emotion while the supplied description already reveals the concrete news fact. Do not require extreme sensationalism. Compare the headline semantically with the description: if the description states the central fact more directly than the headline and the omission appears deliberate, that is strong evidence of clickbait. Do not penalize concise breaking-news headlines merely for being short, and do not penalize a headline that already states the central event clearly. Do not rewrite in this step. Return one result for every supplied key. Set needsArticle to true whenever clickbait is true, because every suspected clickbait headline must be verified against the article body; otherwise set needsArticle to false.`;

const REWRITE_PROMPT=`Rewrite only when the supplied publisher description and/or article text contain enough explicit facts to state the central news event more directly than the original headline. You may use facts that are explicit in either the supplied description or the article text. Never infer motives, causes, numbers, identities, outcomes or certainty that are not explicit. Prefer the most concrete fact that the original headline obscures. Preserve attribution and uncertainty when the source text uses them. If the available text still does not reveal a meaningful concrete fact beyond the original headline, return insufficient_content. If rewritten, produce a neutral Turkish news headline, normally 7-18 words, that states the subject and central event directly. Do not add commentary, labels, quotation marks, moral judgment or facts absent from the supplied material.`;

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
