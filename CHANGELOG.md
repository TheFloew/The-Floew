# FLÖW | KAPSAMLI SÜRÜM NOTLARI

**Kapsam:** Flöw'ün başlangıcından günümüze; son tarihsel kayıt: 23 Kasım 2026  
**İlk doğrulanabilen GitHub kaydı:** 9 Ağustos 2026  
**Kaynaklar:** `TheFloew/The-Floew` GitHub `main` commit geçmişi, `docs/vers.txt` arşiv sürüm notları, ilgili teknik belgeler, geliştirme görüşmeleri.  
**Belgenin statüsü:** Yaşayan ve GitHub'da tutulan Flöw sürüm günlüğü. **23 Kasım 2026 itibarıyla Beta 1.25.1 takip için kabul edilen başlangıç sürümüdür.** Beta 1.9.0–1.25.1 arasındaki numaralar geçmişe dönük düzenlenmiştir; gerçekte bu etiketlerle dağıtım yapıldığını kanıtlamaz.

## Sürümleme ilkesi

- **[ORİJİNAL]**: Eski sürüm notlarında gerçekten yer alan Alpha ve Beta sürüm numaraları. Tarihsel numaralar korunmuştur.
- **[ÖNERİLEN]**: Beta 1.8.0'dan sonraki geliştirmelere, okunabilir bir ana ürün sürüm geçmişi oluşturmak amacıyla **sonradan atanmış** numaralar. Bunlar GitHub tag'i veya resmî yayımlanma kanıtı değildir.
- **[BİLEŞEN]**: Worker, istemci, yönetim paneli veya modelin kendi bağımsız teknik sürüm numarası. Ana ürün sürümüyle karıştırılmamalıdır.
- **[PROTOTİP]**: Kodlanmış/test edilmiş veya tasarlanmış; canlıya tamamen geçtiği doğrulanmayan geliştirme.
- Bir sürümün altındaki tarih, çalışmanın kayıtlarla doğrulanabilen yaklaşık zaman aralığıdır. Her alt düzeltmenin yayımlandığı gün ayrı ayrı teyit edilmiş değildir.
- Tam olarak belgelenmeyen bir **Alpha 1** sürümü icat edilmemiştir. İlk arşiv **Alpha 2** ile başlar.
- **23 Kasım 2026 sonrası:** Ürün sürümleri bu dosyada kesintisiz devam eder. Yeni sürümler `1.25.2`, `1.25.3` (düzeltmeler) veya `1.26.0` (yeni işlevler) gibi artırılır. Ayrı Worker/model sürümleri ana ürün sürümü değildir.
- Yeni maddeler mevcut kronolojik **III. GERİYE DÖNÜK ÜRÜN SÜRÜMLERİ** bölümünün sonuna, yeni sürümün tarih ve kapsamıyla eklenir. Bu bölüm gelecekteki sürümleri de içerir; eski sürümler yerinde korunur.
- Henüz yayınlanmayan veya yalnızca test edilen işler aşağıdaki **Yayımlanmamış değişiklikler** bölümünde tutulur; deploy/merge doğrulanmadan yayınlanmış sürüm olarak yazılmaz.
- Bu belgedeki sürüm kaydı tek başına Git tag, GitHub Release, mağaza sürümü veya Cloudflare deploy işlemi gerçekleştirmez.

---

## YAYIMLANMAMIŞ DEĞİŞİKLİKLER

### [PROTOTİP] PiP eşzamanlılık ve performans motoru v2 | 24 Kasım 2026
- PiP bağımsız haber/görsel seçme mekanizmasından ayrıldı; akışın güncel haber veya reklam kimliğini tek doğruluk kaynağı kabul eder.
- Haber resminde doğrudan RSS'deki ilk görsel yerine ana ekrana başarıyla yüklenmiş gerçek görselin URL'si izlenir. Eski haber görseli hiçbir durumda yeni habere yedeklenmez.
- Ağ yanıtları sürüm belirteciyle kontrol edilerek geç kalan isteklerin güncel PiP karesini değiştirmesi engellendi; reklam-haber geçişleri ve değişen sekme haberleri periyodik doğrulanır.
- Kayıt hattı elle frame göndermeyi (uygunsa captureStream(0) + requestFrame) kullanır; düşük tempolu sabit kare ve arka planda rAF'a bağlı olmayan güncelleme benimsenir. Video görüntüsü CORS kontrolünden sonra çizilir.
- PiP açılışı görsel indirmesini beklemez; kullanıcı tıklamasının ardından hazırlanmış ilk kare hemen sunulur. PiP yalnız kullanıcı açınca çalışır.
- Test ve canlı PiP tarayıcı doğrulaması yapılmadan yayımlanmamalıdır.

### Hamburger menü ve anahtar kelime silme düzeltmeleri | 24 Kasım 2026
- **Akış / Anahtar kelimeler:** Açılınca hamburger araç menüsü kapanmaz; tam ekran kapatıldığında önceki gibi açık kalır.
- **Hamburger kapanışı:** Kaydedilen Haberler ikonunun zorunlu görünürlük ve tıklama CSS kuralları kaldırıldı. Böylece diğer ikonlarla aynı 320 ms kapanış hareketini izler.
- **Anahtar kelimeler:** Listelerdeki çarpı düğmelerinin “Sil” hover etiketi kaldırıldı; erişilebilirlik açıklaması ve silme işlevi korundu.
- Yeni menü tutarlılığı testleri eklendi; canlı tarayıcı doğrulaması ayrıca yapılmalı.

