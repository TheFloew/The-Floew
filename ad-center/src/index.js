import { CATEGORIES, TIME_ZONE } from "./config.js";

const COOKIE_NAME = "floew_ad_session";
const SESSION_SECONDS = 12 * 60 * 60;
const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
const ALLOWED_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
  "image/avif",
  "video/mp4",
  "video/webm",
  "video/quicktime"
]);

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;
    const method = request.method.toUpperCase();
    if(method==="OPTIONS" && path.startsWith("/api/") && portalOrigin(request)){
      return new Response(null,{status:204,headers:{
        "Access-Control-Allow-Origin":portalOrigin(request),
        "Access-Control-Allow-Credentials":"true",
        "Access-Control-Allow-Methods":"GET, POST, PATCH, DELETE, OPTIONS",
        "Access-Control-Allow-Headers":"Accept, Content-Type, X-File-Name",
        "Access-Control-Max-Age":"900",
        "Vary":"Origin"
      }});
    }

    try {
      if (path === "/api/login" && method === "POST") {
        assertSameOrigin(request);
        return await login(request, env);
      }
      if (path === "/api/logout" && method === "POST") {
        assertSameOrigin(request);
        return await logout(request, env);
      }
      if (path === "/api/session" && method === "GET") {
        return portalCors(request,json({ authenticated: await isAdmin(request, env) }));
      }
      if (path === "/api/health" && method === "GET") {
        const check = await env.DB.prepare("SELECT 1 AS ok").first();
        return json({
          ok: Number(check && check.ok) === 1,
          database: Number(check && check.ok) === 1,
          storage: Boolean(env.GITHUB_TOKEN),
          categories: CATEGORIES.length
        });
      }
      if (path === "/api/categories" && method === "GET") {
        return portalCors(request,json({ categories: CATEGORIES }));
      }
      if (path === "/api/flowery" && method === "OPTIONS") {
        return new Response(null, {
          status: 204,
          headers: {
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Methods": "GET, OPTIONS",
            "Access-Control-Allow-Headers": "Accept",
            "Access-Control-Max-Age": "86400",
            "Vary": "Origin"
          }
        });
      }
      if (path === "/api/flowery" && method === "GET") {
        return portalCors(request,await listAds(request, env));
      }
      if (path === "/api/internal/analytics-ads" && method === "GET") {
        return await listAdsForAnalytics(request, env);
      }
      if (path === "/api/flowery" && method === "POST") {
        assertSameOrigin(request);
        if (!(await isAdmin(request, env))) return json({ error: "Oturum gerekli." }, 401);
        return portalCors(request,await createAd(request, env));
      }
      if (path === "/api/upload" && method === "POST") {
        assertSameOrigin(request);
        if (!(await isAdmin(request, env))) return json({ error: "Oturum gerekli." }, 401);
        return portalCors(request,await uploadMedia(request, env));
      }

      const adMatch = path.match(/^\/api\/flowery\/([a-f0-9-]+)$/i);
      if (adMatch && method === "PATCH") {
        assertSameOrigin(request);
        if (!(await isAdmin(request, env))) return json({ error: "Oturum gerekli." }, 401);
        return portalCors(request,await updateAd(request, env, adMatch[1]));
      }
      if (adMatch && method === "DELETE") {
        assertSameOrigin(request);
        if (!(await isAdmin(request, env))) return json({ error: "Oturum gerekli." }, 401);
        return portalCors(request,await deleteAd(env, adMatch[1]));
      }

      if (path === "/feed.xml" && method === "GET") {
        return await rssFeed(url, env);
      }

      if (path.startsWith("/m/") && (method === "GET" || method === "HEAD")) {
        return await serveMedia(request, env, path.slice("/m/".length));
      }

      return env.ASSETS.fetch(request);
    } catch (error) {
      if (error instanceof Response) return portalCors(request,error);
      console.error("Ad Center request failed:", error);
      return portalCors(request,json({ error: "İşlem tamamlanamadı. Lütfen tekrar deneyin." }, 500));
    }
  }
};

