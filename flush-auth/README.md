# FLÜSH | SSO + KULLANICI YETKİLENDİRME (v1)

Bu paket, **kullanıcının sağladığı Flüsh logosu** ve daha önce hazırlanmış portal tasarımını korur. Sistem üç bağımsız fasiliteyi tek oturumda açar: Analytics, Feedback ve Reklam Merkezi. **Canlıya otomatik kurulmaz;** önce Worker, D1, DNS ve uygulama köprüleri yayınlanmalıdır.

## Parçalar

- `flush-auth/`: Cloudflare Worker kimlik doğrulama ve yetki geçidi. D1 kullanıcılar, PBKDF2-SHA256 parola özetleri (salt + Cloudflare uyumlu 100.000 iterasyon ve Worker secret HMAC pepper), sunucu tarafında iptal edilebilir oturumlar, giriş deneme sınırlaması, superadmin, kullanıcı yönetimi ve izin kontrolleri.
- `flush-portal/`: Önceki koyu tasarım ve **sağlanan özgün mavi logo**. Giriş ekranı, ilk girişte parola değiştirme, çıkış, yalnız superadmin'in görebileceği *Kullanıcı Yetkileri*, kullanıcı ekleme, modül izinleri, devre dışı bırakma, parola yenileme.
- `patches/apply-existing-app-bridges.mjs`: Mevcut Analytics, Feedback ve Reklam Merkezi kodlarını Flüsh'e bağlar. Mevcut kullanıcı parolaları ve giriş yolları korunur.
- `tests/auth.test.mjs`: Sunucu oturum, izin ve iptal testleri.

## SSO nasıl çalışır?

1. Flüsh, `https://flöw.tr/flush/` adresinde oturum isteğini `https://auth.flöw.tr` Worker'ına yollar.
2. Worker, `__Secure-flush_session` adlı HttpOnly, Secure, SameSite=Strict, **yalnız flöw.tr alan adına ait** oturum çerezi verir. `flöw.tr` ve `flowery.flöw.tr` aynı kayıtlı alan adını paylaştığı için Reklam Merkezi Worker'ı çerezi sunucuda doğrulayabilir.
3. Analytics ve Feedback'in mevcut statik sayfaları Flüsh oturumunu kontrol eder; varsa eski `ADMIN_TOKEN` girişi yerine `auth.flöw.tr/api/proxy/analytics/...` API geçidini kullanır. **Eski ADMIN_TOKEN asla tarayıcıya gönderilmez.** Geçit, sunucuda tutulan anahtarla eski Analytics Worker'ına gider. Fasilite bazında sunucu yetki denetimi yapılır.
4. Reklam Merkezi Worker'ı istekteki Flüsh çerezini `FLUSH_AUTH` Service Binding üzerinden doğrular. Kendi mevcut `floew_ad_session` sistemi de çalışmayı sürdürür.
5. Superadmin dışındaki hesaplar yalnız kendilerine atanmış fasiliteleri görür. Bir hesap devre dışı bırakılınca oturumları silinir; erişimler hemen kesilir. Roller yalnız tarayıcıda değil API tarafında da kontrol edilir.

## Kurulum sırası

### 1. Yeni D1 ve auth Worker

`flush-auth` klasöründe:

```bash
npx wrangler login
npx wrangler d1 create floew-flush-auth
```

Gelen `database_id` değerini `flush-auth/wrangler.toml` dosyasında `REPLACE_WITH_NEW_D1_DATABASE_ID` yerine koyun.

```bash
npx wrangler d1 migrations apply floew-flush-auth --remote
npx wrangler secret put BOOTSTRAP_KEY
npx wrangler secret put THROTTLE_SECRET
npx wrangler secret put AUTH_PEPPER
npx wrangler secret put ANALYTICS_ADMIN_TOKEN
npx wrangler deploy
```

- `BOOTSTRAP_KEY`: En az 32 rastgele karakterlik **tek seferlik kurulum anahtarı**.
- `THROTTLE_SECRET`: Ayrı rastgele anahtar; login-rate-limit kayıtlarında kullanılır.
- `AUTH_PEPPER`: En az 32 rastgele karakterlik parola-özetleme gizli anahtarı. **Kaybedilirse saklanan parolalar doğrulanamaz**, bu nedenle güvenli biçimde saklayın.
- `ANALYTICS_ADMIN_TOKEN`: **Analytics Worker'ın mevcut** `ADMIN_TOKEN` değeri. Bu gizli bilgi yalnızca auth Worker'a secret olarak girilir, ZIP veya GitHub'a yazılmaz.
- `ALLOWED_ORIGINS`: Varsayılan `https://xn--flw-tna.tr,https://flush.xn--flw-tna.tr`.
- `COOKIE_DOMAIN`: `xn--flw-tna.tr`.

Cloudflare Workers ekranından auth Worker'a `auth.flöw.tr` **Custom Domain** bağlayın. Kayıt/domain hazır olmadan portal giriş ekranı çalışmayacaktır. Site HTTPS olmalı.

### 2. İlk superadmin

D1 tamamen boşken yalnız **bir kez** `POST https://auth.flöw.tr/api/bootstrap` isteği atılır. `X-Bootstrap-Key` başlığında kurulum anahtarı, JSON gövdede aşağıdaki değerler olur:

```json
{"username":"superadmin","password":"BURAYA_KENDI_GUCLU_PAROLANIZI_YAZIN"}
```

