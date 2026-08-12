# Flöw V31.16.1 — Flöra + Analytics

Bu paket iki aşamada devreye alınır.

## 1. Cloudflare Worker

Önce `The-Floew-Worker-v31.16.1-flora-analytics.js` dosyasını deploy edin.

Worker'a üç ayrı D1 binding ekleyin:

- `CONTENT_DB`  → içerik / Flöra
- `AUDIENCE_DB` → ziyaretçi + oturum
- `BEHAVIOR_DB` → kullanıcı hareketleri

Ayrıca Worker secret olarak güçlü ve uzun bir `ADMIN_TOKEN` tanımlayın.

D1 veritabanları boş olabilir. Binding'ler ve ADMIN_TOKEN tanımlandıktan sonra
`admin/analytics.html` sayfasını açıp token ile giriş yapın ve
"Veritabanlarını hazırla" butonuna bir kez basın. Giriş kontrolü `/admin/ping` üzerinden yapılır; tablolar henüz yokken de yönetim ekranına girip kurulumu başlatabilirsiniz. Worker gerekli tabloları ve
index'leri `CREATE TABLE IF NOT EXISTS` ile kurar.

İsterseniz aynı şemaları D1 SQL Console üzerinden de uygulayabilirsiniz:

- analytics/content.sql
- analytics/audience.sql
- analytics/behavior.sql

Kontrol endpoint'i:
`/analytics/health`

## 2. GitHub Pages

Worker hazır olduktan sonra frontend dosyalarını yükleyin.

Ana sayfa artık fiziksel cache-bust dosyalarını kullanır:

- `js/app-31.16.1.js`
- `css/styles-31.16.1.css`

Yeni sayfalar:

- `flora.html` → herkese açık Flöra / içerik istatistikleri
- `admin/analytics.html` → özel kullanıcı/oturum + davranış paneli

Admin sayfası ana siteden linklenmez ve API verileri `ADMIN_TOKEN` olmadan
dönmez. Token statik dosyaya gömülmez; girişte sessionStorage'da tutulur.

## Flöra

Flöra 0–100 arası bir haber ilgi skorudur. Şunları birlikte değerlendirir:

- ekranda kalma / hedef süre
- otomatik tamamlanma
- habere geri dönme
- asıl haber kaynağını açma
- hızlı manuel geçme

Az görüntülenmiş içeriklerin tek bir etkileşimle yapay biçimde zirveye çıkmasını
azaltmak için görüntülenme sayısına bağlı bir güven katsayısı da uygulanır.

## HTML raporu

`admin/analytics.html` içindeki "HTML raporu indir" butonu tek bir bağımsız
HTML dosyası üretir. Dosyada iki ana dönem bulunur:

1. Son 7 gün
2. Tüm zamanlar

Her dönem içinde:
- Kullanıcılar & Oturumlar
- Hareketler & Etkileşimler

özetleri yer alır.

## Not

Analytics verisi V31.16.1 yayına alındıktan sonra birikmeye başlar; geçmiş
ziyaretleri geriye dönük oluşturamaz.
