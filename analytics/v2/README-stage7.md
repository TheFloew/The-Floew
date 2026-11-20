# Flöw Analytics v2 | Aşama 7: Ücretsizden ücretliye ölçeklenebilen ham veri altyapısı

**Karar kaydı:** 20 Kasım 2026  
**Durum:** Mimari ve kapasite karşılaştırması. **Üretime alınmış servis veya migrasyon değildir.**  
**Kaynak referans:** [analytics-v2-data-architecture.md](../../docs/analytics-v2-data-architecture.md), [README-stage6.md](README-stage6.md).

## Ürün kararı

Flöw bugün Workers Free üzerindedir. Trafik yüz binlerce günlük kullanıcıya ulaşırsa Workers Paid ve gerekirse daha büyük analitik altyapıya geçilecek. **Ücretsiz plana kalıcı uyum için ölçüm, haber davranışı, cihaz/yön kırılımı, tekil erişim, geçmişe dönük sorgu veya ham arşiv budanmayacak.**

Birincil öneri: **Workers Paid -> Basin Pipelines -> özel R2 Parquet/Iceberg arşivi -> toplu analitik işleme -> küçük hazır Flüsh raporları (uygunsa D1).** D1 kaynak/ayar/yönetim, reklam metadata ve hızlı raporları saklayabilir; ham olayların uzun vadeli tek deposu olmamalı.

Bugün ücretli servis etkinleştirilmez. Çalışan Analytics Worker v31.22.2, Flüsh, Ad Center ve mevcut D1'ler korunur. Ölçekli altyapının ortak olay sözleşmesi, izinleri, ölçüm tanımları ve doğruluk testleri **şimdi** hazırlanır. Ücretli aktivasyon, kontrollü dual-run testinden hemen önce ve ödeme yöntemi onayıyla yapılır.

## 2026/11 servis karşılaştırması

| Seçenek | Güçlü yanı | Sınırı | Karar |
|---|---|---|---|
| D1 ham olay + SQL + cache | Mevcut sistem, en düşük geçiş maliyeti | Ham tablo tarama, tek DB 10 GB Paid limiti, seri sorgu işleme, yazma/index yükü | **Bugün korunur**, uzun vade arşiv değil |
| Workers Paid + Basin Pipelines + R2 Parquet/Iceberg + özet deposu | Yönetilen akış, güvenilir R2 teslimatı, kolonlu arşiv, ücretsiz egress; raporlama katmanı ayrı | Workers Paid gerekir, bağımsız analitik toplayıcı gerekir, Basin SQL stateful aggregation değildir | **Tercih edilen büyüme yolu** |
| Workers + Queues + özel R2 toplu yazıcı | Özel işlemci ve retry/fan-out tasarımı esnek | Operasyon/mesaj başı faturalama, batch ve yeniden oynatma kodu bize ait | Gerekirse, Basin yetmezse |
| BigQuery + object store / ClickHouse | Büyük veri için olgun sorgular ve ayrıntılı analiz | İkinci sağlayıcı, IAM/egress, ingest, compute ve operasyon gideri | Karmaşık analitik ihtiyaçta değerlendirilir |
| GitHub ham log deposu | Kaynak kodu / konfigürasyon / test için uygun | Özel/uzun büyüyen olay kaydında gizlilik, dosya, API, throughput sınırları | Birincil olay arşivi **değil** |

### Doğrulanmış önemli servis gerçekleri

