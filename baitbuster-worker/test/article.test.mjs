import test from "node:test";
import assert from "node:assert/strict";
import {isSafeArticleUrl,cleanArticleText,extractSputnikArticleImage} from "../src/article.js";

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


test("Sputnik extractor chooses a clean large article image from its CDN",()=>{
  const social="https://cdn.img.anlatilaninotesi.com.tr/img/07ea/09/19/social_0:0:1200:630_1200x0_80_0_0_card.jpg.webp";
  const clean="https://cdn.img.anlatilaninotesi.com.tr/img/07ea/09/19/1109053747_0:160:3072:1888_1920x0_80_0_0_a70aba764b501c8ac4c1b74cd6001bf2.jpg.webp";
  const html=`
    <html>
      <head>
        <meta property="twitter:image" content="${social}">
      </head>
      <body>
        <article>
          <figure class="article-media photo">
            <img src="${clean}" width="1920" height="1080" alt="Türkiye - Fransa maçı">
          </figure>
        </article>
      </body>
    </html>
  `;

  assert.equal(
    extractSputnikArticleImage(
      html,
      "https://anlatilaninotesi.com.tr/20260925/test-1109055337.html"
    ),
    clean
  );
});

test("Sputnik extractor reads escaped CDN URLs from structured data",()=>{
  const clean="https://cdn.img.anlatilaninotesi.com.tr/img/07ea/09/19/1109052236_0:160:3072:1888_1920x0_80_0_0_02573029f6ced3cc9995be7003c12afe.jpg";
  const escaped=clean.replaceAll("/","\\/");
  const html=`<script type="application/ld+json">{"image":"${escaped}"}</script>`;

  assert.equal(
    extractSputnikArticleImage(
      html,
      "https://anlatilaninotesi.com.tr/20260925/test-1109052393.html"
    ),
    clean
  );
});
