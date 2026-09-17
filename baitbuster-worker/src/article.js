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
