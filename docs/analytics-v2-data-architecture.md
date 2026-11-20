# Flöw Analytics v2: reklam odaklı veri mimarisi

**Durum:** Tasarım / uygulama öncesi karar kaydı. **Tarih:** 20 Kasım 2026.  
**Kapsam:** Flöw Analytics Worker v31.22.2, Flüsh kullanıcı/davranış/reklam performansı modülleri, GA4 entegrasyonu.  
**ÖNEMLİ:** Bu belge canlı Worker'ı, D1 veritabanlarını veya mevcut API'leri değiştirmez.

## Hedef ve sınırlar

- Günlük 500 bin ziyaretçi gibi büyüme senaryolarında ham tablo taramasına bağlı rapor performansını ve D1 kota riskini azaltmak.
- Reklamverene **toplulaştırılmış**, tanımları açık, güvenilir kampanya istatistikleri sunmak.
- Ham olayların yeniden işlenebilirliğini korumak; ham ziyaretçi olaylarını herkese açık GitHub deposuna koymamak.
- Flüsh'ün mevcut yanıt şemalarını ve seçilebilir zaman aralıklarını korumak: `24h`, `7d`, `all`.
- Temel ilkeler: **olayı bir kez kabul et, güvenli arşivle; özeti bir kez üret, çok kez oku**. Özetleme geçmiş olayların silinmesi değildir.
- R2, başka bir nesne deposu veya analitik veritabanı tercihi **henüz verilmedi**. GitHub kaynak kodu ve işlemci iş akışları için kullanılabilir; birincil sınırsız ham olay deposu olarak önerilmez.

## Mevcut kaynak envanteri

| Kaynak | Mevcut tablolar/servis | İşlev |
|---|---|---|
| D1 `audience_db` | `visitors`, `sessions` | Tekil ziyaretçi, oturum, cihaz, ülke, şehir, tarayıcı, işletim sistemi, geliş kaynağı |
| D1 `behavior_db` | `behavior_events` | Kaynak/kategori etkileşimleri, olay türleri, kelimeler, filtreler, otomatik akış, özel RSS, Feedback |
| D1 `behavior_db` | `ad_events` | Reklam gösterim, atlama, tamamlama, tekrar gösterim, geçmişteki reklama geri dönüş, süre ve kırılımlar |
| D1 `content_db` | `content_events`, `content_daily` | Haber/Flöra istatistikleri, görüntüleme ve okuma süresi |
| GA4 | GA4 Data API | Yaş ve cinsiyet gibi platformun sunabildiği, eşikleme/eksik kapsama içerebilen demografik raporlar |
| Ad Center | Ayrı reklam yönetimi kaynağı | Reklam kimliği, kategori, başlangıç/bitiş, aktif/yayın durumu ve kampanya metaverisi |
| Flüsh | Yetkili yönetim arayüzü | Mevcut üç Analytics modülü, geri bildirim ve yönetim |

## Ölçüm sözlüğü ve hesaplama yolu

