# Flöw | Paylaşılan haber sayfası butonları

Bu güncelleme **ana sayfayı değiştirmez**. Paylaşılan haberin açıldığı Share Worker sayfasındaki ikon butonlarını Flöw ana sayfası ile aynı tasarım diline taşır.

## Dosyalar

- `css/share-landing.css`: Yeni Flöw ikon/SVG görselleri, 30×36 masaüstü ve 32×38 mobil buton geometrisi, hareketsiz hover/focus davranışı.
- `js/share-landing-ui.js`: Share Worker sayfasındaki mevcut butonları tanır ve CSS'yi yükler. Butonların `click` olayları, bağlantıları ve içerikleri değişmez.

## Canlı yayına alma

Share Worker'ın **mevcut** kodunda, paylaşılan haberin HTML'ini üreten fonksiyonun `<head>` kısmına (kapanış `</head>` öncesine) şu satırı ekle:

```html
<script defer src="https://xn--flw-tna.tr/js/share-landing-ui.js?v=1"></script>
```

Ardından **yalnızca Share Worker'ı** deploy et. Worker'ın tamamını eski sürümlerle değiştirme. Paylaşılan haber sayfası hem `/s/<kod>` hem de eski `/share/<token>` için ayrı HTML üretirse, satırı ikisine de ekle.

## Kontrol

1. Gerçek bir haberi paylaş; `flöw.tr/s/...` bağlantısını aç.
2. Paylaş, kaynağa git, kapat ve varsa geri bildirim ikonlarının yeni SVG/ikon fontu tasarımında olup olmadığını kontrol et.
3. Hover sırasında ikonlar yerinde durmalı; sadece opaklık değişmeli.
4. Mobilde dokunma hedefleri korunmalı.
5. Paylaşım kopyalama, QR, kaynak görüntüleme ve Flöra verileri eskisi gibi çalışmalı.

**Not:** Bu repository'deki dosyalar GitHub'a yazılmıştır, fakat Share Worker bu script'i HTML'ine ekleyip deploy edilmedikçe *paylaşım sayfasının canlı görünümü değişmez*.