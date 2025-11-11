# Desktop Worker Uygulaması - AI Development Prompt

## Proje Genel Bakış

**Uygulama Adı:** Telegram Emoji Worker Desktop Application

**Amaç:** Herhangi bir bilgisayarda çalıştırılabilen, Telegram hesapları kullanarak grup mesajlarına emoji reaction gönderen otomatik masaüstü uygulaması. Uygulama açıkken "online", kapalıyken "offline" durumdadır.

**Backend:** Supabase (Database + Edge Functions)

---

## 🎯 Teknoloji Stack

### Desktop Framework
- **Electron** (önerilen) - Cross-platform, kolay build
- Alternatif: **Tauri** (daha hafif, Rust-based)

### Frontend
- **React** + **TypeScript**
- **Tailwind CSS** (styling)
- **shadcn/ui** (UI components)

### Backend & API
- **Supabase JS SDK** (@supabase/supabase-js v2.75.0)
- **Telegram API:** `telegram` npm package (v2.26.22)

### Build & Package
- **Electron Builder** (Windows .exe, macOS .app, Linux AppImage)

---

## 🔑 Supabase Bağlantı Bilgileri

```typescript
const SUPABASE_URL = 'https://hmjmlqmwfarqlrhrkyla.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imhtam1scW13ZmFycWxyaHJreWxhIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjA0NDQ1NjAsImV4cCI6MjA3NjAyMDU2MH0.fGVOrhe1B2GlQY9pNRqi42T21wmlkZtV1iihqBc0QDg';
```

---

## 📐 Database Schema (Referans)

### emoji_tasks
```typescript
interface EmojiTask {
  id: string;                    // UUID
  telegram_username: string;
  telegram_user_id: number;
  chat_id: number;
  group_link: string;
  post_link: string;
  group_id?: number;
  message_id?: number;
  task_type: 'positive_emoji' | 'negative_emoji' | 'custom_emoji' | 'view_only';
  custom_emojis?: string[];      // JSON array
  requested_count: number;
  available_count: number;
  queue_number: number;
  status: 'queued' | 'processing' | 'completed' | 'failed';
  processing_mode: 'edge_function' | 'desktop_worker';
  assigned_worker_id?: string;
  started_at?: string;           // ISO timestamp
  completed_at?: string;
  total_success: number;
  total_failed: number;
  error_message?: string;
  created_at: string;
}
```

### emoji_task_logs
```typescript
interface EmojiTaskLog {
  id: string;
  task_id: string;
  account_id: string;
  action_type: string;           // 'emoji_reaction', 'view_only'
  emoji_used?: string;
  status: 'success' | 'failed';
  error_message?: string;
  worker_id?: string;
  created_at: string;
}
```

### worker_heartbeats
```typescript
interface WorkerHeartbeat {
  id: string;
  worker_id: string;             // Unique worker identifier
  worker_type: 'cloud' | 'desktop';
  last_seen: string;             // ISO timestamp
  status: 'online' | 'offline';
  version: string;               // App version
  machine_info?: {
    os: string;
    hostname: string;
    node_version: string;
  };
  details?: any;                 // Additional JSON data
  created_at: string;
}
```

### telegram_accounts
```typescript
interface TelegramAccount {
  id: string;
  phone_number: string;
  name?: string;
  session_string?: string;       // Encrypted session
  api_credential_id: string;     // FK to telegram_api_credentials
  is_active: boolean;
  created_by: string;            // User ID
  created_at: string;
  telegram_api_credentials: {
    api_id: string;
    api_hash: string;
  };
}
```

---

## 🎨 UI/UX Gereksinimleri

### 1. Ana Pencere (Main Window)

**Başlık:** "Telegram Emoji Worker"

**Bileşenler:**

- **Status Indicator**
  - 🟢 Online / 🔴 Offline
  - Animated pulse effect when online

- **Connection Info**
  - Supabase connection status (Connected / Disconnected)
  - Worker ID (editable)
  - Last heartbeat timestamp (relative time, e.g., "2 seconds ago")

- **Task Stats (Real-time)**
  - Total tasks processed today
  - Success count / Failed count
  - Last task processed timestamp

