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

test("main story navigation never waits for full BaitBuster preparation",async()=>{
  const app=await source("js/app.js");
  assert.match(app,/function prepareTransitionSlideImmediate/);
  assert.match(
    app,
    /async function transitionTo\([\s\S]*?prepareTransitionSlideImmediate\(nextSlide,story\)[\s\S]*?nextSlide\.classList\.add\(enterClass\)/
  );
  assert.doesNotMatch(
    app,
    /async function transitionTo\([\s\S]{0,2500}?await prepareTransitionSlide\(nextSlide,story\)/
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

test("touch navigation builds an immediate target instead of bouncing the first swipe",async()=>{
  const app=await source("js/app.js");
  assert.match(
    app,
    /function prepareTouchDragTarget\([\s\S]*?if\(!slidePreloadedForStory\(standby,story\)\)\{\s*prepareTransitionSlideImmediate\(standby,story\);\s*\}/
  );
  assert.match(
    app,
    /function prepareTouchFeedDragTarget\([\s\S]*?prepareTransitionSlideImmediate\(standby,story\)/
  );
});

test("late background preparation is invalidated before it can rewrite a visible snapshot",async()=>{
  const app=await source("js/app.js");
  assert.match(app,/function invalidateSlidePreparation/);
  assert.match(app,/__floewPreparationSerial/);
  assert.match(
    app,
    /preparationSerial[\s\S]*?el\.__floewPreparationSerial!==preparationSerial/
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
