import {
  normalizeStory,
  storyCacheKey,
  originalResult,
  rewrittenResult
} from "./core.js";
import {fetchArticleText} from "./article.js";
import {
  classifyStories,
  rewriteStory,
  AI_MODEL_DEFAULT
} from "./ai.js";

const SERVICE="thefloew-baitbuster";
const VERSION="1.3.0";
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
    const cacheKey=`v3:${await storyCacheKey(story)}`;
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
          const rewrite=await rewriteStory(story,articleText,env);
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