### [PROTOTİP] Akış ve Anahtar Kelimeler tam ekran tasarımı | 24 Kasım 2026
- **Akış:** Sıralama (Algoritmik/Kronolojik) ve zaman aralığı seçenekleri, Tercihler ile aynı karartma ve açılış/kapanış animasyonuna sahip bağımsız tam ekran penceresine alındı.
- **Anahtar Kelimeler:** Göster, Gizle ve Uyar işlemleri, tek ve ortalanmış giriş alanı ile üç sütun altında birleştirildi: Gösterilenler, Gizlenenler, Vurgulananlar.
- Anahtar kelimeler işlem sonrası giriş alanından temizlenir; listelerde ayrı satırlarda tutulur ve her biri çarpı düğmesiyle silinebilir. Göster/Gizle filtreleri aynı anda çalışır, Uyar eşleşen haberleri vurgular.
- Eski filtre/takip ayarları yeni saklama biçimine aktarılır; tercih dışa/içe aktarma desteği korunur. Ayrı Anahtar Kelime Takibi araç ikonu kaldırıldı.
- Pencereler açıkken haber akışı durur; kapanınca kaldığı yerden sürer. Mobil yerleşim, klavye ve erişilebilirlik davranışları yenilendi.
- **Yayımlanmadı:** GitHub PR aşamasında; Merge ve canlı tarayıcı doğrulaması bekleniyor.

### [PROTOTİP] Flüsh Kaynak İstatistikleri | 24 Kasım 2026
- Analytics altında **Haber Kaynakları** yönetim ekranı, kaynak arama/sıralama ve kaynak ayrıntıları.
- Kaynak bazında görüntülenen farklı haber, gösterim, anonim tekil erişim, toplam ve kişi başına görüntüleme süresi, eşit ağırlıklı ortalama Flöra, paylaşım eylemleri, cihaz/tarayıcı dağılımları.
- Tüm kaynakların veya tek bir kaynağın bağımsız HTML rapor olarak indirilmesi.
- Kaynak bazlı yaş/cinsiyet verisi için rızalı GA4 `floew_story_view` olayı ve `news_source` özel boyutu; eksik/eşiklenmiş veri açıkça gösterilir.
- Eski cihaz/tarayıcı olaylarında eksik veriler **Bilinmiyor** olarak belirtilir; geçmişe dönük uydurma yapılmaz.
- Yetkilendirilmiş `/admin/sources` ve `/admin/source-report` uçları, mevcut özel D1 rapor önbelleğine bağlıdır.
- **Canlıya alınmadı:** Flüsh, News Web ve Analytics Worker dağıtımları ile Flüsh proxy erişimi ve GA4 boyut kurulumu doğrulanmalı.



---

## I. TARİHSEL ALPHA SÜRÜMLERİ [ORİJİNAL]

### Alpha 2 | 9 Ağustos 2026 çevresi
- Fare tıklaması, yukarı/aşağı sürükleme, fare tekerleği ve klavye oklarıyla önceki/sonraki habere gezinme.
- Haber görsellerinin tarayıcı tarafından sürüklenmesinin engellenmesi.
- Flöw logosunun sol üstte konumlandırılması.

### Alpha 3
- Tam ekran özelliği ve kaynak favicon'larının gösterimi.
- Saat/tarih eklenmesi; Comfortaa fontuna geçiş.

### Alpha 4
- Tarih/saat, tam ekran ve kaynak logosu ölçüleriyle ilgili düzeltmeler.
- Arka arkaya aynı haber kaynağına ağırlık verilmemesi için kaynakların rastgeleleştirilmesi.

### Alpha 5
- Fare hareketinde belirip hareketsizken kaybolan tam ekran butonu; `F` kısayolu.
- Kaynak ikonları için standart 25×25 px ölçü.
- Logo, başlık, saat ve kaynak gölgelerinin yeniden dengelenmesi; manşet alanının genişletilmesi.

### Alpha 6
- Önceki haberlere doğru sırada dönmeyi sağlayan gezinme geçmişi.
- Geçişte eski/boş haber görselinin görünmesini engelleyen görsel hazırlama.
- Tam ekran butonunun geçiş animasyonunun yumuşatılması.

### Alpha 7
- Gezinme yönü hatasının düzeltilmesi.

---

## II. TARİHSEL BETA SÜRÜMLERİ [ORİJİNAL]

### Beta 1.0.8 | 9 Ağustos 2026 çevresi
- Haber kaynaklarını seçme menüsü.
- Kategorilere göre haber gösterimi; kategorileri açma/kapatma.

### Beta 1.0.9
- RSS → Cloudflare News Worker → sınıflandırılmış haber → GitHub Pages/istemci veri akışı.
- Kategori ve `breaking` (son dakika) bilgisinin Worker tarafından belirlenmesi.
- Haberlerin kategori ve Son Dakika görünümünde doğru eşleşmesi; istemcide tekrar sınıflandırma yapılmaması.

