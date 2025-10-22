require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const { TelegramClient } = require('telegram');
const { StringSession } = require('telegram/sessions');
const { Api } = require('telegram');
const fs = require('fs');
const path = require('path');

// Supabase client
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// Log klasörü
const logsDir = path.join(__dirname, 'logs');
if (!fs.existsSync(logsDir)) {
  fs.mkdirSync(logsDir);
}

function log(message, level = 'info') {
  const timestamp = new Date().toISOString();
  const logMessage = `[${timestamp}] [${level.toUpperCase()}] ${message}`;
  console.log(logMessage);
  fs.appendFileSync(
    path.join(logsDir, `scraper-${new Date().toISOString().split('T')[0]}.log`),
    logMessage + '\n'
  );
}

async function processFetchSession(session) {
  log(`Processing session ${session.id} - Source: ${session.source_group_input}`);

  try {
    // Update status to fetching
    await supabase
      .from('scraping_sessions')
      .update({ status: 'fetching' })
      .eq('id', session.id);

    // Get scanner account - first try to find one from session_accounts
    let scannerAccountId = null;
    
    const { data: sessionAccounts } = await supabase
      .from('session_accounts')
      .select('account_id')
      .eq('session_id', session.id)
      .limit(1);
    
    if (sessionAccounts && sessionAccounts.length > 0) {
      scannerAccountId = sessionAccounts[0].account_id;
    }

    const { data: account, error: accountError } = await supabase
      .from('telegram_accounts')
      .select('session_string, api_credential_id, telegram_api_credentials(api_id, api_hash)')
      .eq('id', scannerAccountId)
      .single();

    if (accountError || !account) {
      throw new Error('Scanner account not found');
    }

    const apiCreds = account.telegram_api_credentials;
    if (!apiCreds) {
      throw new Error('API credentials not found');
    }

    // Connect to Telegram
    const client = new TelegramClient(
      new StringSession(account.session_string),
      parseInt(apiCreds.api_id),
      apiCreds.api_hash,
      { connectionRetries: 5 }
    );

    await client.connect();
    log('Connected to Telegram');

    // Get source entity
    const sourceEntity = await client.getEntity(session.source_group_input);
    log(`Source group resolved: ${sourceEntity.title}`);

    // Update session with source group info
    await supabase
      .from('scraping_sessions')
      .update({
        source_group_id: sourceEntity.id.toString(),
        source_group_title: sourceEntity.title
      })
      .eq('id', session.id);

    // Fetch all participants
    let allParticipants = [];
    let offset = 0;
    const limit = 200;
    let hasMore = true;

    while (hasMore) {
      const result = await client.invoke(
        new Api.channels.GetParticipants({
          channel: sourceEntity,
          filter: new Api.ChannelParticipantsSearch({ q: '' }),
          offset: offset,
          limit: limit,
          hash: 0,
        })
      );

      if (result.users.length === 0) {
        hasMore = false;
      } else {
        allParticipants = allParticipants.concat(
          result.users.map((user, idx) => {
            const participant = result.participants[idx];
            return {
              user,
              participant,
              isAdmin: participant.className === 'ChannelParticipantAdmin' || 
                      participant.className === 'ChannelParticipantCreator'
            };
          })
        );
        offset += result.users.length;
        
        log(`Fetched ${offset} members so far...`);
        
        // Update progress
        await supabase
          .from('scraping_sessions')
          .update({ total_members_fetched: offset })
          .eq('id', session.id);
      }

      await new Promise(resolve => setTimeout(resolve, 1000));
    }

    await client.disconnect();
    log(`Total members fetched: ${allParticipants.length}`);

    // Filter members
    const settings = session.settings || {};
    let filteredCount = 0;
    
    const membersToQueue = allParticipants
      .filter(item => {
        if (settings.filter_bots && item.user.bot) {
          filteredCount++;
          return false;
        }
        if (settings.filter_admins && item.isAdmin) {
          filteredCount++;
          return false;
        }
        return true;
      })
      .map((item, index) => ({
        session_id: session.id,
        user_id: item.user.id.toString(),
        access_hash: item.user.accessHash?.toString() || null,
        username: item.user.username || null,
        first_name: item.user.firstName || null,
        last_name: item.user.lastName || null,
        phone: item.user.phone || null,
        is_bot: item.user.bot || false,
        is_admin: item.isAdmin,
        sequence_number: index + 1,
        status: 'queued'
      }));

    // Insert members in batches
    const batchSize = 100;
    for (let i = 0; i < membersToQueue.length; i += batchSize) {
      const batch = membersToQueue.slice(i, i + batchSize);
      await supabase.from('scraped_members').insert(batch);
      log(`Inserted batch ${Math.floor(i / batchSize) + 1}/${Math.ceil(membersToQueue.length / batchSize)}`);
    }

    // Update session
    await supabase
      .from('scraping_sessions')
      .update({
        status: 'ready',
        total_in_queue: membersToQueue.length,
        total_filtered_out: filteredCount,
        fetched_at: new Date().toISOString()
      })
      .eq('id', session.id);

    log(`Session ${session.id} completed. ${membersToQueue.length} members queued, ${filteredCount} filtered out.`);

  } catch (error) {
    log(`Error processing session ${session.id}: ${error.message}`, 'error');
    await supabase
      .from('scraping_sessions')
      .update({ 
        status: 'error',
        error_message: error.message 
      })
      .eq('id', session.id);
  }
}

async function run() {
  log('Telegram Scraper Runner started');

  while (true) {
    try {
      // Find sessions that need fetching
      const { data: sessions, error } = await supabase
        .from('scraping_sessions')
        .select('*')
        .eq('status', 'configuring')
        .is('fetched_at', null);

      if (error) {
        log(`Error fetching sessions: ${error.message}`, 'error');
      } else if (sessions && sessions.length > 0) {
        log(`Found ${sessions.length} sessions to process`);
        for (const session of sessions) {
          await processFetchSession(session);
        }
      }

      // Wait 5 seconds before next check
      await new Promise(resolve => setTimeout(resolve, 5000));

    } catch (error) {
      log(`Fatal error in main loop: ${error.message}`, 'error');
      await new Promise(resolve => setTimeout(resolve, 10000));
    }
  }
}

run().catch(error => {
  log(`Fatal error: ${error.message}`, 'error');
  process.exit(1);
});
