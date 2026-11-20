# Analytics v2 · Saatlik Reklam Özeti Prototipi

Bu klasör **yalnızca offline doğruluk prototipidir**. Çalışan Flöw Analytics Worker'ına, veritabanlarına veya Flüsh API yanıtlarına bağlı değildir. Üretimde **deploy edilmemelidir**.

## Amaç

Mevcut Analytics Worker **v31.22.2** içindeki `adSummary()` fonksiyonunun ölçümlerini, her rapor isteğinde ham `ad_events` taramak yerine saatlik dilimler üzerinden üretmeyi denemek.

- Saatlik boyutlar: UTC saat başlangıcı + reklam ID + cihaz tipi + yön + reklamın yerel saati.
- Sayaçlar: `ad_view`, `ad_skip`, `ad_complete`, `ad_return`, `ad_repeat_view`.
- Ortalama: pozitif süreli atlama/tamamlama olaylarının `dwell_ms` toplamı / örnek adedi.
- Erişim: `visitor_id` bazında aynı kişinin farklı saat ve reklamlarda iki kez sayılmaması.
- Dönem: `24h` ve `7d` kayan zaman aralığı için yalnızca başlangıç saatinin ham sınır olayları, diğer saatler için hazır özet; `all` için yalnızca özet.
- Aynı `event_id` iki kez işlenirse yalnızca bir kez sayılır.

## Tek komutla test

```sh
node --test analytics/v2/ad-hourly.test.mjs
```

**7 test:** 24h/7d/all ham-referans eşleşmesi; tüm zamanlar ham olay taramaması; kayan dönem sınırı; tekrar gelen olay; günler arası tekil ziyaretçi.

## Test çıktısı neyi kanıtlar, neyi kanıtlamaz?

Sentetik olaylar üzerinde **mevcut raporun gösterim, atlama, tamamlanma, geri dönüş, tekrar gösterim, ortalama süre ve tekil tanımlayıcı sayısı** ile aynı sonuç elde edildiğini doğrular. **Gerçek D1 sorgusu, canlı trafik veya Cloudflare maliyeti ölçülmedi.** SQL tarafındaki `MAX` alanlarının ve reklama ait detay kırılımlarının üretim eşitliği ayrıca test edilmelidir.

Bilinçli olarak üretime uygun olmayan iki unsur var:

1. **`Set<visitor_id>`** kullanılması kesin tekilleştirme için bellekte bütün anonim ID'leri tutar. Çok sayıda ziyaretçide maliyeti büyür; uygun kalıcı tekilleştirme/sketch yapısı seçilmelidir. Ziyaretçi kimlikleri GitHub'a yüklenmez.
2. **`hourEvents`** yalnızca kayan 24 saat/7 gün sınırını kusursuz doğrulamak için offline bellekte tutulur. Üretimde yalnızca sınır saati için erişilen kısıtlı ham partisyon, daha küçük zaman dilimi veya uygun delta yapısı gerekir.

Bu prototip **kalıcı ham olay arşivi**, **kimlik verisi güvenliği**, **GA4 demografisi**, **Feedback**, **Kullanıcılar**, **Davranış** veya **Reklam Detay** API'lerini uygulamaz. Flüsh bu dosyaları yüklemez.

## Sonraki iş (canlıya geçiş değil)

1. Mevcut v31.22.2 Worker'ın **gerçek SQL** sonuçlarını sentetik aynı veri setinde prototiple karşılaştır; reklam detayındaki yön, cihaz, saat, yön × cihaz kırılımlarını da eşitle.
2. Reklamveren ölçümlerinde reklam gösterimi tanımını (gerçek görünürlükten farkını) belgele.
3. Ham arşivin özel depolama/izin/saklama politikasını ve hacim tahminini netleştir.
4. Tekil erişim için kesin anonim eşleştirme mi, hata payı açıklanan yaklaşık tekilleştirme mi kullanılacağını seç.
5. Üretim için sınırlı yazmalı saatlik özet veritabanı ve güvenli idempotent işleme prototipi tasarla; istemci API'lerine dokunmadan **dual-run** test et.

