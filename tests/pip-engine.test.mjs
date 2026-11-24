import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {runInNewContext} from "node:vm";

const engineCode=readFileSync(new URL("../js/pip-engine.js",import.meta.url),"utf8");
const app=readFileSync(new URL("../js/app.js",import.meta.url),"utf8");
const html=readFileSync(new URL("../index.html",import.meta.url),"utf8");

async function flush(){
  for(let i=0;i<14;i++)await Promise.resolve();
}
function fixture({deferImages=false}={}){
  const drawn=[],requested=[],pending=new Map(),timers=new Map();
  let frames=0,clock=100,selected=null,busy=false,ad=null,adEntering=false;
  let nextTimer=1;
  class FakeCanvas{
    constructor(){
      this.width=0;this.height=0;
      this.id="snapshot";
      const self=this;
      this.ctx={
        fillStyle:"",last:null,
        fillRect(){},clearRect(){},save(){},restore(){},translate(){},
        beginPath(){},rect(){},clip(){},
        createLinearGradient(){return {addColorStop(){}};},
        measureText(s){return {width:s.length*14};},
        fillText(s){drawn.push(["text",s]);},
        drawImage(image){
          this.last=image;
          drawn.push(["media",image.id||"image"]);
        },
        getImageData(){
          if(this.last?.tainted)throw new Error("tainted");
          return {data:[0,0,0,0]};
        }
      };
    }
    getContext(){return this.ctx;}
    captureStream(fps){
      this.capturedFPS=fps;
      return {
        getVideoTracks:()=>[{requestFrame(){frames++;}}],
        getTracks:()=>[]
      };
    }
  }
  class FakeVideo{
    constructor(){
      this.style={};
      this.paused=false;this.ended=false;this.readyState=3;
      this.videoWidth=640;this.videoHeight=360;
      this.events=new Map();
    }
    setAttribute(){}
    addEventListener(type,fn){this.events.set(type,fn);}
    play(){this.paused=false;return Promise.resolve();}
    requestPictureInPicture(){return Promise.resolve();}
  }

  function createImage(src,{tainted=true,ready=true}={}){
    const listeners={};
    return {
      id:"dom:"+src,tainted,currentSrc:src,src,
      dataset:{imageStage:"direct"},style:{visibility:"visible"},
      complete:ready,naturalWidth:ready?1200:0,naturalHeight:ready?675:0,
      addEventListener(type,fn){(listeners[type]??=[]).push(fn);},
      emit(type){for(const fn of listeners[type]||[])fn();}
    };
  }
  function makeSlide(story,{src=story.image,ready=true,tainted=true}={}){
    const img=createImage(src,{ready,tainted});
    const slide={
      dataset:{storyKey:story.title},img,
      querySelector(selector){
        if(selector===".slide-image")return img;
        if(selector===".headline h1")return {textContent:story.title};
        return null;
      }
    };
    return slide;
  }
  const slides=[];
  const adImage=createImage("https://cdn.example/ad.png",{tainted:false});
  const adVideo=new FakeVideo();
  adVideo.id="ad-video-frame";
  adVideo.currentSrc="https://flow.tr/ad.mp4";
  adVideo.src=adVideo.currentSrc;

  const doc={
    baseURI:"https://flow.tr/",
    hidden:false,
    pictureInPictureElement:null,
    body:{appendChild(){}},
    createElement(tag){return tag==="canvas"?new FakeCanvas():new FakeVideo();},
    addEventListener(){}
  };
  async function fakeFetch(url){
    const requestedUrl=new URL(url).searchParams.get("url")||url;
    requested.push(requestedUrl);
    if(deferImages){
      return new Promise(resolve=>{
        pending.set(requestedUrl,()=>resolve({
          ok:true,blob:async()=>({src:requestedUrl})
        }));
      });
    }
    return {ok:true,blob:async()=>({src:requestedUrl})};
  }
  const context={
    window:{},document:doc,URL,Image:class{},
    HTMLCanvasElement:FakeCanvas,HTMLVideoElement:FakeVideo,
    createImageBitmap:async blob=>({id:"decoded:"+blob.src,width:1200,height:675}),
    fetch:fakeFetch,console:{warn(){}},
    performance:{now:()=>clock},
    setTimeout(fn,ms){const id=nextTimer++;timers.set(id,{fn,ms});return id;},
    clearTimeout(id){timers.delete(id);},
    queueMicrotask(fn){Promise.resolve().then(fn);}
  };
  runInNewContext(engineCode,context);
  const ctrl=context.window.FloewPiPEngine.create({
    slides,adImage,adVideo,
    imageProxyBase:"https://proxy.example/image",
    storyKey:story=>story.title,
    currentStory:()=>selected,
    currentAd:()=>ad,
    isBusy:()=>busy,
    isAdEntering:()=>adEntering,
    direction:()=>"up",
    status(){}
  });
  return {
    ctrl,slides,adImage,adVideo,drawn,requested,pending,timers,doc,
    makeSlide,createImage,
    select(story){selected=story;},
    setBusy(value){busy=value;},
    setAd(value){ad=value;},
    setAdEntering(value){adEntering=value;},
    forward(ms){clock+=ms;},
    frames(){return frames;},
    async load(url){assert.ok(pending.has(url),"pending "+url);pending.get(url)();await flush();}
  };
}

