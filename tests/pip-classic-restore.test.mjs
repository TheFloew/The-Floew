import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";

const app=readFileSync(new URL("../js/app.js",import.meta.url),"utf8");
const html=readFileSync(new URL("../index.html",import.meta.url),"utf8");

function section(start,end){
  const a=app.indexOf(start),b=app.indexOf(end,a);
  assert.ok(a>=0 && b>a,"classic PiP section is present: "+start);
  return app.slice(a,b);
}

test("legacy classic video PiP is the only active renderer",()=>{
  assert.match(app,/let pipCanvas=null;/);
  assert.match(app,/pipCanvas\.captureStream\(30\)/);
  assert.match(app,/video\.requestPictureInPicture\(\)/);
  assert.doesNotMatch(app,/FloewDocumentPiP|FloewPiPEngine/);
  assert.doesNotMatch(html,/src="js\/pip-document\.js|src="js\/pip-engine\.js/);
  assert.match(html,/pip-origin-clean1/);
});

test("manual-only enter PiP handler remains in place",()=>{
  assert.match(app,/setActionHandler\("enterpictureinpicture"/);
  assert.match(app,/reason==="useraction"/);
  assert.match(app,/if\(await exitPiP\(\)\)return;/);
});

test("legacy PiP takes an already playing main-page video advertisement",async()=>{
  const video={hidden:false,readyState:4,videoWidth:1920,videoHeight:1080};
  const source=section("async function preparePiPAd(ad){","async function setPiPInitialAd(ad){");
  const prepare=new Function("adVideo","adImage","getPiPImage",
    "pipMediaIsOriginClean","ensurePiPSafeAdVideo",source+";return preparePiPAd;")(
    video,null,async()=>null,()=>true,()=>null
  );
  const ad={id:"spot",type:"video",src:"https://example.test/spot.mp4"};
  const item=await prepare(ad);
  assert.equal(item.kind,"ad");
  assert.equal(item.ad,ad);
  assert.equal(item.media,video);
});

test("legacy PiP renders advertisement frames and the Reklam badge",()=>{
  const source=section("function drawPiPAd(ctx,item,offsetX=0,offsetY=0){","function drawPiPItem(ctx,item,offsetX=0,offsetY=0){");
  const draw=new Function("pipCanvas","pipMediaIsOriginClean","wrapCanvasText",
    source+";return drawPiPAd;")({width:960,height:540},()=>true,(_ctx,title)=>[title]);
  const calls={images:[],labels:[]};
  const noop=()=>{};
  const ctx={
    save:noop,translate:noop,beginPath:noop,rect:noop,clip:noop,
    fillRect:noop,restore:noop,
    drawImage:(...args)=>calls.images.push(args),
    fillText:(...args)=>calls.labels.push(args)
  };
  const video={videoWidth:1920,videoHeight:1080};
  draw(ctx,{kind:"ad",media:video});
  assert.equal(calls.images.length,1);
  assert.equal(calls.images[0][0],video);
  assert.deepEqual(calls.labels[0].slice(0,1),["Reklam"]);
});
