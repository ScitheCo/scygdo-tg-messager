# Desktop Telegram Worker - Session Validation & Health Monitoring

Bu prompt, mevcut Desktop Worker uygulamasının **session validation**, **bağlantı yönetimi** ve **hesap sağlığı izleme** özellikleri ile güncellenmesi içindir.

## Yeni Özellikler

### 1. Account Health Status Tablosu
Worker artık hesap sağlık durumlarını Supabase'deki `account_health_status` tablosuna kaydedecek:

```typescript
interface AccountHealthStatus {
  account_id: string;
  last_checked: string;
  status: 'ok' | 'invalid_session' | 'rate_limited' | 'connection_timeout' | 'dc_migrate_required' | 'unknown_error';
  error_message?: string;
  consecutive_failures: number;
  last_success?: string;
}
```

### 2. Session Validation Sistemi

#### Başlangıç Validasyonu
Worker başlarken tüm aktif hesapların session'larını test edecek:

```typescript
async function validateAllSessions() {
  const accounts = await getActiveAccounts();
  
  for (const account of accounts) {
    const result = await testAccountSession(account);
    await updateAccountHealth(result);
    
    if (result.status !== 'ok') {
      console.warn(`Account ${account.phone_number} failed validation: ${result.status}`);
    }
  }
}
```

#### Test Account Session Fonksiyonu
```typescript
async function testAccountSession(account: TelegramAccount): Promise<SessionTestResult> {
  let client: TelegramClient | null = null;
  
  try {
    client = new TelegramClient(
      new StringSession(account.session_string),
      parseInt(account.api_id),
      account.api_hash,
      {
        connectionRetries: 5,
        timeout: 30000,
        retryDelay: 2000,
        autoReconnect: true,
        useWSS: false
      }
    );

    await connectWithRetry(client, 3);
    await client.getMe();

    return {
      account_id: account.id,
      phone_number: account.phone_number,
      status: 'ok',
      message: 'Session geçerli ve aktif'
    };

  } catch (error) {
    const errorMsg = error.message?.toLowerCase() || '';
    
    if (errorMsg.includes('auth_key_unregistered') || errorMsg.includes('session_revoked')) {
      return {
        account_id: account.id,
        phone_number: account.phone_number,
        status: 'invalid_session',
        message: 'Oturum geçersiz veya iptal edilmiş'
      };
    }
    
    if (errorMsg.includes('flood') || errorMsg.includes('too many requests')) {
      return {
        account_id: account.id,
        phone_number: account.phone_number,
        status: 'rate_limited',
        message: 'Rate limit (çok fazla istek)'
      };
    }
    
    if (errorMsg.includes('timeout') || errorMsg.includes('connection')) {
      return {
        account_id: account.id,
        phone_number: account.phone_number,
        status: 'connection_timeout',
        message: 'Bağlantı zaman aşımı'
      };
    }
    
    return {
      account_id: account.id,
      phone_number: account.phone_number,
      status: 'unknown_error',
      message: error.message
    };
  } finally {
    if (client) {
      await client.disconnect();
    }
  }
}
```

#### Retry Logic ile Bağlantı
```typescript
async function connectWithRetry(
  client: TelegramClient, 
  maxRetries: number = 3,
  baseDelay: number = 2000
): Promise<void> {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      await client.connect();
      console.log(`✓ Connected successfully on attempt ${attempt}`);
      return;
    } catch (error) {
      console.warn(`✗ Connection attempt ${attempt} failed:`, error.message);
      
      if (attempt === maxRetries) {
        throw error;
      }
      
      // Exponential backoff: 2s, 4s, 8s
      const delay = baseDelay * Math.pow(2, attempt - 1);
      console.log(`Retrying in ${delay}ms...`);
      await sleep(delay);
    }
  }
}
```

### 3. Periyodik Health Check

Worker ayarlara yeni bir seçenek eklenecek:

```typescript
interface WorkerSettings {
  // ... mevcut ayarlar
  autoHealthCheck: boolean; // default: true
  healthCheckInterval: number; // default: 3600000 (1 saat)
  connectionTimeout: number; // default: 30000
  maxConnectionRetries: number; // default: 5
}
```

```typescript
// Ana worker loop'unda
if (settings.autoHealthCheck) {
  const lastCheck = getLastHealthCheckTime();
  const now = Date.now();
  
  if (now - lastCheck >= settings.healthCheckInterval) {
    console.log('🔍 Running periodic health check...');
    await validateAllSessions();
    setLastHealthCheckTime(now);
  }
}
```

### 4. Supabase'e Health Status Yazma