- **Control Buttons**
  - **Start/Stop Button** (Large, prominent)
  - **Settings Button** (Gear icon)
  - **Logs Button** (Console icon)

- **System Tray**
  - Minimize to tray
  - Tray icon shows status (green/red dot)

### 2. Settings Page

**Fields:**
- **Supabase URL:** (read-only, from config)
- **Supabase Anon Key:** (read-only, masked)
- **Worker ID:** (text input, default: hostname)
- **Auto-start on boot:** (checkbox)
- **Poll Interval:** (slider: 1-30 seconds, default: 5s)
- **Batch Size:** (number input: 1-20, default: 8)
- **Save Button**

### 3. Logs Viewer

- **Real-time log stream** (auto-scroll to bottom)
- **Log level filter:** All / Info / Warn / Error
- **Search box** (filter logs by text)
- **Clear Logs Button**
- **Export Logs Button** (save to .txt)

### 4. System Tray Menu

Right-click menu:
- **Show/Hide Window**
- **Start Worker** (if stopped)
- **Stop Worker** (if running)
- **About**
- **Quit**

---

## 🔧 Core Functionality

### 1. Worker Lifecycle

#### Startup Sequence
```typescript
async function startWorker() {
  // 1. Initialize Supabase connection
  const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  
  // 2. Register worker (upsert heartbeat)
  await supabase.from('worker_heartbeats').upsert({
    worker_id: WORKER_ID,
    worker_type: 'desktop',
    last_seen: new Date().toISOString(),
    status: 'online',
    version: '1.0.0',
    machine_info: {
      os: process.platform,
      hostname: os.hostname(),
      node_version: process.version
    }
  }, { onConflict: 'worker_id' });
  
  // 3. Start heartbeat interval (every 15 seconds)
  heartbeatInterval = setInterval(sendHeartbeat, 15000);
  
  // 4. Start task polling loop
  pollForTasks();
  
  // 5. Update UI status
  setStatus('online');
}
```

#### Heartbeat Mechanism
```typescript
async function sendHeartbeat() {
  await supabase
    .from('worker_heartbeats')
    .update({
      last_seen: new Date().toISOString(),
      status: 'online'
    })
    .eq('worker_id', WORKER_ID);
  
  console.log('[Heartbeat] Sent at', new Date().toISOString());
}
```

#### Graceful Shutdown
```typescript
async function stopWorker() {
  // 1. Stop polling
  clearInterval(pollInterval);
  clearInterval(heartbeatInterval);
  
  // 2. Wait for current task to finish (max 30s)
  if (isProcessingTask) {
    await waitForTaskCompletion({ timeout: 30000 });
  }
  
  // 3. Set worker offline
  await supabase
    .from('worker_heartbeats')
    .update({ status: 'offline' })
    .eq('worker_id', WORKER_ID);
  
  // 4. Update UI
  setStatus('offline');
}

// Handle app close
window.addEventListener('beforeunload', async (e) => {
  if (isProcessingTask) {
    e.preventDefault();
    e.returnValue = 'Task is still processing. Are you sure you want to quit?';
  }
  await stopWorker();
});
```

### 2. Task Polling & Claiming

```typescript
async function pollForTasks() {
  while (isRunning) {
    try {
      // 1. Call claim-emoji-task edge function
      const { data, error } = await supabase.functions.invoke('claim-emoji-task', {
        body: { worker_id: WORKER_ID }
      });

      if (error) {
        console.error('Error claiming task:', error);
        await sleep(POLL_INTERVAL);
        continue;
      }

      const { task } = data;

      if (!task) {
        console.log('No tasks in queue, waiting...');
        await sleep(POLL_INTERVAL);
        continue;
      }

      // 2. Process the task
      console.log(`Processing task ${task.id}`);
      await processEmojiTask(task);

    } catch (error) {
      console.error('Error in poll loop:', error);
      await sleep(5000); // Wait 5s on error
    }
  }
}
```

### 3. Task Processing Logic

