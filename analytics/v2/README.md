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