function json(data, status = 200, extraHeaders = {}) {
  const headers = new Headers(extraHeaders);
  headers.set("Content-Type", "application/json; charset=utf-8");
  headers.set("Cache-Control", "no-store");
  return new Response(JSON.stringify(data), { status, headers });
}


const FLUSH_PORTAL_ORIGIN = "https://xn--flw-tna.tr";
function portalOrigin(request){
 const origin=request.headers.get("Origin");
 return origin===FLUSH_PORTAL_ORIGIN?origin:"";
}
function portalCors(request,response){
 const origin=portalOrigin(request);
 if(!origin)return response;
 const h=new Headers(response.headers);
 h.set("Access-Control-Allow-Origin",origin);
 h.set("Access-Control-Allow-Credentials","true");
 h.set("Access-Control-Allow-Methods","GET, POST, PATCH, DELETE, OPTIONS");
 h.set("Access-Control-Allow-Headers","Accept, Content-Type, X-File-Name");
 h.set("Vary","Origin");
 return new Response(response.body,{status:response.status,statusText:response.statusText,headers:h});
}
async function isFlushAuthorized(request,env){
 if(!env.FLUSH_AUTH)return false;
 const cookie=request.headers.get("Cookie")||"";
 if(!cookie.split(";").some(x=>x.trim().startsWith("__Secure-flush_session=")))return false;
 try{
  const r=await env.FLUSH_AUTH.fetch(new Request("https://flush.internal/api/session?facility=flowery",{method:"GET",headers:{"Cookie":cookie}}));
  if(!r.ok)return false;
  const data=await r.json();
  return data.authenticated===true && data.permitted===true;
 }catch(e){console.error("Flüsh session lookup failed",String(e));return false}
}

function assertSameOrigin(request) {
  const origin = request.headers.get("Origin");
  if (origin && origin !== new URL(request.url).origin && origin !== FLUSH_PORTAL_ORIGIN) {
    throw new Response("Origin not allowed", { status: 403 });
  }
}

async function login(request, env) {
  if (!env.ADMIN_PASSWORD || !env.SESSION_SECRET) {
    return json({ error: "Yönetici parolası henüz yapılandırılmamış." }, 503);
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: "Geçersiz istek." }, 400);
  }

  const ip = request.headers.get("CF-Connecting-IP") || "unknown";
  const ipHash = await hmac(ip, env.SESSION_SECRET);
  const now = Date.now();
  const attempt = await env.DB.prepare(
    "SELECT failures, window_started, locked_until FROM login_throttle WHERE ip_hash = ?"
  ).bind(ipHash).first();

  if (attempt && Number(attempt.locked_until) > now) {
    return json({ error: "Çok fazla başarısız deneme. 15 dakika sonra tekrar deneyin." }, 429);
  }

  const supplied = String(body.password || "");
  if (!constantTimeEqual(supplied, String(env.ADMIN_PASSWORD))) {
    const withinWindow = attempt && now - Number(attempt.window_started) < 15 * 60 * 1000;
    const failures = withinWindow ? Number(attempt.failures) + 1 : 1;
    const windowStarted = withinWindow ? Number(attempt.window_started) : now;
    const lockedUntil = failures >= 5 ? now + 15 * 60 * 1000 : 0;
    await env.DB.prepare(
      "INSERT INTO login_throttle (ip_hash, failures, window_started, locked_until) VALUES (?, ?, ?, ?) ON CONFLICT(ip_hash) DO UPDATE SET failures = excluded.failures, window_started = excluded.window_started, locked_until = excluded.locked_until"
    ).bind(ipHash, failures, windowStarted, lockedUntil).run();

    return json({
      error: lockedUntil
        ? "Çok fazla başarısız deneme. 15 dakika sonra tekrar deneyin."
        : "Parola hatalı."
    }, lockedUntil ? 429 : 401);
  }

  await env.DB.prepare("DELETE FROM login_throttle WHERE ip_hash = ?").bind(ipHash).run();

  const token = await createSession(env.SESSION_SECRET);
  const headers = new Headers();
  headers.append(
    "Set-Cookie",
    COOKIE_NAME + "=" + token + "; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=" + SESSION_SECONDS
  );
  return json({ ok: true }, 200, headers);
}