test("PiP opens without waiting for remote images and sends manual frames",async()=>{
  const f=fixture({deferImages:true});
  const story={title:"A",image:"https://cdn.example/a.jpg"};
  f.slides.push(f.makeSlide(story));
  f.select(story);
  assert.equal(await f.ctrl.toggle(),true);
  assert.equal(f.ctrl.isActive(),true);
  assert.ok(f.frames()>0);
  assert.deepEqual(f.requested,[story.image]);
  assert.equal(f.drawn.some(([type,s])=>type==="text" && s==="A"),true);
});

test("PiP reads the actual displayed image URL instead of the original RSS image",async()=>{
  const f=fixture();
  const story={title:"A",image:"https://rss.example/thumbnail.jpg"};
  const final="https://images.example/final-article.jpg";
  f.slides.push(f.makeSlide(story,{src:final}));
  f.select(story);
  await f.ctrl.toggle();
  await flush();
  assert.deepEqual(f.requested,[final]);
  assert.equal(f.drawn.some(([type,id])=>type==="media"&&id==="decoded:"+final),true);
});

test("out-of-order downloads cannot overwrite a newer story",async()=>{
  const f=fixture({deferImages:true});
  const a={title:"A",image:"https://cdn.example/a.jpg"};
  const b={title:"B",image:"https://cdn.example/b.jpg"};
  f.slides.push(f.makeSlide(a),f.makeSlide(b));
  f.select(a);
  await f.ctrl.toggle();
  f.setBusy(true);
  f.ctrl.transitionStory(b,1);
  f.select(b);
  await flush();
  await f.load(b.image);
  const bFrames=f.drawn.filter(([kind,id])=>kind==="media" && id==="decoded:"+b.image).length;
  await f.load(a.image);
  assert.ok(bFrames>0);
  assert.equal(f.drawn.some(([kind,id])=>kind==="media" && id==="decoded:"+a.image),false);
});

test("no image means a current headline, never a previous story's image",async()=>{
  const f=fixture();
  const a={title:"A",image:"https://cdn.example/a.jpg"};
  const b={title:"B",image:"https://cdn.example/b.jpg"};
  f.slides.push(f.makeSlide(a),f.makeSlide(b,{ready:false}));
  f.select(a);
  await f.ctrl.toggle();await flush();
  f.setBusy(true);f.ctrl.transitionStory(b);f.select(b);
  f.forward(500);
  const begin=f.drawn.length;
  f.ctrl.sync();
  const last=f.drawn.slice(begin);
  assert.ok(last.some(([type,t])=>type==="text" && t==="B"));
  assert.equal(last.some(([type,t])=>type==="media"&&t==="decoded:"+a.image),false);
});

test("on-page ad images are snapshotted and shown with the ad label",async()=>{
  const f=fixture();
  const story={title:"A",image:"https://cdn.example/a.jpg"};
  f.slides.push(f.makeSlide(story));
  f.select(story);
  await f.ctrl.toggle();
  const ad={id:"abc",src:"https://cdn.example/ad.png",type:"image"};
  f.adImage.src=ad.src;f.adImage.currentSrc=ad.src;
  f.setBusy(true);f.ctrl.transitionAd(ad);
  f.forward(500);f.ctrl.sync();
  assert.ok(f.drawn.some(([type,t])=>type==="text"&&t==="Reklam"));
  assert.ok(f.drawn.some(([type,t])=>type==="media"&&t==="snapshot"));
  assert.equal(f.requested.includes(ad.src),false,"clean snapshot needs no extra fetch");
});

test("CORS-safe video ad frames are drawn, not replaced with the old news",async()=>{
  const f=fixture();
  const story={title:"A",image:"https://cdn.example/a.jpg"};
  f.slides.push(f.makeSlide(story));
  f.select(story);
  await f.ctrl.toggle();
  const ad={id:"video",src:f.adVideo.src,type:"video"};
  f.setBusy(true);f.ctrl.transitionAd(ad);
  f.forward(500);f.ctrl.sync();
  assert.ok(f.drawn.some(([type,t])=>type==="media"&&t==="ad-video-frame"));
  assert.ok(f.drawn.some(([type,t])=>type==="text"&&t==="Reklam"));
});

test("manual-only PiP, app integration and script order are retained",()=>{
  assert.match(app,/const floewPiP=window\.FloewPiPEngine/);
  assert.match(app,/reason==="useraction"/);
  assert.match(app,/function startPiPTransition\(_fromStory,toStory,dir=1\)/);
  assert.match(app,/function startPiPAdTransition\(ad,dir=1\)/);
  const enginePos=html.indexOf('src="js/pip-engine.js?v=2"');
  const appPos=html.indexOf('src="js/app.js?v=');
  assert.ok(enginePos>=0 && appPos>enginePos);
  assert.doesNotMatch(app,/pipCurrent\?\.image\s*\|\|\s*null/);
});
