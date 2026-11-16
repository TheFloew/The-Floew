import { CATEGORIES, TIME_ZONE } from "./config.js";

const COOKIE_NAME = "floew_ad_session";
const SESSION_SECONDS = 12 * 60 * 60;
const MAX_UPLOAD_BYTES = 100 * 1024 * 1024;
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
        return json({ authenticated: await isAdmin(request, env) });
      }
      if (path === "/api/categories" && method === "GET") {
        return json({ categories: CATEGORIES });
      }
      if (path === "/api/ads" && method === "GET") {
        return await listAds(request, env);
      }
      if (path === "/api/ads" && method === "POST") {
        assertSameOrigin(request);
        if (!(await isAdmin(request, env))) return json({ error: "Oturum gerekli." }, 401);
        return await createAd(request, env);
      }
      if (path === "/api/upload" && method === "POST") {
        assertSameOrigin(request);
        if (!(await isAdmin(request, env))) return json({ error: "Oturum gerekli." }, 401);
        return await uploadMedia(request, env);
      }

      const adMatch = path.match(/^\/api\/ads\/([a-f0-9-]+)$/i);
      if (adMatch && method === "PATCH") {
        assertSameOrigin(request);
        if (!(await isAdmin(request, env))) return json({ error: "Oturum gerekli." }, 401);
        return await updateAd(request, env, adMatch[1]);
      }
      if (adMatch && method === "DELETE") {
        assertSameOrigin(request);
        if (!(await isAdmin(request, env))) return json({ error: "Oturum gerekli." }, 401);
        return await deleteAd(env, adMatch[1]);
      }

      if (path === "/feed.xml" && method === "GET") {
        return await rssFeed(url, env);
      }

      if (path.startsWith("/media/") && (method === "GET" || method === "HEAD")) {
        return await serveMedia(request, env, path.slice("/media/".length));
      }

      return env.ASSETS.fetch(request);
    } catch (error) {
      if (error instanceof Response) return error;
      console.error("Ad Center request failed:", error);
      return json({ error: "İşlem tamamlanamadı. Lütfen tekrar deneyin." }, 500);
    }
  }
};

function json(data, status = 200, extraHeaders = {}) {
  const headers = new Headers(extraHeaders);
  headers.set("Content-Type", "application/json; charset=utf-8");
  headers.set("Cache-Control", "no-store");
  return new Response(JSON.stringify(data), { status, headers });
}

function assertSameOrigin(request) {
  const origin = request.headers.get("Origin");
  if (origin && origin !== new URL(request.url).origin) {
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
    "SELECT id, title, category, media_key, media_name, media_type, media_content_type, media_size, start_date, end_date, is_enabled, created_at, updated_at FROM ads ORDER BY start_date DESC, created_at DESC"
  ).all();

  let ads = result.results || [];
  if (!admin) ads = ads.filter((ad) => isLive(ad, today));

  return json({
    ads: ads.map((ad) => ({
      ...ad,
      active: Number(ad.is_enabled) === 1,
      live: isLive(ad, today),
      mediaUrl: "/media/" + encodeURIComponent(ad.media_key)
    })),
    admin,
    today
  });
}