async function logout(request, env) {
  const headers = new Headers();
  headers.append(
    "Set-Cookie",
    COOKIE_NAME + "=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0"
  );
  return json({ ok: true }, 200, headers);
}

async function createSession(secret) {
  const payload = base64UrlEncode(new TextEncoder().encode(JSON.stringify({
    exp: Math.floor(Date.now() / 1000) + SESSION_SECONDS
  })));
  return payload + "." + await hmac(payload, secret);
}

async function isAdmin(request, env) {
  if (await isFlushAuthorized(request,env)) return true;
  if (!env.SESSION_SECRET) return false;
  const token = readCookie(request.headers.get("Cookie") || "", COOKIE_NAME);
  if (!token) return false;

  const parts = token.split(".");
  if (parts.length !== 2) return false;

  const expected = await hmac(parts[0], env.SESSION_SECRET);
  if (!constantTimeEqual(parts[1], expected)) return false;

  try {
    const payload = JSON.parse(new TextDecoder().decode(base64UrlDecode(parts[0])));
    return Number(payload.exp) > Math.floor(Date.now() / 1000);
  } catch {
    return false;
  }
}

async function hmac(value, secret) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(value));
  return base64UrlEncode(new Uint8Array(signature));
}

function base64UrlEncode(bytes) {
  let binary = "";
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function base64UrlDecode(value) {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized + "=".repeat((4 - normalized.length % 4) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function readCookie(header, name) {
  const prefix = name + "=";
  for (const part of header.split(";")) {
    const trimmed = part.trim();
    if (trimmed.startsWith(prefix)) return trimmed.slice(prefix.length);
  }
  return "";
}

function constantTimeEqual(a, b) {
  a = String(a);
  b = String(b);
  const max = Math.max(a.length, b.length);
  let difference = a.length ^ b.length;
  for (let i = 0; i < max; i++) {
    difference |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  }
  return difference === 0;
}

function todayInIstanbul() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(new Date());
  const values = {};
  for (const part of parts) values[part.type] = part.value;
  return values.year + "-" + values.month + "-" + values.day;
}

function validDate(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(value + "T00:00:00Z");
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function isLive(ad, today) {
  return Number(ad.is_enabled) === 1 &&
    ad.start_date <= today &&
    ad.end_date >= today;
}

async function expireEndedAds(env) {
  const today = todayInIstanbul();
  await env.DB.prepare(
    "UPDATE ads SET is_enabled = 0, updated_at = datetime('now') WHERE is_enabled = 1 AND end_date < ?"
  ).bind(today).run();
  return today;
}

async function listAds(request, env) {
  const today = await expireEndedAds(env);
  const admin = await isAdmin(request, env);
  const result = await env.DB.prepare(
    "SELECT * FROM ads ORDER BY start_date DESC, created_at DESC"
  ).all();

  let ads = result.results || [];
  if (!admin) ads = ads.filter((ad) => isLive(ad, today));

  return json({
    ads: ads.map((ad) => ({
      ...ad,
      active: Number(ad.is_enabled) === 1,
      live: isLive(ad, today),
      horizontalMedia: mediaObject(ad, "horizontal"),
      verticalMedia: mediaObject(ad, "vertical")
    })),
    admin,
    today
  }, 200, {
    // Public read-only catalog consumed by flöw.tr. No credentials are sent.
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Accept",
    "Vary": "Origin"
  });
}

async function listAdsForAnalytics(request, env) {
  const expected = String(env.AD_CENTER_SYNC_SECRET || "");
  const authorization = String(request.headers.get("Authorization") || "");
  const supplied = authorization.startsWith("Bearer ")
    ? authorization.slice(7)
    : "";

  if (!expected || !constantTimeEqual(supplied, expected)) {
    return json({ error: "Unauthorized" }, 401);
  }

  const today = await expireEndedAds(env);

  const result = await env.DB.prepare(
    "SELECT id, title, category, start_date, end_date, is_enabled, created_at, updated_at FROM ads ORDER BY start_date DESC, created_at DESC"
  ).all();

  return json({
    today,
    ads: (result.results || []).map((ad) => ({
      id: ad.id,
      title: ad.title,
      category: ad.category,
      start_date: ad.start_date,
      end_date: ad.end_date,
      is_enabled: Number(ad.is_enabled),
      active: Number(ad.is_enabled) === 1,
      live: isLive(ad, today),
      created_at: ad.created_at,
      updated_at: ad.updated_at
    }))
  });
}

function mediaObject(ad, orientation) {
  const prefix = orientation + "_media_";
  const key = ad[prefix + "key"];
  if (!key) return null;
  return {
    mediaKey: key,
    mediaName: ad[prefix + "name"],
    mediaType: ad[prefix + "type"],
    mediaContentType: ad[prefix + "content_type"],
    mediaSize: Number(ad[prefix + "size"]),
    mediaUrl: "/m/" + encodeURIComponent(key)
  };
}

async function uploadMedia(request, env) {
  const contentLength = Number(request.headers.get("Content-Length") || 0);
  if (!contentLength || contentLength > MAX_UPLOAD_BYTES) {
    return json({ error: "Dosya boş veya 10 MB sınırını aşıyor." }, 413);
  }

  const contentType = String(request.headers.get("Content-Type") || "")
    .split(";")[0].trim().toLowerCase();
  if (!ALLOWED_TYPES.has(contentType)) {
    return json({ error: "Bu dosya türü desteklenmiyor." }, 415);
  }
  if (!request.body) return json({ error: "Dosya içeriği bulunamadı." }, 400);

  let originalName = request.headers.get("X-File-Name") || "reklam";
  try {
    originalName = decodeURIComponent(originalName);
  } catch {
    originalName = "reklam";
  }
  const safeName = originalName
    .split(/[\\/]/).pop()
    .replace(/[^a-zA-Z0-9._-]/g, "_")
    .slice(-100) || "reklam";
  if (!env.GITHUB_TOKEN) return json({ error: "GitHub medya erişimi yapılandırılmamış." }, 503);

  const key = crypto.randomUUID() + "-" + safeName;
  const bytes = new Uint8Array(await request.arrayBuffer());
  if (bytes.byteLength !== contentLength) return json({ error: "Dosya boyutu doğrulanamadı." }, 400);

  let binary = "";
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, Math.min(offset + chunkSize, bytes.length)));
  }
  const content = btoa(binary);
  const githubResponse = await fetch(
    "https://api.github.com/repos/TheFloew/The-Floew/contents/media/" + encodeURIComponent(key),
    {
      method: "PUT",
      headers: githubHeaders(env),
      body: JSON.stringify({ message: "Add ad media: " + key, content, branch: "ad-center-media" })
    }
  );
  if (!githubResponse.ok) {
    console.error("GitHub media upload failed:", githubResponse.status, await githubResponse.text());
    return json({ error: "GitHub dosya yüklemesi başarısız. Dosya boyutunu ve erişim anahtarını kontrol edin." }, 502);
  }

  return json({
    ok: true,
    mediaKey: key,
    mediaName: originalName,
    mediaType: contentType.startsWith("video/") ? "video" : "image",
    mediaContentType: contentType,
    mediaSize: bytes.byteLength
  });
}