```typescript
async function updateAccountHealth(result: SessionTestResult) {
  const healthData = {
    account_id: result.account_id,
    last_checked: new Date().toISOString(),
    status: result.status,
    error_message: result.message,
    consecutive_failures: result.status === 'ok' ? 0 : undefined,
    last_success: result.status === 'ok' ? new Date().toISOString() : undefined
  };

  const { error } = await supabase
    .from('account_health_status')
    .upsert(healthData, { onConflict: 'account_id' });

  if (error) {
    console.error('Failed to update health status:', error);
  } else {
    // Başarısızsa consecutive_failures'ı artır
    if (result.status !== 'ok') {
      const { data: existing } = await supabase
        .from('account_health_status')
        .select('consecutive_failures')
        .eq('account_id', result.account_id)
        .single();

      if (existing) {
        await supabase
          .from('account_health_status')
          .update({ 
            consecutive_failures: (existing.consecutive_failures || 0) + 1 
          })
          .eq('account_id', result.account_id);
      }
    }
  }
}
```

### 5. Client Cache Yönetimi

TelegramClient örneklerini önbelleğe alıp yeniden kullan:

```typescript
const clientCache = new Map<string, TelegramClient>();

async function getOrCreateClient(account: TelegramAccount): Promise<TelegramClient> {
  const cacheKey = account.id;
  
  if (clientCache.has(cacheKey)) {
    const client = clientCache.get(cacheKey)!;
    
    // Client connected mi kontrol et
    if (client.connected) {
      return client;
    } else {
      // Disconnect olmuşsa yeniden bağlan
      await connectWithRetry(client, 3);
      return client;
    }
  }
  
  // Yeni client oluştur
  const client = new TelegramClient(
    new StringSession(account.session_string),
    parseInt(account.api_id),
    account.api_hash,
    {
      connectionRetries: 5,
      timeout: 30000,
      retryDelay: 2000,
      autoReconnect: true,
      useWSS: false
    }
  );
  
  await connectWithRetry(client, 3);
  clientCache.set(cacheKey, client);
  
  return client;
}

// Cleanup function
async function cleanupClients() {
  for (const [key, client] of clientCache.entries()) {
    try {
      await client.disconnect();
    } catch (error) {
      console.error(`Error disconnecting client ${key}:`, error);
    }
  }
  clientCache.clear();
}
```

### 6. Task İşleme İyileştirmesi

Sadece sağlıklı hesapları kullan:

```typescript
async function processTask(task: EmojiTask) {
  // Hesap sağlık durumlarını kontrol et
  const { data: healthStatuses } = await supabase
    .from('account_health_status')
    .select('*')
    .in('account_id', availableAccountIds);

  // Sadece sağlıklı hesapları filtrele
  const healthyAccounts = accounts.filter(account => {
    const health = healthStatuses?.find(h => h.account_id === account.id);
    
    // Sağlık durumu 'ok' veya 'rate_limited' (rate limit geçici)
    if (!health) return true; // Hiç test edilmemişse kullan
    if (health.status === 'ok') return true;
    if (health.status === 'rate_limited') return true;
    
    // 3'ten fazla ardışık hata varsa kullanma
    if (health.consecutive_failures >= 3) return false;
    
    return false;
  });

  if (healthyAccounts.length === 0) {
    throw new Error('Kullanılabilir sağlıklı hesap yok');
  }

  // ... task işleme devam eder
}
```

### 7. Network Diagnostics

Worker başlangıcında ağ kalitesini kontrol et:

```typescript
async function runNetworkDiagnostics() {
  console.log('🔍 Running network diagnostics...');
  
  const checks = {
    telegramApi: false,
    supabase: false,
    dns: false
  };

  // Telegram API kontrolü
  try {
    const response = await fetch('https://telegram.org', { method: 'HEAD' });
    checks.telegramApi = response.ok;
  } catch (error) {
    console.error('❌ Telegram API unreachable:', error.message);
  }

  // Supabase kontrolü
  try {
    const { error } = await supabase.from('telegram_accounts').select('id').limit(1);
    checks.supabase = !error;
  } catch (error) {
    console.error('❌ Supabase unreachable:', error.message);
  }

  // DNS çözümlemesi
  try {
    await fetch('https://dns.google/resolve?name=telegram.org');
    checks.dns = true;
  } catch (error) {
    console.error('❌ DNS resolution failed:', error.message);
  }

  if (Object.values(checks).some(v => !v)) {
    console.warn('⚠️ Network issues detected. Some features may not work properly.');
  } else {
    console.log('✓ Network diagnostics passed');
  }

  return checks;
}
```

### 8. UI Güncellemeleri

