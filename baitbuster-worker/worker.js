/*
  The Flöw — BaitBuster β Worker
  Cloudflare Workers AI + KV single-file build.
  Generated from baitbuster-worker/src/*.
*/

const RESULT_STATUSES=new Set([
  "rewritten",
  "not_clickbait",
  "insufficient_content",
  "article_error",
  "ai_error",
  "invalid_story"
]);

export function clamp01(value){
  const n=Number(value);
  return Number.isFinite(n)?Math.max(0,Math.min(1,n)):0;
}

export function normalizeStory(input){
  if(!input||typeof input!=="object")return null;
  const title=String(input.title||"").trim().slice(0,700);
  const rawUrl=String(input.url||"").trim();
  if(!title||!rawUrl)return null;

  let url;
  try{url=new URL(rawUrl);}catch{return null;}
  if(url.protocol!=="https:"&&url.protocol!=="http:")return null;

  return {
    key:String(input.key||rawUrl).trim().slice(0,900),
    url:url.href,
    title,
    description:String(input.description||"").trim().slice(0,1800),
    source:String(input.source||"").trim().slice(0,180),
    category:String(input.category||"").trim().slice(0,120)
  };
}

export async function storyCacheKey(story){
  const text=`${story.url}\n${story.title}`;
  const digest=await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(text)
  );
  return [...new Uint8Array(digest)]
    .map(v=>v.toString(16).padStart(2,"0"))
    .join("");
}

export function sanitizeClassificationResult(value,knownKeys){
  if(!Array.isArray(value))return [];
  const allowed=knownKeys instanceof Set?knownKeys:new Set();
  const seen=new Set();
  const out=[];

  for(const row of value){
    if(!row||typeof row!=="object")continue;
    const key=String(row.key||"").trim().slice(0,900);
    if(!key||!allowed.has(key)||seen.has(key))continue;
    seen.add(key);
    const clickbait=Boolean(row.clickbait);
    out.push({
      key,
      clickbait,
      confidence:clamp01(row.confidence),
      needsArticle:clickbait&&Boolean(row.needsArticle),
      reasonCode:String(row.reasonCode||"").trim().slice(0,120),
      missingQuestion:clickbait
        ? String(row.missingQuestion||"").replace(/\s+/g," ").trim().slice(0,240)
        : "",
      candidateFact:clickbait
        ? String(row.candidateFact||"").replace(/\s+/g," ").trim().slice(0,700)
        : ""
    });
  }

  return out;
}


const MATERIAL_STOPWORDS=new Set([
  "ve","veya","ile","bir","bu","şu","o","da","de","için","gibi","daha","çok",
  "sonra","önce","ise","hem","ama","ancak","çünkü","ne","neden","nasıl","kim",
  "nerede","nereye","hangi","kaç","tüm","bütün","ilk","son","yeni"
]);

const GENERIC_MATERIAL_STEMS=[
  "açıkla","duyur","söyle","belirt","ifade","konuş","paylaş","geliş","haber",
  "detay","olay","yap","gel","ol","belli","ortaya","iddia","açıklama"
];

function materialTokens(value){
  const raw=String(value||"").match(/[\p{L}\p{N}]+/gu)||[];
  return raw
    .map(token=>({
      raw:token,
      normalized:token.toLocaleLowerCase("tr-TR")
    }))
    .filter(({raw,normalized})=>{
      if(!normalized||MATERIAL_STOPWORDS.has(normalized))return false;
      if(GENERIC_MATERIAL_STEMS.some(stem=>normalized.startsWith(stem)))return false;
      if(/^\d+$/.test(normalized))return true;
      const first=raw[0]||"";
      const looksProper=
        raw.length>=2 &&
        first===first.toLocaleUpperCase("tr-TR") &&
        first!==first.toLocaleLowerCase("tr-TR");
      return normalized.length>=4||looksProper;
    });
}