async function createAd(request, env) {
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: "Geçersiz reklam bilgisi." }, 400);
  }

  const data = validateAd(body);
  if (data.error) return json({ error: data.error }, 400);
  const id = crypto.randomUUID();
  const primary = data.horizontal || data.vertical;
  await env.DB.prepare(
    "INSERT INTO ads (id, title, category, media_key, media_name, media_type, media_content_type, media_size, horizontal_media_key, horizontal_media_name, horizontal_media_type, horizontal_media_content_type, horizontal_media_size, vertical_media_key, vertical_media_name, vertical_media_type, vertical_media_content_type, vertical_media_size, start_date, end_date, is_enabled) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)"
  ).bind(
    id, data.title, data.category,
    primary.mediaKey, primary.mediaName, primary.mediaType, primary.mediaContentType, primary.mediaSize,
    data.horizontal?.mediaKey || null, data.horizontal?.mediaName || null, data.horizontal?.mediaType || null, data.horizontal?.mediaContentType || null, data.horizontal?.mediaSize || null,
    data.vertical?.mediaKey || null, data.vertical?.mediaName || null, data.vertical?.mediaType || null, data.vertical?.mediaContentType || null, data.vertical?.mediaSize || null,
    data.startDate, data.endDate
  ).run();

  return json({ ok: true, id }, 201);
}

