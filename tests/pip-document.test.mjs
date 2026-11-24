import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {runInNewContext} from "node:vm";

const source=readFileSync(new URL("../js/pip-document.js",import.meta.url),"utf8");
const app=readFileSync(new URL("../js/app.js",import.meta.url),"utf8");
const html=readFileSync(new URL("../index.html",import.meta.url),"utf8");

function fixture(){
 const intervals=new Map();
 let nextInterval=1,requestCount=0,animationCount=0;
 class FakeElement{
  constructor(tag){
   this.tagName=tag.toUpperCase();this.children=[];this.parentElement=null;
   this.className="";this.dataset={};this.style={};this.events={};
   this.textContent="";this._src="";this.muted=false;this.currentTime=0;this.duration=10;
   this.classList={
    add:name=>{this.className=(this.className+" "+name).trim()},
    contains:name=>this.className.split(" ").includes(name)
   };
  }
  appendChild(node){node.parentElement=this;this.children.push(node);return node;}
  append(...nodes){for(const node of nodes)this.appendChild(node);}
  insertBefore(node,target){node.parentElement=this;const index=this.children.indexOf(target);this.children.splice(index<0?this.children.length:index,0,node);}
  remove(){if(this.parentElement){const p=this.parentElement;p.children=p.children.filter(n=>n!==this);this.parentElement=null;}}
  setAttribute(name,val){this[name]=String(val);}
  removeAttribute(name){delete this[name];}
  addEventListener(name,fn){(this.events[name]??=[]).push(fn);}
  emit(name){for(const fn of this.events[name]||[])fn();}
  animate(){
   animationCount++;
   return {finished:Promise.resolve(),cancel(){}};
  }
  set src(url){this._src=url;}
  get src(){return this._src;}
  play(){this.playCalled=(this.playCalled||0)+1;return Promise.resolve();}
  pause(){this.pauseCalled=(this.pauseCalled||0)+1;}
  canPlayType(){return "";}
 }
 const pipDocument={
  head:new FakeElement("head"),body:new FakeElement("body"),
  title:"",createElement:tag=>new FakeElement(tag)
 };
 const pipWindow={
  closed:false,document:pipDocument,events:{},
  addEventListener(name,fn){this.events[name]=fn;},
  close(){this.closed=true;this.events.pagehide?.();},
  setInterval(fn,ms){const id=nextInterval++;intervals.set(id,{fn,ms});return id;},
  clearInterval(id){intervals.delete(id);},
  setTimeout(fn){fn();return 1;}
 };
 const baseDocument={baseURI:"https://flow.test/",body:new FakeElement("body")};
 const runtime={window:{documentPictureInPicture:{
  requestWindow:({width,height})=>{
   requestCount++;
   assert.equal(width,480);assert.equal(height,270);
   return Promise.resolve(pipWindow);
  }
 }},document:baseDocument,URL,console:{warn(){}}};
 runInNewContext(source,runtime);
 const slides=[];
 let selected=null,ad=null,busy=false,adEntering=false;
 const config={
  slides,adImage:null,adVideo:null,imageProxyBase:"https://worker.test/image",
  storyKey:s=>s.title,initialStoryImage:s=>s.image,
  storyImageProxy:s=>"https://worker.test/image?url="+encodeURIComponent(s.image),
  ensureHlsLibrary:()=>Promise.resolve(null),
  currentStory:()=>selected,currentAd:()=>ad,
  isBusy:()=>busy,isAdEntering:()=>adEntering,
  direction:()=>"up",reducedMotion:()=>false,status(){}
 };
 const ctrl=runtime.window.FloewDocumentPiP.create(config);
 const scene=()=>pipDocument.body.children.find(el=>el.tagName==="MAIN")?.children.at(-1);
 function findAll(el,tag){
  if(!el)return[];
  return [...(el.tagName===tag.toUpperCase()?[el]:[]),...el.children.flatMap(x=>findAll(x,tag))];
 }
 function slide(story,{loaded=true}={}){
  const img=new FakeElement("img");
  img.complete=loaded;img.naturalWidth=loaded?900:0;
  img.currentSrc=loaded?story.image:"";img.src=story.image;
  img.dataset.imageStage=loaded?"direct":"pending";
  const heading={textContent:story.title};
  let direct=null,embed=null;
  const el={dataset:{storyKey:story.title},img,
   querySelector(sel){
    if(sel===".slide-image")return img;
    if(sel===".headline h1")return heading;
    if(sel===".slide-video.media-visible")return direct;
    if(sel===".slide-embed.media-visible")return embed;
    return null;
   },
   video(src,type="video/mp4"){
    direct=new FakeElement("video");
    direct.__floewMediaDescriptor={url:src,type};
    direct.currentSrc=src;direct.src=src;direct.currentTime=4;
    return direct;
   },
   embed(url){embed=new FakeElement("iframe");embed.src=url;return embed;}
  };
  slides.push(el);
  return el;
 }
 return {
  ctrl,config,slides,pipWindow,scene,findAll,slide,FakeElement,
  setStory:value=>{selected=value;},setAd:value=>{ad=value;},
  setBusy:value=>{busy=value;},tick:()=>{for(const item of intervals.values())item.fn();},
  requestCount:()=>requestCount,animationCount:()=>animationCount,
  media:()=>findAll(scene(),"video")[0],
  image:()=>findAll(scene(),"img").at(-1),
  styles:()=>findAll(pipDocument.head,"style")[0]?.textContent||""
 };
}