function rewriteHasNovelMaterial(story,flowTitle,addedInformation){
  const original=new Set(
    materialTokens(story?.title).map(token=>token.normalized)
  );
  const rewritten=new Set(
    materialTokens(flowTitle).map(token=>token.normalized)
  );

  for(const item of addedInformation){
    for(const token of materialTokens(item)){
      if(
        !original.has(token.normalized) &&
        rewritten.has(token.normalized)
      )return true;
    }
  }
  return false;
}

export function sanitizeRewriteResult(value,story){
  const rawStatus=String(value?.rewriteStatus||"").trim();
  const requestedStatus=rawStatus==="rewritten"||rawStatus==="insufficient_content"
    ?rawStatus
    :"insufficient_content";
  const flowTitle=typeof value?.flowTitle==="string"
    ?value.flowTitle.replace(/\s+/g," ").trim().slice(0,240)
    :"";
  const informationGain=clamp01(value?.informationGain);
  const addedInformation=Array.isArray(value?.addedInformation)
    ? value.addedInformation
        .map(item=>String(item||"").replace(/\s+/g," ").trim().slice(0,260))
        .filter(Boolean)
        .slice(0,3)
    : [];
  const hasMaterialGain=
    informationGain>=0.35 &&
    addedInformation.length>0 &&
    rewriteHasNovelMaterial(story,flowTitle,addedInformation);
  const rewriteStatus=
    requestedStatus==="rewritten" &&
    flowTitle &&
    hasMaterialGain
      ?"rewritten"
      :"insufficient_content";

  return {
    key:String(story?.key||""),
    rewriteStatus,
    flowTitle:rewriteStatus==="rewritten"?flowTitle:null,
    confidence:rewriteStatus==="rewritten"?clamp01(value?.confidence):0,
    informationGain:rewriteStatus==="rewritten"?informationGain:0,
    addedInformation:rewriteStatus==="rewritten"?addedInformation:[]
  };
}

export function originalResult(story,status="invalid_story",extra={}){
  const safeStatus=RESULT_STATUSES.has(status)?status:"invalid_story";
  return {
    key:String(story?.key||""),
    originalTitle:String(story?.title||""),
    flowTitle:null,
    clickbait:Boolean(extra.clickbait),
    classificationConfidence:clamp01(extra.classificationConfidence),
    rewriteConfidence:0,
    informationGain:0,
    addedInformation:[],
    rewriteStatus:safeStatus,
    reasonCode:String(extra.reasonCode||"").slice(0,120),
    modelVersion:String(extra.modelVersion||"").slice(0,120),
    updatedAt:new Date().toISOString()
  };
}

export function rewrittenResult(story,classification,rewrite,modelVersion=""){
  const sanitized=sanitizeRewriteResult(rewrite,story);
  if(sanitized.rewriteStatus!=="rewritten"){
    return originalResult(story,"insufficient_content",{
      clickbait:true,
      classificationConfidence:classification?.confidence,
      reasonCode:classification?.reasonCode,
      modelVersion
    });
  }
  return {
    key:String(story.key||""),
    originalTitle:String(story.title||""),
    flowTitle:sanitized.flowTitle,
    clickbait:true,
    classificationConfidence:clamp01(classification?.confidence),
    rewriteConfidence:clamp01(sanitized.confidence),
    informationGain:clamp01(sanitized.informationGain),
    addedInformation:Array.isArray(sanitized.addedInformation)
      ? sanitized.addedInformation
      : [],
    rewriteStatus:"rewritten",
    reasonCode:String(classification?.reasonCode||"").slice(0,120),
    modelVersion:String(modelVersion||"").slice(0,120),
    updatedAt:new Date().toISOString()
  };
}

const MAX_HTML_BYTES=2*1024*1024;
const MAX_ARTICLE_CHARS=18000;
const FETCH_TIMEOUT_MS=8000;
const MAX_REDIRECTS=4;