async function updateAd(request, env, id) {
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: "Geçersiz reklam bilgisi." }, 400);
  }

  const current = await env.DB.prepare("SELECT * FROM ads WHERE id = ?").bind(id).first();
  if (!current) return json({ error: "Reklam bulunamadı." }, 404);

  const currentHorizontal = mediaObject(current, "horizontal");
  const currentVertical = mediaObject(current, "vertical");
  const next = {
    title: body.title === undefined ? current.title : String(body.title).trim(),
    category: body.category === undefined ? current.category : String(body.category),
    startDate: body.startDate === undefined ? current.start_date : String(body.startDate),
    endDate: body.endDate === undefined ? current.end_date : String(body.endDate),
    horizontal: body.horizontal === undefined ? currentHorizontal : body.horizontal,
    vertical: body.vertical === undefined ? currentVertical : body.vertical,
    active: body.active === undefined ? Number(current.is_enabled) === 1 : body.active === true
  };

  const validation = validateAd(next);
  if (validation.error) return json({ error: validation.error }, 400);
  const primary = validation.horizontal || validation.vertical;

  await env.DB.prepare(
    "UPDATE ads SET title = ?, category = ?, media_key = ?, media_name = ?, media_type = ?, media_content_type = ?, media_size = ?, horizontal_media_key = ?, horizontal_media_name = ?, horizontal_media_type = ?, horizontal_media_content_type = ?, horizontal_media_size = ?, vertical_media_key = ?, vertical_media_name = ?, vertical_media_type = ?, vertical_media_content_type = ?, vertical_media_size = ?, start_date = ?, end_date = ?, is_enabled = ?, updated_at = datetime('now') WHERE id = ?"
  ).bind(
    validation.title, validation.category,
    primary.mediaKey, primary.mediaName, primary.mediaType, primary.mediaContentType, primary.mediaSize,
    validation.horizontal?.mediaKey || null, validation.horizontal?.mediaName || null, validation.horizontal?.mediaType || null, validation.horizontal?.mediaContentType || null, validation.horizontal?.mediaSize || null,
    validation.vertical?.mediaKey || null, validation.vertical?.mediaName || null, validation.vertical?.mediaType || null, validation.vertical?.mediaContentType || null, validation.vertical?.mediaSize || null,
    validation.startDate, validation.endDate, next.active ? 1 : 0, id
  ).run();

  return json({ ok: true });
}