| Metrik | Mevcut olay/alan | v2 hesaplama ilkesi | Reklamverenin görebileceği durum |
|---|---|---|---|
| Reklam gösterimi | `ad_view` | Reklam ID × UTC saat × cihaz/yön boyutunda sayaç | **Kesin olay sayısı**; görünürlük standardı (viewability) doğrulanmadıkça o adla sunulmaz |
| Atlamalar | `ad_skip` | Ayrı sayaç | Kesin olay sayısı |
| Tamamlamalar | `ad_complete` | Ayrı sayaç | Kesin olay sayısı |
| Atlama / tamamlama oranı | Üstteki sayaçlar | Dönem boyunca toplam pay / toplam gösterim; günlük yüzdeler toplanmaz | Payda ve kapsamıyla sunulur |
| İzleme süresi | `ad_skip`, `ad_complete`, `dwell_ms` | `dwell_sum_ms` + `dwell_count`, sonra bölme | Ham kayıtlarla aynı kuralla hesaplanmış ortalama |
| Tekrar gösterim | `ad_repeat_view` | Ayrı sayaç | Aynı oturumdaki/izleme durumundaki tekrar olaylarının teknik tanımı belgelenir |
| Geçmişteki reklama geri dönüş | `ad_return` | Ayrı sayaç | **Reklama geri dönüş**, asla satın alma/dönüşüm (conversion) diye adlandırılmaz |
| Tekil reklam erişimi | `COUNT(DISTINCT visitor_id)` | Günler arasında ziyaretçileri tekilleştiren özel yapı; günlük tekiller toplanmaz | Kesinse "tekil tarayıcı/cihaz tanımlayıcısı"; yaklaşık yöntem seçilirse hata payı etiketlenir |
| Görüntüleme frekansı | Gösterim / dönem tekil erişimi | Dönemin tekil paydasıyla hesaplama | Aynı koşullarla ve açık tanımla |
| Reklam cihaz/yön/saat dağılımı | `device_type`, `orientation`, `local_hour` | Saatlik boyutlu özet | Kesin olay sayıları |
| Reklam kampanya/kategori | `ad_id` + Ad Center metadata | Stable reklam ID ile eşleştir; tarihsel metadata değişikliklerini izle | Kampanya performansı; reklamın sonradan değişen başlığı geçmişi bozmaz |
| Reklama tıklama / web dönüşümü | **Mevcut olay yok** | Yeni ve ayrı tanımlanmış olay takibi gerekir | Şimdilik gösterilmez |
| Ziyaretçi / oturum | `visitor_id`, `session_id`, `sessions` | Günlük/saatlik toplamlar + dönem çapında tekilleştirme | Ziyaretçi ≠ gerçek kişi; ID sıfırlanabilir veya birden çok cihaz olabilir |
| Yeni / geri dönen ziyaretçi | `visitors`, `first_seen`, `session_count` | Anlamı ve dönem sınırı belgelenir; ham kayıttan doğrulanır | Önce iç raporda korunur |
| Haber görüntüleme | `story_view` | Mevcut `content_daily` modeli korunur; tekrarlı olaylara karşı idempotentlik kontrolü | İçerik raporu / gelecekteki reklam bağlamı |
| Kaynak/kategori/filtre etkileşimi | `behavior_events` | Saatlik olay türü/alan sayacı | Önce iç raporda; reklamverene yalnızca toplulaştırılmış eğilim |
| Otomatik akış durdurma | `auto_advance_*` | Sayı, süre toplamı, pozitif süre sayısı; ortalama sonradan | İç raporda |
| Özel RSS kullanımı | `custom_rss_*` | Olay sayıları + "son durum" için ayrı state özeti; basit günlük toplama yeterli değildir | İç raporda |
| Feedback | `feedback_submit`, ham metaveri | Ayrı kayıt/iş akışı, sayfalama ve yetkiyle yönetim; özetleme ile silinmez | Reklamverene bireysel kayıt sunulmaz |
| Yaş / cinsiyet | GA4 | GA4'ün kendi raporu; kapsam/eşikleme belirtilir | Eksik, tahmini veya eşiklenmiş olabileceği açıklanır |

### Yanlış hesaplamayı önleyen kurallar

1. **Dönemler arası tekil sayılar toplanmaz.** Pazartesi 1.000, salı 1.000 tekil kişi -> toplam 1.000 ile 2.000 arasında olabilir.
2. **Ortalamalar yeniden ağırlıklandırılır.** Günlük izleme süresi ortalamalarının basit ortalaması alınmaz; `SUM(dwell_sum_ms)/SUM(dwell_count)` kullanılır.
3. **Kayan 24 saat için yalnızca günlük tablo yetmez.** UTC saatlik özetler kullanılmalı; son dakika hassasiyeti gerekiyorsa açık gün/saat için ek canlı delta hesaplanmalı.
4. **`all` ve `7d` aynı kullanıcıyı günler arasında tekilleştirmelidir.** Gereken yerde anonim kimlikler için kesin eşleştirme veya açıkça etiketlenmiş yaklaşık sketch (ör. HLL) gerekir.
5. **Bir olay ikinci kez gelirse sayaçlar ikinci kez artmamalıdır.** Mevcut `INSERT OR IGNORE` ile `content_daily` sayaç artışlarının ayrı çalışması tekrar olaylarda sapma yaratabilir: geçiş öncesinde idempotentlik denetimi yapılacak.
6. **"Ad return" bir satın alma dönüşümü değildir.** Ayrı "ad click" veya dönüşüm izleme tanımlanmadan CTR/conversion raporlanmaz.
7. **Şifreli/özel ham arşiv.** IP, cihaz, ziyaretçi ve oturum tanımlayıcıları için asgari veri, erişim ve saklama süresi ayrıca tanımlanmalıdır. Reklamverene ham kayıt verilmez.

## Mantıksal veri akışı

```text
Flöw istemcisi /track
    |
    v
Olay kabul katmanı (şema kontrolü, event_id ile idempotent kabul)
    |
    +--> özel, yeniden işlenebilir ham olay arşivi (tarih/saat partisyonlu; sıkıştırılmış)
    |
    +--> kontrollü ve mümkünse toplu çalışan özetleme hattı
             |
             +--> ad_hourly: ad_id, UTC saat, cihaz, yön, olay sayıları, süre toplamları
             +--> behavior_hourly: UTC saat, olay türü, kaynak/kategori ve gerekli sayaçlar
             +--> audience_hourly: oturum/haber gösterimleri ve ziyaretçi özetleri
             +--> reach structure: kampanya + dönem üzerinde tekil hesaplama desteği
             |
             v
       küçük rapor/sunum deposu veya güvenli rapor API'si
             |
             v
         Flüsh (24h, 7d, all)
```