### Beta 1.1.0
- Algısal kategori sınıflandırması ve yeni kategoriler.
- Picture-in-Picture (PiP) desteği.
- Kaydırma yönü tercihi; yenilenen menü.
- Habere **Kaynağa git** butonu.
- Kaynak/kategori tercihlerinin tarayıcıda hatırlanması.
- Boş akışta geri dönme kontrolleri ve çeşitli hata düzeltmeleri.

### Beta 1.2.0
- Gömülü veya bağlantılı haber videolarının haber süresince otomatik oynatılması; kapatma tercihi.
- Açılış yükleme ekranı ve yüklenme durumu.
- Hava durumu göstergesi.
- Haber gösterim süresini tercihlerden ayarlama.
- İlk ziyaret çerez bilgilendirmesi.
- Haber açıklamalarının gösterilmesi ve çok sayıda video/görünüm düzeltmesi.

### Beta 1.2.5
- İlk reklam yerleşimi ve gösterim sistemi.
- Reklamların haber akışı içine belirli aralıklarla yerleştirilmesi, yaklaşan reklamların önceden hazırlanması ve reklam sonrası haber akışına dönebilme davranışına ilişkin ilk çalışmalar.

### Beta 1.2.6
- Videolu haber düzeltmeleri.
- Ekran yönüne göre yatay/dikey reklam eşleştirmesi.

### Beta 1.3.0
- Ayrı **Son Dakika** ve **Gündem** sekmeleri.
- Gündem akışında zaman aralığı seçimi.
- Anahtar kelimeye göre haberleri gösterme veya gizleme.
- Anahtar kelimeyle haber takip sistemi ve hata düzeltmeleri.

### Beta 1.4.3
- Haber ve ziyaretçi istatistiklerini depolayan veritabanları.
- Bağımsız Flöw Analytics raporlama arayüzü.
- Kullanıcı arayüzünde Flöw istatistikleri ekranı.

### Beta 1.4.4
- Ana ekran butonlarının yeniden düzenlenip menüleştirilmesi.
- Son Dakika/Gündem arasında kaydırmalı sekme geçişi.
- İstatistik penceresinin çerçevesiz, tercihlerle uyumlu tasarımı.
- Mobilde sekmelerin görünür kalması; istenmeyen dokunma-ile-geçişin kaldırılması.

### Beta 1.5.0
- **Yabancı** haberler sekmesi.
- Haber metinlerinin kesilmesinin önlenmesi.

### Beta 1.6.0
- **flöw.tr** alan adının canlıya alınması.
- Haber başlıklarının yanında ilk **Flöra (𝒇) 0–100 puanı**.
- Flöra tasarımının geliştirilmesi ve sayfa yenileme sorununun çözülmesi.

### Beta 1.6.2
- Flöw Analytics geliştirmeleri, puanlama ve genel hata düzeltmeleri.

### Beta 1.7.0
- Kullanıcının kendi RSS kaynağını eklemesi ve kaynağa özel sekme.
- Akışı duraklatma seçeneği.
- Mobil kaydırma iyileştirmeleri; çerez bildirimi, otomatik video oynatma ve düşük çözünürlüklü görsel düzeltmeleri.

### Beta 1.7.1
- Hakkında, kullanım koşulları, gizlilik, çerezler, iletişim ve SSS sayfaları.
- Hata bildirim prosedürü ve yasal metinlerin arayüze alınması.

### Beta 1.7.2
- Sosyal medya ve diğer uygulamalara Flöw üzerinden haber paylaşımı.
- Geri bildirim/şikâyet butonu ve iş akışı.

### Beta 1.7.5
- Flöra puanına tıklayarak ayrıntılı istatistikleri görüntüleme.
- Yanlış haber videosu eşleşmeleri ve tekrarlanan haberlerin düzeltilmesi.
- Önceki habere dönüş ve gereksiz 'haberler alınamadı' uyarısı sorunlarının giderilmesi.
- Açılış ilerleme çubuğu, metin düzeni ve kaydırma iyileştirmeleri.

### Beta 1.7.6
- Yanlış veya ilgisiz video içeriklerinin haberlere sızması probleminin düzeltilmesi.

### Beta 1.8.0 | 21 Ağustos 2026 civarı
- Döviz kurları ve borsa bandı.
- Flöw içi haber açılışını destekleyen yeni kısa bağlantılı paylaşım sistemi.
- Siteden çıkmadan **Kaynağı Gör** paneli.
- Tercihleri içe/dışa aktarma.
- Fare hareketiyle otomatik akışı duraklatma; ekran koruyucuyu devre dışı bırakma.
- Benzer haberlerin azaltılması, reklam ve video iyileştirmeleri.
- Video motorunda MP4/HLS ve servis bazlı çözümleme; alakasız reklam/canlı TV oynatıcılarının haber videosu sayılmaması.
- Haber videosu ile reklam videosunun otomatik oynatma kurallarının ayrılması.

---

## III. ÜRÜN SÜRÜMLERİ [1.9.0–1.25.1 GERİYE DÖNÜK; SONRAKİLER GÜNCEL]

> **Uyarı:** Aşağıdaki Beta 1.9.0–1.25.1 numaraları bu belgede önerilmiştir. Geçmişte böyle etiketlenmiş bir release veya tag olduğunu iddia etmez. Tarih ve kapsam GitHub commit'leri ve geliştirme kayıtlarıyla eşleştirilmiştir.

