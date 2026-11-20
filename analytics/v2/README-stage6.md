# Flöw Analytics v2 | Aşama 6: Global olay tekilleştirme ve günlük/aylık arşiv

**Durum:** Yalnızca **yerel Node.js 22 / SQLite prototipi**, canlıya alınmaz. 20 Kasım 2026.

## Bu sürümde ne var?

1. `v2_event_ledger`: Olay ID'sinin gizli HMAC ile üretilmiş özeti ve içerik doğrulama özeti. Bir olay farklı `batch_id` ile tekrar gelirse **gösterim/atlama/süre sayaçlarına ve reach özetine yeniden yazılmaz**. Aynı ID farklı içerikle gelirse paket reddedilir.
2. `ingestAcceptedBatch`: Ledger, saatlik sayaç, HMAC/HLL tekil erişim ve batch manifestini **tek bir SQLite transaction** içinde günceller. Hata olursa hepsi geri alınır. Saatlik kırılım aynıysa 1000 olaydan tek sayaç satırı oluşur; **ancak 1000 ayrı ledger kaydı tutulur**.
3. `sealDays` / `sealMonths`: Eski tam UTC günlerini saatlik özetlerden günlük, eski tam UTC aylarını günlük özetlerden aylık kayıtlara birleştirir. Alt zaman çözünürlüğündeki özetleri kaldırır, üst düzey özetleri tutar. HLL tekil sayımı **günler arasında basitçe toplamaz, eskizleri birleştirir**.
4. `getStage6AdReport`: `24h` / `7d` / `all` görünümlerini önceki aşamadaki rapor yapısında sunar. Eski dönemleri aylık/günlük, yakın dönemi saatlik özetlerden okur; tamamlanmamış saatler için yalnızca **eksiksiz doğrulanmış kabul edilmiş olaylar** kaynağını kullanır.
5. `v2_key_config`: Aynı `keyId` etiketi altında gizli HMAC anahtarının değişmesini engeller. Anahtar kaybolursa ya da döndürülürse kontrollü yeniden işleme gerekir.

## Dosyalar

- `ad-stage6.sql`: İzole offline test şeması. **Canlı D1'de çalıştırmayın.**
- `ad-stage6-pipeline.mjs`: Tek işlemde global dedup + saatlik yazma + günlük/aylık kapatma.
- `ad-stage6-report.mjs`: Karışık saat/gün/ay granülerliği ve doğrulanmış eksik saat adaptörü.
- `ad-stage6.test.mjs`: Yeni kurallar için sentetik ve tekrarlanabilir testler.
- Aşama 5'ten taşınan `ad-unified-report.mjs`, `ad-reach-sketch.mjs` ve diğer offline referans modüller.

Node.js 22+ üzerinde:

```sh
cd analytics-v2-stage6-offline
node --test ad-stage6.test.mjs ad-unified-report.test.mjs
```

**25 / 25 yerel test başarılı** (14 yeni + 11 önceki aşama): farklı paketlerde tekrar ID, içerik çakışması, atomik rollback, HMAC anahtar kontrolü, 1000 olaylık tek kırılım, 24h/7d/all kesin sınırları, eksik veya sahte sınır kaynağının reddi, saatten güne ve günden aya indirgeme, 8 günlük saatlik koruma, gecikmiş olay engeli ve 600 olaylık çok aylı rastgele test. Hepsi sentetik veridir, gerçek D1 benchmark'ı değildir.

## Canlıya geçişin önündeki önemli engeller

**A. Global dedup hâlâ pahalıdır.** Her kabul edilen olay için `v2_event_ledger` içine **1 kalıcı satır** yazılır ve PK indeksi kontrol edilir. 500 bin ziyaretçi × günlük 20 olay senaryosunda 10 milyon yeni ledger satırı/gün doğar. Bu, D1 ücretsiz kotası için uygun değildir, ücretli plan üzerinde de sürdürülebilirlik/maliyet karşılaştırması gerektirir. Olay ID'si ledger'ının saklama süresi, daha ekonomik upstream kuyruğa bağlanma ve dedup kimliğinin ömrü kararlaştırılmadı. "20 bin olay = bir D1 yazma" iddiası **doğru değildir**: yalnızca sayaç satırları toplanır; olay dedup kaydı ayrı yazılır.

**B. Kısmi saat için hâlâ ham olay gerekir.** Doğrulayıcı `v2_event_ledger` üzerinde **zaman aralığıyla sınırlı indeksli COUNT + olay başına PK kontrolü** yapar. Bu önceki gibi bütün geçmişi taramaz, ama yüksek trafikte tek bir saat bile yüz binlerce olay anlamına gelir. Daha küçük zaman dilimli özetler, kaynak manifesti veya uçtan uca checkpoint çözümü olmadan 500 bin/gün hedefi için canlıya alınamaz. Kısmi saatin bütün olaylarını listeleyen sınır kaynağı da henüz bir servise bağlı değildir.

**C. Gecikmiş yeni olaylar reddedilir, telafi mekanizması yok.** Bir gün/ay özetlendikten sonra ona gelen daha önce kabul edilmemiş olay durdurulur; sessizce eksik hesaplanmaz. Üretimde bu olayın özel arşive/karantinaya alınıp kontrollü tekrar hesaplanması gerekir. Yerel prototip bunu henüz sağlamıyor.

**D. D1 transaction API farklıdır.** Buradaki `BEGIN IMMEDIATE` senaryosu **Node.js SQLite** için geçerlidir. Cloudflare D1'de aynı transaction garantisini sağlayacak dağıtık worker/queue/tek-yazıcı tasarımı yapılmadı. Gerçek veri ve canlı worker değiştirilmedi.

**E. İstatistik kesinliği:** Sayaçlar kabul edilen olaylar için kesindir; >128 ayrı ziyaretçi tanımlayıcısı HLL ile yaklaşık sayılır (`p=14`, yaklaşık %0,81 standart hata). Ziyaretçi kimliği gerçek insan sayısı değildir. Reklamveren ekranında yaklaşık erişim ve buna bağlı frekans açıkça etiketlenmelidir.

**F. Diğer açık konular:** Gizli ham olay arşivi, KVKK uyumu, kimlik saklama süresi ve silme, Ad Center metadata bağlama, maksimum 1000 reklam durumundaki toplamlar, canlı deploy/backfill, gerçek trafik benchmark'ı, 24h/7d ile 1 dakikadan küçük zaman çözünürlüğü, kaynak checksum ve tekrar oynatma garantisi.

**Özet:** Bu sürüm iki matematiksel problemi yerel prototipte çözüyor: tekrar olayın çift sayılmaması ve eskiden kalma özetlerin saat/gün/ay olarak çakışmadan toplanması. **500 bin günlük kullanıcıyı Cloudflare kotası içinde karşılayacak üretim mimarisi henüz değildir.**
