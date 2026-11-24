# Flüsh / Haber Kaynakları (24 Kasım 2026)

**Durum:** GitHub feature dalında geliştirme tamamlandı. **Canlıda etkin değil; Worker, Flüsh ön yüzü ve izinli GA4 kurulumu ayrıca dağıtılmalı.**  
**Dal:** `feature/flush-source-analytics`

## Ekran

Flüsh → Analytics → **Haber Kaynakları**. Son 24 saat, son 7 gün ve tüm zamanlar; kaynak adıyla arama ve kolon başlıklarıyla sıralama, satır tıklayarak kaynağa özel grafikler ve demografi. `Tüm kaynakları HTML indir` ve `Bu kaynağın HTML raporu` butonları filtrelenen döneme ilişkin tek dosyalık, ağ bağlantısı gerektirmeyen HTML raporu üretir.

## Metrik sözlüğü

| Alan | Tanım / veri kaynağı |
| --- | --- |
| Farklı haber | `story_view` olayı olan **ayrı `story_key` sayısı**, kaynak başına; tüm haber havuzuna alınmış ama henüz gösterilmemiş haberleri içermez |
| Gösterim | `story_view` olayı, `content_daily` veya `content_events` |
| Tekil erişim | `behavior_events` içinde `story_view` için `COUNT(DISTINCT visitor_id)`; **gerçek insan sayısı değil anonim tarayıcı/cihaz ID sayısı** |
| Toplam görüntüleme | `story_leave` ve pozitif `dwell_ms` değerlerinin toplamı |
| Kişi başına süre | Kaynağın toplam izleme süresi / dönem içinde kaynağı gören tekil anonim ID sayısı. Tek tek açılışların ortalaması değildir |
| Ortalama Flöra | Dönemde görüntülenmiş **farklı** haber başına mevcut `calculateFlora` skoru; haberler eşit ağırlıklı. Büyük dönemlerde ilk 20.000 popüler kaynak-haber örneklemi, arayüzde yaklaşık gösterilir |
| Cihaz / tarayıcı | `story_view` sırasında `analytics_device_type` / `analytics_browser` olay meta alanları. Yeni olaylar için kaydedilir, **eski olaylar “Bilinmiyor”** |
| Paylaşım | `story_share` eylem olayı; hedef uygulamada paylaşımın tamamlandığına dair doğrulama değildir |
| Yaş / cinsiyet | Yalnızca kullanıcının izniyle GA4'e gönderilen `floew_story_view` + `news_source` olay boyutu. GA4'ün gizlilik eşikleri ve eksik örneklem kapsamına tabidir. Veri yokken tahmin gösterilmez |

7 günlük rapor, tamamlanmış UTC günlerini `content_daily` üzerinden, iki yarım sınır gününü ham olaylardan okuyarak **kayan 7 günlük pencereyi** korur. Dönem boyunca tekil kullanıcı sayıları toplanmaz, yalnız `COUNT(DISTINCT)` kullanılır. `24h` ve `all` ham olaylardan hesaplanır. Var olan özel Behavior rapor snapshot tablosu `analytics_behavior_report_cache_v2` yeni kaynak raporlarına da kapalı erişimli, süreli önbellek sağlar. İlk `all` sorgusu hâlâ ağır olabilir; büyüyen trafikte ilave kaynak-saat özeti gerekir.

## Dağıtım ve doğrulama

1. **Önce canlı Worker sürümüyle farkları karşılaştır.** `analytics/worker-flora-prediction.js` içinde mevcut `export default`, `/track`, Flöra, reklam, Behavior, feedback ve diğer rotalar korunmuş durumda. Fakat repodaki sürüm canlı Cloudflare Worker'dan geri olabileceği için **tüm dosyayı körlemesine canlıya yapıştırma**; gerekirse değişiklikleri gerçek canlı Worker üstüne taşı.
2. **Analytics Worker:** `/admin/sources?range=7d` ve `/admin/source-report?range=7d[&source=...]` rotalarını yayımla. İkisinin de mevcut `ADMIN_TOKEN` yetki kapısı içinde kaldığını doğrula. `/admin/setup` ile mevcut önbellek tablosunun kurulmuş olduğunu doğrula; tablo yoksa sistem performans önbelleği olmadan çalışabilir.
3. **Flüsh ön yüzü:** `flush/index.html`, `flush/sources-native.js`, `flush/sources-native.css` dağıt. `/api/proxy/analytics/admin/sources` ile `/admin/source-report` alt yolları Flüsh auth Worker'da **yetkilendirilmiş kullanıcılar için** geçerli olmalı. Proxy katmanı bir endpoint izin listesi kullanıyorsa yeni rotaları ekle; anonim erişim açma. Yeni ekran mevcut `audience` iznine bağlıdır, bağımsız yetki gerekirse Flüsh auth Worker da güncellenmelidir.
4. **Web ön yüzü:** `app.js`'deki rızalı `floew_story_view` telemetrisini yayımla. GA4 yapılandırması tamamlandığında Analytics admin'in mevcut `/admin/ga4/setup` işlevi `news_source` özel boyutunu oluşturabilir. Yeni GA4 boyutu **geçmişe işlemez** ve GA4 genel demografisi kaynaklara yanlış dağıtılmamalıdır.
5. Test et: kaynak seçme/arama/sıralama, JSON'daki toplama formülleri, 24h/7d/all, paylaşımlar, bilinemeyen eski cihazlar, yaş/cinsiyet yokken boş durum, iki HTML indirme, üyelerin erişimi ve yetkisiz 401. Ayrıca `node --test tests/source-analytics.test.cjs` komutuyla yapay verili regresyon testlerini çalıştır.

## Bilinen sınırlamalar

- `content_daily` hazır değilse 7 günlük rapor eski ham olayları tarar, kesintiye uğramadan çalışabilir ancak D1 sorgu maliyeti artabilir.
- Etkin haber listesi/sitede canlıda gösterime hazır haber envanteri ayrı News Worker'da tutulduğu için “farklı haber” bugünkü uygulamada **görüntülenmiş ayrı haber** anlamına gelir.
- Tarayıcı ve cihaz bazında tarihsel kırılım, yeni event meta alanlarının yayına geçişinden önce tam değildir; kimlik bazında son oturumu habere yakıştırarak yanlış kırılım üretmiyoruz.
- `Flöra` tahmini yerel modelin başlık-temelli ilk değerleri içerik olaylarında saklanmadığından kaynak ortalamaları mevcut analitik skor fonksiyonunun hesapladığı değerlere dayanır.
- `all` dönemi büyüdükçe ilk raporu hesaplamak pahalı olabilir. Kalıcı saatlik/aylık kaynak özetleri, rapor doğrulama ve ücretsiz/ücretli Cloudflare kapasite planlaması sonradan yapılmalıdır.