- **Basin Pipelines (eski Cloudflare Pipelines)** 2026-10-01 itibarıyla GA, **Workers Paid** gerektiriyor. HTTP/Workers kaynaklı event ingress, stateless SQL dönüşüm, R2 Parquet veya Iceberg hedefi ve hedefe exactly-once delivery sunuyor. Bu garanti **kaynakta aynı event_id'nin iki kez üretilmediğini** garanti etmez.
- Basin giriş ücretsiz; Workers Paid 50 GB/ay SQL transform ve **ayrı** 50 GB/ay sink hakkı içerir. Sonraki hacim: transform $0.04/GB, Parquet/Iceberg sink $0.06/GB. **Sink faturası sıkıştırılmamış teslim verisine** dayanır.
- R2 Standard: $0.015/GB-ay, A operasyonları $4.50/milyon, B operasyonları $0.36/milyon; ilk 10 GB-ay, 1 milyon A ve 10 milyon B aylık kapsam dahil. Egress ücretsiz. Katalog/sorgu/compaction ek faturalandırılabilir.
- D1 Workers Paid: ilk 25 milyar satır okuma/ay, 50 milyon yazma/ay dahil; +$0.001/milyon okuma, +$1/milyon yazma. **Bir D1 veritabanı en fazla 10 GB** ve sorguları sırayla işliyor. D1 okuma birim fiyatının düşük olması, seri sorgu ve DB boyutu sorununu çözmez.
- Queues Workers Free'de 10 bin operasyon/gün, Paid'de 1 milyon/ay dahil, +$0.40/milyon operasyon. Normal mesaj teslimi yaklaşık 3 operasyon (yaz, oku, sil); toplu mesaj göndermek bu *mesaj başı* sayımı otomatik düşürmez.
- Basin SQL/R2 SQL veri sorguları keşif/backfill için adaydır; mevcut ürün sürümünün ve SQL/dedup operasyonlarının destek sınırları canlı pilotta teyit edilmeli. **Raporların her ziyaretinde büyük arşive sorgu göndermek yok.**

## Flöw veri sözleşmesi: neyi koruyoruz?

**Hedef: Çalışan olayları eksiltmek değil, ölçüm sözleşmesini sürümlemek.** Schema version, event_id, occurred_at UTC, received_at UTC, event_type, platform, uygulama sürümü, ad_id/kampanya_id, kaynak/kategori ve haber bağlamı, cihaz/yön, local_hour/timezone, dwell_ms, ziyaretçi/oturum anonim tanımlayıcısı, gerekliyse metadata. Mevcut Worker ile karşılaştırılıp alan ve olay adı uyumu ayrı test edilecek. Bir reklam olayı, yaş/cinsiyet gibi GA4 tahmini değildir.

**Korumamız gereken reklam metrikleri:** gösterim, atlama, tamamlama, tekrar gösterim, geri dönüş, pozitif izleme süreleri, kampanya tarihsel metadata, saat/yön/cihaz dağılımı, dönem genelinde (günler arası) tekil tarayıcı/kurulum erişimi, gösterim sıklığı ve yeni ölçümler için geriye dönük yeniden işleme. Yeni event olmadan 'reklama tıklama', CTR, satın alma dönüşümü veya reklamın görünürlük standardı sağlandı iddiası yok.

**Gizlilik:** Yalnızca özel erişimli arşiv, en az yetki, şifreleme, takip onayı ve saklama/silme politikası. IP gibi gereksiz ham kişisel veri yeni alan olarak eklenmeyecek. Ziyaretçi tanımlayıcıları ve HMAC özetleri bile kişisel veri riskini bütünüyle kaldırmaz. Reklamverene bireysel kayıt verilmez, yalnızca toplu istatistikler; küçük örneklem gizleme politikası ayrıca tasarlanır. Feedback serbest metni ve yönetici kimlikleri ayrı korunur.

## Üretim veri akışı

```text
Flöw web / mobil / TV
  -> mevcut /track API sözleşmesi, şema sürümü, event_id; küçük ve güvenli batch
  -> güvenilir olay kabul noktası (kesintide retry / DLQ veya Basin stream)
  -> Basin Pipelines (Workers Paid aşamasında açılır)
  -> özel R2 Parquet veya Iceberg, UTC date/hour partition, immutable ham log
  -> checkpoint + geç gelen olay ve yeniden işleme kuralları
  -> batch aggregator / sorgu motoru:
       - event_id ile global dedup, ters kayıt/onarım
       - reklam bazlı hourly/daily/monthly sayaç, dwell sum/count
       - HMAC/HLL reach sketch, audience ve behavior özetleri
       - işlenmiş partition manifesti, watermark
  -> D1 veya ayrı küçük summary store + özel rapor API
  -> Flüsh / Reklam Performansı / Davranış / Kullanıcılar
```

