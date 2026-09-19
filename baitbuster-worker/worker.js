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
      reasonCode:String(row.reasonCode||"").trim().slice(0,120)
    });
  }

  return out;
}

export function sanitizeRewriteResult(value,story){
  const rawStatus=String(value?.rewriteStatus||"").trim();
  const requestedStatus=rawStatus==="rewritten"||rawStatus==="insufficient_content"
    ?rawStatus
    :"insufficient_content";
  const flowTitle=typeof value?.flowTitle==="string"
    ?value.flowTitle.replace(/\s+/g," ").trim().slice(0,240)
    :"";
  const rewriteStatus=requestedStatus==="rewritten"&&flowTitle
    ?"rewritten"
    :"insufficient_content";

  return {
    key:String(story?.key||""),
    rewriteStatus,
    flowTitle:rewriteStatus==="rewritten"?flowTitle:null,
    confidence:rewriteStatus==="rewritten"?clamp01(value?.confidence):0
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

const SERVICE="thefloew-baitbuster";
const VERSION="1.2.0";
const ALLOWED_ORIGIN="https://xn--flw-tna.tr";
const MAX_STORIES=12;
const CACHE_TTL_SECONDS=30*24*60*60;
const REWRITE_CONCURRENCY=3;

function corsHeaders(origin){
  const headers={
    "Vary":"Origin",
    "Access-Control-Allow-Methods":"POST, OPTIONS",
    "Access-Control-Allow-Headers":"Content-Type",
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
    const cacheKey=`v2:${await storyCacheKey(story)}`;
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
      console.error("BaitBuster classification",error);
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
          const result=originalResult(story,"not_clickbait",{
            clickbait:false,
            classificationConfidence:classification.confidence,
            reasonCode:classification.reasonCode,
            modelVersion
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
        let articleText;
        try{
          articleText=await fetchArticleText(story.url);
        }catch(error){
          return {story,result:originalResult(story,"article_error",{
            clickbait:true,
            classificationConfidence:classification.confidence,
            reasonCode:classification.reasonCode,
            modelVersion
          }),transient:true,kind:"article_error"};
        }

        try{
          const rewrite=await rewriteStory(story,articleText,env);
          const result=rewrite.rewriteStatus==="rewritten"
            ?rewrittenResult(story,classification,rewrite,modelVersion)
            :originalResult(story,"insufficient_content",{
              clickbait:true,
              classificationConfidence:classification.confidence,
              reasonCode:classification.reasonCode,
              modelVersion
            });
          return {story,result,transient:false,kind:result.rewriteStatus};
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
