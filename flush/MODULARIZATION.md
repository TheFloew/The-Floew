# Flüsh · Yerel Analitik Modülleri (v7, aşama 1)

Bu paket henüz canlı sistemde yayınlanmamıştır. Mevcut Flöw sitesi, Analytics, Feedback ve Reklam Merkezi'ni değiştirmeden, Flüsh portalı için üç yerel analitik modülü içerir.

## İçerik

- `flush-index.html`: Flüsh ana ekranının yeni sürümü. Sol menüde üç analitik modül ve iki yönetim modülü bulunur. **Kullanıcılar, Davranış, Reklam Performansı** portalın kendi bileşenleriyle çalışır; iframe kullanılmaz. Reklam Merkezi ile Feedback henüz mevcut bağımsız sayfalarından iframe ile gösterilir.
- `floew-flush-auth-worker-v7.js`: Mevcut v6 güvenli kimlik doğrulama, iki superadmin, korumalı kurtarma hesabı ve oturum mekanizmalarını korur. Analitik için ayrı API yetkileri sağlar.
- `native_analytics.js`, `native_analytics.css`: Portalın içindeki yerel modüllerin geliştirme kaynakları (nihai HTML'e dahil edilmiştir).
- `test-auth.mjs`: Modüller arası API yetki testleri.
- `test-ui.py`: Yerel tarayıcı test betiği. Mock veriler kullanılır; canlı kullanıcı verisi içermez.

## Cloudflare yayın sırası (güvenlik nedeniyle önemli)

1. `floew-flush-auth` Worker'ına `floew-flush-auth-worker-v7.js` içeriğini yükleyip Deploy et. **D1, Cookie Domain, AUTH_PEPPER veya diğer Secret değerlerini değiştirme.** BOOTSTRAP_KEY silinmiş olarak kalmalı. SQL değişikliği gerekmiyor.
2. `/api/health` kontrolü yap ve mevcut superadmin ile Flüsh girişini doğrula. Ana ve kurtarma hesabının açılıp açılmadığını, kullanıcı yetkileri görünümünü kontrol et.
3. Ancak bundan sonra `flush-index.html` dosyasını Flöw GitHub deposunda **`flush/index.html`** yoluna yayınla (manuel ya da hazırlanan geliştirme dalından). Yeni UI v7 API yetkilendirmesini bekler.
4. Yeni sol menüden Kullanıcılar, Davranış ve Reklam Performansı'nı kontrol et. Yedek superadmin erişimi bozulmamalı.
5. Ayrıntılı yetki testi için yalnız tek modüle izinli *kullanıcı* hesabıyla giriş yapıp yetkisiz modül API'sinin 403 döndürdüğünü doğrula.

## Geri alma

Önceki `flush/index.html` dosyasını yeniden yayınlamak arayüzü geri alır. v7 Worker yeni izni desteklerken önceki Flüsh giriş ve mevcut Analytics/Feedback oturumlarını da destekleyecek şekilde tasarlanmıştır. Worker'ı v6'ya geri döndürmek gerekiyorsa önce portalı eski sürüme al.

## İzin modeli

- `audience` → `/admin/audience`, `/admin/demographics`
- `behavior` → `/admin/behavior`
- `ad_performance` → `/admin/ads`, `/admin/ad`, `/admin/ad-report`
- `flowery` → Reklam Merkezi (mevcut bağımsız arayüz; gelecek aşama)
- `feedback` → `/admin/feedback`, `/admin/feedback-delete`
- `analytics` yalnızca eski Analytics sayfasındaki SSO uyumluluğu için korunur. Bu eski yetkiye sahip mevcut hesaplar üç yeni analitik yetkiyi de korur. Yeni kullanıcı eklerken ayrı izinler kullanılır.
- Kurulum ve tüm analitiği bir arada dışa aktarma endpoint'leri (`/admin/setup`, `/admin/ga4/setup`, `/admin/export`) yalnızca superadmin için açıktır.

## Korunan özellikler

Canlıdaki eski Analytics tablosu ve sıralama özelliği, Feedback yönetimi, Reklam Merkezi ve tüm eski URL'ler değiştirilmez. Korunan kurtarma superadmin hesabına yönelik API kısıtları aynen devam eder.