import {
  sanitizeClassificationResult,
  sanitizeRewriteResult
} from "./core.js";

const DEFAULT_MODEL="@cf/meta/llama-3.3-70b-instruct-fp8-fast";
const AI_TIMEOUT_MS=18000;

const CLASSIFICATION_PROMPT=`Judge each Turkish headline by how much of the central news fact it lets a reader understand without opening the article. Work semantically, never by keyword matching. Set clickbait=true when the headline withholds, obscures or merely announces the existence of a central fact that the supplied description reveals or strongly indicates should be answered. A headline can need BaitBuster even without sensational language. In particular, when a headline says that a statement, decision, result, list, identity, amount, cause, consequence or practical detail exists but does not communicate its substantive content, treat the missing substance as the information gap. Keep clickbait=false when the headline already communicates the central event and the description only adds secondary detail. For clickbait=true, missingQuestion must be a short Turkish question describing exactly what the headline leaves unanswered. candidateFact must contain the concrete answer from the supplied description when the description explicitly provides it; do not paraphrase the headline itself as candidateFact. Set needsArticle=false only when candidateFact is concrete enough to produce a materially more informative headline. Otherwise set needsArticle=true and candidateFact may be empty. Return one result for every supplied key.`;

const REWRITE_PROMPT=`The goal is INFORMATION GAIN, not paraphrasing. Write a Turkish headline that lets the reader understand materially more about the news without opening the article. First compare the original headline with missingQuestion, candidateFact, publisher description and article text. addedInformation must list 1-3 concrete facts that are explicit in the supplied material and semantically absent from the original headline. Restating the same event with synonyms, adding generic labels, or merely saying that someone made a statement/announcement does NOT count as added information. If candidateFact is non-empty, the rewritten headline must communicate its substantive content unless article text provides a more precise supported answer to the same missingQuestion. If you cannot identify at least one central concrete fact absent from the original, return insufficient_content. informationGain is 0 to 1: 0 means essentially a paraphrase, 1 means the headline now reveals the central fact that the original withheld. Use rewriteStatus=rewritten only when informationGain is at least 0.35 and flowTitle actually contains at least one item from addedInformation. Prefer one self-contained neutral headline of about 9-24 words. Preserve attribution and uncertainty. Never invent facts, motives, numbers, identities, outcomes or certainty not explicit in the supplied material.`;

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

export async function rewriteStory(story,articleText,classification,env){
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
