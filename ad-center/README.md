# Flöw Reklam Yönetim Merkezi

Flöw ana sayfasından ve mevcut reklam manifestlerinden bağımsız bir reklam yönetim sistemi.

## Bileşenler

- Cloudflare Worker: yönetim API'si, oturum, medya sunumu ve RSS
- Cloudflare D1: reklam kayıtları ve yayın tarihleri
- Cloudflare R2: görsel/video dosyaları
- Worker Assets: herkese açık blog görünümü ve yönetim arayüzü
- RSS: /feed.xml

Bu klasördeki sistem mevcut ads/ klasörünü, data/ads-hor.json, data/ads-ver.json, app.js veya ana News Worker dosyasını değiştirmez.

## 1. Cloudflare kaynaklarını oluştur

Bu klasöre gir:

~~~bash
cd ad-center
npx wrangler login
npx wrangler d1 create floew-ad-center
npx wrangler r2 bucket create floew-ad-media
~~~

D1 komutunun döndürdüğü database_id değerini wrangler.toml içindeki REPLACE_WITH_D1_DATABASE_ID alanına yaz.

## 2. Veritabanını hazırla

Üretim veritabanı:

~~~bash
npx wrangler d1 migrations apply floew-ad-center --remote
~~~

## 3. Yerel geliştirme

Yerel gizli değişken dosyasını oluştur:

~~~bash
cp .dev.vars.example .dev.vars
~~~

.dev.vars içindeki ADMIN_PASSWORD ve SESSION_SECRET değerlerini değiştir. Bu dosya .gitignore içindedir ve repoya gönderilmemelidir.

~~~bash
npx wrangler d1 migrations apply floew-ad-center --local
npx wrangler dev
~~~

Yerel sağlık kontrolü: http://localhost:8787/api/health

## 4. Yönetici parolasını üretime tanımla

~~~bash
npx wrangler secret put ADMIN_PASSWORD
npx wrangler secret put SESSION_SECRET
~~~

- ADMIN_PASSWORD: yönetim ekranına girişte kullanılacak güçlü parola.
- SESSION_SECRET: imzalı oturum çerezleri için rastgele ve uzun gizli anahtar. Örnek üretim komutu: openssl rand -base64 48.

Bu değerler repoya veya tarayıcı koduna yazılmaz. Yönetici girişi beş başarısız denemeden sonra IP'nin kendisi saklanmadan 15 dakika sınırlandırılır.

## 5. Yayın

~~~bash
npx wrangler deploy
~~~

İlk testte Worker'ın workers.dev adresi kullanılabilir. Sistem doğrulandıktan sonra Cloudflare üzerinden ayrı bir alt alan adı (ör. reklam.flöw.tr) bağlanabilir. Ana Flöw sayfasına route eklenmesi gerekmez.

## 6. Kategoriler

Başlangıç kategorisi src/config.js içinde CATEGORIES dizisinde geçici olarak Genel tanımlıdır. Kullanılacak kesin kategori listesi geldiğinde bu dizi güncellenmelidir.

## Yayın davranışı

- Yeni reklam varsayılan olarak Aktif oluşturulur.
- Başlangıç tarihi gelmeden RSS'e girmez; yönetim ekranında Planlandı olarak görünür. Aktif checkbox'ı açık kalır, böylece reklam başlangıç gününde otomatik yayına girebilir.
- Başlangıç ve bitiş tarihleri dahil olmak üzere tarih aralığında Aktif reklam RSS'te yayınlanır.
- Bitiş tarihi geçince ilk API/RSS isteğinde kayıt otomatik pasife alınır ve checkbox kapalı görünür.
- Yönetici checkbox'ı istediği zaman kapatarak reklamı anında yayından kaldırabilir.
- RSS yalnızca aktif ve tarih aralığında olan reklamları döndürür.
- Tarihler Europe/Istanbul saat dilimine göre değerlendirilir.
- Görsel/video dosyaları R2'de tutulur; tek dosya sınırı 100 MB'tır. JPG, PNG, WebP, GIF, AVIF, MP4, WebM ve MOV desteklenir.

## RSS adresi

https://<worker-adresi>/feed.xml

RSS her istekte güncel D1 kayıtlarından oluşturulur ve reklam değişiklikleri için cache kullanılmaz.

## İlk kabul testi

1. Yönetici parolasıyla giriş yap.
2. Bir görsel reklam ekle ve akış kartını kontrol et.
3. Aynı işlemi bir video ile yap; videonun oynatıldığını doğrula.
4. Aktif kutusunu kapat; reklamın yönetici akışında pasif kaldığını ve RSS'ten çıktığını doğrula.
5. Gelecek tarihli reklam ekle; Planlandı görünmesini ve başlangıç tarihinden önce RSS'te bulunmamasını doğrula.
6. Bitiş tarihi geçmiş reklamı aç; checkbox'ın otomatik kapandığını ve RSS'te bulunmadığını doğrula.
7. RSS XML'ini doğrula; enclosure ve media:content alanlarının medya URL'si, türü ve boyutunu içerdiğini kontrol et.