async function uploadMedia(request, env) {
  const contentLength = Number(request.headers.get("Content-Length") || 0);
  if (!contentLength || contentLength > MAX_UPLOAD_BYTES) {
    return json({ error: "Dosya boş veya 100 MB sınırını aşıyor." }, 413);
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
  const key = crypto.randomUUID() + "-" + safeName;

  await env.MEDIA.put(key, request.body, {
    httpMetadata: {
      contentType,
      cacheControl: "public, max-age=31536000, immutable"
    },
    customMetadata: { originalName }
  });

  return json({
    ok: true,
    mediaKey: key,
    mediaName: originalName,
    mediaType: contentType.startsWith("video/") ? "video" : "image",
    mediaContentType: contentType,
    mediaSize: contentLength
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
  const media = await env.MEDIA.head(data.mediaKey);
  if (!media) return json({ error: "Yüklenen medya bulunamadı." }, 400);

  const id = crypto.randomUUID();
  await env.DB.prepare(
    "INSERT INTO ads (id, title, category, media_key, media_name, media_type, media_content_type, media_size, start_date, end_date, is_enabled) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)"
  ).bind(
    id,
    data.title,
    data.category,
    data.mediaKey,
    data.mediaName,
    data.mediaType,
    data.mediaContentType,
    data.mediaSize,
    data.startDate,
    data.endDate
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

  const next = {
    title: body.title === undefined ? current.title : String(body.title).trim(),
    category: body.category === undefined ? current.category : String(body.category),
    startDate: body.startDate === undefined ? current.start_date : String(body.startDate),
    endDate: body.endDate === undefined ? current.end_date : String(body.endDate),
    mediaKey: body.mediaKey === undefined ? current.media_key : String(body.mediaKey),
    mediaName: body.mediaName === undefined ? current.media_name : String(body.mediaName),
    mediaType: body.mediaType === undefined ? current.media_type : String(body.mediaType),
    mediaContentType: body.mediaContentType === undefined ? current.media_content_type : String(body.mediaContentType),
    mediaSize: body.mediaSize === undefined ? Number(current.media_size) : Number(body.mediaSize),
    active: body.active === undefined ? Number(current.is_enabled) === 1 : body.active === true
  };

  const validation = validateAd(next);
  if (validation.error) return json({ error: validation.error }, 400);

  if (next.mediaKey !== current.media_key) {
    const media = await env.MEDIA.head(next.mediaKey);
    if (!media) return json({ error: "Yeni medya dosyası bulunamadı." }, 400);
  }

  await env.DB.prepare(
    "UPDATE ads SET title = ?, category = ?, media_key = ?, media_name = ?, media_type = ?, media_content_type = ?, media_size = ?, start_date = ?, end_date = ?, is_enabled = ?, updated_at = datetime('now') WHERE id = ?"
  ).bind(
    next.title,
    next.category,
    next.mediaKey,
    next.mediaName,
    next.mediaType,
    next.mediaContentType,
    next.mediaSize,
    next.startDate,
    next.endDate,
    next.active ? 1 : 0,
    id
  ).run();

  if (next.mediaKey !== current.media_key) {
    await env.MEDIA.delete(current.media_key);
  }

  return json({ ok: true });
}

function validateAd(body) {
  const title = String(body.title || "").trim();
  const category = String(body.category || "");
  const startDate = String(body.startDate || "");
  const endDate = String(body.endDate || "");
  const mediaKey = String(body.mediaKey || "");
  const mediaName = String(body.mediaName || "reklam");
  const mediaType = String(body.mediaType || "");
  const mediaContentType = String(body.mediaContentType || "");
  const mediaSize = Number(body.mediaSize || 0);

  if (!title || title.length > 160) return { error: "Reklam başlığı 1-160 karakter olmalı." };
  if (!CATEGORIES.includes(category)) return { error: "Geçerli bir kategori seçin." };
  if (!validDate(startDate) || !validDate(endDate) || startDate > endDate) {
    return { error: "Başlangıç ve bitiş tarihlerini kontrol edin." };
  }
  if (!mediaKey || !/^[a-zA-Z0-9._-]+$/.test(mediaKey)) return { error: "Medya dosyası seçilmedi." };
  if (mediaType !== "image" && mediaType !== "video") return { error: "Medya türü geçersiz." };
  if (!ALLOWED_TYPES.has(mediaContentType)) return { error: "Medya formatı desteklenmiyor." };
  if ((mediaType === "image") !== mediaContentType.startsWith("image/")) return { error: "Medya türü ve dosya formatı uyuşmuyor." };
  if (!Number.isFinite(mediaSize) || mediaSize < 1 || mediaSize > MAX_UPLOAD_BYTES) {
    return { error: "Medya dosyası 100 MB sınırını aşamaz." };
  }

  return {
    title,
    category,
    startDate,
    endDate,
    mediaKey,
    mediaName,
    mediaType,
    mediaContentType,
    mediaSize
  };
}

async function deleteAd(env, id) {
  const current = await env.DB.prepare("SELECT media_key FROM ads WHERE id = ?").bind(id).first();
  if (!current) return json({ error: "Reklam bulunamadı." }, 404);
  await env.DB.prepare("DELETE FROM ads WHERE id = ?").bind(id).run();
  await env.MEDIA.delete(current.media_key);
  return json({ ok: true });
}

async function rssFeed(url, env) {
  const today = await expireEndedAds(env);
  const result = await env.DB.prepare(
    "SELECT id, title, category, media_key, media_type, media_content_type, media_size, start_date FROM ads WHERE is_enabled = 1 AND start_date <= ? AND end_date >= ? ORDER BY start_date DESC, created_at DESC"
  ).bind(today, today).all();

  const origin = url.origin;
  const items = (result.results || []).map((ad) => {
    const mediaUrl = origin + "/media/" + encodeURIComponent(ad.media_key);
    const itemUrl = origin + "/#" + encodeURIComponent(ad.id);
    const pubDate = new Date(ad.start_date + "T00:00:00+03:00").toUTCString();
    const medium = ad.media_type === "video" ? "video" : "image";
    const html = ad.media_type === "video"
      ? '<video controls playsinline src="' + mediaUrl + '"></video>'
      : '<img src="' + mediaUrl + '" alt="' + escapeHtml(ad.title) + '" />';
    const encoded = html.replace(/\]\]>/g, "]]]]><![CDATA[>");
    return [
      "<item>",
      "<title>" + xmlEscape(ad.title) + "</title>",
      "<link>" + xmlEscape(itemUrl) + "</link>",
      "<guid isPermaLink=\"false\">" + xmlEscape(ad.id) + "</guid>",
      "<pubDate>" + pubDate + "</pubDate>",
      "<category>" + xmlEscape(ad.category) + "</category>",
      "<description>" + xmlEscape(ad.title) + "</description>",
      "<enclosure url=\"" + xmlEscape(mediaUrl) + "\" length=\"" + Number(ad.media_size) + "\" type=\"" + xmlEscape(ad.media_content_type) + "\" />",
      "<media:content url=\"" + xmlEscape(mediaUrl) + "\" medium=\"" + medium + "\" type=\"" + xmlEscape(ad.media_content_type) + "\" fileSize=\"" + Number(ad.media_size) + "\" />",
      "<content:encoded><![CDATA[" + encoded + "]]></content:encoded>",
      "</item>"
    ].join("");
  }).join("");

  const xml = '<?xml version="1.0" encoding="UTF-8"?>' +
    '<rss version="2.0" xmlns:content="http://purl.org/rss/1.0/modules/content/" xmlns:media="http://search.yahoo.com/mrss/">' +
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

async function serveMedia(request, env, key) {
  if (!key || !/^[a-zA-Z0-9._-]+$/.test(key)) return new Response("Not found", { status: 404 });

  const head = await env.MEDIA.head(key);
  if (!head) return new Response("Not found", { status: 404 });

  const headers = new Headers();
  head.writeHttpMetadata(headers);
  headers.set("ETag", head.httpEtag);
  headers.set("Accept-Ranges", "bytes");
  headers.set("Cache-Control", "public, max-age=31536000, immutable");
  headers.set("X-Content-Type-Options", "nosniff");

  if (request.method === "HEAD") {
    headers.set("Content-Length", String(head.size));
    return new Response(null, { status: 200, headers });
  }

  const rangeHeader = request.headers.get("Range");
  if (rangeHeader) {
    const range = parseByteRange(rangeHeader, head.size);
    if (!range) {
      headers.set("Content-Range", "bytes */" + head.size);
      return new Response(null, { status: 416, headers });
    }
    const length = range.end - range.start + 1;
    const object = await env.MEDIA.get(key, {
      range: { offset: range.start, length }
    });
    headers.set("Content-Range", "bytes " + range.start + "-" + range.end + "/" + head.size);
    headers.set("Content-Length", String(length));
    return new Response(object.body, { status: 206, headers });
  }

  const object = await env.MEDIA.get(key);
  headers.set("Content-Length", String(head.size));
  return new Response(object.body, { status: 200, headers });
}