function isPrivateIpv4(host){
  const parts=host.split(".");
  if(parts.length!==4||parts.some(p=>!/^[0-9]+$/.test(p)))return false;
  const nums=parts.map(Number);
  if(nums.some(n=>n<0||n>255))return true;
  const [a,b]=nums;
  return a===0||a===10||a===127||
    (a===169&&b===254)||
    (a===172&&b>=16&&b<=31)||
    (a===192&&b===168);
}

function isPrivateIpv6(host){
  const h=host.toLowerCase().replace(/^\[|\]$/g,"");
  if(!h.includes(":"))return false;
  if(h==="::"||h==="::1")return true;
  if(h.startsWith("fc")||h.startsWith("fd"))return true;
  const first=Number.parseInt(h.split(":",1)[0]||"0",16);
  if(Number.isFinite(first)&&(first&0xffc0)===0xfe80)return true;
  const mapped=h.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  return mapped?isPrivateIpv4(mapped[1]):false;
}

export function isSafeArticleUrl(value){
  let url;
  try{url=new URL(String(value||""));}catch{return false;}
  if(url.protocol!=="https:"&&url.protocol!=="http:")return false;
  if(url.username||url.password)return false;

  const host=url.hostname.toLowerCase().replace(/^\[|\]$/g,"");
  if(!host)return false;
  if(host==="localhost"||host.endsWith(".localhost")||host.endsWith(".local"))return false;
  if(isPrivateIpv4(host)||isPrivateIpv6(host))return false;
  return true;
}

function decodeHtmlEntities(text){
  const named={amp:"&",lt:"<",gt:">",quot:'"',apos:"'",nbsp:" "};
  return String(text||"").replace(/&(#x?[0-9a-f]+|[a-z]+);/gi,(full,body)=>{
    if(body[0]==="#"){
      const hex=body[1]?.toLowerCase()==="x";
      const raw=body.slice(hex?2:1);
      const n=Number.parseInt(raw,hex?16:10);
      if(Number.isFinite(n)&&n>0&&n<=0x10ffff){
        try{return String.fromCodePoint(n);}catch{return full;}
      }
      return full;
    }
    return named[body.toLowerCase()]??full;
  });
}

export function cleanArticleText(text){
  return decodeHtmlEntities(text)
    .replace(/\s+/g," ")
    .trim()
    .slice(0,MAX_ARTICLE_CHARS);
}

function removeNoiseBlocks(html){
  return html.replace(
    /<(script|style|noscript|svg|nav|footer|header|form)\b[^>]*>[\s\S]*?<\/\1\s*>/gi,
    " "
  );
}

function visibleText(html){
  return cleanArticleText(
    String(html||"")
      .replace(/<(br|\/p|\/div|\/li|\/h[1-6]|\/section)\s*>/gi," ")
      .replace(/<!--([\s\S]*?)-->/g," ")
      .replace(/<[^>]+>/g," ")
  );
}