```typescript
async function processEmojiTask(task: EmojiTask) {
  isProcessingTask = true;
  updateTaskStats({ currentTask: task.id });

  try {
    // 1. Parse links
    const { groupId, messageId } = parseLinks(task.group_link, task.post_link);
    
    if (!groupId || !messageId) {
      throw new Error('Invalid group or post link');
    }

    console.log(`Task ${task.id}: Group ${groupId}, Message ${messageId}`);

    // 2. Filter accounts (exclude already processed)
    const processedIds = new Set(task.processed_account_ids || []);
    const remainingAccounts = task.accounts.filter(
      (acc: any) => !processedIds.has(acc.id)
    );

    if (remainingAccounts.length === 0) {
      console.log('All accounts already processed');
      await completeTask(task.id, { status: 'completed' });
      return;
    }

    // 3. Process in batches
    const batchSize = 8;
    const batch = remainingAccounts.slice(0, batchSize);
    
    let successCount = 0;
    let failedCount = 0;

    for (const account of batch) {
      try {
        console.log(`Processing account: ${account.phone_number}`);
        
        // Create Telegram client
        const client = new TelegramClient(
          new StringSession(account.session_string),
          parseInt(account.telegram_api_credentials.api_id),
          account.telegram_api_credentials.api_hash,
          { connectionRetries: 3 }
        );

        await client.connect();

        // Get group entity
        const groupEntity = await client.getEntity(groupId);

        // View message
        await client.invoke(new Api.messages.GetMessages({
          id: [new Api.InputMessageID({ id: messageId })]
        }));

        // Send emoji (if not view_only)
        if (task.task_type !== 'view_only') {
          const emoji = getRandomEmoji(task.task_type, task.custom_emojis);
          await client.invoke(new Api.messages.SendReaction({
            peer: groupEntity,
            msgId: messageId,
            reaction: [new Api.ReactionEmoji({ emoticon: emoji })]
          }));
          console.log(`✅ Sent emoji: ${emoji}`);
        } else {
          console.log(`👁️ Viewed message`);
        }

        await client.disconnect();

        // Log success
        await supabase.from('emoji_task_logs').insert({
          task_id: task.id,
          account_id: account.id,
          action_type: 'emoji_reaction',
          emoji_used: emoji,
          status: 'success',
          worker_id: WORKER_ID
        });

        successCount++;

      } catch (error: any) {
        console.error(`❌ Error with account ${account.phone_number}:`, error.message);
        
        // Log failure
        await supabase.from('emoji_task_logs').insert({
          task_id: task.id,
          account_id: account.id,
          action_type: 'emoji_reaction',
          status: 'failed',
          error_message: error.message,
          worker_id: WORKER_ID
        });

        failedCount++;
      }

      // Rate limiting (2.5s between accounts)
      await sleep(2500);
    }

    // 4. Update task status
    const totalProcessed = processedIds.size + batch.length;
    
    if (totalProcessed >= task.requested_count || remainingAccounts.length === batch.length) {
      // Task completed
      await supabase.from('emoji_tasks').update({
        status: 'completed',
        total_success: task.total_success + successCount,
        total_failed: task.total_failed + failedCount,
        completed_at: new Date().toISOString()
      }).eq('id', task.id);

      console.log(`✅ Task ${task.id} completed`);
      updateTaskStats({ totalCompleted: +1 });
      
    } else {
      // Requeue for more processing
      await supabase.from('emoji_tasks').update({
        status: 'queued',
        assigned_worker_id: null,
        total_success: task.total_success + successCount,
        total_failed: task.total_failed + failedCount
      }).eq('id', task.id);

      console.log(`🔄 Task ${task.id} requeued`);
    }

  } catch (error: any) {
    console.error('Task processing error:', error);
    
    // Mark task as failed
    await supabase.from('emoji_tasks').update({
      status: 'failed',
      error_message: error.message,
      completed_at: new Date().toISOString()
    }).eq('id', task.id);

    updateTaskStats({ totalFailed: +1 });
    
  } finally {
    isProcessingTask = false;
  }
}
```

### 4. Helper Functions