### Beta 1.9.0 | 22–27 Ağustos 2026 | Haber motorunda dayanıklılık
- Farklı yayıncıların RSS, görsel ve haber bağlantısı biçimlerini daha güvenilir işleme.
- CNN Türk ve Milliyet gibi özel kaynaklarla ilgili RSS/link düzeltmeleri ve kaynak sağlığı kontrolleri.
- Video çözümlemesinde Sabah/Turkuvaz Video.js ve Habertürk HopePlayer desteği; HLS/MP4 ayrıştırma.
- Haberle ilgisiz canlı yayın veya VAST reklam oynatıcılarını reddetme; yüksek çözünürlüklü asıl görseli seçme.
- Bozuk/ölü kaynakların, eksik görsellerin ve kaynak bazlı hataların önceliklendirilmesi.
- Bağımsız News Worker için **v31.61–v31.94** aralığındaki kaynak/oynatıcı iyileştirmeleri.

### Beta 1.10.0 | 27 Ağustos – 1 Eylül 2026 | Android telefon ve tablet
- Web tabanlı akışın Android WebView uygulamasına taşınması.
- Telefon/tablette tam ekran arayüz, özel uygulama ikonu ve siyah açılış ekranı.
- Yerel paylaşım sayfası (native share sheet); haber açıldığında akışın davranışının korunması.
- Ağ bağlantısı kesildiğinde özel **Bağlantı yok** ekranı.
- Kaynak bağlantılarının sistem tarayıcısında açılması; uygulamaya geri dönüş.
- Dokunma vurgusu, çift dokunma ve video oynatma sorunlarının giderilmesi.
- APK/AAB oluşturma ve cihaz testleri; uygulama mağazasındaki yayın durumu bu kayıtlardan kesinleştirilmemiştir.

### Beta 1.11.0 | 1–3 Eylül 2026 | Android TV ve Google TV
- Kumandayla gezinme: yukarı/aşağı haber, sağ/sol sekme, OK ile haber eylemleri.
- Odaklanınca açılan hamburger menü; açılır/kapanır kontrollerde kumanda odağı.
- Kaynak ve kategori düğmeleri için klavyeyle/uzaktan kumandayla erişilebilirlik.
- Kalın beyaz çerçeve yerine yumuşak odak vurgusu; odaklanan kontrolün etiketini gösterme.
- TV'de haber paylaşmak için QR kodlu panel; yatay reklam uyumluluğu.
- TV release APK/AAB derlemeleri ve gerçek Google TV üzerinde işlev testleri.

### Beta 1.12.0 | 2–10 Eylül 2026 | News Worker ve performans
- Haber, video ve görsel çözümleme yollarının optimize edilmesi.
- Video bulunan akışlarda sıra atlama ve doğrulanmış oynatma geçmişi sorunlarının giderilmesi.
- RSS parser, önbellek, canonical video ve CPU/bellek kullanımında iyileştirmeler.
- News Worker'ın ortak web/Android/TV/iOS veri kaynağı olarak yönetilmesi.
- Kaynak/batch yoğunluğunda bellek ve kota sorunlarının incelenmesi.
- Teknik dönüm noktaları: **News Worker v31.98, v31.99, v31.100**; istemci v31.79.x.
- Analytics Worker için veritabanı sorgularını hafifletme; Flöra skorlarını yalnızca görünen haberler için alma.

### Beta 1.13.0 | 7–10 Eylül 2026 | iPhone ve iPad
- WKWebView tabanlı iOS/iPadOS uygulaması.
- iPhone'da portre kullanım; iPad'de yön ve pencere düzeni desteği.
- Safe-area/notch uyumu, logo ve hamburger hizalaması.
- Yerel paylaşım, Safari'de dış kaynak açma, ağ yok ekranı ve video yaşam döngüsü.
- Video/akış davranışında paylaşımdan dönüş, tam ekran ve yatay reklam uyumu.
- Beyaz açılış flaşı, uzun basma, dokunma ve ilk açılış performansının iyileştirilmesi.
- Simülatör ve iPhone cihaz testleri; Apple TV geliştirmesi bu dönemde tamamlanmış ürün sayılmıyor.

### Beta 1.14.0 | 17–21 Eylül 2026 | BaitBuster β
- Haber başlıklarındaki clickbait kalıplarını tespit eden **BaitBuster** sistemi.
- İlk aşamada ana sayfadan izole `/baitbusterbeta/` deneme ortamı.
- Haber içeriğiyle doğrulama yaparak bilgi sağlayan, daha açık başlık oluşturma.
- Yapay zekâ başlığı ile orijinal başlık arasında **β** düğmesiyle geçiş.
- Kullanıcı tercihlerinden BaitBuster'ı açma/kapatma.
- Yeniden yazılmamış başlıklarda β simgesini göstermeme.
- Mobil ipucu metinleri ve Flöra ile uyumlu buton ölçüleri.
- Başlangıçta dış AI denemelerinin ardından **Cloudflare Workers AI** altyapısına geçiş.
- Teknik sürümler: **BaitBuster Worker v1.5.1–v1.6.0**.

