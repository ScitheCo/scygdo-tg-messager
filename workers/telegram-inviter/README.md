# Telegram Inviter Worker

Harici Node.js worker - Telegram üye davet işlemlerini yönetir.

## Neden Harici Worker?

Supabase Deno Edge Functions TCP bağlantılarını desteklemez. GramJS kütüphanesi TCP gerektirir. Bu nedenle davet işlemleri harici bir Node.js worker'da çalışır.

## Kurulum

### 1. Bağımlılıkları Yükle

```bash
cd workers/telegram-inviter
npm install
```

### 2. Çevre Değişkenlerini Ayarla

`.env` dosyası oluştur:

```bash
cp .env.example .env
```

`.env` dosyasını düzenle:

```env
SUPABASE_URL=https://hmjmlqmwfarqlrhrkyla.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key-here
WORKER_ID=telegram-inviter
BATCH_SIZE=10
POLL_INTERVAL=5000
LOG_LEVEL=info
```

**ÖNEMLİ:** `SUPABASE_SERVICE_ROLE_KEY` Supabase Dashboard'dan alın:
- https://supabase.com/dashboard/project/hmjmlqmwfarqlrhrkyla/settings/api
- "service_role" anahtarını kopyalayın (gizli tutun!)

## Çalıştırma

### Development (Lokal)

```bash
npm run dev
```

### Production (Build)

```bash
npm run build
npm start
```

## Deploy

### Render.com (Önerilen)

1. [Render.com](https://render.com)'a giriş yap
2. "New Background Worker" oluştur
3. GitHub repo'nuzu bağla
4. Ayarlar:
   - **Name:** telegram-inviter
   - **Root Directory:** `workers/telegram-inviter`
   - **Build Command:** `npm install && npm run build`
   - **Start Command:** `npm start`
5. Environment Variables ekle:
   - `SUPABASE_URL`
   - `SUPABASE_SERVICE_ROLE_KEY`
   - `WORKER_ID=telegram-inviter`
   - `BATCH_SIZE=10`
   - `LOG_LEVEL=info`
6. "Create Background Worker"

### Railway.app

1. [Railway.app](https://railway.app)'e giriş yap
2. "New Project" → GitHub repo
3. Root Directory: `workers/telegram-inviter`
4. Environment Variables ekle
5. Deploy

### Docker

```bash
docker build -t telegram-inviter .
docker run -d --env-file .env telegram-inviter
```

## Nasıl Çalışır?

1. **Heartbeat:** Her 60 saniyede `worker_heartbeats` tablosuna yazar
2. **Session Polling:** Her 5 saniyede "running" oturumları kontrol eder
3. **Hesap Bağlantısı:** Aktif hesaplara GramJS ile bağlanır (TCP sorunsuz!)
4. **Davet İşlemi:**
   - Hedef grup entity çözümler
   - İzin kontrolü yapar
   - Üyeleri round-robin ile davet eder
5. **Hata Yönetimi:**
   - FLOOD_WAIT → Hesabı beklet, üyeyi tekrar kuyruğa al
   - Kalıcı hatalar → Üyeyi "failed" yap
   - Geçici hatalar → Üyeyi tekrar kuyruğa al
6. **Güncelleme:** Supabase tablolarını real-time günceller

## Loglar

Worker çalışırken konsola detaylı loglar yazar:

```
[2025-10-23T12:00:00.000Z] [INFO] 🚀 Starting Telegram Inviter Worker...
[2025-10-23T12:00:01.000Z] [INFO] ✅ Supabase client initialized
[2025-10-23T12:00:01.500Z] [INFO] 💓 Heartbeat sent
[2025-10-23T12:00:02.000Z] [INFO] 📋 Processing session abc-123
[2025-10-23T12:00:03.000Z] [INFO] 🔌 Connecting account +1234567890...
[2025-10-23T12:00:05.000Z] [INFO] ✅ Connected: +1234567890
[2025-10-23T12:00:06.000Z] [INFO] 🎯 Target group resolved: Test Group
[2025-10-23T12:00:07.000Z] [INFO] ✅ Successfully invited user 123456789
```

## Sorun Giderme

### Worker çalışmıyor

- `.env` dosyasının doğru olduğundan emin olun
- `SUPABASE_SERVICE_ROLE_KEY` doğru mu kontrol edin
- Logları kontrol edin: `npm run dev`

### Davet yapılmıyor

- Worker heartbeat kontrolü: UI'da "Worker Çevrimdışı" uyarısı var mı?
- Hesapların davet izni var mı?
- FLOOD_WAIT hatası mı? (Loglarda görünür)

### Bağlantı hataları

- Telegram hesaplarının `session_string` değerleri geçerli mi?
- API credentials doğru mu?

## Güvenlik

- `SUPABASE_SERVICE_ROLE_KEY` GİZLİ TUTULMALI
- Sadece worker ortamında (Render, Railway, Docker) kullanın
- Asla Git'e commit etmeyin
- Asla tarayıcı koduna eklemeyın

## Lisans

MIT