**Uyarı:** Aşama 6'daki her olay için bir D1 ledger satırı, büyük trafikte uzun vadeli yaklaşım olmayacak. Aynı olayın farklı batch'lerde tekrarı, saklanan arşiv üstünde partisyonlu dedup/manifest üzerinden çözülmeli. Kaynakta exactly-once varsayılmayacak. Özellikle gün sınırında gelen gecikmiş olaylar raporun hangi versiyonunda yer aldığını değiştirebilir; watermark, redrive ve backfill gerekir.

**Pilot zaman hedefi:** Başlangıçta **15 dakika** maksimum kabul edilmiş olay -> iç rapor güncellik hedefi; sözleşmede gecikme etiketi ve aksama uyarısı. Reklamveren raporları için nihaileşmiş günler watermark ile kilitlenir; gecikmiş olaylar rapor revizyonu olarak izlenir. Bu hedef performans testiyle doğrulanacak, mevcut Flüsh davranışı hakkında iddia değildir.

## Hacim ve örnek bütçe (gerçek trafik ölçümü DEĞİL)

Varsayım: **500.000 ziyaretçi/gün × 20 olay = 10 milyon olay/gün = 300 milyon/30 gün.**
İstek sayısı olay sayısıyla aynı değildir: 1 telemetry HTTP isteği/ziyaretçi/gün kabul edilirse **15 milyon HTTP isteği/ay**; çoklu oturum/istek durumunda artar.

| Bir olayın sıkıştırılmamış veri boyu | Aylık olay hacmi | Basin dönüşüm ve Parquet sink* | %30 boyuta sıkışma ile 12 ay sonunda R2 boyutu |
|---|---:|---:|---:|
| 500 bayt (örnek) | 150 GB | $10/ay | 540 GB |
| 2.000 bayt (örnek) | 600 GB | $55/ay | 2.160 GB |

*50GB transform ve 50GB sink hakkı boştaysa; yalnızca bu iki fiyat kalemi. R2 depolama, işlemler, catalog/SQL, worker CPU/istek, gerçek veri yeniden işleme, vergiler hariç.