function extractPreferredContainer(html){
  const chunks=[];
  for(const tag of ["article","main"]){
    const re=new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)<\\/${tag}\\s*>`,"gi");
    let match;
    while((match=re.exec(html)))chunks.push(match[1]);
  }
  return chunks.join(" ");
}

export function extractArticleText(html){
  const cleaned=removeNoiseBlocks(String(html||""));
  const preferred=extractPreferredContainer(cleaned);
  if(preferred){
    const text=visibleText(preferred);
    if(text.length>=160)return text;
  }

  const paragraphs=[];
  const pRe=/<p\b[^>]*>([\s\S]*?)<\/p\s*>/gi;
  let match;
  while((match=pRe.exec(cleaned)))paragraphs.push(match[1]);
  const paragraphText=visibleText(paragraphs.join(" "));
  if(paragraphText)return paragraphText;
  return visibleText(cleaned);
}

async function readBodyLimited(response,maxBytes=MAX_HTML_BYTES){
  if(!response.body)return response.text();
  const reader=response.body.getReader();
  const decoder=new TextDecoder();
  let total=0;
  let text="";
  try{
    while(true){
      const {done,value}=await reader.read();
      if(done)break;
      total+=value.byteLength;
      if(total>maxBytes)throw new Error("article_too_large");
      text+=decoder.decode(value,{stream:true});
    }
    text+=decoder.decode();
    return text;
  }finally{
    try{reader.releaseLock();}catch{}
  }
}

export async function fetchArticleText(value,fetchImpl=fetch){
  let current=String(value||"");
  if(!isSafeArticleUrl(current))throw new Error("unsafe_article_url");

  const controller=new AbortController();
  const timeout=setTimeout(()=>controller.abort(),FETCH_TIMEOUT_MS);
  try{
    for(let redirects=0;redirects<=MAX_REDIRECTS;redirects++){
      const response=await fetchImpl(current,{
        method:"GET",
        redirect:"manual",
        signal:controller.signal,
        headers:{
          "Accept":"text/html,application/xhtml+xml;q=0.9",
          "User-Agent":"TheFloew-BaitBuster/1.0"
        }
      });

      if(response.status>=300&&response.status<400){
        const location=response.headers.get("location");
        if(!location)throw new Error("redirect_without_location");
        if(redirects>=MAX_REDIRECTS)throw new Error("too_many_redirects");
        current=new URL(location,current).href;
        if(!isSafeArticleUrl(current))throw new Error("unsafe_redirect");
        continue;
      }

      if(!response.ok)throw new Error(`article_http_${response.status}`);
      const type=String(response.headers.get("content-type")||"").toLowerCase();
      if(type&&!type.includes("text/html")&&!type.includes("application/xhtml+xml")){
        throw new Error("article_not_html");
      }
      const declared=Number(response.headers.get("content-length"));
      if(Number.isFinite(declared)&&declared>MAX_HTML_BYTES){
        throw new Error("article_too_large");
      }

      const html=await readBodyLimited(response);
      const text=extractArticleText(html);
      if(text.length<120)throw new Error("article_text_too_short");
      return text;
    }
    throw new Error("too_many_redirects");
  }finally{
    clearTimeout(timeout);
  }
}

const DEFAULT_MODEL="@cf/meta/llama-3.3-70b-instruct-fp8-fast";
const DEFAULT_GATE_MODEL="@cf/meta/llama-3.1-8b-instruct-fp8";
const AI_TIMEOUT_MS=18000;
export const GATE_CONFIDENCE_THRESHOLD=.95;

const GATE_PROMPT=`Act as a conservative first-pass filter for Turkish news headlines. Your only job is to decide which headlines are so clearly informative and non-clickbait that a larger model can safely skip reviewing them.

Mark clear ONLY when the headline itself states the central event or fact plainly enough that a reader understands the main news without opening the article. Treat any open-ended or incomplete headline as review when the reader must open the article to learn the central fact. If the headline withholds an answer, result, identity, reason, statement, development, amount, date, or other central fact; asks a question whose answer is central; uses a teaser; is ambiguous; or you are not highly confident, mark review.

A clear headline must leave no unresolved who, what, why, where, when, or how much question that is central to the news. A headline that merely says something happened, was announced, was revealed, was said, became clear, or caused surprise without stating the substance is review.

The description may help you understand context, but do not let the description rescue a vague headline. Judge whether the headline itself is sufficiently informative. When uncertain, always choose review.

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

const SERVICE="thefloew-baitbuster";
const VERSION="1.6.4";
const ALLOWED_ORIGIN="https://xn--flw-tna.tr";
const MAX_STORIES=12;
const CACHE_TTL_SECONDS=30*24*60*60;
const REWRITE_CONCURRENCY=3;

function corsHeaders(origin){
  const headers={
    "Vary":"Origin",
    "Access-Control-Allow-Methods":"POST, OPTIONS",
    "Access-Control-Allow-Headers":"Content-Type, X-BaitBuster-Client, X-BaitBuster-Version",
    "Access-Control-Max-Age":"86400"
  };
  if(origin===ALLOWED_ORIGIN){
    headers["Access-Control-Allow-Origin"]=ALLOWED_ORIGIN;
  }
  return headers;
}

function json(data,status=200,origin=""){
  return new Response(JSON.stringify(data),{
    status,
    headers:{
      "Content-Type":"application/json; charset=utf-8",
      "Cache-Control":"no-store",
      ...corsHeaders(origin)
    }
  });
}

function deploymentReady(env){
  return Boolean(env?.AI&&env?.BAITBUSTER_CACHE);
}

async function readCached(env,key){
  try{return await env.BAITBUSTER_CACHE.get(key,"json");}
  catch(error){
    console.warn("BaitBuster KV read",error);
    return null;
  }
}

async function writeCached(env,key,result){
  try{
    await env.BAITBUSTER_CACHE.put(key,JSON.stringify(result),{
      expirationTtl:CACHE_TTL_SECONDS
    });
  }catch(error){
    console.warn("BaitBuster KV write",error);
  }
}

async function mapLimit(items,limit,worker){
  const results=new Array(items.length);
  let cursor=0;
  const runners=Array.from({length:Math.min(limit,items.length)},async()=>{
    while(true){
      const index=cursor++;
      if(index>=items.length)return;
      try{
        results[index]={status:"fulfilled",value:await worker(items[index],index)};
      }catch(reason){
        results[index]={status:"rejected",reason};
      }
    }
  });
  await Promise.all(runners);
  return results;
}

async function evaluateStories(rawStories,env,ctx){
  const normalized=[];
  const invalid=[];
  const seenKeys=new Set();

  for(const raw of rawStories){
    const story=normalizeStory(raw);
    if(!story){
      invalid.push(originalResult({
        key:String(raw?.key||""),
        title:String(raw?.title||"")
      },"invalid_story"));
      continue;
    }
    if(seenKeys.has(story.key))continue;
    seenKeys.add(story.key);
    normalized.push(story);
  }

  const finalByKey=new Map();
  const uncached=[];
  const cacheKeyByStory=new Map();
  let cacheHits=0;

  await Promise.all(normalized.map(async story=>{
    const cacheKey=`v6:${await storyCacheKey(story)}`;
    cacheKeyByStory.set(story.key,cacheKey);
    const cached=await readCached(env,cacheKey);
    if(cached&&cached.originalTitle===story.title&&cached.key===story.key){
      finalByKey.set(story.key,cached);
      cacheHits++;
    }else{
      uncached.push(story);
    }
  }));

  let classifiedCount=0;
  let gateFiltered=0;
  let suspiciousCount=0;
  let rewrittenCount=0;
  let articleErrors=0;
  let aiErrors=0;
  const cacheWrites=[];
  const modelVersion=String(env.AI_MODEL||AI_MODEL_DEFAULT);

  if(uncached.length){
    let classifications;
    try{
      classifications=await classifyStories(uncached,env);
      classifiedCount=classifications.length;
    }catch(error){
      console.error("BaitBuster classification",JSON.stringify({
        name:String(error?.name||""),
        message:String(error?.message||""),
        stack:String(error?.stack||"").slice(0,1600)
      }));
      aiErrors+=uncached.length;
      for(const story of uncached){
        finalByKey.set(story.key,originalResult(story,"ai_error",{modelVersion}));
      }
      classifications=[];
    }

    if(classifications.length){
      const classByKey=new Map(classifications.map(row=>[row.key,row]));
      const suspicious=[];

      for(const story of uncached){
        const classification=classByKey.get(story.key);
        if(!classification){
          aiErrors++;
          finalByKey.set(story.key,originalResult(story,"ai_error",{modelVersion}));
          continue;
        }

        if(!classification.clickbait){
          if(classification.reasonCode==="clear_headline_8b_gate")gateFiltered++;
          const result=originalResult(story,"not_clickbait",{
            clickbait:false,
            classificationConfidence:classification.confidence,
            reasonCode:classification.reasonCode,
            modelVersion:classification.modelVersion||modelVersion
          });
          finalByKey.set(story.key,result);
          cacheWrites.push([cacheKeyByStory.get(story.key),result]);
          continue;
        }

        suspicious.push({story,classification});
      }

      suspiciousCount=suspicious.length;
      const settled=await mapLimit(suspicious,REWRITE_CONCURRENCY,async entry=>{
        const {story,classification}=entry;
        let articleText="";
        let articleFailed=false;

        if(classification.needsArticle){
          try{
            articleText=await fetchArticleText(story.url);
          }catch(error){
            articleFailed=true;
          }
        }

        try{
          const rewrite=await rewriteStory(story,articleText,classification,env);
          if(rewrite.rewriteStatus==="rewritten"){
            return {
              story,
              result:rewrittenResult(story,classification,rewrite,modelVersion),
              transient:false,
              kind:"rewritten"
            };
          }

          const status=articleFailed&&classification.needsArticle
            ?"article_error"
            :"insufficient_content";
          return {
            story,
            result:originalResult(story,status,{
              clickbait:true,
              classificationConfidence:classification.confidence,
              reasonCode:classification.reasonCode,
              modelVersion
            }),
            transient:status==="article_error",
            kind:status
          };
        }catch(error){
          return {story,result:originalResult(story,"ai_error",{
            clickbait:true,
            classificationConfidence:classification.confidence,
            reasonCode:classification.reasonCode,
            modelVersion
          }),transient:true,kind:"ai_error"};
        }
      });

      for(const row of settled){
        if(row.status!=="fulfilled")continue;
        const {story,result,transient,kind}=row.value;
        finalByKey.set(story.key,result);
        if(kind==="rewritten")rewrittenCount++;
        if(kind==="article_error")articleErrors++;
        if(kind==="ai_error")aiErrors++;
        if(!transient){
          cacheWrites.push([cacheKeyByStory.get(story.key),result]);
        }
      }
    }
  }

  const writePromise=Promise.allSettled(
    cacheWrites
      .filter(([key])=>Boolean(key))
      .map(([key,result])=>writeCached(env,key,result))
  );
  if(ctx?.waitUntil)ctx.waitUntil(writePromise);
  else await writePromise;

  const results=[
    ...normalized.map(story=>finalByKey.get(story.key)||originalResult(story,"ai_error")),
    ...invalid
  ];

  console.log(JSON.stringify({
    event:"baitbuster_evaluate",
    total:rawStories.length,
    valid:normalized.length,
    cacheHits,
    classified:classifiedCount,
    gateFiltered,
    suspicious:suspiciousCount,
    rewritten:rewrittenCount,
    articleErrors,
    aiErrors
  }));

  return results;
}

export async function handleRequest(request,env,ctx){
  const url=new URL(request.url);
  const origin=request.headers.get("Origin")||"";

  if(request.method==="OPTIONS"){
    if(origin!==ALLOWED_ORIGIN)return new Response(null,{status:403,headers:corsHeaders(origin)});
    return new Response(null,{status:204,headers:corsHeaders(origin)});
  }

  if(request.method==="GET"&&url.pathname==="/health"){
    return json({ok:true,service:SERVICE,version:VERSION},200,origin);
  }

  if(url.pathname!=="/v1/evaluate"){
    return json({ok:false,error:"not_found"},404,origin);
  }
  if(request.method!=="POST"){
    return json({ok:false,error:"method_not_allowed"},405,origin);
  }
  if(origin!==ALLOWED_ORIGIN){
    return json({ok:false,error:"origin_not_allowed"},403,origin);
  }
  if(!deploymentReady(env)){
    return json({ok:false,error:"service_not_configured"},503,origin);
  }

  let body;
  try{body=await request.json();}
  catch{return json({ok:false,error:"invalid_json"},400,origin);}
  if(!Array.isArray(body?.stories)||body.stories.length<1||body.stories.length>MAX_STORIES){
    return json({ok:false,error:"invalid_stories",maxStories:MAX_STORIES},400,origin);
  }

  const results=await evaluateStories(body.stories,env,ctx);
  return json({ok:true,results},200,origin);
}

export default {
  fetch:handleRequest
};
