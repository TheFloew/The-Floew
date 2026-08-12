Versiyon 1.4.3
İstatistikler ve kullanıcı hareketlerini depolayan veritabanı geldi.
Kullanıcı arayüzünden bağımsız olarak raporlama için Flöw Analytics arayüzü eklendi.
Kullanıcı arayüzüne istatistikler ekranı eklendi.

Versiyon 1.3.0
- Son dakika ve Gündem sekmeleri
- Gündem akışında zaman aralığı seçme fonksiyonu
- Anahtar kelime filtreleyerek haber gösterme ya da gizleme
- Anahtar kelime bazlı haber takip mekanizması
- Hata düzeltmeleri

Versiyon 1.2.6
- Video içerikli haberlerle ilgili düzeltmeler.
- Responsive tasarıma uygun yatay ve dikey reklam eşleşmesi.

Versiyon 1.2.5
- Reklamlara merhaba diyin!
- Reklamlarla ilgili minör düzeltmeler.

Versiyon 1.2.0
- Videolu haber özelliği kullanıma sunuldu. Eğer bir haberin sayfasında gömülü video ya da video bağlantısı varsa Flöw bunu o haberin süresi boyunca otomatik oynatıyor. Bu özellik Tercihler menüsünden kapatılabilir.
- Uzun açılışlar için loading ekranı tasarlandı.
- Hava durumu eklendi.
- Artık Tercihler'den haberlerin süresi ayarlanabiliyor.
- Siteye ilk girişte çerez politikası uyarısı eklendi.
- Haberlerin açıklamaları eklendi.
- Bug düzeltmeleri.

Versiyon 1.1.0
- Kategoriler algısal hale geldi.
- Yeni kategoriler eklendi.
- Picture-in-Picture desteği.
- Kaydırma yönü ayarı.
- Menü arayüzünde değişiklikler.
- Haberlere "Kaynağa git" butonu ekledi.
- Kaynak ve kategori tercihleri artık tarayıcı bazlı hatırlanıyor.
- Gösterecek haber bulunamadığında geri dönebilmek için sayfadaki butonlar görünür hale getirildi.
- Bug düzeltmeleri.

Versiyon 1.0.9
- Artık akış: RSS kaynakları > Cloudflare Worker > category: "#Spor" breaking: true > GitHub Pages > doğrudan bu bilgiyi kullanıyor. Frontend artık haberi tekrar tahmin etmiyor.
- #SonDakika ayrı çalışıyor. Örneğin Worker: #Türkiye kategorisiyle beraber son dakika bilgisi de gönderirse haber hem #Türkiye filtresinde hem de #SonDakika filtresinde görünür. Manşette kategori olarak #SonDakika gösterilir.

Versiyon 1.0.8
-Haber kaynağı seçebilme menüsü.
-Haberler kategorilere göre gösteriliyor ve kategoriler açılıp kapatılabiliyor.

Beta 7:
Gezinme yönü sorunu düzeltildi.

Beta 6:
- Gezinmeyi artık bir haber geçmişi üzerinden yapıyoruz. Yani geri kaydırdığında sistem tekrar "farklı bir kaynak bulayım" diye yeni bir haber seçmeyecek; daha önce gördüğün gerçek habere dönecek. Ayrıca geri gelip tekrar ileri gidince de aynı gezinme geçmişini koruyor.
- Yeni haberin görseli artık geçiş sırasında karışmıyor. Önceden yeni görsel henüz hazır değilse eski/boş görsel animasyonun altında görünebiliyordu. Şimdi görsel hazır olmadan haber kaymaya başlamıyor.
- Tam ekran butonunun kaybolması yumuşatıldı

Beta 5:
- Tam ekran butonu artık sadece ⤢ karakteri. Fare hareket ettiğinde görünür. Fare 2 saniye hareketsiz kalırsa kaybolur. Tam ekranda da normal ekranda da aynı şekilde çalışır. F tuşu da çalışmaya devam ediyor.
- Kaynak ikonları önceki 50 px'den 25 px'e indirildi. Kaynak adının tam başında kalıyor. Tüm ikonlar standart 25×25 alanında.
- The Flöw logosunun gölgesi belirgin şekilde yumuşatıldı. Saat/tarih gölgesi azaltıldı. Kaynak ikonlarının gölgesi azaltıldı. Manşet metninin gölgesi de daha kısa yarıçaplı ve daha transparan hale getirildi.
- Manşet artık ekranın yaklaşık %75'ine kadar yayılabiliyor.
- Logo bir miktar büyütüldü. Yeni genişlik yaklaşık %5, maksimum 105 px.

Beta 4:
- Tarih ve saat sorunu giderildi.
- Haber kaynağı logolarının boyutları eşlendi.
- Tam ekran modu sorunu giderildi.
- Haber kaynakları rastgeleleştirildi. Artık arka arkaya geçilen haberler aynı kaynaktan gözükmüyor.

Beta 3 Sürüm notları:
- Tam ekran özelliği eklendi.
- Haber kaynakları artık kendi logolarıyla gösteriliyor.
- Sayfanın sol altına saat ve tarih eklendi.
- Comfortaa fontuna geçildi.

Beta 2 Sürüm notları:
- Sayfanın herhangi bir yerine sol tıklama = sonraki haber
- Yukarı sürükleme = sonraki haber
- Aşağı sürükleme = önceki haber
- Mouse tekerleği aşağı/yukarı = sonraki/önceki
- ↑ / ↓ = önceki/sonraki
- Haber görselleri artık tarayıcı tarafından sürüklenemez.
- The Flöw logosu sol üstte, ekran genişliğinin %4'ünü aşmayacak şekilde.