#### Ana Ekran - Account Health Panel
```tsx
<Card className="p-4">
  <h3 className="font-semibold mb-3">Account Health</h3>
  <div className="space-y-2">
    <div className="flex justify-between text-sm">
      <span>Total Accounts:</span>
      <Badge>{accounts.length}</Badge>
    </div>
    <div className="flex justify-between text-sm">
      <span>Healthy:</span>
      <Badge variant="success">{healthyCount}</Badge>
    </div>
    <div className="flex justify-between text-sm">
      <span>Issues:</span>
      <Badge variant="destructive">{issuesCount}</Badge>
    </div>
  </div>
  <Button 
    size="sm" 
    className="w-full mt-3"
    onClick={() => validateAllSessions()}
  >
    Test All Sessions
  </Button>
</Card>
```

#### Settings - Health Check Options
```tsx
<div className="space-y-4">
  <div className="flex items-center justify-between">
    <Label>Auto Health Check</Label>
    <Switch
      checked={settings.autoHealthCheck}
      onCheckedChange={(v) => updateSetting('autoHealthCheck', v)}
    />
  </div>
  
  {settings.autoHealthCheck && (
    <>
      <div>
        <Label>Check Interval (minutes)</Label>
        <Input
          type="number"
          value={settings.healthCheckInterval / 60000}
          onChange={(e) => updateSetting('healthCheckInterval', parseInt(e.target.value) * 60000)}
        />
      </div>
      <div>
        <Label>Connection Timeout (seconds)</Label>
        <Input
          type="number"
          value={settings.connectionTimeout / 1000}
          onChange={(e) => updateSetting('connectionTimeout', parseInt(e.target.value) * 1000)}
        />
      </div>
      <div>
        <Label>Max Retries</Label>
        <Input
          type="number"
          value={settings.maxConnectionRetries}
          onChange={(e) => updateSetting('maxConnectionRetries', parseInt(e.target.value))}
        />
      </div>
    </>
  )}
</div>
```

#### Yeni Ekran - Account Health Dashboard
Tüm hesapların detaylı sağlık durumunu gösteren bir dashboard:

```tsx
<div className="space-y-4">
  <h2 className="text-xl font-bold">Account Health Dashboard</h2>
  
  <div className="flex gap-2">
    <Button onClick={() => validateAllSessions()}>
      Test All
    </Button>
    <Button 
      variant="destructive"
      onClick={() => deactivateInvalidAccounts()}
    >
      Deactivate Invalid
    </Button>
  </div>

  <Table>
    <TableHeader>
      <TableRow>
        <TableHead>Phone</TableHead>
        <TableHead>Status</TableHead>
        <TableHead>Last Check</TableHead>
        <TableHead>Consecutive Failures</TableHead>
        <TableHead>Actions</TableHead>
      </TableRow>
    </TableHeader>
    <TableBody>
      {accountsWithHealth.map(account => (
        <TableRow key={account.id}>
          <TableCell>{account.phone_number}</TableCell>
          <TableCell>
            <Badge variant={getHealthVariant(account.health.status)}>
              {account.health.status}
            </Badge>
          </TableCell>
          <TableCell>{formatDate(account.health.last_checked)}</TableCell>
          <TableCell>{account.health.consecutive_failures}</TableCell>
          <TableCell>
            <Button 
              size="sm"
              onClick={() => testSingleAccount(account.id)}
            >
              Test
            </Button>
          </TableCell>
        </TableRow>
      ))}
    </TableBody>
  </Table>
</div>
```

## Önemli Notlar

1. **Worker Başlangıcı:**
   - İlk olarak network diagnostics çalışacak
   - Ardından tüm session'lar validate edilecek
   - Sonuçlar account_health_status tablosuna yazılacak

2. **Periyodik Kontrol:**
   - Ayarlanabilir interval'lerde (default 1 saat)
   - Arka planda çalışacak, task işlemeyi engellemeyecek

3. **Task İşleme:**
   - Sadece sağlıklı hesaplar kullanılacak
   - 3+ ardışık hata olan hesaplar atlanacak
   - Rate limited hesaplar kullanılmaya devam edilecek (geçici)

4. **Bağlantı Yönetimi:**
   - Exponential backoff ile retry
   - Client caching ile performans iyileştirmesi
   - Graceful disconnect on shutdown

5. **Kullanıcı Bildirimleri:**
   - Desktop notification ile health check sonuçları
   - Console'da renkli log output
   - UI'da gerçek zamanlı health status gösterimi

Bu prompt ile desktop worker, kendi kendine session validation yapabilen, bağlantı hatalarını daha iyi yöneten ve hesap sağlık durumunu izleyen kapsamlı bir araç haline gelecektir.
