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
    path.join(logsDir, `inviter-${new Date().toISOString().split('T')[0]}.log`),
    logMessage + '\n'
  );
}

async function processInviteSession(session) {
  log(`Processing invite session ${session.id}`);

  try {
    const settings = session.settings || {};
    const dailyLimit = settings.daily_limit || 50;
    const inviteDelay = (settings.invite_delay || 60) * 1000;
    const batchDelay = (settings.batch_delay || 180) * 1000;

    // Get active accounts for this session
    const { data: sessionAccounts, error: accountsError } = await supabase
      .from('session_accounts')
      .select('*, telegram_accounts(session_string, api_credential_id, telegram_api_credentials(api_id, api_hash))')
      .eq('session_id', session.id)
      .eq('is_active', true)
      .lt('added_today', dailyLimit);

    if (accountsError || !sessionAccounts || sessionAccounts.length === 0) {
      log(`No active accounts available for session ${session.id}`);
      await supabase
        .from('scraping_sessions')
        .update({ status: 'paused' })
        .eq('id', session.id);
      return;
    }

    log(`Found ${sessionAccounts.length} active accounts`);

    // Get queued members
    const { data: members, error: membersError } = await supabase
      .from('scraped_members')
      .select('*')
      .eq('session_id', session.id)
      .eq('status', 'queued')
      .order('sequence_number')
      .limit(10);

    if (membersError || !members || members.length === 0) {
      log(`No queued members for session ${session.id}`);
      await supabase
        .from('scraping_sessions')
        .update({ status: 'completed' })
        .eq('id', session.id);
      return;
    }

    log(`Processing ${members.length} members`);

    // Process members
    let accountIndex = 0;
    let invitedCount = 0;

    for (const member of members) {
      const sessionAccount = sessionAccounts[accountIndex];
      const account = sessionAccount.telegram_accounts;
      const apiCreds = account.telegram_api_credentials;

      try {
        // Connect to Telegram
        const client = new TelegramClient(
          new StringSession(account.session_string),
          parseInt(apiCreds.api_id),
          apiCreds.api_hash,
          { connectionRetries: 3 }
        );

        await client.connect();

        // Get target group
        const targetEntity = await client.getEntity(session.target_group_input);

        // Try to get user entity
        let userEntity = null;
        if (member.username) {
          try {
            userEntity = await client.getEntity(member.username);
          } catch (e) {
            log(`Failed to get user by username: ${e.message}`, 'warn');
          }
        }

        if (!userEntity && member.access_hash) {
          try {
            const inputUser = new Api.InputUser({
              userId: BigInt(member.user_id),
              accessHash: BigInt(member.access_hash)
            });
            const result = await client.invoke(new Api.users.GetUsers({ id: [inputUser] }));
            userEntity = result[0];
          } catch (e) {
            log(`Failed to get user by access_hash: ${e.message}`, 'warn');
          }
        }

        if (!userEntity) {
          await supabase
            .from('scraped_members')
            .update({ 
              status: 'failed',
              error_reason: 'User entity not found',
              processed_at: new Date().toISOString()
            })
            .eq('id', member.id);
          continue;
        }

        // Invite user
        await client.invoke(
          new Api.channels.InviteToChannel({
            channel: targetEntity,
            users: [userEntity]
          })
        );

        // Update member status
        await supabase
          .from('scraped_members')
          .update({ 
            status: 'success',
            processed_by_account_id: sessionAccount.account_id,
            processed_at: new Date().toISOString()
          })
          .eq('id', member.id);

        // Update account stats
        await supabase
          .from('session_accounts')
          .update({
            added_today: sessionAccount.added_today + 1,
            total_success: sessionAccount.total_success + 1,
            total_attempts: sessionAccount.total_attempts + 1,
            last_activity_at: new Date().toISOString(),
            is_active: sessionAccount.added_today + 1 < dailyLimit
          })
          .eq('id', sessionAccount.id);

        // Update session totals
        await supabase
          .from('scraping_sessions')
          .update({
            total_processed: session.total_processed + 1,
            total_success: session.total_success + 1
          })
          .eq('id', session.id);

        await client.disconnect();

        invitedCount++;
        log(`Successfully invited user ${member.user_id}`);

        // Delay
        if (invitedCount % 10 === 0) {
          log(`Batch delay: ${batchDelay / 1000}s`);
          await new Promise(resolve => setTimeout(resolve, batchDelay));
        } else {
          await new Promise(resolve => setTimeout(resolve, inviteDelay));
        }

        // Rotate account
        accountIndex = (accountIndex + 1) % sessionAccounts.length;

      } catch (error) {
        log(`Error inviting member ${member.user_id}: ${error.message}`, 'error');

        // Check for flood wait
        if (error.message.includes('FLOOD_WAIT')) {
          const waitTime = parseInt(error.message.match(/\d+/)?.[0] || '3600');
          log(`Flood wait detected: ${waitTime}s`, 'warn');

          await supabase
            .from('session_accounts')
            .update({
              flood_wait_until: new Date(Date.now() + waitTime * 1000).toISOString(),
              is_active: false
            })
            .eq('id', sessionAccount.id);
        }

        await supabase
          .from('scraped_members')
          .update({ 
            status: 'failed',
            error_reason: error.message.substring(0, 255),
            retry_count: member.retry_count + 1,
            processed_at: new Date().toISOString()
          })
          .eq('id', member.id);

        await supabase
          .from('scraping_sessions')
          .update({
            total_processed: session.total_processed + 1,
            total_failed: session.total_failed + 1
          })
          .eq('id', session.id);
      }
    }

    log(`Session ${session.id} batch completed: ${invitedCount} invited`);

  } catch (error) {
    log(`Error processing invite session ${session.id}: ${error.message}`, 'error');
  }
}

async function run() {
  log('Telegram Inviter Runner started');

  while (true) {
    try {
      // Find running sessions
      const { data: sessions, error } = await supabase
        .from('scraping_sessions')
        .select('*')
        .eq('status', 'running');

      if (error) {
        log(`Error fetching sessions: ${error.message}`, 'error');
      } else if (sessions && sessions.length > 0) {
        log(`Found ${sessions.length} running sessions`);
        for (const session of sessions) {
          await processInviteSession(session);
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