**Bu aşamada hiçbir canlı API, D1 veri yapısı, oturum veya reklam kaydı değiştirilmedi.**

## Aşama 2: v31.22.2 SQL eşitlik testi (20 Kasım 2026)

`ad-hourly.mjs` artık `queryHourlyAdDetail()` de içeriyor. Reklam bazında **yön**, **cihaz**, **yerel saat** ve **yön × cihaz** kırılımlarını saatlik özetlerden hesaplıyor. Aynı ziyaretçi saatler veya reklamlar arasında tekrar karşılaşılsa bile tekil tanımlayıcı bir kez sayılıyor. `local_hour=-1` detayın saat kırılımından dışlanıyor; genel reklam toplamından dışlanmıyor. Gösterimi olmayan kırılım satırları kaldırılıyor.

Yeni `ad-hourly.sql-parity.test.mjs`, üretim sistemine bağlanmadan, **kullanıcının mevcut v31.22.2 Analytics Worker dosyasını** yerel SQLite D1 taklidiyle çağırıyor. Worker kodu bu repoya kopyalanmaz ve testlerde gerçek kullanıcı verisi, token veya ağ bağlantısı kullanılmaz.

Node.js **22+** ile gerçek Worker'ın `worker.js` içeriğini `worker.mjs` uzantısıyla yerel bir klasöre kopyalayıp test et:

```sh
FLOEW_ANALYTICS_WORKER_PATH=/path/to/worker.mjs node --test analytics/v2/*.test.mjs
```

Kaynak dosya belirtilmezse SQL'e bağımlı 9 test **skip** edilir, bağımsız prototipin ilk 7 testi çalışır. Kaynak sağlandığında **toplam 16 test** çalışır: genel reklam performansı için 24h/7d/all (3), iki reklamın dört ayrı detay kırılımı için aynı dönemler (6), önceki 7 temel test. 20 Kasım 2026'da yüklenen v31.22.2 Worker ile 16 testin tamamı yerelde başarılıdır.

**Önemli eşitlik ayrımı:** Worker, `/admin/ads` ve `/admin/ad` JSON'larında kategori kodunu örneğin `W` → Türkçe metne dönüştürür ve Ad Center metadatasını ayrı servisten ekleyebilir. Test, istatistik ve ham metaveri alanlarının aynı olmasını karşılaştırır, bu sunum katmanındaki dönüşümü ayrıca kabul eder. GA4 demografisi, reklam detay HTML raporu ve canlı ölçüm yükü henüz bu prototipin kapsamı değildir.

**Canlıya almama nedeni:** Prototip anonim ziyaretçi kimlikleri için bellekte `Set` kullanır; kayan 24h/7d'nin tam sınırını çözmek için başlangıç saatindeki olayları da bellekte tutar. Bu iki yöntem yüksek trafikte aynı biçimde kullanılamaz. Kalıcı, idempotent saatlik yazma/tekilleştirme tasarımı ve doğru özel ham veri arşivi ayrı uygulama aşaması gerektirir. Hiçbir D1 tablosu veya Worker deploy'u değiştirilmemiştir.

## Aşama 3: Kalıcı saatlik delta satırları (offline SQLite prototipi)

Yeni dosyalar:

- `ad-hourly-deltas.sql`: **Yalnızca yerel test amaçlı** şema. `batch_id + UTC hour + ad_id + device_type + orientation + local_hour` birleşik anahtarlı, append-only özet satırları. Canlı D1'de çalıştırmayın.
- `ad-delta-store.mjs`: gelen bir paket içindeki olayları ilgili saatlik kırılımlara indirger, SQLite transaction ile `INSERT OR IGNORE` yazar, saat hizalı dönemlerde özetleri sorgular.
- `ad-delta-store.test.mjs`: tekrarlanan paketin çift sayılmaması, paket içi tekrarlanan `event_id`, büyük tek-kırılım paketi, farklı kampanyalar, saat sınırları, ağırlıklı izleme ortalaması ve kimliklerin özet satırında tutulmaması için 8 test.