test("Document PiP opens during the click and uses a real document, no canvas stream",async()=>{
 const f=fixture();
 const story={title:"First",image:"https://img.test/a.jpg",source:"Source"};
 f.slide(story);f.setStory(story);
 assert.equal(await f.ctrl.toggle(),true);
 assert.equal(f.requestCount(),1);
 assert.equal(f.scene().tagName,"SECTION");
 assert.equal(f.image().src,story.image);
 assert.match(f.styles(),/\.floew-pip-card video\.floew-pip-media/);
 assert.equal(f.ctrl.isActive(),true);
});

test("Late-loaded headline image upgrades in place without removing the current card",async()=>{
 const f=fixture();
 const story={title:"Article",image:"https://img.test/thumb.jpg"};
 const slide=f.slide(story,{loaded:false});f.setStory(story);
 await f.ctrl.toggle();
 const card=f.scene(),first=f.image();
 assert.equal(first.src,story.image);
 slide.img.currentSrc="https://img.test/article.jpg";
 slide.img.complete=true;slide.img.naturalWidth=1600;
 f.tick();
 assert.equal(f.scene(),card);
 assert.equal(f.image().src,"https://img.test/article.jpg");
 assert.notEqual(f.image(),first);
 assert.ok(card.children.includes(first),"old image stays until upgrade is loaded");
 f.image().emit("load");
 assert.ok(f.image().classList.contains("is-ready"));
});

test("Native video news gets a playable video element, not a static poster",async()=>{
 const f=fixture();
 const story={title:"Movie",image:"https://img.test/poster.jpg"};
 const slide=f.slide(story);f.setStory(story);
 await f.ctrl.toggle();
 slide.video("https://stream.test/video.mp4");
 f.tick();
 const video=f.media();
 assert.ok(video);
 assert.equal(video.src,"https://stream.test/video.mp4");
 video.emit("loadeddata");
 assert.ok(video.classList.contains("is-ready"));
 assert.ok(video.playCalled>=1);
});

test("Video advertisement plays as native media and keeps the ad marker",async()=>{
 const f=fixture();
 const story={title:"News",image:"https://img.test/news.jpg"};
 f.slide(story);f.setStory(story);await f.ctrl.toggle();
 const ad={id:"ads-1",type:"video",src:"https://cdn.test/ad.mp4"};
 f.ctrl.transitionAd(ad);
 const video=f.media();
 assert.ok(video,"video advertisement uses a video element");
 assert.equal(video.src,ad.src);
 video.emit("canplay");
 assert.ok(video.classList.contains("is-ready"));
 assert.equal(video.loop,false);
 assert.ok(f.scene().textContent!=="Video reklamı");
});

test("Provider iframe and compositor transitions use the PiP document",async()=>{
 const f=fixture();
 const a={title:"A",image:"https://img.test/a.jpg"};
 const b={title:"B",image:"https://img.test/b.jpg"};
 f.slide(a);const slideB=f.slide(b);
 f.setStory(a);await f.ctrl.toggle();
 slideB.embed("https://www.youtube.com/embed/abcdefg?autoplay=1");
 f.ctrl.transitionStory(b,1);
 const iframe=f.findAll(f.scene(),"iframe")[0];
 assert.ok(iframe);
 assert.match(iframe.src,/youtube\.com\/embed/);
 assert.ok(f.animationCount()>=2,"native compositor animates both cards");
});

test("Opening and closing is explicit; audio/video providers are configurable",async()=>{
 const f=fixture();
 assert.equal(f.ctrl.isActive(),false);
 assert.equal(await f.ctrl.toggle(),true);
 assert.equal(f.ctrl.isActive(),true);
 assert.equal(await f.ctrl.toggle(),false);
 assert.equal(f.ctrl.isActive(),false);
 assert.match(app,/floewDocumentPiP\?\.supported\(\)/);
 assert.match(app,/ensureHlsLibrary,/);
 assert.match(html,/src="js\/pip-document\.js\?v=3"/);
 assert.ok(html.indexOf("js/pip-document.js?v=3")<html.indexOf("js/app.js?v="));
});
