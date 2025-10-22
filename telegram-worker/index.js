import { createClient } from '@supabase/supabase-js';
import { TelegramClient, Api } from 'telegram';
import { StringSession } from 'telegram/sessions/index.js';
import { config } from 'dotenv';

config();

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const POLL_INTERVAL = 5000; // 5 saniye
let isProcessing = false;

console.log('🚀 Telegram Worker başlatıldı...');
console.log('📊 Database bağlantısı kontrol ediliyor...');

// Main polling loop
setInterval(async () => {
  if (isProcessing) {
    console.log('⏳ Hala işlem devam ediyor, atlıyorum...');
    return;
  }

  try {
    // Check for pending scrape jobs
    const { data: scrapeSessions } = await supabase
      .from('scraping_sessions')
      .select('*')
      .eq('status', 'pending_scrape')
      .limit(1)
      .single();

    if (scrapeSessions) {
      console.log('🔍 Scraping job bulundu:', scrapeSessions.id);
      await processScrapeJob(scrapeSessions);
    }

    // Check for pending process jobs
    const { data: processSessions } = await supabase
      .from('scraping_sessions')
      .select('*')
      .eq('status', 'pending_process')
      .limit(1)
      .single();

    if (processSessions) {
      console.log('➕ Processing job bulundu:', processSessions.id);
      await processInviteJob(processSessions);
    }
  } catch (error) {
    if (error.code !== 'PGRST116') { // Ignore "no rows found" error
      console.error('❌ Polling hatası:', error.message);
    }
  }
}, POLL_INTERVAL);

async function processScrapeJob(session) {
  isProcessing = true;
  console.log('🔄 Scraping başlıyor:', session.id);

  try {
    // Update status to 'fetching_members'
    await supabase
      .from('scraping_sessions')
      .update({ status: 'fetching_members' })
      .eq('id', session.id);

    // Get scanner account
    const scannerAccountId = session.settings?.scanner_account_id;
    const { data: account } = await supabase
      .from('telegram_accounts')
      .select('*, telegram_api_credentials(*)')
      .eq('id', scannerAccountId)
      .single();

    if (!account) {
      throw new Error('Scanner account bulunamadı');
    }

    // Initialize Telegram client
    const client = new TelegramClient(
      new StringSession(account.session_string || ''),
      parseInt(account.telegram_api_credentials.api_id),
      account.telegram_api_credentials.api_hash,
      { connectionRetries: 5 }
    );

    await client.connect();
    console.log('✅ Telegram bağlantısı kuruldu');

    // Get group entity
    const groupEntity = await client.getEntity(session.source_group_input);
    console.log('📱 Grup bulundu:', groupEntity.title);

    // Fetch all participants
    let allParticipants = [];
    let offset = 0;
    const limit = 200;

    while (true) {
      const result = await client.invoke(
        new Api.channels.GetParticipants({
          channel: groupEntity,
          filter: new Api.ChannelParticipantsSearch({ q: '' }),
          offset,
          limit,
          hash: BigInt(0),
        })
      );

      if (!result.users || result.users.length === 0) break;
      
      allParticipants = allParticipants.concat(result.users);
      offset += result.users.length;
      
      console.log(`📥 ${allParticipants.length} üye çekildi...`);
      
      if (result.users.length < limit) break;
      
      await new Promise(resolve => setTimeout(resolve, 1000));
    }

    console.log(`✅ Toplam ${allParticipants.length} üye çekildi`);

    // Filter and prepare members
    const filters = session.settings || {};
    const membersToInsert = [];
    let sequence = 0;

    for (const user of allParticipants) {
      if (filters.exclude_bots && user.bot) continue;
      if (filters.exclude_admins && (user.admin || user.creator)) continue;

      membersToInsert.push({
        session_id: session.id,
        user_id: user.id.toString(),
        access_hash: user.accessHash?.toString(),
        username: user.username || null,
        first_name: user.firstName || null,
        last_name: user.lastName || null,
        phone: user.phone || null,
        is_bot: user.bot || false,
        is_admin: (user.admin || user.creator) || false,
        sequence_number: sequence++,
        status: 'queued'
      });
    }

    console.log(`💾 ${membersToInsert.length} üye database'e yazılıyor...`);

    // Insert members in batches
    const batchSize = 1000;
    for (let i = 0; i < membersToInsert.length; i += batchSize) {
      const batch = membersToInsert.slice(i, i + batchSize);
      await supabase.from('scraped_members').insert(batch);
      console.log(`✅ ${i + batch.length}/${membersToInsert.length} üye yazıldı`);
    }

    // Update session
    await supabase
      .from('scraping_sessions')
      .update({
        status: 'ready',
        total_members_fetched: allParticipants.length,
        total_in_queue: membersToInsert.length,
        total_filtered_out: allParticipants.length - membersToInsert.length,
        fetched_at: new Date().toISOString(),
        source_group_id: groupEntity.id.toString(),
        source_group_title: groupEntity.title || session.source_group_input
      })
      .eq('id', session.id);

    await client.disconnect();
    console.log('✅ Scraping tamamlandı!');

  } catch (error) {
    console.error('❌ Scraping hatası:', error);
    await supabase
      .from('scraping_sessions')
      .update({
        status: 'error',
        error_message: error.message
      })
      .eq('id', session.id);
  } finally {
    isProcessing = false;
  }
}

