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