function validateMedia(media, label) {
  if (!media || typeof media !== "object") return null;
  const mediaKey = String(media.mediaKey || "");
  const mediaName = String(media.mediaName || "reklam");
  const mediaType = String(media.mediaType || "");
  const mediaContentType = String(media.mediaContentType || "");
  const mediaSize = Number(media.mediaSize || 0);
  if (!mediaKey || !/^[a-zA-Z0-9._-]+$/.test(mediaKey)) return { error: label + " medya dosyası geçersiz." };
  if (mediaType !== "image" && mediaType !== "video") return { error: label + " medya türü geçersiz." };
  if (!ALLOWED_TYPES.has(mediaContentType)) return { error: label + " medya formatı desteklenmiyor." };
  if ((mediaType === "image") !== mediaContentType.startsWith("image/")) return { error: label + " medya türü ve dosya formatı uyuşmuyor." };
  if (!Number.isFinite(mediaSize) || mediaSize < 1 || mediaSize > MAX_UPLOAD_BYTES) return { error: label + " medya dosyası 10 MB sınırını aşamaz." };
  return { mediaKey, mediaName, mediaType, mediaContentType, mediaSize };
}

function validateAd(body) {
  const title = String(body.title || "").trim();
  const category = String(body.category || "");
  const startDate = String(body.startDate || "");
  const endDate = String(body.endDate || "");
  const horizontal = body.horizontal ? validateMedia(body.horizontal, "Yatay") : null;
  const vertical = body.vertical ? validateMedia(body.vertical, "Dikey") : null;

  if (!title || title.length > 160) return { error: "Reklam başlığı 1-160 karakter olmalı." };
  if (!CATEGORIES.some((item) => item.code === category)) return { error: "Geçerli bir kategori seçin." };
  if (!validDate(startDate) || !validDate(endDate) || startDate > endDate) return { error: "Başlangıç ve bitiş tarihlerini kontrol edin." };
  if (horizontal?.error) return { error: horizontal.error };
  if (vertical?.error) return { error: vertical.error };
  if (!horizontal && !vertical) return { error: "En az bir yatay veya dikey medya dosyası eklemelisiniz." };

  return { title, category, startDate, endDate, horizontal, vertical };
}

async function deleteAd(env, id) {
  const current = await env.DB.prepare("SELECT media_key FROM ads WHERE id = ?").bind(id).first();
  if (!current) return json({ error: "Reklam bulunamadı." }, 404);
  await env.DB.prepare("DELETE FROM ads WHERE id = ?").bind(id).run();
  // Media files are retained in GitHub so cached RSS readers do not lose assets.
  return json({ ok: true });
}

async function rssFeed(url, env) {
  const today = await expireEndedAds(env);
  const result = await env.DB.prepare(
    "SELECT * FROM ads WHERE is_enabled = 1 AND start_date <= ? AND end_date >= ? ORDER BY start_date DESC, created_at DESC"
  ).bind(today, today).all();

  const origin = url.origin;
  const items = (result.results || []).map((ad) => {
    const itemUrl = origin + "/#" + encodeURIComponent(ad.id);
    const pubDate = new Date(ad.start_date + "T00:00:00+03:00").toUTCString();
    const horizontal = mediaObject(ad, "horizontal");
    const vertical = mediaObject(ad, "vertical");
    const allMedia = [
      horizontal ? { ...horizontal, orientation: "landscape" } : null,
      vertical ? { ...vertical, orientation: "portrait" } : null
    ].filter(Boolean);

    const mediaXml = allMedia.map((media) => {
      const medium = media.mediaType === "video" ? "video" : "image";
      return '<media:content url="' + xmlEscape(origin + media.mediaUrl) + '" medium="' + medium +
        '" type="' + xmlEscape(media.mediaContentType) + '" fileSize="' + media.mediaSize +
        '" flöw:orientation="' + media.orientation + '" />';
    }).join("");
    const first = allMedia[0];
    const firstUrl = origin + first.mediaUrl;
    const html = allMedia.map((media) => {
      const mediaUrl = origin + media.mediaUrl;
      return media.mediaType === "video"
        ? '<div data-orientation="' + media.orientation + '"><video controls playsinline src="' + mediaUrl + '"></video></div>'
        : '<div data-orientation="' + media.orientation + '"><img src="' + mediaUrl + '" alt="' + escapeHtml(ad.title) + '" /></div>';
    }).join("");
    const encoded = html.replace(/\]\]>/g, "]]]]><![CDATA[>");
    return [
      "<item>",
      "<title>" + xmlEscape(ad.title) + "</title>",
      "<link>" + xmlEscape(itemUrl) + "</link>",
      "<guid isPermaLink=\"false\">" + xmlEscape(ad.id) + "</guid>",
      "<pubDate>" + pubDate + "</pubDate>",
      "<category>" + xmlEscape(ad.category) + "</category>",
      "<description>" + xmlEscape(ad.title) + "</description>",
      "<enclosure url=\"" + xmlEscape(firstUrl) + "\" length=\"" + first.mediaSize + "\" type=\"" + xmlEscape(first.mediaContentType) + "\" />",
      "<media:group>" + mediaXml + "</media:group>",
      "<content:encoded><![CDATA[" + encoded + "]]></content:encoded>",
      "</item>"
    ].join("");
  }).join("");

  const xml = '<?xml version="1.0" encoding="UTF-8"?>' +
    '<rss version="2.0" xmlns:content="http://purl.org/rss/1.0/modules/content/" xmlns:media="http://search.yahoo.com/mrss/" xmlns:flöw="https://flöw.tr/xmlns/ad-center/1.0">' +
    "<channel>" +
    "<title>Flöw Reklam Merkezi</title>" +
    "<link>" + xmlEscape(origin) + "</link>" +
    "<description>Flöw için aktif reklam yayın akışı</description>" +
    "<language>tr-TR</language>" +
    "<lastBuildDate>" + new Date().toUTCString() + "</lastBuildDate>" +
    items +
    "</channel></rss>";

  return new Response(xml, {
    headers: {
      "Content-Type": "application/rss+xml; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff"
    }
  });
}

