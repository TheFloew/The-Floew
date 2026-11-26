import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {runInNewContext} from "node:vm";

const html=readFileSync(new URL("../index.html",import.meta.url),"utf8");
const styles=readFileSync(new URL("../css/styles.css",import.meta.url),"utf8");
const app=readFileSync(new URL("../js/app.js",import.meta.url),"utf8");
const start=app.indexOf("function hideCookieNotice(){");
const end=app.indexOf("const WEATHER_GEOCODING_API=",start);
assert.ok(start>=0&&end>start,"cookie handlers must be present");
const cookieCode=app.slice(start,end);

function setup(initial={}){
  const values=new Map(Object.entries(initial));
  const elements=new Map();
  function el(){
    const listeners=new Map();
    const classes=new Set();
    const state={textContent:""};
    return {
      hidden:true,dataset:{},state,
      classList:{toggle:(name,on)=>on?classes.add(name):classes.delete(name),contains:name=>classes.has(name)},
      setAttribute(name,value){this[name]=value},
      querySelector:()=>state,
      addEventListener(name,fn){listeners.set(name,fn)},
      click(){listeners.get("click")?.({stopPropagation(){}})}
    };
  }
  for(const id of ["cookie-notice","cookie-close","cookie-reject","cookie-accept","optional-cookie-setting","cookie-preference-status"]){
    elements.set(id,el());
  }
  const consentChanges=[];
  const ctx={
    document:{getElementById:id=>elements.get(id)||null},
    localStorage:{
      getItem:key=>values.has(key)?values.get(key):null,
      setItem:(key,value)=>values.set(key,value)
    },
    getGa4Consent:()=>{
      const v=values.get("thefloew.ga4Consent.v1");
      return v==="granted"||v==="denied"?v:"";
    },
    setGa4Consent:v=>{values.set("thefloew.ga4Consent.v1",v);consentChanges.push(v)}
  };
  runInNewContext(cookieCode+"\n;globalThis.cookieApi={updateAnalyticsConsentNotice,getSavedCookieChoice,setCookieChoice};",ctx);
  return {api:ctx.cookieApi,values,elements,consentChanges,element:id=>elements.get(id)};
}

test("Preferences contains Cookies tab and both optional/essential states",()=>{
  assert.match(html,/class="menu-tab" data-tab="cookies"/);
  assert.match(html,/id="cookies-panel" data-panel="cookies"/);
  assert.match(html,/id="optional-cookie-setting"[^>]*aria-pressed="false"/);
  assert.match(html,/Zorunlu teknolojiler/);
  assert.match(styles,/#cookies-panel \.cookie-essential-setting/);
  assert.match(html,/js\/app\.js\?v=[A-Za-z0-9._-]+/);
});

test("first visit prompts; accept and later rejection both persist across visits",()=>{
  let s=setup();
  s.api.updateAnalyticsConsentNotice();
  assert.equal(s.element("cookie-notice").hidden,false);
  assert.equal(s.element("optional-cookie-setting").state.textContent,"Kapalı");
  s.element("cookie-accept").click();
  assert.equal(s.values.get("thefloew.cookieNotice.v1"),"accepted");
  assert.equal(s.values.get("thefloew.ga4Consent.v1"),"granted");
  assert.equal(s.element("cookie-notice").hidden,true);
  assert.equal(s.element("optional-cookie-setting").state.textContent,"Açık");

  s=setup(Object.fromEntries(s.values));
  s.api.updateAnalyticsConsentNotice();
  assert.equal(s.element("cookie-notice").hidden,true);
  s.element("optional-cookie-setting").click();
  assert.equal(s.values.get("thefloew.cookieNotice.v1"),"rejected");
  assert.equal(s.values.get("thefloew.ga4Consent.v1"),"denied");
  assert.equal(s.element("optional-cookie-setting").state.textContent,"Kapalı");

  s=setup(Object.fromEntries(s.values));
  s.api.updateAnalyticsConsentNotice();
  assert.equal(s.element("cookie-notice").hidden,true,"rejection must not show the banner again");
  assert.equal(s.api.getSavedCookieChoice(),"rejected");
  s.element("optional-cookie-setting").click();
  assert.equal(s.values.get("thefloew.ga4Consent.v1"),"granted");
  assert.equal(s.element("optional-cookie-setting").state.textContent,"Açık");
});

test("banner rejection and close both save denied consent even before GA4 config",()=>{
  for(const id of ["cookie-reject","cookie-close"]){
    const s=setup();
    s.api.updateAnalyticsConsentNotice();
    s.element(id).click();
    assert.equal(s.values.get("thefloew.cookieNotice.v1"),"rejected");
    assert.deepEqual(s.consentChanges,["denied"]);
    assert.equal(s.element("cookie-notice").hidden,true);
  }
});

test("legacy accepted and stored GA4 denied choices retain sensible precedence",()=>{
  const oldAccept=setup({"thefloew.cookieNotice.v1":"accepted"});
  oldAccept.api.updateAnalyticsConsentNotice();
  assert.equal(oldAccept.element("cookie-notice").hidden,true);
  assert.equal(oldAccept.element("optional-cookie-setting").state.textContent,"Açık");

  const denied=setup({
    "thefloew.cookieNotice.v1":"accepted",
    "thefloew.ga4Consent.v1":"denied"
  });
  denied.api.updateAnalyticsConsentNotice();
  assert.equal(denied.element("cookie-notice").hidden,true);
  assert.equal(denied.element("optional-cookie-setting").state.textContent,"Kapalı");
  assert.equal(denied.api.getSavedCookieChoice(),"rejected");
});

test("in-session regrant updates live consent mode instead of only initializing GA4",()=>{
  assert.match(app,/if\(ga4Initialized && window\.gtag\)\{\s*\/\* Re-enable Consent Mode immediately/);
  assert.match(app,/window\.gtag\("consent","update",\{\s*ad_storage:"granted"/);
});
