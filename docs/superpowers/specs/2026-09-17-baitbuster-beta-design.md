# BaitBuster β Tasarımı

Tarih: 2026-09-17
Durum: Tasarım onayı alındı, uygulama öncesi inceleme

## Amaç

BaitBuster β, Flöw akışındaki clickbait manşetleri sabit anahtar kelime listelerine bağlı kalmadan anlamsal olarak tespit eder. Clickbait olduğu düşünülen haberlerde gerçek makale içeriğini okuyarak daha açık, tarafsız ve bilgi veren alternatif bir `flowTitle` üretir.

Ana `flöw.tr/` deneyimi bu beta sürecinde değişmez. Tüm deneyler yalnızca `flöw.tr/baitbusterbeta/` altında görünür.

## Temel ilkeler

- Her haber AI sınıflandırmasından geçebilir; sabit keyword filtresi kullanılmaz.
- İlk aşamada yalnızca hafif metadata gönderilir: başlık, kısa açıklama, kaynak, kategori ve haber kimliği/URL.
- Makale gövdesi yalnızca AI ilk aşamada clickbait şüphesi belirlediğinde okunur.
- Kullanıcı hiçbir zaman AI yanıtını beklemez.
- Sonuç hazır değilse özgün başlık gösterilir.
- AI haber içeriğinde yeterli bilgi bulamazsa başlığı yeniden yazmaz.
- Özgün `title` hiçbir zaman silinmez veya üzerine yazılmaz.
- AI kaynaklı her alternatif başlık izlenebilir bir durum ve güven değeriyle saklanır.

## Mimari

### 1. Mevcut News Worker

News Worker mevcut haber toplama davranışını aynen korur. BaitBuster için AI çağrısı, queue veya ek bekleme eklenmez; böylece ana haber servisi AI gecikmelerinden ve AI servis hatalarından etkilenmez.

Beta istemci katmanı, News Worker'dan zaten aldığı haberleri şu temel alanlarla BaitBuster servisine gönderir:

```json
{
  "key": "canonical-story-key",
  "url": "https://...",
  "title": "...",
  "description": "...",
  "source": "...",
  "category": "..."
}
```

### 2. Flöw AI Worker

Ayrı bir Cloudflare Worker olarak çalışır. Görevleri:

1. Önce KV cache'de mevcut sonuçları aramak.
2. Cache miss olan haber metadata paketlerini toplu halde sınıflandırmak.
3. Her haber için clickbait olasılığı, güven düzeyi ve makale gövdesine ihtiyaç olup olmadığını üretmek.
4. Yalnızca gerekli haberlerde kaynak makaleyi güvenli biçimde çekmek/çıkarma katmanına yönlendirmek.
5. Yeterli içerik varsa tarafsız alternatif başlık üretmek.
6. Sonucu Cloudflare KV'ye yazmak ve beta istemcisine döndürmek.

AI Worker arızası ana Flöw akışını durdurmaz.

### 3. Cloudflare KV

BaitBuster sonuç cache'i ayrı bir KV namespace kullanır. Her haber için tek bir analiz kaydı tutulur. KV yalnız türetilmiş haber analizi içerir; kullanıcı verisi içermez.

Cache anahtarının başlık hash'ini de içermesi sayesinde yayıncı aynı URL'deki manşeti anlamlı biçimde değiştirirse haber yeniden değerlendirilebilir.

## İki aşamalı AI akışı

### Aşama A: Tüm haberlerin hafif sınıflandırması

Girdi, birden fazla haberi tek istekte batch olarak içerir. Model yalnızca metadata görür.

Her haber için beklenen çıktı:

```json
{
  "key": "...",
  "clickbait": true,
  "confidence": 0.91,
  "needsArticle": true,
  "reasonCode": "withheld_core_fact"
}
```

`reasonCode` kullanıcıya gösterilmek zorunda değildir; hata ayıklama ve ölçüm içindir. Serbest metin açıklaması zorunlu değildir.

Sınıflandırma sabit kelime eşleştirmesine dayanmaz. Model; başlığın temel olguyu saklayıp saklamadığı, aşırı merak boşluğu oluşturup oluşturmadığı, haber içeriği yerine duygusal/şok etkisine yaslanıp yaslanmadığı gibi anlamsal özellikleri değerlendirir.

### Aşama B: Şüpheli haberlerin içerik doğrulaması ve yeniden yazımı

Yalnızca `needsArticle=true` olan haberlerde çalışır.

Makale gövdesinden yeterli doğrulanabilir bilgi çıkarılırsa model şu yapıyı döndürür:

```json
{
  "key": "...",
  "rewriteStatus": "rewritten",
  "flowTitle": "...",
  "confidence": 0.94
}
```

Yeterli bilgi yoksa:

```json
{
  "key": "...",
  "rewriteStatus": "insufficient_content",
  "flowTitle": null,
  "confidence": 0.0
}
```

## Başlık yazım kuralları

`flowTitle`:

- Haber gövdesinde açıkça bulunan bilgiyi kullanır.
- Yeni bilgi, yorum, niyet veya sonuç uydurmaz.
- Mümkün olduğunca özne + olay + önemli bağlamı açıkça söyler.
- Tarafsız ve haber diliyle yazılır.
- Genellikle 8-15 kelime hedeflenir; anlam için gerektiğinde bu sınır esneyebilir.
- Sırf farklı görünmek için iyi bir özgün başlığı yeniden yazmaz.
- Sansasyonel sıfat, belirsiz zamir ve yapay merak boşluğunu kaldırır.

## Cache ve kimliklendirme

AI sonuçları tekrar tekrar hesaplanmaz.