```typescript
function parseLinks(groupLink: string, postLink: string) {
  // Extract message ID and group identifier from post link
  // Format: https://t.me/groupname/123 or https://t.me/c/1234567890/123
  const postMatch = postLink.match(/\/(?:c\/)?([^\/]+)\/(\d+)/);
  
  if (!postMatch) {
    return { groupId: null, messageId: null };
  }

  const messageId = parseInt(postMatch[2]);
  const groupIdentifier = postMatch[1];
  
  // If numeric, it's a channel ID (prepend -100)
  const groupId = /^\d+$/.test(groupIdentifier) 
    ? parseInt(groupIdentifier) 
    : groupIdentifier; // Username

  return { groupId, messageId };
}

function getRandomEmoji(taskType: string, customEmojis?: string[]) {
  const POSITIVE = ['👍', '❤️', '🔥', '👏', '🎉', '💯', '😍', '🥳'];
  const NEGATIVE = ['👎', '💔', '😢', '😡', '🤮', '😭', '😠'];

  switch (taskType) {
    case 'positive_emoji':
      return POSITIVE[Math.floor(Math.random() * POSITIVE.length)];
    case 'negative_emoji':
      return NEGATIVE[Math.floor(Math.random() * NEGATIVE.length)];
    case 'custom_emoji':
      if (!customEmojis || customEmojis.length === 0) return '👍';
      return customEmojis[Math.floor(Math.random() * customEmojis.length)];
    default:
      return '👍';
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
```

---

## 🔐 Güvenlik ve Best Practices

### Supabase RLS
- Desktop worker sadece `processing_mode = 'desktop_worker'` olan task'leri alabilir
- Worker sadece kendi heartbeat'ini güncelleyebilir
- Accounts read-only (RLS ile korunmuş)

### Telegram API
- Her account için ayrı `TelegramClient` instance
- Her işlem sonrası `client.disconnect()` (memory leak önleme)
- Rate limiting: Account'lar arası 2.5 saniye bekle
- FLOOD_WAIT hatalarını handle et

### Error Handling
- Tüm network hatalarını try-catch ile yakala
- Her hatayı `emoji_task_logs` tablosuna yaz
- UI'da kullanıcıya bildir (toast/notification)

### Performance
- Telegram client'ları cache'leme (opsiyonel)
- Poll interval: 5 saniye (ayarlanabilir)
- Batch size: 8 account (sequential işleme)

---

## 📦 Build ve Distribution

### Electron Builder Config

**electron-builder.json:**
```json
{
  "appId": "com.telegram.emojiworker",
  "productName": "Telegram Emoji Worker",
  "directories": {
    "output": "dist"
  },
  "files": [
    "build/**/*",
    "node_modules/**/*",
    "package.json"
  ],
  "win": {
    "target": "nsis",
    "icon": "assets/icon.ico"
  },
  "mac": {
    "target": "dmg",
    "icon": "assets/icon.icns",
    "category": "public.app-category.utilities"
  },
  "linux": {
    "target": "AppImage",
    "icon": "assets/icon.png",
    "category": "Utility"
  }
}
```

### Package Scripts

**package.json:**
```json
{
  "name": "telegram-emoji-worker",
  "version": "1.0.0",
  "main": "build/electron.js",
  "scripts": {
    "dev": "concurrently \"npm run dev:react\" \"npm run dev:electron\"",
    "dev:react": "vite",
    "dev:electron": "wait-on http://localhost:5173 && electron .",
    "build": "tsc && vite build",
    "build:win": "npm run build && electron-builder --win",
    "build:mac": "npm run build && electron-builder --mac",
    "build:linux": "npm run build && electron-builder --linux"
  },
  "dependencies": {
    "@supabase/supabase-js": "^2.75.0",
    "telegram": "^2.26.22",
    "react": "^18.3.1",
    "react-dom": "^18.3.1"
  },
  "devDependencies": {
    "electron": "^28.0.0",
    "electron-builder": "^24.0.0",
    "typescript": "^5.0.0",
    "vite": "^5.0.0",
    "concurrently": "^8.0.0",
    "wait-on": "^7.0.0"
  }
}
```

---

## 📁 Örnek Klasör Yapısı

