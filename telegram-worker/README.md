# Telegram Worker

Bu worker, Telegram grup üyelerini çekme ve ekleme işlemlerini yapar. Supabase database'i sürekli poll eder ve job'ları işler.

## Kurulum

1. Dependencies'i yükle:
```bash
cd telegram-worker
npm install
```

2. `.env` dosyası oluştur:
```bash
cp .env.example .env
```

3. `.env` dosyasını düzenle:
- `SUPABASE_URL`: Zaten dolu
- `SUPABASE_SERVICE_ROLE_KEY`: Supabase dashboard'dan alın (Settings > API > service_role secret)

## Çalıştırma

```bash
npm start
```

Worker başladığında:
- ✅ Her 5 saniyede database'i kontrol eder
- 🔍 `pending_scrape` durumundaki session'ları bulur ve üyeleri çeker
- ➕ `pending_process` durumundaki session'ları bulur ve üyeleri ekler
- 📊 İlerlemeyi database'e yazar
- 🔄 Frontend realtime subscription ile otomatik güncellenir

## Nasıl Çalışır?

1. **Frontend**: "Üyeleri Çek" butonu → Session'ı `pending_scrape` durumuna alır
2. **Worker**: Database'de `pending_scrape` görür → Telegram'dan üyeleri çeker → Database'e yazar
3. **Frontend**: Realtime subscription ile üyeleri görür
4. **Frontend**: "Başlat" butonu → Session'ı `pending_process` durumuna alır  
5. **Worker**: Database'de `pending_process` görür → Üyeleri gruba ekler → İlerlemeyi yazar
6. **Frontend**: Realtime subscription ile ilerlemeyi görür

## Log'lar

Worker çalışırken terminal'de detaylı log'lar gösterir:
- 🔍 Scraping job'ları
- ➕ Invite job'ları
- ✅ Başarılı işlemler
- ❌ Hatalar
- 📊 İlerleme durumu

## Production'da Çalıştırma

VPS veya cloud server'da daemon olarak çalıştırmak için:

```bash
# PM2 ile
npm install -g pm2
pm2 start index.js --name telegram-worker
pm2 save
pm2 startup

# Systemd ile
sudo nano /etc/systemd/system/telegram-worker.service
# (servis dosyasını oluştur)
sudo systemctl enable telegram-worker
sudo systemctl start telegram-worker
```

## Troubleshooting

- **"Database bağlantı hatası"**: `.env` dosyasındaki `SUPABASE_SERVICE_ROLE_KEY` doğru mu kontrol edin
- **"Telegram bağlantı hatası"**: Hesapların `session_string` değerleri doğru mu kontrol edin
- **"Job işlenmiyor"**: Worker çalışıyor mu? Terminal'de log'lar görünüyor mu?