Yerel Node 22+ komutu:

```sh
node --test analytics/v2/ad-delta-store.test.mjs
```

Yerel doğrulama: **8/8 başarılı.** Sentetik 20.000 gösterim aynı reklam/saat/cihaz/yön kırılımında tek bir SQLite özet satırı olarak kaydedildi. Bu yalnızca seçilmiş sentetik senaryodur, gerçek kullanıcı trafiği ve Cloudflare D1 maliyet ölçümü değildir. Gerçekte satır sayısı aktif kampanya, zaman ve kırılım çeşitliliğine bağlıdır.

**Bilinen sınırlamalar ve canlıya geçiş engelleri:**

1. **Paket düzeyinde idempotent:** Aynı `batch_id` tekrar gelirse satır çakışması sayesinde iki kez yazılmaz. Aynı `event_id` **farklı batch_id'lerde** geldiyse, bu prototip onu yeniden sayabilir. Üretimde upstream olay kimliği deduplikasyonu ve stabil paketleme *zorunlu*. Aynı `batch_id` altında **farklı içerik** kabul edilmemeli; üretim aşamasında paket içerik özeti/manifest doğrulaması olmalı.
2. **Tekil erişim bu depoda yok:** Anonim ziyaretçi kimliklerini saklamadan `COUNT(DISTINCT)` üretmek için ayrı kesin reach indeksi veya açıklanmış tahmini HyperLogLog benzeri birleşebilir sketch gerekir. Bu prototip izleyici/geri dönen izleyici frekansı üretmez.
3. **Tam kayan 24 saat/7 gün sorgusu yok:** Saat ortasında başlayan dönemleri sessizce yuvarlamak yanlış sonuç verir. Kod böyle istekleri reddeder. Sınır saatinin küçük ayrı bir partisyondan okunması, dakikalık özet veya ayrı canlı delta çözümü tasarlanmadan Flüsh'e bağlanmamalı.
4. **Kapsam:** Reklam gösterim/atlama/tamamlama/tekrar/geri dönüş sayaçları ve süre toplamları. Reklam kırılımları SQL'de boyut olarak bulunur; detay sayfası ve metadata eşleştirmesi için üretim API henüz hazırlanmadı. GA4, Feedback ve diğer Analytics modüllerine dokunulmadı.
5. **D1 sınırlaması:** Mevcut D1'daki tek tek ham olay yazıları devam ederse bu prototip tek başına büyüme sorununu çözmez. Ham olay arşivi, sıra/batch sistemi, depolama kararı, backfill ve eski ham sorguların kapatılması ayrı aşamadır.

**Uygulama kararı:** Canlıya alma, D1 migrasyonu veya çalışan Worker değişikliği yapılmadı. Bunlar yapılmadan önce global dedup, tekil erişim, 24h/7d sınırları, gizlilik, arşiv ve gerçek maliyet testleri tamamlanmalı.

## Aşama 4: Tekil reklam erişimi (offline, 20 Kasım 2026)

Yeni modüller: `ad-reach-sketch.mjs`, `ad-reach-store.mjs`, `ad-reach-hourly.sql`, `ad-reach-store.test.mjs`.

**Yöntem:** 32+ baytlık gizli HMAC-SHA256 anahtarından üretilmiş kimlik özeti ve birleşebilir `ReachSketch`:

- **1–128 farklı tanımlayıcı:** 128-bit anahtarlı özetlerle **kesin** tekil erişim.
- **129+ farklı tanımlayıcı:** Sparse HyperLogLog, yeterince büyürse `p=14` dense HLL. Yaklaşık sayım; **%0,8125** teorik bağıl standart hata (garantili maksimum hata değildir).
- Büyük bir sketch'in binary boyutu **16.387 bayt**. Küçük gruplar daha kompakt.
- Aynı ziyaretçi farklı saat, gün ve reklamlarda tekrar etse bile eskizler birleştirilerek tekrar sayılmıyor. Birden fazla küçük grubun birleşimi 128'i aşınca birleşik sonuç yaklaşık olabilir.
- `ad_view` ve `ad_return` tekil tanımlayıcıları; reklam, cihaz, yön, yerel saat ve yön×cihaz kırılımları destekleniyor. Bu sayılar **gerçek tekil kişi** değil, anonim tarayıcı/kurulum tanımlayıcı sayısıdır.
- Gösterim/atlama/tamamlama **olay sayıları** mevcut kesin sayaçlarda kalır. Tahmini tekil erişime dayanan frekans ve geri dönüş oranları da yaklaşık olarak etiketlenmelidir.

**Kalıcı offline örnek:** `ad_reach_hourly` tekil sketch BLOB'ları, `ad_reach_batches` aynı batch'in tekrar uygulanmamasını sağlayan manifest tutar. SQLite `BEGIN IMMEDIATE` ile saatlik sketch'ler işlem içinde birleştirilir. Üretim D1 için **aynen kullanılamaz**; yazma yarışları, transaction desteği ve batch stratejisi tasarlanmalıdır.

**Test:** `node --test analytics/v2/ad-reach-store.test.mjs` (Node 22+). Yerelde **13/13 başarılı**. 100.000 sentetik farklı ziyaretçide **100.488** tahmin edildi (bu tek testte **%0,488** sapma). Gerçek Cloudflare maliyet veya trafik testi değildir. Anahtarlar ve kullanıcılar sentetiktir.

### Canlıya geçiş öncesi sınırlar

1. **Tam 24h/7d:** Prototip sadece *saat başlangıcına hizalı* raporları kabul eder. Kayan son 24 saat ve 7 gün için dakika/alt saat bölümü veya sınırlı saat sınırı taraması gereklidir. HLL'den belirli bir saat dilimi çıkarılamaz.
2. **Tüm zamanlar:** Ham olayı taramaz, ama çok sayıda saatlik eskiz birikebilir. Ömür boyu sorguyu sınırlandırmak için günlük/aylık birleşik sketch arşivi gerekir.
3. **Trafik maliyeti:** Çok sayıda reklam ve kırılım için BLOB birleştirme/yazma iş yükü ölçülmeli. D1, sıraya alınmış işlemci, depolama ve arşiv seçimi henüz yapılmadı.
4. **Gizlilik:** Gizli anahtar asla GitHub'a yüklenmeyecek. HMAC özetleri **takma adlı veri** olarak korunacak. Küçük gruplar reklamveren raporunda ayrıca gizlenebilir. Anahtar rotasyonu / kaybı halinde eski-yeni eskizler yeniden hesaplama olmaksızın birleşemez; keyId ve gerçek secret eşleştirmesi şarttır.
5. **Deduplikasyon:** Reach aynı anonim kişiyi ayrı batch'te doğal biçimde birleştirir; **normal gösterim sayaçları** için farklı batch'lerde tekrar eden `event_id` hâlâ ayrı çözülmelidir.
6. **Veri kapsamı:** Eksik/yenilenen ziyaretçi kimlikleri, cihaz değişimi, takip engeli gibi nedenlerle hiçbir hesap gerçek insan erişimini garanti etmez. `visitor_id` alanı olmayan olaylar tekil erişime dahil edilmez.
7. **Canlı bağlantı yok:** Modül `node:crypto` ve yerel SQLite kullanır. Worker'a geçişte Web Crypto, batch/atomic upsert, veri saklama politikası ve gerçek SQL eşitliği doğrulanmalı.

**Durum:** Bu aşamada Cloudflare Worker, Flüsh, D1 veya canlı kullanıcı kayıtlarında **hiçbir değişiklik yapılmadı**.