```
telegram-emoji-worker-desktop/
├── src/
│   ├── main/
│   │   ├── index.ts              # Electron main process
│   │   ├── worker.ts              # Task processing logic
│   │   ├── supabase.ts            # Supabase client
│   │   ├── telegram.ts            # Telegram helpers
│   │   └── config.ts              # App configuration
│   ├── renderer/
│   │   ├── App.tsx                # React root
│   │   ├── main.tsx               # React entry
│   │   ├── pages/
│   │   │   ├── Dashboard.tsx
│   │   │   ├── Settings.tsx
│   │   │   └── Logs.tsx
│   │   ├── components/
│   │   │   ├── StatusIndicator.tsx
│   │   │   ├── TaskStats.tsx
│   │   │   ├── LogViewer.tsx
│   │   │   └── ControlPanel.tsx
│   │   └── styles/
│   │       └── index.css
│   └── types/
│       ├── database.ts            # Supabase types
│       └── electron.d.ts          # Electron types
├── assets/
│   ├── icon.ico
│   ├── icon.icns
│   └── icon.png
├── package.json
├── tsconfig.json
├── vite.config.ts
└── electron-builder.json
```

---

## ✅ Test Senaryoları

### 1. Worker Başlatma
- [ ] Uygulamayı aç
- [ ] Status "🟢 Online" görünmeli
- [ ] Supabase'de `worker_heartbeats` tablosunda entry oluşmalı
- [ ] Heartbeat her 15 saniyede güncellenmeşli

### 2. Task İşleme
- [ ] Telegram bot'a task oluştur (processing_mode: desktop_worker)
- [ ] Desktop worker task'i claim etmeli
- [ ] Task işlenirken UI'da progress göstermeli
- [ ] Loglar gerçek zamanlı görünmeli
- [ ] Task tamamlandığında notification göstermeli

### 3. Graceful Shutdown
- [ ] Task işlenirken uygulamayı kapat
- [ ] "Task is processing" uyarısı görmeli
- [ ] Task tamamlandıktan sonra kapatmalı
- [ ] Supabase'de worker status "offline" olmalı

### 4. Error Handling
- [ ] Geçersiz session_string ile test et
- [ ] Network bağlantısını kes
- [ ] Rate limit hatası simüle et
- [ ] Her hata durumunda log oluşmalı

### 5. Multi-Instance Prevention
- [ ] Aynı worker_id ile 2. instance aç
- [ ] 2. instance uyarı gösterip kapanmalı

---

## 🚀 Ekstra Özellikler (Opsiyonel)

- [ ] **Auto-update:** electron-updater ile
- [ ] **Task History:** Son 100 task'i göster
- [ ] **Account Management:** UI'dan account ekle/çıkar
- [ ] **Dark Mode:** Light/Dark theme toggle
- [ ] **Multi-language:** TR/EN support
- [ ] **Crash Reporting:** Sentry entegrasyonu
- [ ] **Performance Metrics:** Task/second grafiği

---

## 📝 Önemli Notlar

1. **Single Instance:** Aynı `worker_id` ile birden fazla instance çalışmamalı
2. **Graceful Shutdown:** Task işlenirken kapanmaya çalışırsa kullanıcıya sor
3. **System Tray:** Minimize edildiğinde tray'e gitmeli
4. **Notifications:** Task tamamlandığında sistem notification göster
5. **Logs:** Logs klasöründe günlük olarak kaydet (max 7 gün)
6. **Updates:** İlk versiyonda gerekli değil, sonra eklenebilir

---

## 🎯 Başarı Kriterleri

✅ Uygulama açıldığında "online" olmalı  
✅ Task'leri claim edip işleyebilmeli  
✅ Her işlem `emoji_task_logs`'a yazmalı  
✅ Heartbeat düzenli gönderilmeli  
✅ Kapatıldığında "offline" olmalı  
✅ UI responsive ve kullanıcı dostu olmalı  
✅ Loglar gerçek zamanlı görünmeli  
✅ Multi-platform build edilebilmeli (Windows, macOS, Linux)

---

**Bu prompt'u kullanarak tam işlevsel bir Desktop Worker uygulaması geliştirebilirsiniz!**

---

## 🔗 İlgili Linkler

- Supabase Docs: https://supabase.com/docs
- Telegram GramJS: https://gram.js.org/
- Electron Docs: https://www.electronjs.org/docs
- shadcn/ui: https://ui.shadcn.com/