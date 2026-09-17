import {
  sanitizeClassificationResult,
  sanitizeRewriteResult
} from "./core.js";

const OPENAI_URL="https://api.openai.com/v1/responses";
const OPENAI_TIMEOUT_MS=18000;
const DEFAULT_MODEL="gpt-5.6-luna";

const CLASSIFICATION_PROMPT=`Evaluate meaning, not keyword matches. Mark clickbait only when the headline materially withholds the core fact, creates an artificial curiosity gap, substitutes emotional shock for the event itself, or otherwise prevents the reader from knowing the central news fact from the headline. Do not penalize concise breaking-news headlines merely for being short. Do not rewrite in this step. Evaluate each Turkish news item independently. Return one result for every supplied key.`;

const REWRITE_PROMPT=`Use only facts present in the supplied article text. Never infer motives, causes, numbers, identities or outcomes that are not explicit. If the article text does not reveal the fact hidden by the original headline, return insufficient_content. If rewritten, write a neutral Turkish news headline that states the subject and central event directly, normally in 8-15 words. Do not add commentary, labels, quotation marks, or facts absent from the article.`;

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

function outputTextFromResponse(value){
  if(typeof value?.output_text==="string"&&value.output_text.trim()){
    return value.output_text.trim();
  }
  for(const item of Array.isArray(value?.output)?value.output:[]){
    for(const content of Array.isArray(item?.content)?item.content:[]){
      if(content?.type==="refusal"){
        throw new Error("openai_refusal");
      }
      if(content?.type==="output_text"&&typeof content.text==="string"&&content.text.trim()){
        return content.text.trim();
      }
    }
  }
  throw new Error("openai_missing_output");
}

export function extractStructuredOutput(responseJson){
  const text=outputTextFromResponse(responseJson);
  let parsed;
  try{parsed=JSON.parse(text);}catch{throw new Error("openai_invalid_json");}
  if(!parsed||typeof parsed!=="object"||Array.isArray(parsed)){
    throw new Error("openai_invalid_structure");
  }
  return parsed;
}

async function postStructured({env,systemPrompt,payload,schema,name,fetchImpl}){
  const apiKey=String(env?.OPENAI_API_KEY||"").trim();
  if(!apiKey)throw new Error("openai_api_key_missing");

  const controller=new AbortController();
  const timeout=setTimeout(()=>controller.abort(),OPENAI_TIMEOUT_MS);
  try{
    const response=await fetchImpl(OPENAI_URL,{
      method:"POST",
      signal:controller.signal,
      headers:{
        "Authorization":`Bearer ${apiKey}`,
        "Content-Type":"application/json"
      },
      body:JSON.stringify({
        model:String(env?.OPENAI_MODEL||DEFAULT_MODEL),
        store:false,
        reasoning:{effort:"none"},
        input:[
          {role:"system",content:[{type:"input_text",text:systemPrompt}]},
          {role:"user",content:[{type:"input_text",text:JSON.stringify(payload)}]}
        ],
        text:{
          format:{
            type:"json_schema",
            name,
            strict:true,
            schema
          }
        }
      })
    });

    if(!response.ok){
      let detail="";
      try{detail=(await response.text()).slice(0,500);}catch{}
      const error=new Error(`openai_http_${response.status}`);
      error.detail=detail;
      throw error;
    }

    const json=await response.json();
    if(json?.status==="incomplete")throw new Error("openai_incomplete");
    return extractStructuredOutput(json);
  }catch(error){
    if(error?.name==="AbortError")throw new Error("openai_timeout");
    throw error;
  }finally{
    clearTimeout(timeout);
  }
}

export async function classifyStories(stories,env,fetchImpl=fetch){
  if(!Array.isArray(stories)||!stories.length)return [];
  const payload={
    stories:stories.map(story=>({
      key:story.key,
      title:story.title,
      description:story.description,
      source:story.source,
      category:story.category
    }))
  };
  const parsed=await postStructured({
    env,
    systemPrompt:CLASSIFICATION_PROMPT,
    payload,
    schema:classificationSchema,
    name:"baitbuster_classification",
    fetchImpl
  });
  const knownKeys=new Set(stories.map(story=>story.key));
  const sanitized=sanitizeClassificationResult(parsed.results,knownKeys);
  if(sanitized.length!==knownKeys.size){
    throw new Error("openai_incomplete_classification");
  }
  return sanitized;
}

export async function rewriteStory(story,articleText,env,fetchImpl=fetch){
  const payload={
    story:{
      key:story.key,
      title:story.title,
      description:story.description,
      source:story.source,
      category:story.category
    },
    articleText:String(articleText||"").slice(0,18000)
  };
  const parsed=await postStructured({
    env,
    systemPrompt:REWRITE_PROMPT,
    payload,
    schema:rewriteSchema,
    name:"baitbuster_rewrite",
    fetchImpl
  });
  return sanitizeRewriteResult(parsed,story);
}

export const OPENAI_MODEL_DEFAULT=DEFAULT_MODEL;
