# Flöra Tahmini: güvenli dağıtım notu

Bu değişiklik **canlı ortama dağıtılmadı**. Kod bir GitHub dalında hazırlanmıştır.

## İşleyiş

- Worker, `content_daily` içindeki son 30 günde en az 3 gösterim alan haberleri inceleyerek (en çok 2.400 haber/akış), Flöra puanlarını mevcut `calculateFlora` fonksiyonuyla hesaplar.
- Yalnızca Türkçe/İngilizce anlamlı kelime ve ikili ifadeler için anonim toplu istatistik döner. Geçmiş haber başlıkları, kullanıcı kimlikleri ve ham olaylar API'de yayınlanmaz.
- Sözlük, Worker'ın mevcut D1 + edge cache mekanizmasıyla 24 saat taze, 7 gün stale olarak tutulur. Kullanıcı veya yeni haber başına model eğitimi ya da AI çağrısı **yoktur**.
- Tarayıcı bir sözlüğü oturumda bir defa alır, başlıklara `≈` ile gösterilen yaklaşık puan verir. 8+ görüntüleme ve pozitif bakma süresi oluştuğunda gerçek puana öncelik verir.
- Tek haberin indeksli Flöra API'si 10 dakikalık cache'le tazelenir. Geçici puan yok sonucu da 10 dakika tutulur.
- Haber görünürken puan otomatik değiştirilmez, bir sonraki hazırlanan ekran görüntüsüne yeni veri yansır.
- Sözlük endpoint'i erişilemiyorsa eski puan görünümü aynen çalışır. Özel RSS tahmine katılmaz.

## Kritik sürüm uyarısı

`analytics/worker-flora-prediction.js`, 19 Kasım 2026'da paylaşılan **Analytics Worker V31.22.1** kaynak metni temel alınarak hazırlanmıştır. **Canlı Worker'ın daha yeni bir sürümde olması ihtimaline karşı bu dosyayı doğrudan canlıya yapıştırmayın.** Aynı üç küçük sunucu değişikliğinin mevcut canlı sürüme uygulanması gerekir:

1. `js/flora-predictor.js` içindeki ortak kelime modelinin Worker'a dahil edilmesi.
2. `publicFloraVocabulary` ve `/stats/flora-vocabulary` rotasının eklenmesi.
3. `/stats/flora-story` önbellek anahtarının `flora-story-v2`, fresh TTL'nin 10 dk, stale TTL'nin 2 saat ve edge TTL'nin 3 dk yapılması.

Referans olarak tüm değişiklikler **`analytics/worker-flora-prediction.js`** içinde hazırlanmıştır. Herhangi bir D1 migrasyonu, yeni secret veya Workers AI bağlaması gerekmemektedir.

## Dağıtım sırası

1. Önce canlı Analytics Worker'ın sürümünü ve içeriğini kontrol ederek bu sunucu değişikliklerini daha yeni kodları koruyacak şekilde uygulayın.
2. Sonra GitHub dalını `main` ile birleştirin. `index.html` yeni istemci yardımcı dosyasını `js/app.js` öncesinde yükler.
3. `/stats/flora-vocabulary?stream=main` ve `?stream=foreign` yanıtlarında `ok:true`, `model.sampleStories`, `model.baseline` ve `model.terms` kontrol edin. Örnek sayısı 12'den azsa tahminin kapalı kalması normaldir.
4. Flöw'de henüz görüntülenmemiş bir haberde `≈` tahminini, yeterli etkileşimi olan haberde normal Flöra puanını ve açılır penceredeki açıklamaları doğrulayın.

## Test

```bash
node --test tests/flora-predictor.test.mjs
```

Ücretsiz planı korumak için toplu `/stats/flora-scores` çağrılarını her kullanıcıda başlatmadık. Sadece hazırlanan haberin indeksli sorgusu ve günlük özet sözlüğü kullanılıyor.
