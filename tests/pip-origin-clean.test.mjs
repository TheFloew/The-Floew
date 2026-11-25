import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";

const app=readFileSync(new URL("../js/app.js",import.meta.url),"utf8");

function section(first,last){
  const a=app.indexOf(first),b=app.indexOf(last,a);
  assert.ok(a!==-1 && b>a,"source section found: "+first);
  return app.slice(a,b);
}

function fixture(){
  let probes=0;
  const fakeDocument={
    createElement(tag){
      assert.equal(tag,"canvas");
      probes++;
      return {
        width:0,height:0,
        getContext(){
          return {
            tainted:false,
            drawImage(media){this.tainted=!!media.tainted;},
            getImageData(){
              if(this.tainted)throw Object.assign(new Error("Tainted canvas"),{name:"SecurityError"});
              return {data:new Uint8ClampedArray(4)};
            }
          };
        }
      };
    }
  };
  const snippet=section("function pipMediaIsOriginClean(media){","function updatePiPSafeAdMedia(ad,media){");
  const safe=new Function("document","pipMediaOriginCache",
    snippet+";return pipMediaIsOriginClean;")(fakeDocument,new WeakMap());
  const drawSnippet=section("function drawPiPAd(ctx,item,offsetX=0,offsetY=0){","function drawPiPItem(ctx,item,offsetX=0,offsetY=0){");
  const drawAd=new Function("pipCanvas","pipMediaIsOriginClean","wrapCanvasText",
    drawSnippet+";return drawPiPAd;")(
    {width:960,height:540},safe,(_ctx,text)=>[String(text)]
  );
  const calls={images:[],text:[],fills:0};
  const noop=()=>{};
  const ctx={
    save:noop,restore:noop,translate:noop,beginPath:noop,rect:noop,clip:noop,
    fillRect:()=>{calls.fills++},
    fillText:(...args)=>calls.text.push(args),
    drawImage:(media,...args)=>{
      if(media.tainted)throw new Error("tainted input illegally reached live captured canvas");
      calls.images.push([media,...args]);
    }
  };
  return {safe,drawAd,ctx,calls,probes:()=>probes};
}

test("cross-origin ad is rejected on a sacrificial canvas, never on captured PiP canvas",()=>{
  const f=fixture();
  const adVideo={tagName:"VIDEO",readyState:4,videoWidth:1920,videoHeight:1080,
    currentSrc:"https://cross-origin.test/ad.mp4",tainted:true};
  assert.equal(f.safe(adVideo),false);
  f.drawAd(f.ctx,{kind:"ad",media:adVideo,ad:{title:"Markanızı gündeme taşıyın"}});
  assert.equal(f.calls.images.length,0,"do not poison live canvas by drawing tainted video");
  assert.ok(f.calls.text.some(x=>x[0]==="Markanızı gündeme taşıyın"),
    "draw advertiser's campaign text while video is inaccessible");
  assert.ok(f.calls.text.some(x=>x[0]==="Reklam"),
    "keep advertising badge");
  assert.ok(f.calls.fills>=2);
});

test("CORS-approved video is drawn exactly as before",()=>{
  const f=fixture();
  const video={tagName:"VIDEO",readyState:4,videoWidth:1920,videoHeight:1080,
    currentSrc:"https://origin-clean.test/ad.mp4",tainted:false};
  f.drawAd(f.ctx,{kind:"ad",media:video,ad:{title:"Spot"}});
  assert.equal(f.calls.images.length,1);
  assert.equal(f.calls.images[0][0],video);
});

test("an unsafe media decision is cached only for that URL, not future ads",()=>{
  const f=fixture();
  const reusable={tagName:"VIDEO",readyState:4,videoWidth:1920,videoHeight:1080,
    currentSrc:"https://cross-origin.test/a.mp4",tainted:true};
  assert.equal(f.safe(reusable),false);
  assert.equal(f.safe(reusable),false);
  assert.equal(f.probes(),1);
  reusable.currentSrc="https://cors.test/next.mp4";
  reusable.tainted=false;
  assert.equal(f.safe(reusable),true);
  assert.equal(f.probes(),2);
});

test("ad frames not yet decoded are not drawn, avoiding partial-video exceptions",()=>{
  const f=fixture();
  const video={tagName:"VIDEO",readyState:1,videoWidth:0,videoHeight:0,
    currentSrc:"https://cross-origin.test/ad.mp4"};
  assert.equal(f.safe(video),false);
  assert.equal(f.probes(),0);
  f.drawAd(f.ctx,{kind:"ad",media:video,ad:{title:"Reklam Spotu"}});
  assert.equal(f.calls.images.length,0);
});

