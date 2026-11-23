# Flöra Tahmini: uygulama ve dağıtım

## Hazırlanan sürümler

- **Analytics Worker**: Kullanıcı tarafından 23 Kasım 2026'da sağlanan **V31.23.0** temel alınmıştır. `analytics/worker-flora-prediction.js` dosyası tam, tek parça Worker kodudur.
- **Web ön yüzü**: `js/flora-predictor.js` ve `js/app.js` güncellendi. `index.html` yardımcı modülü önce yükler.
- Eski V31.22.1 Worker **artık referans alınmamaktadır**. Behavior v3, reklam analitiği, GA4 ve mevcut raporlama bölümleri korunmuştur.
- Kod **canlıya otomatik gönderilmedi**.

## Nasıl çalışır?

- Worker, son 30 günde `content_daily` tablosundan en az üç görüntülenmesi olan, en çok 2.400 haber/akış arasından geçmiş etkileşimleri ve Flöra skorlarını toplar.
- `/stats/flora-vocabulary?stream=main` ve `stream=foreign` endpoint'leri, geçmiş haberlerin başlıklarını değil, en çok 1.800 adet kelime/ifade özetini yayınlar.
- Model 24 saat taze, 7 gün stale önbellekte tutulur. Kullanıcı veya haber başına AI çağrısı ya da geçmiş istatistik taraması yapılmaz.
- Yeni haberde, model üzerinden tarayıcıda `≈` ile gösterilen başlangıç puanı hesaplanır. Yeterli gerçek kullanım verisi (8+ görüntülenme ve bakma süresi) olduğunda gerçek Flöra puanına öncelik verilir.
- Tek haber Flöra istatistik önbelleği artık 10 dk taze, 2 saat stale; edge'de 3 dk tutulur. Gösterilmiş haberin puanı arka plandan gelince ekranda değişmez. Yeni snapshot sonraki hazırlanmış haberde kullanılır.
- Modelin kullanılabilmesi için en az 12 uygun geçmiş haber olması gerekir. Model boşsa eski normal Flöra davranışı sürer.
- Özel RSS haberleri tahmine dahil edilmez.

## Önemli: Sıralama

1. Cloudflare'deki **Analytics Worker** editörüne `analytics/worker-flora-prediction.js` içeriğini **tamamen** yapıştırın ve Deploy edin. Aynı Worker'ın mevcut ortam bağlamalarını/secrets'ını değiştirmeyin.
2. Aşağıdaki iki test adresinde JSON `ok:true` ve `model` alanını doğrulayın:
   - `https://thefloew-analytics.thefloewback.workers.dev/stats/flora-vocabulary?stream=main`
   - `https://thefloew-analytics.thefloewback.workers.dev/stats/flora-vocabulary?stream=foreign`
3. Sonra PR #12'yi `main` dalına merge edin.
4. Siteyi yeniden yükleyip, tahmini haber için `≈` ve gerçek verili haber için standart puanı kontrol edin.

## Testler

```bash
node --test tests/flora-predictor.test.mjs
```

Kaynak Worker'a yalnız Flöra ile ilişkili eklemeler yapıldı; Behavior v3 / ads / GA4 SQL sorguları ve hizmet rotaları değiştirilmedi.
