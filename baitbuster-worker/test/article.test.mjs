import test from "node:test";
import assert from "node:assert/strict";
import {isSafeArticleUrl,cleanArticleText} from "../src/article.js";

test("article url rejects localhost and private ip literals",()=>{
  for(const url of [
    "http://localhost/a",
    "http://sub.localhost/a",
    "http://device.local/a",
    "http://127.0.0.1/a",
    "http://10.0.0.1/a",
    "http://172.16.0.1/a",
    "http://172.31.255.255/a",
    "http://192.168.1.2/a",
    "http://169.254.1.1/a",
    "http://[::1]/a",
    "http://[fc00::1]/a",
    "http://[fe80::1]/a"
  ]) assert.equal(isSafeArticleUrl(url),false,url);
});

test("article url allows ordinary public http(s) urls",()=>{
  assert.equal(isSafeArticleUrl("https://example.com/news/1"),true);
  assert.equal(isSafeArticleUrl("http://8.8.8.8/news/1"),true);
});

test("article url rejects credentials and non-http schemes",()=>{
  assert.equal(isSafeArticleUrl("https://u:p@example.com/a"),false);
  assert.equal(isSafeArticleUrl("file:///etc/passwd"),false);
});

test("cleanArticleText collapses whitespace and limits size",()=>{
  const cleaned=cleanArticleText("  Bir   haber\n\n metni  ");
  assert.equal(cleaned,"Bir haber metni");
  assert.equal(cleanArticleText("a".repeat(19000)).length,18000);
});