### Beta 1.14.1 | 21–25 Eylül 2026 | BaitBuster maliyet ve kararlılık
- BaitBuster'ın ana sayfada kullanılması.
- Sekme görünmezken yeni AI işi başlatmama; sırayı temizleme ve istekleri iptal etme.
- Sorgu alanını görünen haber + sonraki iki haberle sınırlama.
- Görünür haberin AI analizini arka plan ön hazırlığından öncelikli yapma.
- Daha ucuz 8B modelle ön sınıflandırma, belirsiz başlıkları 70B'ye yönlendirme denemeleri.
- Yetersiz bilgi kazancı sağlayan yeniden ifadeleri reddetme ve karar eşiklerini iyileştirme.
- Workers AI kotası dolduğunda zincirleme tekrar denemeleri engelleme; tanılama başlıkları.
- Üretilen sonuçların önbellek kullanımı, eski olumsuz kararların temizlenmesi ve istemci/sunucu sürümlerinin uyumu.
- Teknik sürümler: **Worker v1.6.2–v1.6.4** ve BaitBuster istemci v11–v13 dönemi.

### Beta 1.15.0 | 25–26 Eylül 2026 | Kesintisiz haber geçişi
- Sonraki haberin başlığı, görseli, video/medya durumu, Flöra ve BaitBuster verilerinin mümkün olduğunca gösterim öncesi hazırlanması.
- Kullanıcı mevcut haberi okurken arka plandaki yenilemenin görünen içeriği değiştirmemesi.
- Geç gelen görsel, medya ve puan güncellemelerinin mevcut slayta sıçramaması.
- Çift haber hazırlama işlerinin birleştirilmesi; hazır olmayan dokunmatik geçişlerin güvenle tekrarlanması.
- Birbirinin aynısı veya ayna kaynaklardan gelen haberlerin akışta aralıklı sunulması.
- Video sesini kontrol eden başlık butonu ve varsayılan ses tercihi.
- BaitBuster'ın geçiş sistemiyle daha güvenli birlikte çalışması.

### Beta 1.15.1 | 28 Eylül 2026 | Sputnik ve görsel çözümleme
- Sputnik Türkiye haberlerinde sosyal paylaşım kartı yerine haberin gerçek görselini alma.
- Kaçış karakterli görsel URL'lerinin doğru çözülmesi.
- Görsel çözümleme işinin BaitBuster/ön yüzden **News Worker'a** taşınması.
- Eskimiş istemci köprülerinin ve tanılama sayfalarının temizlenmesi.
- **News Worker v31.102** dosyasının hazırlanması ve repoya alınması.

### Beta 1.16.0 | 29 Eylül 2026 | Erişilebilir görünüm
- **Görünüm → Boyut** kontrolü.
- Haber alanı için bağımsız ölçek ayarı.
- Döviz, saat ve hava durumu bilgi alanı için ikinci ölçek ayarı.
- Logo ve borsa bandını bozmadan mobil, masaüstü ve TV'de daha okunabilir arayüz.

### Beta 1.16.1 | 2–3 Ekim 2026 | Navigasyon ve BaitBuster toparlama
- BaitBuster beklerken haber geçişinin kilitlenmemesi; ana gezinmenin AI hazırlığından bağımsız çalışması.
- Hızlı geçişlerde eksik görsellerin doğru yedek görselle tamamlanması.
- BaitBuster'ın soğuk önbellek zaman aşımı ve az sonuç üretme sorunlarının incelenmesi.
- Daha erken ön hazırlama, gruplu istek, geçici AI hatalarında tekrar deneme.
- Yanlış negatif önbelleğinin temizlenmesi ve karar eşiklerinin yeniden dengelenmesi.
- **BaitBuster Worker v1.6.6–v1.6.7**, istemci **v18–v19**.

### Beta 1.17.0 | 3–6 Ekim 2026 | Büyük ikon ve tasarım revizyonu
- Emoji/PNG ve birbiriyle uyuşmayan simgelerin tek bir **Flöw ikon fontu** altında toplanması.
- Buton boyutlarının ve aralıklarının yeniden dengelenmesi; ortak hover/aktif dili.
- Flöra, paylaş, kaynağa git, geri bildirim, ses ve üst bilgi kontrollerinin görsel olarak birleştirilmesi.
- Döviz ülke bayrakları ve altın simgesi hizalamaları; kaynak/başlık eylem grubunun yeniden düzenlenmesi.
- Menü içindeki kutu/çember arka planlı ikon yaklaşımının kaldırılması.
- Açık/Kapalı kontrollerinin sadeleştirilmesi.
- Kaynak görüntüleme penceresi, kapat butonu ve geri bildirim simgelerinin aynı stile uyarlanması.
- Çeşitli cihazlarda optik hizalama ve CSS önbellek düzeltmeleri.