En az 12 karakterli benzersiz parola seçin. Bu isteği bir HTTP istemcisi veya güvenilir bir terminal üzerinden yapın; anahtarı/parolayı kaynak koduna, GitHub'a veya genel bir dosyaya koymayın. İlk hesabın oluşturulmasının ardından `BOOTSTRAP_KEY` Worker secret'ı silinebilir; ikinci bir superadmin oluşturulamaz. `curl` ile örnek istek (değerleri gerçek ortama göre değiştirin):

```bash
curl -fsS -X POST 'https://auth.xn--flw-tna.tr/api/bootstrap' \
 -H 'Content-Type: application/json' \
 -H 'X-Bootstrap-Key: YOUR_BOOTSTRAP_KEY' \
 --data '{"username":"superadmin","password":"YOUR_PRIVATE_PASSWORD"}'
```

> Güvenlik: Yukarıdaki satırda gerçek sırları terminal geçmişine yazmayın. Sırları koruyan bir API istemcisi veya kabuk ortam değişkenleri kullanın.

### 3. Uygulama köprüleri

GitHub'da `feature/ad-management-center` dalı temel alınarak oluşturulmuş `feature/flush-sso` geliştirme dalında **uygulama köprüsü düzenlemeleri hazırdır**:

- `js/analytics-admin.js`: Flüsh oturum varsa otomatik giriş, yoksa mevcut token girişi.
- `admin/feedback-admin.html`: Aynı otomatik giriş ve eski token davranışı.
- `ad-center/src/index.js`: Flüsh çerezi Service Binding üzerinden doğrulanır, mevcut parola oturumu korunur.
- `ad-center/wrangler.toml`: `FLUSH_AUTH` Service Binding eklendi.

İsterseniz aynı değişiklikler `patches/apply-existing-app-bridges.mjs` ile orijinal `feature/ad-management-center` checkout'unuza uygulanabilir:

```bash
node patches/apply-existing-app-bridges.mjs /path/to/The-Floew
```

**Bu script'i zaten düzenlenmiş `feature/flush-sso` dalına tekrar uygulamayın.**

Reklam Merkezi kodu ancak `floew-flush-auth` Worker deploy edildikten sonra `[[services]]` binding ile yeniden deploy edilmelidir. Bağımsız `flowery.flöw.tr` adresi ve parola girişi korunur.

### 4. Portal

`flush-portal/` içeriğini GitHub Pages'in `flush/` dizini olarak yayınlayın. Mevcut `index.html`, Flüsh logosu ve SVG simgesi bu pakette vardır. **Mevcut Flöw ana sayfasına, Analytics veya Feedback veri tabanına dokunulmaz.**

### 5. Kontrol listesi

- Superadmin giriş yapabilir, tüm 3 fasiliteyi ve *Kullanıcı Yetkileri* ekranını görür.
- Yeni kullanıcı yalnız seçili modülleri görür, ilk girişte parolasını değiştirir.
- Kullanıcının yetkisiz modüle API isteği `403` döner; yalnızca menü gizlenmez.
- Kullanıcı devre dışı bırakıldığında oturum hemen geçersiz olur.
- Analytics ve Feedback doğrudan URL'de de Flüsh oturumunu tanır; oturum yoksa eski giriş ekranları çalışır.
- Reklam Merkezi, kendi adresinde ve Flüsh içinden aynı Flüsh oturumunu kabul eder.
- Reklam Merkezi'nin eski yönetici giriş mekanizması çalışmaya devam eder.

## Sınırlar ve güvenlik notları

- **Mevcut eski yönetici parolaları/ADMIN_TOKEN geçerli kalır.** Bunları bilen kişiler hâlâ bağımsız eski giriş yöntemleriyle yetki alabilir. Flüsh'in modül izinlerinin bu *legacy* yolla aşılmasını bütünüyle önlemek için geçiş tamamlandıktan sonra eski ortak yönetici girişlerinin kademeli kapatılması veya yalnız superadmin'e ayrılması gerekir.
- Flüsh portalındaki menü gizleme tek başına koruma değildir; kritik koruma `flush-auth` üzerindeki D1 oturum ve API kontrolüdür. Reklam Merkezi Server Binding de ayrıca denetler.
- Mevcut iframe `frame-ancestors` / `X-Frame-Options` izinleri gömmeyi engelleyebilir. Bu durumda *Ayrı sekmede aç* kullanılır, Flüsh girişinden dolayı yeniden parola gerekmez.
- Güvenlik nedeniyle henüz gerçek superadmin parolası seçilmedi; hesap ilk sunucu kurulumunda oluşturulur. Kullanıcı adını başlangıçta `superadmin` seçmenizi öneriyoruz.
- Cloudflare üretimde WebCrypto PBKDF2 için 100.000 iterasyon tavanı uygulayabilir. Bu sürüm özel Worker pepper + 100.000 iterasyon kullanır; yine de maliyet/CPU limitini gerçek hesapta doğrulayın.
- Production öncesi gerçek Cloudflare üzerinde uçtan uca testi, CORS/Cookie/Service Binding doğrulaması ve tarayıcı testi zorunludur. Yereldeki testler canlı altyapı yerine geçmez.

## Yerel test

```bash
cd flush-sso
node --no-warnings --test tests/auth.test.mjs
```

Node 22+ (`node:sqlite`) kullanılır. Canlı Cloudflare hesabı gerekmez.