test("after unsafe ad the same captured canvas can still render subsequent news",()=>{
  const f=fixture();
  const unsafeVideo={tagName:"VIDEO",readyState:4,videoWidth:1920,videoHeight:1080,
    currentSrc:"https://cross-origin.test/spot.mp4",tainted:true};
  f.drawAd(f.ctx,{kind:"ad",media:unsafeVideo,ad:{title:"Campaign"}});
  assert.equal(f.calls.images.length,0);

  const storySnippet=section(
    "function drawPiPStory(ctx,story,img,offsetX=0,offsetY=0){",
    "function drawPiPAd(ctx,item,offsetX=0,offsetY=0){"
  );
  const drawStory=new Function("pipCanvas","wrapCanvasText",
    storySnippet+";return drawPiPStory;")(
      {width:960,height:540},(_ctx,title)=>[title]
    );
  f.ctx.createLinearGradient=()=>({addColorStop(){}});
  const newsImage={width:960,height:540,tainted:false};
  drawStory(f.ctx,{title:"Reklamdan sonraki haber",source:"Source"},newsImage);
  assert.equal(f.calls.images.length,1,"new news frame can still reach PiP capture");
  assert.equal(f.calls.images[0][0],newsImage);
  assert.ok(f.calls.text.some(line=>line[0]==="Reklamdan sonraki haber"));
});

test("next story begins without awaiting network and upgrades on later image arrival",async()=>{
  const snippet=section(
    "async function preparePiPStory(story){",
    "async function preparePiPAd(ad){"
  );
  let resolveFetch,refreshes=0;
  const unresolved=new Promise(resolve=>{resolveFetch=resolve});
  const transition={to:null};
  const prepare=new Function(
    "getPiPImage","pipCurrent","pipTransition","pipActive","schedulePiPRender",
    snippet+";return preparePiPStory;"
  )(()=>unresolved,null,transition,true,()=>{refreshes++});

  const story={title:"Yeni haber",image:"https://assets.test/new.jpg"};
  const item=await Promise.race([
    prepare(story),
    new Promise((_,reject)=>setTimeout(()=>reject(new Error("transition blocked on image")),100))
  ]);
  assert.equal(item.story,story);
  assert.equal(item.image,null,"never copy previous story image while loading");
  transition.to=item;
  const image={width:1024,height:768};
  resolveFetch(image);
  for(let i=0;i<4;i++)await Promise.resolve();
  assert.equal(item.image,image);
  assert.equal(refreshes,1);
});

test("PiP always retains classic native video capture and manual-only activation",()=>{
  assert.match(app,/pipCanvas\.captureStream\(30\)/);
  assert.match(app,/video\.requestPictureInPicture\(\)/);
  assert.match(app,/reason==="useraction"/);
  assert.doesNotMatch(app,/FloewDocumentPiP/);
});

test("safe independent CORS video is prepared without changing the feed ad's crossorigin",()=>{
  const f=fixture();
  const snippets=section("function ensurePiPSafeAdVideo(ad){","function warmPiPUpcomingAds(){");
  const existing=documentVideo();
  const body={appended:[],appendChild(element){this.appended.push(element)}};
  const doc={
    body,
    createElement(tag){
      assert.equal(tag,"video");
      return existing;
    }
  };
  const ad={src:"https://cdn.example.test/spot.mp4"};
  const feedVideo={crossOrigin:null,currentTime:0};
  const updates=[];
  const ensure=new Function("document","adVideo","pipSafeAdVideos",
    "pipMediaIsOriginClean","updatePiPSafeAdMedia",
    snippets+";return ensurePiPSafeAdVideo;")(
      doc,feedVideo,new Map(),f.safe,(_,media)=>updates.push(media)
    );
  assert.equal(ensure(ad),null);
  assert.equal(existing.crossOrigin,"anonymous");
  assert.equal(feedVideo.crossOrigin,null,"the original feed ad is untouched");
  assert.equal(existing.src,ad.src);
  existing.videoWidth=1920;
  existing.videoHeight=1080;
  existing.readyState=4;
  existing.events.loadeddata();
  assert.equal(updates.length,1);
  assert.equal(updates[0],existing);
});

function documentVideo(){
  return {
    style:{},videoWidth:0,videoHeight:0,readyState:0,
    duration:12,currentTime:0,currentSrc:"",
    tainted:false,
    events:{},
    setAttribute(){},
    addEventListener(name,fn){this.events[name]=fn;},
    load(){},
    play(){return Promise.resolve();},
    pause(){},
    removeAttribute(){},
    remove(){}
  };
}