### Beta 1.18.0 | 16–18 Kasım 2026 | Reklam Merkezi (Flowery)
- Reklamları dosya/manifest düzenleme yerine yönetim arayüzünden ekleme ve yönetme.
- Görsel veya video reklam için başlık, kategori, başlangıç/bitiş tarihi, aktif/pasif durumu.
- Yatay ve dikey reklam medyasını ayrı yükleme; yalnız uygun ekran yönünde gösterme.
- Süresi dolan veya pasife alınan reklamı akıştan/RSS'den çıkarma.
- Reklamların kronolojik yönetimi; yönetim listesindeki sütunları sıralama.
- Reklamları RSS ve `/api/flowery` üzerinden sunma; reklam engelleyicilerle uyumluluğu iyileştirme.
- **flowery.flöw.tr** alt alan adından erişim ve yönetici oturumu.
- On reklam kategori kodu: **G** Gıda, **Y** Finans, **O** Otomotiv, **T** Tekstil, **M** Alışveriş, **S** Sanayi, **F** Akaryakıt, **E** İlaç/Medikal, **H** Sağlık kuruluşları, **J** Teknoloji.
- Reklam kategori kodları ve kampanya metaverisinin Analytics ile paylaşılması.
- Analytics'te reklam başlığı, kategori, yayın başlangıç/bitişi, süre ve durum alanları.
- Bu sistem önceki doğrudan dosya esaslı reklam iş akışının yerini almak üzere geliştirildi.

### Beta 1.19.0 | 18–19 Kasım 2026 | Flüsh yönetim portalı
- Bağımsız, yetki kontrollü **Flüsh** yönetim portalı.
- Superadmin ve üyeler için giriş/rol yönetimi; yedek erişim ve hesap kurtarma akışı.
- Analytics, Geri Bildirim ve Reklam Merkezi'nin tek panelden açılması.
- İlk iframe bağlantıları yerine **yerel/native portal ekranlarının** hazırlanması.
- SSO bağlantılarıyla Analytics ve Geri Bildirim; bağımsız yönetim girişlerinin korunması.
- Reklam kampanya tablo/editörünün portal arayüzüne uyarlanması.
- Hesap ayarları ve üye giriş bilgilerinin değiştirilmesi.
- Reklam analitiği listesinde tıklanabilir sütun başlıklarıyla sıralama.

### Beta 1.20.0 | 19 Kasım 2026 | Paylaşılan haber deneyimi
- Kullanıcının o anda seçtiği **orijinal veya BaitBuster manşetinin** paylaşılması.
- Paylaşım sayfasında BaitBuster'ın iki manşeti arasında geçiş için veri aktarımının iyileştirilmesi.
- Paylaşılmış haber sayfalarının buton ve ikon tasarımının ana akışla uyumlu hale getirilmesi.
- Ana akışta Paylaş butonuna işlem tamamlandığını gösteren işaret/geri bildirim eklenmesi.
- Tarayıcı sekmesi değiştiğinde istenmeden açılan PiP'in engellenmesi; PiP'in kullanıcı kontrolüne bırakılması.
- Paylaşım Worker'ının önceden hazırlanmış haber başlığı varyantlarını yeniden AI çağrısı yapmadan kullanması.
- İlgili teknik paylaşım Worker dosyasında **v2.9.3** numarası kayıtlıdır; tüm frontend değişiklikleri aynı bileşen numarası altında sayılmaz.

### Beta 1.21.0 | 19–20 Kasım 2026 | Kaydet ve Sonra Oku
- Haberi yerel cihazda saklayan **Kaydet** eylemi; dolu/boş yer imi ikonu.
- Kaydedilen Haberler penceresi ve hamburger menüsünde erişim.
- Kaydedilmiş haberi Flöw içindeki kaynak görüntüleme penceresinde açma.
- Kullanıcı tercihlerini dışa aktarma/içe aktarma kapsamına kaydedilen haberleri ekleme.
- Eski yedek dosyalarının içe aktarımında mevcut kaydedilen haberleri koruma.
- Yer imi sayacı, ikon fontu, menü düzeni ve başlık butonu için çok sayıda optik hizalama düzeltmesi.
- Kayıtlar **cihaz/tarayıcı yerel depolamasındadır**; bulut hesabına senkronizasyon olarak sunulmamalı.

### Beta 1.22.0 | 19–20 Kasım 2026 | Görsel haber paylaşımı
- Paylaş düğmesinde **bağlantı / görsel** tercihi.
- Mobil hikâye oranında **1080×1920 / 9:16** haber kartı üretimi.
- Kartta haber görseli, seçili başlık, kaynak, logo ve haber bağlantısını açan QR kod.
- Kartı tarayıcıda oluşturma, ön izleme, PNG olarak kaydetme ve desteklenen yerel paylaşım sistemine verme.
- Tam haber fotoğrafını kırpmadan gösterme, bulanık/karartılmış arka planla boşlukları doldurma.
- Instagram benzeri hikâye uygulamalarının güvenli alanı için iç çerçeve.
- Beta yazısı olmayan logo, kategori/CTA fazlalıklarının temizlenmesi, sağa hizalı haber metni ve kaynak favicon'u.
- Küçültülmüş, renk uyumlu, yarı saydam QR ve kart içi kontrast düzeltmeleri.

### Beta 1.22.1 | 19–20 Kasım 2026 | Mikro arayüz iyileştirmeleri
- Ana akış kontrollerinde gecikmesiz ve daha yumuşak tooltip etiketleri.
- Karma dokunmatik/fare cihazları için hover algılaması.
- Eylem butonlarının tooltip kutularında ortak sağ kenar, ok ve metin hizalaması.
- Kaynak/kategori, başlık eylemleri ve menü için tutarlı etiket görünümü.

