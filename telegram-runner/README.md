# Telegram Runner

Bu klasör, Telegram işlemlerini (üye çekme ve davet gönderme) Supabase Edge'den bağımsız olarak çalıştırmak için Node.js runner script'lerini içerir.

## Neden Gerekli?

Supabase Edge Functions, Telegram MTProto TCP bağlantılarını desteklemiyor. Bu yüzden Telegram işlemlerini local veya sunucunuzda çalışan bu script'lerle yapıyoruz.

## Kurulum

1. Node.js yüklü olmalı (v18+)
2. Bu klasörde terminali açın:
```bash
cd telegram-runner
npm install
```

3. `.env` dosyası oluşturun ve şu bilgileri ekleyin:
```env
SUPABASE_URL=https://hmjmlqmwfarqlrhrkyla.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key
```

## Kullanım

### Üye Çekme Runner'ı Başlatma
```bash
npm run scraper
```

Bu script:
- `scraping_sessions` tablosunu izler
- Status='fetching' olan oturumları bulur
- Kaynak gruptan üyeleri çeker
- Database'e kaydeder
- İlerlemeyi günceller

### Davet Runner'ı Başlatma
```bash
npm run inviter
```

Bu script:
- Status='running' olan oturumları işler
- Sıradaki üyeleri davet eder
- Flood wait hatalarını yönetir
- Günlük limitleri takip eder

## Otomatik Çalıştırma

### Linux/Mac (systemd veya pm2)
```bash
npm install -g pm2
pm2 start npm --name "telegram-scraper" -- run scraper
pm2 start npm --name "telegram-inviter" -- run inviter
pm2 save
```

### Windows (Task Scheduler)
1. Task Scheduler'ı açın
2. "Create Basic Task" seçin
3. Trigger: "At startup"
4. Action: `node scraper.js` ve `node inviter.js`

## Loglar

Script'ler konsola ve `logs/` klasörüne yazıyor. Hata durumunda logları kontrol edin.

## Notlar

- İki script aynı anda çalışabilir
- Her script 5 saniyede bir database'i kontrol eder
- Otomatik yeniden bağlanma var
- Flood wait sürelerini otomatik bekler