**Özetleme çok sayıda D1 yazmasına dönüşmemeli:** 500 bin ziyaretçi/gün ile ziyaretçi başına 20 olay varsayımı, yaklaşık 10 milyon olay/gün demektir. D1'in tek bir tablosuna her olay için ek yazma ve çoklu indeks üretmek uzun vadede başka bir darboğaz yaratır. Toplu işleme ve ham arşiv deposu seçiminden önce kapasite testi gerekir.

## Neyi kesin, neyi yaklaşık ölçeriz?

**Kesin tutmaya öncelik:** Reklam gösterimi, atlama, tamamlanma, yeniden gösterim, geçmiş reklama geri dönüş, izleme sürelerinin toplamı/sayısı, cihaz-yön-saat dağılımı, kampanya metaverisi. Olay kaybı/çift yazma izleme dahil.

**Karar verilmesi gereken:** Kampanya çapında tekil erişim. Kesin deduplikasyon büyüyen kimlik kümesi gerektirir; yaklaşık hesap daha ekonomik olabilir. Reklamveren raporunda yaklaşım ve varsa hata payı belirtilir. Kullanıcı kimliği tarayıcı/cihaz temelliyse "benzersiz kişi" iddiasında bulunulmaz.

**Ham arşive ihtiyaç:** Henüz özetlemediğimiz yeni metrikler, geçmiş yeniden hesaplama, hatalı bir özetin düzeltilmesi, denetim. Arşiv tutulmadan sadece özet kullanmak bu esnekliği kaybettirir.

## Geçiş sırası (canlıya dokunmadan tasarla, sonra kademeli dağıt)

1. **Envanter ve tanımlar (bu belge):** Her mevcut gösterge için olay kaynağı, formül ve reklamveren kapsamını belirle.
2. **Ölçüm sözleşmesi ve testler:** Gösterim, tekil erişim, süre ve oranlar için aynı ham girdiden beklenen sonuçları veren otomatik testler yaz. İstemci `ad_view` olayının ne zaman gönderildiğini ayrıca doğrula.
3. **Özet deposu prototipi:** Küçük kontrollü örnek üzerinde saatlik reklam ve davranış özetlerini üret. **Önce 24h/7d/all sonuçlarının eski sorgularla eşitliğini karşılaştır**; distinct ve GA4 istisnaları açık.
4. **Canlı trafiği çift işleme (dual-run):** Eski API değişmeden yeni hattı paralel çalıştır, kayıp/çift olay sayısını izle; başarısızlıkta eski yol kullanılabilsin.
5. **Flüsh sunumunu kademeli değiştir:** Önce reklam performansı, ardından Davranış ve Kullanıcılar. Kullanıcıya gösterilen JSON alanlarını mümkün olduğunca aynı tut.
6. **Eski ağır ham sorguları devreden çıkar:** Yalnızca raporlar karşılaştırmadan geçince; Feedback CRUD ve ham arşiv yolu bağımsız kalsın.
7. **Ölçek testi:** Saatteki olay hacmi, gecikme, veritabanı satır okuma/yazma, depolama büyümesi ve 500 bin günlük ziyaretçi senaryosu altında kapasite/bütçe doğrulaması yap.

## İzleme ve kabul kriterleri

- Aynı tarih aralığında yenileme, ağır ham olay taraması yapmaz.
- `all` raporunun maliyeti ham olay sayısıyla doğrusal artmaz; küçük özetleri okur.
- Toplam gösterim / tamamlanma / atlama / süre sayıları örnek olay setinde **tam olarak eşleşir**.
- Tekil sayılarda kesin yöntem veya ilan edilmiş tahmini yöntemle anlaşılır sonuç üretilir.
- Özet üretimi aksarsa ham kayıtlar kaybolmaz; daha sonra yeniden işlenebilir.
- Feedback listeleme/silme, kullanıcı girişleri ve reklam merkezi bundan bağımsız çalışır.
- Yeni hat hazır olmadan `behavior_db` veya diğer D1 tabloları silinmez; mevcut Worker v31.22.2 geri dönüş yolu olarak korunur.

## Açık teknik kararlar

1. Ham arşiv için özel nesne deposu / analitik veritabanı seçeneklerinin gizlilik, maliyet, ücretsiz kullanım, yazma hacmi ve geri yükleme açısından karşılaştırılması.
2. Reklamverenin **kesin tekil erişim** mi, açıkça belirtilen **yaklaşık erişim** mi gerektirdiği; bunu destekleyecek anonim kimlik saklama politikası.
3. Reklam raporları için kabul edilebilir tazelik: 5, 15 veya 60 dakika.
4. Ham olaylarda saklama süresi, erişim yetkisi, yedekleme/şifreleme ve silme politikası.
5. Eski veriden ilk backfill'in D1 günlük kotasını zorlamayacak kademeli dışa aktarma planı.

**Uygulama notu:** Bu aşama yalnızca tasarımdır; yeni Worker, SQL migrasyonu, veri taşıma veya Cloudflare deploy'u yapılmamıştır.