### Beta 1.23.0 | 20 Kasım 2026 | BaitBuster soru başlıkları
- Soru işareti taşıyan haber başlıklarını BaitBuster değerlendirmesine daha güvenilir gönderme.
- Soru biçimli clickbait adaylarının kaçmasını önleyecek kontrol ve testler.
- Mevcut tek AI analizine ek gerekçe ürettirecek **BaitBuster 2.0 açıklama özelliği** maliyet gerekçesiyle uygulanmadı; sürümün parçası değildir.

### Beta 1.24.0 | 22 Kasım 2026 | Canlanan arayüz
- Flöra puanının göründüğü ve sonradan yüklendiği anda küçük geçiş animasyonu.
- BaitBuster manşeti değiştiğinde görsel geri bildirim.
- Sekmeler arasında kayan aktif sekme göstergesi.
- Ana uygulamadan yalıtılmış mikro hareket katmanı; gecikmeli puan/başlık durumlarında animasyon düzeltmeleri.

### Beta 1.25.0 | 22–23 Kasım 2026 | Tahmini Flöra puanları
- Henüz yeterli kullanıcı etkileşimi olmayan haberler için **başlıktan yaklaşık Flöra puanı** tahmini.
- Son 30 günlük toplulaştırılmış etkileşimlerden kelime/başlık sinyali çıkarılması; yeni haber başına ayrı AI çağrısı olmaması.
- Yaklaşık skorun `≈` işaretiyle gerçek Flöra skorundan ayrılması.
- Gerçek veri geldikçe önceliğin gerçek skora verilmesi; mevcut görünür haberi zıplatmayan güncelleme.
- Sözlük üretiminde `sampleStories: 0` sorununun, indeksli ham olaylardan güvenli geri dönüşle düzeltilmesi.
- Dar 35–38 bandında kalan tahminlerin daha geniş, veriye göre kalibre edilmiş aralığa yayılması.
- Türkçe kelime eşleşmesi, başlık biçimi ve daha zengin sözlük özelliklerinin eklenmesi.
- Kısa süreli Flöra API önbelleği ve 24 saatlik sözlük önbelleğiyle istek yükünün sınırlandırılması.
- Teknik: **Flöra predictor v2**, sözlük/model şeması **v3**; bu değerler ana Flöw sürümü değildir.

### Beta 1.25.1 | 23 Kasım 2026 | Son optik hizalama düzeltmeleri
- Flöra ikonu ve puanının başlık eylem düğmeleriyle görsel boyut eşitliği.
- Kaydet, paylaş, geri bildirim, Flöra ve diğer başlık eylemlerinin aynı üst çizgiye getirilmesi.
- Flöra puan metninin dikey merkezinin ayarlanması; yer imi simgesinde 2 px son düzeltme.
- Borsa/döviz bandındaki yukarı-aşağı üçgenlerin metin değerleriyle **dikey ortalanması**.
- Güncel GitHub `main` geçmişinde bu değişiklikleri içeren PR ve commit'ler kayıtlıdır; mağaza/Worker dağıtımı bu nottan otomatik olarak çıkarılamaz.

---

## IV. AYRI BİLEŞENLERİN TEKNİK SÜRÜMLERİ [BİLEŞEN]

Bu tablo, uygulamanın Beta sürümünü **değil**, ayrı servis veya dosyaların geçmişte görülen gerçek teknik sürümlerini listeler.

| Bileşen | Kayıtlarda görülen sürüm örnekleri | Değişiklik ailesi |
|---|---|---|
| News Worker | v31.16.1, v31.49, v31.50, v31.61, v31.62, v31.94, v31.98, v31.99, v31.100, v31.102 | RSS, görsel, video, cache, CPU/bellek ve özel kaynak çözümleme |
| Ön yüz / app.js | v31.74.4, v31.79.4, v31.79.7 ve çeşitli asset sürümleri | Ana akış, gösterim, görüntüleme, video, performans |
| Analytics Worker | v31.20.0, v31.22.1, v31.22.2 | D1/GA4, Flöra, telemetri, reklam raporları |
| Share Worker | v2.4.0, v2.9.3 | Kısa bağlantılar, paylaşım sayfası, görsel kart ve BaitBuster varyantları |
| BaitBuster Worker | v1.5.1, v1.6.0, v1.6.2, v1.6.4, v1.6.5, v1.6.6, v1.6.7 | AI modelleri, kota, önbellek, doğrulama, sınıflandırma |
| BaitBuster istemcisi | v11, v13, v16, v18, v19 | Görünürlük, ön hazırlık, istemci kuyruğu, gezinme |
| Flöra Predictor | v2; kelime modeli/sözlük v3 | Yaklaşık puan ve genişletilmiş başlık sinyalleri |

*Not:* Bazı teknik sürümler kaynak dosyalarının başlıklarında veya commit/test kayıtlarında geçmektedir; bunların tümünün ayrı ayrı canlı deploy edildiği doğrulanmamıştır.

---

## V. ÜZERİNDE ÇALIŞILAN, ANCAK TAMAMEN CANLIYA GEÇTİĞİ DOĞRULANMAYANLAR