function xmlEscape(value) {
  return String(value == null ? "" : value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function escapeHtml(value) {
  return String(value == null ? "" : value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function parseByteRange(value, size) {
  const match = /^bytes=(\d*)-(\d*)$/.exec(value || "");
  if (!match || (!match[1] && !match[2])) return null;

  let start;
  let end;
  if (!match[1]) {
    const suffix = Number(match[2]);
    if (!suffix) return null;
    start = Math.max(0, size - suffix);
    end = size - 1;
  } else {
    start = Number(match[1]);
    end = match[2] ? Number(match[2]) : size - 1;
  }
  if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || start >= size || end < start) {
    return null;
  }
  return { start, end: Math.min(end, size - 1) };
}

function githubHeaders(env) {
  return {
    "Accept": "application/vnd.github+json",
    "Authorization": "Bearer " + env.GITHUB_TOKEN,
    "X-GitHub-Api-Version": "2022-11-28",
    "Content-Type": "application/json",
    "User-Agent": "Floew-Ad-Center"
  };
}

async function serveMedia(request, env, key) {
  if (!key || !/^[a-zA-Z0-9._-]+$/.test(key)) return new Response("Not found", { status: 404 });
  const rawUrl = "https://raw.githubusercontent.com/TheFloew/The-Floew/ad-center-media/media/" + encodeURIComponent(key);
  const requestHeaders = new Headers();
  const range = request.headers.get("Range");
  if (range) requestHeaders.set("Range", range);
  const upstream = await fetch(rawUrl, {
    method: request.method === "HEAD" ? "HEAD" : "GET",
    headers: requestHeaders
  });
  if (!upstream.ok) return new Response("Not found", { status: upstream.status === 404 ? 404 : 502 });
  const headers = new Headers();
  headers.set("Content-Type", upstream.headers.get("Content-Type") || "application/octet-stream");
  headers.set("Cache-Control", "public, max-age=3600");
  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("Accept-Ranges", "bytes");
  for (const name of ["Content-Length", "Content-Range", "ETag", "Last-Modified"]) {
    const value = upstream.headers.get(name);
    if (value) headers.set(name, value);
  }
  return new Response(request.method === "HEAD" ? null : upstream.body, { status: upstream.status, headers });
}
