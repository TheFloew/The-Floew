# Flöw | Paylaşılan haber sayfasında işlev eşitliği

## Kapsam
Bu dal ana haber akışını değiştirmez. Tahmini Flöra puanı gerçek puanmış gibi kısa bağlantıya yazılmaz; paylaşım sayfasında yeniden tahmin edilirse `≈` işaretiyle gösterilir. Paylaşım sayfasının davranışı `js/share-landing-parity.js`, tasarımı `css/share-landing-parity.css` içindedir.

- Flöra: kısa linke kaydedilmiş pozitif puan korunur. Eksik/şüpheli `0.0` için yalnız ilgili haberin **indeksli** `/stats/flora-story` uç noktası sorgulanır; yeterli gerçek veri yoksa 24 saat önbellekli Flöra sözlüğü ve mevcut yerel tahminci kullanılır. Veri yoksa yapay `0.0` yerine `—` gösterilir. Her ziyaretçi için yeni AI çağrısı yapılmaz.
- Paylaş: ana akıştaki `js/visual-share.js` ve QR kütüphanesi **yalnız paylaş düğmesine basıldığında** yüklenir. Aynı iki seçenek, “Bağlantı paylaş” ve “Görsel paylaş / Görseli indir” sunulur. Mevcut `/s/<kod>` bağlantısı yeniden kullanılır; yeni KV kaydı oluşturulmaz. Eski `/share/<token>` linklerinde QR kartı kullanılamıyorsa bağlantı paylaşımı çalışır.
- Kaynak: mevcut News Worker `/source` proxy'si korunur. Açılan kaynak penceresinde dış alana tıklama, Escape ve kapanışın 340 ms sonrasında iframe temizliği eklenir.
- Akışa yönlendirme: logo bağlantısına ek olarak üst sağda “Akışa devam et” belirgin bağlantısı vardır. Mobil safe area ve klavye odağı desteklenir.

## ÖNEMLİ: Share Worker'a manuel ekleme gerekiyor
Canlı `/s/*` HTML'i Cloudflare Share Worker tarafından üretiliyor; GitHub Pages bu route'u sunmaz. 27 Kasım 2026 tarihli canlı kontrolünde paylaşım sayfası `share-landing-ui.js` dahil **hiçbir dış UI betiğini** yüklemiyordu. Bu yüzden bu PR'yi merge etmek tek başına canlı `/s/*` sayfalarını değiştirmez.

**Share Worker'ın mevcut, canlı sürümündeki** paylaşılmış haber HTML'ini oluşturan `<head>` bölgesine, `</head>` öncesine aşağıdaki tek satırı ekle. Güncel Worker'ı eski bir dosyayla tamamen değiştirme:

```html
<script defer src="https://xn--flw-tna.tr/js/share-landing-ui.js?v=2"></script>
```

Bu satır ikon arayüzünü yükler, o da otomatik olarak `share-landing-parity.js` davranış katmanını çağırır.

Kısa `/s/<kod>` ve eski `/share/<token>` rotaları ayrı şablon kullanıyorsa iki HTML'ye de ekle. Önce GitHub Pages'in bu dalı yayınladığından emin ol, sonra yalnız Share Worker'ı deploy et. Cloudflare'daki KV binding, route ve mevcut video/BaitBuster işlevleri korunmalı.

## Önerilen Share Worker null/0 düzeltmesi
2026-11-19 tarihli v2.9.3 Worker kodunda `Number(null)===0` nedeniyle Flöra değeri eksik olduğunda `0.0` yazılıyordu. Güncel Worker'da da aynı satırlar varsa:

```js
const floraNumber =
  meta?.floraScore == null || meta.floraScore === ""
    ? NaN : Number(meta.floraScore);
```

`normalizeShareSnapshot` için de:

```js
const floraRaw =
  value.floraScore == null || value.floraScore === ""
    ? NaN : Number(value.floraScore);
```

`mergeShareSnapshots` içinde `Number.isFinite(Number(next.floraScore))` ve `Number.isFinite(Number(previous.floraScore))` koşullarını sırasıyla `next.floraScore != null && next.floraScore !== "" && Number.isFinite(Number(next.floraScore))` ve aynı şekilde `previous` için yaz. Bunlar KV'deki mevcut doğru puanları değiştirmez; yalnızca `null`'ın sıfıra dönüşmesini engeller.

## Kontrol senaryoları
1. Yeni bir ana akış haberi paylaş, `/s/<kod>` sayfasını gizli pencerede aç. Flöra varsa puan aynı olmalı; eksik veride `0.0` uydurulmamalı.
2. Paylaş'a tıkla. Ana sayfadaki gibi iki seçenek açılmalı; bağlantı paylaşınca aynı kısa link gelmeli, görsel kart indirilebilmeli/paylaşılabilmeli.
3. Kaynağı gör -> iframe aç -> Escape veya kapat -> tekrar aç. Çıkışta beyaz kare olmamalı, geri dönüş odağı kaynak düğmesine dönmeli.
4. Sağ üstteki “Akışa devam et” bağlantısı PC ve dikey mobilde `https://flöw.tr/` ana akışını açmalı.
5. Video, ses, BaitBuster, kısa link/QR ve mevcut reklam davranışlarını ayrıca kontrol et.

> Sınır: Bu dalda canlı Cloudflare Worker'a deploy yapılmadı. v2.9.3'ün tamamını canlı Worker'ın üstüne yazmak yerine yalnız entegrasyon satırlarını ve uygun null/0 düzeltmesini güncel Worker'a işle.
