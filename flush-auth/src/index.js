/** Flüsh auth gateway: Cloudflare Worker + D1. No client-side admin secrets. */
const FACILITIES = Object.freeze(['analytics', 'flowery', 'feedback']);
const COOKIE = '__Secure-flush_session';
const SESSION_TTL = 12 * 60 * 60;
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const LOGIN_FAILURE_LIMIT = 5;
const PW_ITERATIONS = 100_000; // Cloudflare Workers production WebCrypto maximum
const te = new TextEncoder();

function bytesHex(bytes) { return [...bytes].map(v => v.toString(16).padStart(2,'0')).join(''); }
function randomHex(n) { return bytesHex(crypto.getRandomValues(new Uint8Array(n))); }
async function shaHex(text) { return bytesHex(new Uint8Array(await crypto.subtle.digest('SHA-256',te.encode(text)))); }
function equalSecret(a,b) {
  const aa=te.encode(String(a||'')),bb=te.encode(String(b||''));
  let diff=aa.length^bb.length;
  for(let i=0;i<Math.max(aa.length,bb.length);i++)diff |= (aa[i]||0)^(bb[i]||0);
  return diff===0;
}
async function passwordHash(password,salt,env,iterations=PW_ITERATIONS) {
  // Keep password hashes resistant to offline guessing if D1 alone is leaked.
  // The server-only pepper must be kept in a Worker secret, never in GitHub or browser assets.
  if (!env.AUTH_PEPPER || String(env.AUTH_PEPPER).length<32) throw new Error('AUTH_PEPPER secret is required');
  if (iterations>100_000 || iterations<1) throw new Error('Unsupported password work factor');
  const pepperKey=await crypto.subtle.importKey('raw',te.encode(env.AUTH_PEPPER),{name:'HMAC',hash:'SHA-256'},false,['sign']);
  const peppered=new Uint8Array(await crypto.subtle.sign('HMAC',pepperKey,te.encode(password)));
  const key=await crypto.subtle.importKey('raw',peppered,'PBKDF2',false,['deriveBits']);
  const bits=await crypto.subtle.deriveBits({name:'PBKDF2',hash:'SHA-256',salt:Uint8Array.from(salt.match(/.{2}/g).map(h=>parseInt(h,16))),iterations},key,256);
  return bytesHex(new Uint8Array(bits));
}
function validUsername(name){ return /^[a-z0-9._-]{3,40}$/.test(name); }
function validPassword(p){ return typeof p==='string'&&p.length>=12&&p.length<=128&&te.encode(p).length<=256; }
function parsePerms(s){ try { const p=JSON.parse(s);return Array.isArray(p)?p.filter(x=>FACILITIES.includes(x)):[]; } catch { return []; } }
function normalizePerms(v){ return [...new Set((Array.isArray(v)?v:[]).filter(x=>FACILITIES.includes(x)))]; }
function cleanUser(u){return {id:u.id,username:u.username,role:u.role,active:!!u.active,mustChangePassword:!!u.must_change_password,permissions:u.role==='superadmin'?[...FACILITIES]:parsePerms(u.permissions),createdAt:u.created_at};}
function asJson(obj,status=200,headers={}){return new Response(JSON.stringify(obj),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff',...headers}});}
function getCookie(req){ const match=(req.headers.get('Cookie')||'').split(';').map(x=>x.trim()).find(x=>x.startsWith(COOKIE+'='));return match?.slice(COOKIE.length+1)||''; }
function cookieLine(token,env,maxAge){const domain=String(env.COOKIE_DOMAIN||'xn--flw-tna.tr').replace(/^\./,'');return `${COOKIE}=${token}; Path=/; Domain=${domain}; HttpOnly; Secure; SameSite=Strict; Max-Age=${maxAge}`;}
function originAllowed(origin,env){return String(env.ALLOWED_ORIGINS||'').split(',').map(x=>x.trim()).includes(origin);}
function cors(req,env){const origin=req.headers.get('Origin');if(!origin||!originAllowed(origin,env))return {};return {'Access-Control-Allow-Origin':origin,'Access-Control-Allow-Credentials':'true','Access-Control-Allow-Headers':'Content-Type','Access-Control-Allow-Methods':'GET, POST, PATCH, OPTIONS','Access-Control-Max-Age':'600','Vary':'Origin'};}
function error(code,status=400){return asJson({error:code},status);}
function safeRequestOrigin(req,env){const origin=req.headers.get('Origin');return !!origin&&originAllowed(origin,env);}
async function inputJson(req){ if(!String(req.headers.get('Content-Type')||'').toLowerCase().startsWith('application/json'))throw error('JSON gerekli.',415);const length=Number(req.headers.get('Content-Length')||0);if(length>20000)throw error('İstek çok büyük.',413);const txt=await req.text();if(txt.length>20000)throw error('İstek çok büyük.',413);try{return JSON.parse(txt)}catch{throw error('JSON geçersiz.',400)} }
async function sessionUser(req,env){
 const raw=getCookie(req);if(!/^[a-f0-9]{64}$/.test(raw))return null;
 const hash=await shaHex(raw);
 const row=await env.DB.prepare(`SELECT u.*,s.expires_at FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=?`).bind(hash).first();
 if(!row||!row.active||Number(row.expires_at)<=Date.now())return null;
 return row;
}
function allowed(user,facility){return !!user&&!user.must_change_password&&(user.role==='superadmin'||parsePerms(user.permissions).includes(facility));}
async function newSession(user,env){const raw=randomHex(32),now=Date.now();await env.DB.prepare('INSERT INTO sessions(token_hash,user_id,created_at,expires_at) VALUES(?,?,?,?)').bind(await shaHex(raw),user.id,now,now+SESSION_TTL*1000).run();return raw;}
async function verifyPassword(user,pw,env){const hashed=await passwordHash(pw,user.salt,env,Number(user.iterations));return equalSecret(hashed,user.password_hash);}
async function bootstrap(req,env){
 const secret=req.headers.get('X-Bootstrap-Key')||'';
 if(!env.BOOTSTRAP_KEY||!equalSecret(secret,env.BOOTSTRAP_KEY))return error('Yetkisiz.',401);
 if((await env.DB.prepare('SELECT COUNT(*) AS n FROM users').first()).n!==0)return error('İlk kurulum tamamlanmış.',409);
 const body=await inputJson(req),username=String(body?.username||'').trim().toLowerCase(),pw=body?.password;
 if(!validUsername(username)||!validPassword(pw))return error('Kullanıcı adı 3-40 karakter, parola en az 12 karakter olmalı.',400);
 const now=Date.now(),salt=randomHex(16),hash=await passwordHash(pw,salt,env);
 try {await env.DB.prepare("INSERT INTO users (id,username,role,salt,password_hash,iterations,permissions,active,must_change_password,created_at,updated_at) VALUES (?,?,'superadmin',?,?,?,?,1,0,?,?)")
   .bind(crypto.randomUUID(),username,salt,hash,PW_ITERATIONS,JSON.stringify(FACILITIES),now,now).run();}
 catch{return error('İlk kurulum tamamlanmış veya veritabanı hatası.',409);}
 return asJson({ok:true,superadmin:username});
}
async function attemptKey(req,env,username){const addr=req.headers.get('CF-Connecting-IP')||'unknown';return shaHex(`${env.THROTTLE_SECRET||''}|${addr}|${username}`)}
async function login(req,env){
 const body=await inputJson(req),username=String(body?.username||'').trim().toLowerCase(),pw=String(body?.password||'');
 if(!validUsername(username)||pw.length>128)return error('Giriş başarısız.',401);
 const k=await attemptKey(req,env,username),now=Date.now();
 const attempt=await env.DB.prepare('SELECT * FROM login_attempts WHERE attempt_key=?').bind(k).first();
 if(attempt&&Number(attempt.locked_until)>now)return error('Çok fazla deneme. 15 dakika sonra tekrar deneyin.',429);
 const user=await env.DB.prepare('SELECT * FROM users WHERE username=?').bind(username).first();
 // Perform the same expensive hash operation for missing accounts.
 const ok=user?await verifyPassword(user,pw,env):await passwordHash(pw,'00000000000000000000000000000000',env).then(()=>false);
 if(!user||!user.active||!ok){
   const inWindow=attempt&&now-Number(attempt.first_failed_at)<LOGIN_WINDOW_MS;
   const count=inWindow?Number(attempt.failed_count)+1:1;
   await env.DB.prepare('INSERT INTO login_attempts(attempt_key,failed_count,first_failed_at,locked_until) VALUES(?,?,?,?) ON CONFLICT(attempt_key) DO UPDATE SET failed_count=excluded.failed_count,first_failed_at=excluded.first_failed_at,locked_until=excluded.locked_until')
     .bind(k,count,inWindow?attempt.first_failed_at:now,count>=LOGIN_FAILURE_LIMIT?now+LOGIN_WINDOW_MS:0).run();
   return error(count>=LOGIN_FAILURE_LIMIT?'Çok fazla deneme. 15 dakika sonra tekrar deneyin.':'Giriş başarısız.',count>=LOGIN_FAILURE_LIMIT?429:401);
 }
 await env.DB.prepare('DELETE FROM login_attempts WHERE attempt_key=?').bind(k).run();
 const token=await newSession(user,env);
 return asJson({ok:true,user:cleanUser(user)},200,{'Set-Cookie':cookieLine(token,env,SESSION_TTL)});
}
async function logout(req,env){const raw=getCookie(req);if(raw)await env.DB.prepare('DELETE FROM sessions WHERE token_hash=?').bind(await shaHex(raw)).run();return asJson({ok:true},200,{'Set-Cookie':cookieLine('',env,0)});}
async function changeOwnPassword(req,env,user){
 if(!user)return error('Giriş gerekli.',401);
 const b=await inputJson(req);if(!validPassword(b?.newPassword))return error('Yeni parola en az 12 karakter olmalı.',400);
 if(!await verifyPassword(user,String(b?.currentPassword||''),env))return error('Mevcut parola yanlış.',403);
 const salt=randomHex(16),hash=await passwordHash(b.newPassword,salt,env),now=Date.now();
 await env.DB.prepare('UPDATE users SET salt=?,password_hash=?,iterations=?,must_change_password=0,updated_at=? WHERE id=?').bind(salt,hash,PW_ITERATIONS,now,user.id).run();
 await env.DB.prepare('DELETE FROM sessions WHERE user_id=? AND token_hash<>?').bind(user.id,await shaHex(getCookie(req))).run();
 return asJson({ok:true});
}
async function adminUsers(req,env,user,url){
 if(!user||user.role!=='superadmin'||user.must_change_password)return error('Yetkiniz yok.',403);
 if(req.method==='GET'&&url.pathname==='/api/users'){
   const r=await env.DB.prepare(`SELECT * FROM users ORDER BY CASE WHEN role='superadmin' THEN 0 ELSE 1 END,username`).all();
   return asJson({users:(r.results||[]).map(cleanUser)});
 }
 if(req.method==='POST'&&url.pathname==='/api/users'){
   const b=await inputJson(req),username=String(b?.username||'').trim().toLowerCase();
   if(!validUsername(username)||!validPassword(b?.password))return error('Kullanıcı adı geçersiz veya parola çok kısa.',400);
   const now=Date.now(),salt=randomHex(16),hash=await passwordHash(b.password,salt,env),permissions=normalizePerms(b.permissions);
   try {await env.DB.prepare("INSERT INTO users (id,username,role,salt,password_hash,iterations,permissions,active,must_change_password,created_at,updated_at) VALUES (?,?,'member',?,?,?, ?,1,1,?,?)")
       .bind(crypto.randomUUID(),username,salt,hash,PW_ITERATIONS,JSON.stringify(permissions),now,now).run();}
   catch{return error('Kullanıcı zaten var.',409)}
   return asJson({ok:true},201);
 }
 const m=url.pathname.match(/^\/api\/users\/([0-9a-f-]{36})(\/password)?$/i);
 if(!m)return error('Adres bulunamadı.',404);
 const target=await env.DB.prepare('SELECT * FROM users WHERE id=?').bind(m[1]).first();
 if(!target||target.role==='superadmin')return error('Bu hesap değiştirilemez.',403);
 if(req.method==='PATCH'&&!m[2]){
   const b=await inputJson(req);
   if(typeof b.active!=='boolean'||!Array.isArray(b.permissions)||b.permissions.some(p=>!FACILITIES.includes(p)))return error('Yetki verileri geçersiz.',400);
   await env.DB.prepare('UPDATE users SET active=?,permissions=?,updated_at=? WHERE id=?').bind(b.active?1:0,JSON.stringify(normalizePerms(b.permissions)),Date.now(),target.id).run();
   if(!b.active)await env.DB.prepare('DELETE FROM sessions WHERE user_id=?').bind(target.id).run();
   return asJson({ok:true});
 }
 if(req.method==='POST'&&m[2]){
   const b=await inputJson(req);if(!validPassword(b?.password))return error('Parola en az 12 karakter olmalı.',400);
   const salt=randomHex(16),hash=await passwordHash(b.password,salt,env);
   await env.DB.prepare('UPDATE users SET salt=?,password_hash=?,iterations=?,must_change_password=1,updated_at=? WHERE id=?').bind(salt,hash,PW_ITERATIONS,Date.now(),target.id).run();
   await env.DB.prepare('DELETE FROM sessions WHERE user_id=?').bind(target.id).run();
   return asJson({ok:true});
 }
 return error('Yöntem desteklenmiyor.',405);
}
const ALLOWED_ANALYTICS = new Map([
 ['/admin/ping',['GET']],['/admin/audience',['GET']],['/admin/behavior',['GET']],['/admin/ads',['GET']],
 ['/admin/demographics',['GET']],['/admin/ad',['GET']],['/admin/ga4/status',['GET']],['/admin/export',['GET']],
 ['/admin/ad-report',['GET']],['/admin/feedback',['GET']],
 ['/admin/setup',['POST']],['/admin/ga4/setup',['POST']],['/admin/feedback-delete',['POST']]
]);
async function analyticsProxy(req,env,user,url){
 const path=url.pathname.slice('/api/proxy/analytics'.length);
 if(!allowed(user,path==='/admin/feedback'||path==='/admin/feedback-delete'?'feedback':'analytics'))return error('Bu modüle erişim yetkiniz yok.',403);
 if(!ALLOWED_ANALYTICS.get(path)?.includes(req.method))return error('Bu işlem için izin verilmedi.',403);
 if(!env.ANALYTICS_ADMIN_TOKEN||!env.ANALYTICS_WORKER_BASE)return error('Analytics geçidi henüz yapılandırılmadı.',503);
 // Only a fixed allowlist can be proxied; never allow user-defined URLs or paths.
 const upstream=new URL(path+url.search,String(env.ANALYTICS_WORKER_BASE).replace(/\/$/,''));
 const headers=new Headers({'Authorization':`Bearer ${env.ANALYTICS_ADMIN_TOKEN}`,'Accept':req.headers.get('Accept')||'application/json'});
 const hasBody=req.method==='POST';if(hasBody)headers.set('Content-Type','application/json');
 const body=hasBody?await req.arrayBuffer():undefined;
 if(body?.byteLength>10000)return error('İstek çok büyük.',413);
 const response=await fetch(upstream.toString(),{method:req.method,headers,body,redirect:'manual'});
 const outHeaders=new Headers({'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});
 outHeaders.set('Content-Type',response.headers.get('Content-Type')||'application/json');
 if(response.headers.get('Content-Disposition'))outHeaders.set('Content-Disposition',response.headers.get('Content-Disposition'));
 return new Response(response.body,{status:response.status,headers:outHeaders});
}
export default {async fetch(req,env){
 const url=new URL(req.url),path=url.pathname,method=req.method.toUpperCase();
 if(path==='/api/health'&&method==='GET')return asJson({ok:true});
 if(!path.startsWith('/api/'))return error('Bulunamadı.',404);
 const origin=req.headers.get('Origin');
 if(method==='OPTIONS')return originAllowed(origin,env)?new Response(null,{status:204,headers:cors(req,env)}):error('Origin engellendi.',403);
 // Require approved Origin for all browser writes; bootstrap is a CLI-only one-time operation.
 if(method!=='GET'&&path!=='/api/bootstrap'&&!safeRequestOrigin(req,env))return error('Origin engellendi.',403);
 let result;
 try{
  if(path==='/api/bootstrap'&&method==='POST'){
    if(origin)return error('Bu işlem yalnızca CLI üzerinden yapılabilir.',403);
    result=await bootstrap(req,env);
  }else if(path==='/api/login'&&method==='POST')result=await login(req,env);
  else if(path==='/api/logout'&&method==='POST')result=await logout(req,env);
  else {
    const user=await sessionUser(req,env);
    if(path==='/api/session'&&method==='GET'){
      const facility=url.searchParams.get('facility');
      if(facility&&!FACILITIES.includes(facility))result=error('Bilinmeyen modül.',400);
      else result=asJson({authenticated:!!user,permitted:facility?allowed(user,facility):!!user&&!user.must_change_password,user:user?cleanUser(user):null});
    }
    else if(path==='/api/password'&&method==='POST')result=await changeOwnPassword(req,env,user);
    else if(path.startsWith('/api/users'))result=await adminUsers(req,env,user,url);
    else if(path.startsWith('/api/proxy/analytics/'))result=await analyticsProxy(req,env,user,url);
    else result=error('Bulunamadı.',404);
  }
 }catch(e){
   if(e instanceof Response)result=e;
   else {console.error('Flush auth request failed',e?.message||e);result=error('Sunucu hatası.',500)}
 }
 const headers=new Headers(result.headers);
 for(const [key,value] of Object.entries(cors(req,env)))headers.set(key,value);
 headers.set('Cache-Control','no-store');headers.set('X-Frame-Options','DENY');
 return new Response(result.body,{status:result.status,headers});
}};