Anahtar:

`sha256(normalizedCanonicalUrl + normalizedOriginalTitle)`

KV kaydı en az şu alanları içerir:

```json
{
  "key": "...",
  "originalTitle": "...",
  "flowTitle": "...",
  "clickbait": true,
  "classificationConfidence": 0.91,
  "rewriteConfidence": 0.94,
  "rewriteStatus": "rewritten",
  "modelVersion": "...",
  "updatedAt": "..."
}
```

Aynı haber yeniden görüldüğünde cache sonucu doğrudan kullanılır. Kaynağın başlığı anlamlı biçimde değişirse başlık hash'e dahil olduğu için yeni değerlendirme yapılır.

## Kullanıcı gecikmesi

AI işlemleri ilk haber yükleme zincirinin parçası değildir.

Beta istemcisi haberleri normal biçimde açar. Ardından BaitBuster isteğini kullanıcı arayüzünü bloklamadan başlatır. Cache sonucu hazırsa alternatif başlık kullanılır. Sonuç henüz hazır değilse özgün başlık gösterilir; AI işlemi arka planda tamamlandığında sonuç sonraki render/geçişlerde kullanılabilir.

Bu nedenle hedef kullanıcı tarafı ek gecikmesi yaklaşık sıfırdır; AI gecikmesi arka planda absorbe edilir.

## Beta istemcisi

`baitbusterbeta/index.html`, ana Flöw dosyalarını kullanmaya devam eder ve yalnız beta için ek bir script yükler:

`js/baitbuster-beta.js`

Bu script:

- Haber objesini değiştirmeden BaitBuster sonucunu eşler.
- Yüklenen haber metadata'sını batch halinde AI Worker'a yollar.
- `rewriteStatus === "rewritten"` ve geçerli `flowTitle` varsa ekrandaki başlığı beta görünümünde değiştirir.
- Sonuç yoksa veya hata varsa özgün `title`ı bırakır.
- AI tarafından değiştirilmiş başlığın yanında küçük bir `✦` göstergesi kullanır.
- Paylaşım ve geri bildirim gibi mevcut işlevlerin özgün haber referansını kaybetmemesini sağlar.

İlk beta sürümünde son kullanıcıya confidence puanı veya teknik AI açıklaması gösterilmez.

## Hata yönetimi

Aşağıdaki tüm durumlarda kullanıcı özgün haber başlığını görmeye devam eder:

- AI Worker erişilemiyor.
- Model çağrısı timeout oluyor.
- JSON yanıtı geçersiz.
- Makale gövdesi çekilemiyor.
- İçerik çıkarma başarısız.
- Model içeriği yetersiz buluyor.
- KV erişimi başarısız.

BaitBuster hiçbir koşulda haber kartını boş bırakmaz ve ana akışı bloklamaz.

## Güvenlik ve veri sınırları

- Harici model API anahtarı kullanılmaz. BaitBuster, Cloudflare Workers AI'ı yalnız Worker tarafındaki `AI` binding üzerinden çağırır; istemci doğrudan modele erişmez.
- AI Worker yalnız gerekli haber alanlarını modele yollar.
- Kullanıcıya ait kişisel tercih veya kimlik bilgileri BaitBuster model çağrısına dahil edilmez.
- Kaynak URL'leri çekilirken SSRF güvenlik kontrolleri uygulanır; private/local adresler reddedilir.
- Makale HTML'i doğrudan istemciye taşınmaz.

## Maliyet kontrolü

Maliyet üç mekanizmayla sınırlandırılır:

1. İlk aşama metadata batch çağrılarıyla yapılır.
2. Tam makale yalnızca şüpheli haberlerde işlenir.
3. Sonuçlar KV cache ile tekrar kullanılır.

İlk beta sırasında gerçek oranlar ölçülecek: toplam haber sayısı, clickbait adayı oranı, makale okuma oranı, rewrite başarı oranı, cache hit oranı ve ortalama model kullanım maliyeti.

## Test stratejisi

### Birim/şema testleri

- AI yanıt şeması doğrulaması.
- Eksik/bozuk yanıtların özgün başlığa düşmesi.
- Cache anahtarı kararlılığı.
- `flowTitle` boş olduğunda başlık değişmemesi.

### Davranış testleri

En az üç grup örnek haber kullanılacak:

1. Açık clickbait: temel olguyu gizleyen başlıklar.
2. Normal haber başlıkları: değiştirilmemesi gerekenler.
3. Sınır durumlar: mizahi, soru biçimli, canlı yayın, spor skoru, kısa son dakika başlıkları.

### Beta kabul kriterleri

- `flöw.tr/` davranışı değişmemeli.
- `flöw.tr/baitbusterbeta/` AI sonucu olmadan da normal çalışmalı.
- AI sonucu olan haberde yalnız beta başlığı değişmeli.
- Özgün başlık veri modelinde korunmalı.
- AI servisi kapatıldığında beta akışı çalışmaya devam etmeli.
- Ana sayfanın ilk haber yükleme süresi BaitBuster nedeniyle artmamalı.

## İlk uygulama kapsamı

İlk iterasyonda yalnız şunlar yapılır:

1. Beta istemci entegrasyonu.
2. Flöw AI Worker'ın sınıflandırma + rewrite API'si.
3. Cloudflare KV cache katmanı.
4. Güvenli makale metni çıkarma yolu.
5. Küçük `✦` beta göstergesi.
6. Ölçüm için temel teknik sayaçlar/loglar.

Admin paneli, kullanıcı ayarı, son kullanıcı confidence görünümü, manuel düzeltme arayüzü ve ana siteye taşıma bu iterasyonun dışındadır.
