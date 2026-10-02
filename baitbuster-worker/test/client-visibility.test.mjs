import test from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";

async function source(path){
  return readFile(new URL(`../../${path}`,import.meta.url),"utf8");
}

test("BaitBuster exposes an explicit pre-display preparation API",async()=>{
  const client=await source("js/baitbuster-beta.js");
  assert.match(client,/globalThis\.BaitBusterBeta=/);
  assert.match(client,/prepareStory,/);
  assert.match(client,/prepareAndApply,/);
  assert.match(client,/applyToSlide,/);
  assert.match(client,/prefetchStories,/);
});

test("BaitBuster no longer relies on a DOM MutationObserver",async()=>{
  const client=await source("js/baitbuster-beta.js");
  assert.doesNotMatch(client,/new MutationObserver/);
});

test("Flöw fully prepares a story before the main transition starts",async()=>{
  const app=await source("js/app.js");
  assert.match(app,/async function prepareStorySlideInternal/);
  assert.match(
    app,
    /async function transitionTo\([\s\S]*?await prepareTransitionSlide\(nextSlide,story\)[\s\S]*?nextSlide\.classList\.add\(enterClass\)/
  );
});

test("BaitBuster preparation has a bounded pre-display budget",async()=>{
  const app=await source("js/app.js");
  assert.match(app,/const BAITBUSTER_PRE_DISPLAY_BUDGET_MS=2200;/);
  assert.match(
    app,
    /api\.prepareStory\(story\),\s*BAITBUSTER_PRE_DISPLAY_BUDGET_MS,\s*null/
  );
  assert.doesNotMatch(
    app,
    /api\.prepareStory\(story\),\s*12500/
  );
});

test("a strong touch swipe is preserved while the target is still preparing",async()=>{
  const app=await source("js/app.js");
  assert.match(
    app,
    /const shouldDeferToNormalNavigation=[\s\S]*?state\.touchDragTargetIndex<0[\s\S]*?await move\(direction,\{origin:"touch_drag"\}\)/
  );
});

test("the initial story is prepared behind the loading screen",async()=>{
  const app=await source("js/app.js");
  assert.match(
    app,
    /if\(!state\.stories\.length\)[\s\S]*?await prepareStorySlide\([\s\S]*?slides\[0\][\s\S]*?finishInitialLoading\(\)/
  );
});

test("the obsolete baitbusterbeta page is not part of production loading",async()=>{
  const production=await source("index.html");
  assert.doesNotMatch(production,/baitbusterbeta\//);
  assert.match(production,/js\/baitbuster-beta\.js\?v=[a-f0-9]{12}/);
});
