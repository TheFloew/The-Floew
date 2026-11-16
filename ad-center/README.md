# Flöw Reklam Yönetim Merkezi

Flöw ana sayfasından ve mevcut reklam manifestlerinden bağımsız bir reklam yönetim sistemi.

## Bileşenler

- Cloudflare Worker: yönetim API'si, oturum, medya sunumu ve RSS
- Cloudflare D1: reklam kayıtları ve yayın tarihleri
- Cloudflare R2: görsel/video dosyaları
- Worker Assets: herkese açık blog görünümü ve yönetim arayüzü
- RSS: \`/feed.xml\`

Bu klasördeki sistem mevcut \`ads/\`, \`data/ads-hor.json\`, \`data/ads-ver.json\`, \`app.js\` veya ana News Worker dosyasını değiştirmez.

## 1. Cloudflare kaynaklarını oluştur

Bu klasöre gir:

\`\`\`bash
cd ad-center
npx wrangler d1 create floew-ad-center
npx wrangler r2 bucket create floew-ad-media
\`\`\`

D1 komutunun döndürdüğü \`database_id\` değerini \`wrangler.toml\` içindeki \`REPLACE_WITH_D1_DATABASE_ID\` alanına yaz.

## 2. Veritabanını hazırla

\`\`\`bash
npx wrangler d1 migrations apply floew-ad-center --remote
\`\`\`

## 3. Yönetici parolasını tanımla

\`\`\`bash
npx wrangler secret put ADMIN_PASSWORD
npx wrangler secret put SESSION_SECRET
\`\`\`

- \`ADMIN_PASSWORD\`: yönetim ekranına girişte kullanılacak güçlü parola.
- \`SESSION_SECRET\`: imzalı oturum çerezleri için rastgele ve uzun gizli anahtar. Örnek üretim komutu: \`openssl rand -base64 48\`.

Bu değerler repoya veya tarayıcı koduna yazılmaz.

## 4. Geliştirme ve yayın

\`\`\`bash
npx wrangler dev
\`\`\`

Yerel testlerden sonra:

\`\`\`bash
npx wrangler deploy
\`\`\`

İlk testte Worker'ın \`workers.dev\` adresi kullanılabilir. Sistem doğrulandıktan sonra Cloudflare üzerinden ayrı bir alan adı/alt alan adı (ör. \`reklam.flöw.tr\`) bağlanabilir. Ana Flöw sayfasına route eklenmesi gerekmez.

## 5. Kategoriler

Başlangıç kategorisi \`src/config.js\` içinde \`CATEGORIES\` dizisinde geçici olarak \`Genel\` tanımlıdır. Kullanılacak kesin kategori listesi geldiğinde bu dizi güncellenmelidir.

## Yayın davranışı

- Yeni reklam varsayılan olarak Aktif oluşturulur.
- Başlangıç tarihi gelmeden RSS'e girmez; yönetim ekranında planlanmış olarak görünür.
- Başlangıç ve bitiş tarihleri dahil olmak üzere tarih aralığında Aktif reklam RSS'te yayınlanır.
- Bitiş tarihi geçince ilk API/RSS isteğinde kayıt otomatik pasife alınır ve checkbox kapalı görünür.
- Yönetici checkbox'ı istediği zaman kapatarak reklamı anında yayından kaldırabilir.
- RSS yalnızca aktif ve tarih aralığında olan reklamları döndürür.
- Tarihler Europe/Istanbul saat dilimine göre değerlendirilir.
- Görsel/video dosyaları R2'de tutulur; tek dosya sınırı 100 MB'tır.

## RSS adresi

\`https://<worker-adresi>/feed.xml\`

RSS her istekte güncel D1 kayıtlarından oluşturulur ve reklam değişiklikleri için cache kullanılmaz.