Ek örnek, 500 bayt senaryosunda 12 ay boyunca her ay aynı hacim ve %30 R2 saklama varsayımı: 12. ay sonunda R2 aylık standard storage **~$7,95**, Workers taban **$5**, sadece telemetry isteklerinin Paid kapsamında kalan 5 milyon fazlası için **~$1,50** (hesaptaki 10m dahil istek diğer Worker'larla paylaşılmıyor varsayımı). Basin ~**$10**. Bu sayılan kalemlerin **~$24,45/ay** toplamı **tam sistem faturası değildir**. R2 nesne operasyonları, sorgu motoru, CPU, katalog, diğer Workers trafikleri ve veri değişikliği maliyeti dahil **değildir**. İhtiyaç halinde yüksek trafik için bütçe üst limiti, kapasite ve alarm oluşturulmalı.

Model: `node analytics/v2/capacity-model.mjs [dailyVisitors] [eventsPerVisitor] [bytesPerEvent] [telemetryRequestsPerVisitor] [monthsOfArchive] [compressionRatio]`

**Performans hedefi:** `all` Flüsh sayfası tamamlanmış dönemin aylık/günlük özetinden hesaplanmalı. Arşiv taraması sadece yeni analiz, düzeltme, tarihsel yeniden işleme veya arka plan işleri için olmalı.

## Geçiş takvimi / çıkış kriterleri

1. **Şimdi, Free plan:** Olay sözleşmesini sürümle, mevcut `/track` payloadlarını sentetik verilerle doğrula. Ölçüm sözlüğü + marka/kampanya eşleştirmesi, GDPR/KVKK veri minimizasyonu; canlı Workers v31.22.2 korunur. Küçük offline Parquet/Iceberg örnekleri hazırlanabilir.
2. **Paid'e geçiş onayıyla:** Basin/R2 izolasyonu, IAM, ayrı staging bucket, harcama alarmı, veri saklama ve erişim koşulları. Prod kullanıcı verisine başlamadan sentetik uçtan uca canary.
3. **Sadece arşiv için çift yazım:** Aynı olay D1 eski yoluna ve yeni özel arşive yazılır; kabul oranı, gecikme, missing/duplicate event ID ve parti checksum raporu tutulur. Sözleşme dışı alanlar karantinaya alınır.
4. **Rapor işleyicisi:** 5–15 dk micro-batch, global idempotency, saatlik sayaç + HLL reach, günlük/aylık rollup, watermark ve replay. Her periyotta toplam sayılar mevcut SQL referansıyla karşılaştırılır.
5. **Flüsh shadow/dual read:** 24h,7d,all; ad detay cihaz/yön/saat, campaign totals; son 30 gün ve gerekirse tüm dönemler için sayısal eşitlik veya HLL ilan edilen hata eşiği. Ölçüm sapmaları görünür.
6. **Kademeli switch:** Önce Reklam Performansı, sonra Davranış ve Kullanıcılar. D1 ham yazmalarını azaltmak yalnızca yeterli zaman boyunca işlenen verinin eksiksiz R2 arşivine geçtiği kanıtlanınca yapılır.
7. **Büyüme testleri:** 500k DAU ×20 olay senaryosunda pik/süre, 1–2kB payload, başarısız teslimat, 72 saat gecikmiş olay, sunucu kesintisi, reprocess/backfill ve aylık maliyet alarma karşı sınanır.

### Henüz teknik açıdan karara bağlanmayanlar

- Gerçek kullanıcı/oturum başına `/track` istek sayısı, gerçek medyan/p95 olay boyutu, ay sonu ham kayıt hacmi ve olay sıklıkları ölçülecek.
- Basin Catalog Iceberg mi, düz R2 Parquet mi? İçerik yeniden işleme, çoklu SQL ve gelecekte reklamveren sorguları önemliyse **Iceberg** tercih edilir; daha basit immutable arşiv yeterliyse **Parquet**. İkisi de veri kaybı olmadan taşınabilir.
- 5/15/60 dakika rapor tazelik ve arka plan işleyici seçimi: Basin SQL, harici DuckDB/ClickHouse/BigQuery veya başka işleyici. **Basin SQL stateless transform otomatik olarak Aşama 6 özetlerini üretmez.**
- R2 kullanımı önceki reklam merkezi çalışmasında ödeme yöntemi istenmesi nedeniyle ertelenmişti. Aynı hesapta yeni ücretli ürün etkinleştirmesi için **kullanıcının ödeme/plan onayı gerekli**; arka planda etkinleştirme yapılmayacak.

## Resmi kaynaklar (20 Kasım 2026)

- https://developers.cloudflare.com/basin-pipelines/
- https://developers.cloudflare.com/basin-pipelines/platform/pricing/
- https://developers.cloudflare.com/basin-pipelines/sinks/
- https://developers.cloudflare.com/r2/pricing/
- https://developers.cloudflare.com/d1/platform/pricing/
- https://developers.cloudflare.com/d1/platform/limits/
- https://developers.cloudflare.com/queues/platform/pricing/
- https://developers.cloudflare.com/workers/platform/pricing/
- https://cloud.google.com/bigquery/pricing

**Değişiklik sınırı:** Bu aşamada hiçbir Cloudflare Worker, D1, R2, Basin ya da Flüsh servisi etkinleştirilmedi, güncellenmedi veya deploy edilmedi.
