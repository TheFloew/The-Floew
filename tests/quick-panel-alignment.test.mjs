import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {runInNewContext} from "node:vm";

const app=readFileSync(new URL("../js/app.js",import.meta.url),"utf8");
const index=readFileSync(new URL("../index.html",import.meta.url),"utf8");
const beginning=app.indexOf("const QUICK_PANEL_ANCHORS=[");
const ending=app.indexOf("function closeKeywordFilterPanel(){",beginning);
assert.ok(beginning>=0 && ending>beginning,"quick panel positioning helpers are present");
const helper=app.slice(beginning,ending);

function fixture({
  width=1200,height=800,
  visualViewport=null,
  anchorId="time-range-button",
  panelId="time-range-panel",
  top=150,left=1130,anchorWidth=42,anchorHeight=42,
  panelHeight=140,open=true
}={}){
  const properties=new Map();
  const listeners=[];
  const panel={
    offsetHeight:panelHeight,
    classList:{contains:name=>name==="open" && open},
    style:{setProperty:(key,value,priority)=>properties.set(key,{value,priority})}
  };
  const trigger={
    getBoundingClientRect:()=>({
      top,left,width:anchorWidth,height:anchorHeight
    })
  };
  const nodes={
    [panelId]:panel,
    [anchorId]:trigger
  };
  const context={
    window:{
      innerWidth:width,
      innerHeight:height,
      visualViewport:visualViewport && {
        ...visualViewport,
        addEventListener:(type,callback)=>listeners.push(["visualViewport:"+type,callback])
      },
      addEventListener:(type,callback)=>listeners.push(["window:"+type,callback])
    },
    document:{getElementById:id=>nodes[id]||null}
  };
  const api=runInNewContext(
    helper+";({alignQuickPanelToTrigger,realignOpenQuickPanels})",
    context
  );
  const value=name=>Number(properties.get(name)?.value.replace("px",""));
  return {panel,trigger,nodes,properties,listeners,api,value};
}

test("Akış popup center is directly opposite its own icon",()=>{
  const f=fixture();
  f.api.alignQuickPanelToTrigger("time-range-panel","time-range-button");
  assert.equal(f.value("top"),101);
  assert.equal(f.value("right"),82);
  assert.equal(f.properties.get("top").priority,"important");
  assert.equal(f.properties.get("right").priority,"important");
});

test("keyword filter and watch use their own icons, not old CSS fixed top values",()=>{
  for(const [panel,trigger,top,panelHeight,expectedTop] of [
    ["keyword-filter-panel","keyword-filter-button",250,90,226],
    ["keyword-watch-panel","keyword-watch-button",340,100,311]
  ]){
    const f=fixture({
      panelId:panel,anchorId:trigger,top,panelHeight
    });
    f.api.alignQuickPanelToTrigger(panel,trigger);
    assert.equal(f.value("top"),expectedTop);
    assert.equal(f.value("right"),82);
  }
});

test("popover stays inside both viewport edges",()=>{
  const top=fixture({top:5,panelHeight:200});
  top.api.alignQuickPanelToTrigger("time-range-panel","time-range-button");
  assert.equal(top.value("top"),8);
  const bottom=fixture({top:770,panelHeight:300});
  bottom.api.alignQuickPanelToTrigger("time-range-panel","time-range-button");
  assert.equal(bottom.value("top"),492);
});

test("mobile visualViewport shifts when the software keyboard appears",()=>{
  const f=fixture({
    width:375,height:800,visualViewport:{offsetTop:100,height:350},
    top:420,left:320,anchorWidth:38,anchorHeight:38,
    panelHeight:120
  });
  f.api.alignQuickPanelToTrigger("time-range-panel","time-range-button");
  assert.equal(f.value("top"),322);
  assert.equal(f.value("right"),67);
});

test("hidden or absent anchor cannot move a panel",()=>{
  const hidden=fixture({anchorWidth:0});
  hidden.api.alignQuickPanelToTrigger("time-range-panel","time-range-button");
  assert.equal(hidden.properties.size,0);
  const absent=fixture();
  absent.api.alignQuickPanelToTrigger("keyword-filter-panel","keyword-filter-button");
  assert.equal(absent.properties.size,0);
});

test("only open panels are recalculated on viewport resize",()=>{
  const f=fixture({open:false});
  f.api.realignOpenQuickPanels();
  assert.equal(f.properties.size,0);
  assert.ok(f.listeners.some(([n])=>n==="window:resize"));
  f.api.alignQuickPanelToTrigger("time-range-panel","time-range-button");
  assert.equal(f.value("top"),101);
});

test("the same anchor function is called for all three opening paths",()=>{
  for(const [name,button] of [
    ["time-range-panel","time-range-button"],
    ["keyword-filter-panel","keyword-filter-button"],
    ["keyword-watch-panel","keyword-watch-button"]
  ]){
    assert.match(app,new RegExp(
      'alignQuickPanelToTrigger\\("'+name+'","'+button+'"\\)'
    ));
  }
  assert.match(index,/js\/app\.js\?v=[^"]*quickpanel-anchor1/);
});