### Analytics v2.0.0-prototype | 20 Kasım 2026 [PROTOTİP]
- Günlük yüz binlerce ziyaretçi ve milyonlarca olay ölçeği için reklam analitiği veri mimarisi tasarımı.
- Ham olayları sürekli taramak yerine saatlik toplu reklam/etkileşim sayaçları.
- Reklam gösterim, atlama, tamamlama, dönüş/tekrar gösterim ve izleme süresi metrikleri.
- Günler arasında tekil erişim hesabı için kesin veya etiketlenmiş yaklaşık (HLL) yöntemler.
- Kimlikleri koruyan anahtarlı özetler; yeniden denemede çift saymama (idempotency) ve batch manifestleri.
- Tam kayan 24 saat, 7 gün ve tüm zamanlar aralığındaki raporların sınır kontrolleri.
- SQLite/D1 sorgularıyla karşılaştırmalı çevrimdışı testler; saatlik özet ve retry-safe prototipler.
- Daha yüksek ölçekli Cloudflare paid/Basin/R2 seçenekleri için maliyet modellemesi ve karar kayıtları.
- **Üretimde Analytics Worker v31.22.2'nin tamamen yerini aldığı doğrulanmamıştır.** Doküman açıkça tasarım/prototip olduğunu söyler.

### Durdurulan veya ayrı tutulan fikirler
- **BaitBuster 2.0 açıklama metni:** Ek AI maliyeti nedeniyle uygulanmadı.
- **Hikâye görselinin kendisine otomatik tıklanabilir bağlantı:** Platform sınırlamaları nedeniyle ürün özelliği olarak uygulanmadı. Karttaki QR ve kullanıcı tarafından eklenen hikâye bağlantısı ayrı konulardır.
- **Apple TV/tvOS:** İncelendi/planlandı, tamamlanmış sürüm sayılmıyor.
- **Samsung/LG TV:** Yol haritasından çıkarıldı; **Fire TV** düşük önceliğe alındı.
- **Analytics v2'nin büyük veri taşıması:** Canlıya geçişi doğrulanmayan tasarım aşaması; yapılan testler üretim geçişi olarak yazılmamalı.

---

## VI. BİLEŞEN VE ÜRÜN ENVANTERİ

**Haber/akış:** RSS kaynak yönetimi, otomatik sınıflandırma, Son Dakika/Gündem/Yabancı, algoritmik/kronolojik sıralama ve zaman aralığı, özel RSS, anahtar kelime filtreleri, haber geçmişi, tekrar/benzer haber azaltma, video/görsel çözümleme, akış süresi, duraklatma ve gezinme ayarları.

**Kullanıcı deneyimi:** Tam ekran, PiP, mobil/TV kumanda gezinmesi, hava durumu, tarih/saat, döviz/altın/borsa bandı, görünüm boyut ayarları, tercih dışa/içe aktarımı, haber kaydetme, hızlı ipuçları ve ikon fontu.

**AI ve ölçüm:** BaitBuster, Flöra, tahmini Flöra, D1/GA4 Analytics, haber/ziyaretçi/davranış ve reklam istatistikleri, geri bildirim yönetimi.

**Paylaşım:** Kısa Flöw bağlantısı, paylaşılmış haber sayfası, QR, kaynak penceresi, BaitBuster başlığı aktarımı, sosyal kart, yerel paylaşım ve 9:16 görsel paylaşım.

**Reklam ve yönetim:** Yön bazlı görsel/video reklamları, reklam aralığı ve ön hazırlama, reklam süresi/aktiflik kontrolleri, Flowery Reklam Merkezi, RSS ve reklam metadata, Analytics reklam raporları, Flüsh SSO/rol yönetimi.

**Desteklenen istemciler:** Web/PWA, Android telefon/tablet, Android TV/Google TV, iPhone/iPad. Mağaza yayın koşulları bu belgeden bağımsız olarak teyit edilmelidir.

**Altyapı:** GitHub Pages, GitHub kod ve sürüm geçmişi, Cloudflare Workers (News/Analytics/Share/BaitBuster/Ad Center), D1, KV/edge cache, GA4, Cloudflare DNS, e-posta yönlendirme ve servisler arası yapılandırma.

---

## KAYNAKLAR VE DOĞRULAMA BAĞLANTILARI

- **Orijinal Alpha/Beta arşivi:** https://github.com/TheFloew/The-Floew/blob/main/docs/vers.txt
- **GitHub commit geçmişi:** https://github.com/TheFloew/The-Floew/commits/main/
- **News Worker v31.102:** https://github.com/TheFloew/The-Floew/blob/main/News-Worker-v31.102.js
- **BaitBuster Worker ve testler:** https://github.com/TheFloew/The-Floew/tree/main/baitbuster-worker
- **Flöra tahmin mimarisi:** https://github.com/TheFloew/The-Floew/blob/main/docs/flora-predictive-scores.md
- **Analytics v2 tasarımı:** https://github.com/TheFloew/The-Floew/blob/main/docs/analytics-v2-data-architecture.md
- **Flüsh kodları:** https://github.com/TheFloew/The-Floew/tree/main/flush

**Sürümleme uygulaması (23 Kasım 2026):** Bu belge `CHANGELOG.md` olarak GitHub ana dalında tutulmaktadır. **Beta 1.25.1** mevcut kayıt başlangıcı olarak kabul edilmiştir. Gelecekteki kullanıcıya dönük sürüm güncellemeleri aynı dosyaya eklenir; backend bileşenleri ayrı numaralanır ve yalnızca prototip olan işler yayımlanmış gibi gösterilmez. Git tag/release ve dağıtım işlemleri ayrıca yapılır.