async function processInviteJob(session) {
  isProcessing = true;
  console.log('🔄 Invite işlemi başlıyor:', session.id);

  try {
    // Update status
    await supabase
      .from('scraping_sessions')
      .update({ status: 'processing' })
      .eq('id', session.id);

    // Get session accounts
    const { data: sessionAccounts } = await supabase
      .from('session_accounts')
      .select('*, telegram_accounts(*, telegram_api_credentials(*))')
      .eq('session_id', session.id)
      .eq('is_active', true);

    if (!sessionAccounts || sessionAccounts.length === 0) {
      throw new Error('Aktif hesap bulunamadı');
    }

    console.log(`📱 ${sessionAccounts.length} hesap kullanılacak`);

    // Get queued members
    const { data: queuedMembers } = await supabase
      .from('scraped_members')
      .select('*')
      .eq('session_id', session.id)
      .eq('status', 'queued')
      .order('sequence_number', { ascending: true })
      .limit(100);

    if (!queuedMembers || queuedMembers.length === 0) {
      console.log('✅ Kuyrukta üye kalmadı');
      await supabase
        .from('scraping_sessions')
        .update({ status: 'completed' })
        .eq('id', session.id);
      isProcessing = false;
      return;
    }

    console.log(`➕ ${queuedMembers.length} üye eklenecek`);

    let accountIndex = 0;
    let processed = 0;
    let success = 0;
    let failed = 0;

    for (const member of queuedMembers) {
      try {
        // Round-robin account selection
        const sessionAccount = sessionAccounts[accountIndex % sessionAccounts.length];
        accountIndex++;

        // Check flood wait
        if (sessionAccount.flood_wait_until && new Date(sessionAccount.flood_wait_until) > new Date()) {
          console.log(`⏸️ Hesap flood wait'te, atlanıyor`);
          continue;
        }

        // Mark as processing
        await supabase
          .from('scraped_members')
          .update({ status: 'processing', processed_by_account_id: sessionAccount.account_id })
          .eq('id', member.id);

        const account = sessionAccount.telegram_accounts;
        
        // Initialize client
        const client = new TelegramClient(
          new StringSession(account.session_string || ''),
          parseInt(account.telegram_api_credentials.api_id),
          account.telegram_api_credentials.api_hash,
          { connectionRetries: 3 }
        );

        await client.connect();

        // Get target group
        const targetGroup = await client.getEntity(session.target_group_input);

        // Invite user
        try {
          await client.invoke(
            new Api.channels.InviteToChannel({
              channel: targetGroup,
              users: [
                new Api.InputUser({
                  userId: BigInt(member.user_id),
                  accessHash: BigInt(member.access_hash || 0)
                })
              ]
            })
          );

          await supabase
            .from('scraped_members')
            .update({ 
              status: 'success',
              processed_at: new Date().toISOString()
            })
            .eq('id', member.id);

          success++;
          console.log(`✅ ${member.first_name || member.username} eklendi`);

        } catch (inviteError) {
          if (inviteError.errorMessage === 'FLOOD_WAIT') {
            const waitSeconds = inviteError.seconds || 3600;
            await supabase
              .from('session_accounts')
              .update({
                is_active: false,
                flood_wait_until: new Date(Date.now() + waitSeconds * 1000).toISOString()
              })
              .eq('id', sessionAccount.id);
          }

          await supabase
            .from('scraped_members')
            .update({ 
              status: 'failed',
              error_reason: inviteError.errorMessage || inviteError.message,
              processed_at: new Date().toISOString()
            })
            .eq('id', member.id);

          failed++;
          console.log(`❌ ${member.first_name || member.username} eklenemedi:`, inviteError.errorMessage);
        }

        await client.disconnect();
        processed++;

        // Delay between invites
        const delay = session.settings?.delay_between_adds || 30;
        await new Promise(resolve => setTimeout(resolve, delay * 1000));

      } catch (error) {
        console.error('❌ Üye işleme hatası:', error);
        failed++;
      }
    }

    // Update session stats
    await supabase
      .from('scraping_sessions')
      .update({
        total_processed: session.total_processed + processed,
        total_success: session.total_success + success,
        total_failed: session.total_failed + failed,
        total_in_queue: session.total_in_queue - processed
      })
      .eq('id', session.id);

    console.log(`✅ Batch tamamlandı. İşlenen: ${processed}, Başarılı: ${success}, Başarısız: ${failed}`);

  } catch (error) {
    console.error('❌ Invite işlemi hatası:', error);
    await supabase
      .from('scraping_sessions')
      .update({
        status: 'error',
        error_message: error.message
      })
      .eq('id', session.id);
  } finally {
    isProcessing = false;
  }
}

console.log('✅ Worker hazır, job'lar bekleniyor...');
