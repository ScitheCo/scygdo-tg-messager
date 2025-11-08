import 'dotenv/config';
import * as http from 'http';
import { TelegramClient, Api } from 'telegram';
import { StringSession } from 'telegram/sessions';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import {
  ScrapingSession,
  SessionAccount,
  ScrapedMember,
  PERMANENT_ERRORS
} from './types';

// Environment variables
const SUPABASE_URL = process.env.SUPABASE_URL || '';
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const WORKER_ID = process.env.WORKER_ID || 'telegram-inviter';
const BATCH_SIZE = parseInt(process.env.BATCH_SIZE || '10');
const POLL_INTERVAL = parseInt(process.env.POLL_INTERVAL || '5000');
const LOG_LEVEL = process.env.LOG_LEVEL || 'info';

// Telegram client cache
const clientCache = new Map<string, TelegramClient>();
const entityCache = new Map<string, any>();

let supabase: SupabaseClient = null as any;
let server: http.Server | null = null;
let isShuttingDown = false;

// Logging
function log(level: string, message: string, data?: any) {
  if (LOG_LEVEL === 'debug' || level !== 'debug') {
    const timestamp = new Date().toISOString();
    console.log(`[${timestamp}] [${level.toUpperCase()}] ${message}`, data || '');
  }
}

// Start HTTP server for Cloud Run health checks
function startHttpServer() {
  const port = Number(process.env.PORT || '8080');
  server = http.createServer((req, res) => {
    const path = req.url || '/';
    log('debug', `HTTP ${req.method} ${path}`);
    if (path === '/health' || path === '/_ah/health' || path === '/ready') {
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      res.end('ok');
      return;
    }
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('telegram-inviter-worker');
  });
  server.listen(port, '0.0.0.0', () => log('info', `HTTP server listening on 0.0.0.0:${port}`));
}

// Initialize Supabase
function initSupabase() {
  try {
    if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
      log('error', '❌ Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
      return;
    }
    supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    log('info', '✅ Supabase client initialized');
  } catch (error) {
    log('error', '❌ Failed to initialize Supabase', error);
    supabase = null;
  }
}

// Send heartbeat
async function sendHeartbeat() {
  if (!supabase) {
    log('warn', 'Supabase not initialized, skipping heartbeat');
    return;
  }
  try {
    const { error } = await supabase
      .from('worker_heartbeats')
      .upsert({
        worker_id: WORKER_ID,
        last_seen: new Date().toISOString(),
        status: 'online',
        version: '1.0.0'
      }, {
        onConflict: 'worker_id'
      });

    if (error) {
      log('error', 'Failed to send heartbeat', error);
    } else {
      log('debug', '💓 Heartbeat sent');
    }
  } catch (error) {
    log('error', 'Heartbeat error', error);
  }
}

// Get or create Telegram client
async function getTelegramClient(account: any): Promise<TelegramClient | null> {
  const accountId = account.id;
  
  if (clientCache.has(accountId)) {
    log('debug', `Using cached client for ${account.phone_number}`);
    return clientCache.get(accountId)!;
  }

  try {
    log('info', `🔌 Connecting account ${account.phone_number}...`);
    
    const stringSession = new StringSession(account.session_string || '');
    const client = new TelegramClient(
      stringSession,
      parseInt(account.telegram_api_credentials.api_id),
      account.telegram_api_credentials.api_hash,
      {
        connectionRetries: 3,
        retryDelay: 1500,
        autoReconnect: true,
        requestRetries: 2
      }
    );

    // Connect with timeout
    const connectPromise = client.connect();
    const timeoutPromise = new Promise((_, reject) =>
      setTimeout(() => reject(new Error('Connection timeout')), 20000)
    );

    await Promise.race([connectPromise, timeoutPromise]);
    
    clientCache.set(accountId, client);
    log('info', `✅ Connected: ${account.phone_number}`);
    
    return client;
  } catch (error: any) {
    log('error', `❌ Failed to connect ${account.phone_number}:`, error.message);
    return null;
  }
}

// Resolve target group entity
async function resolveTargetEntity(client: TelegramClient, targetInput: string): Promise<any> {
  const cacheKey = `target:${targetInput}`;
  
  if (entityCache.has(cacheKey)) {
    return entityCache.get(cacheKey);
  }

  try {
    let entity;
    
    if (targetInput.startsWith('-100')) {
      const channelId = targetInput.replace('-100', '');
      entity = await client.getEntity(parseInt(channelId));
    } else if (targetInput.startsWith('@')) {
      entity = await client.getEntity(targetInput);
    } else {
      entity = await client.getEntity(parseInt(targetInput));
    }

    entityCache.set(cacheKey, entity);
    log('info', `🎯 Target group resolved: ${(entity as any).title || 'Unknown'}`);
    
    return entity;
  } catch (error: any) {
    log('error', '❌ Cannot resolve target group:', error.message);
    throw new Error('Cannot resolve target group');
  }
}

// Check invite permission
async function checkInvitePermission(
  client: TelegramClient,
  targetEntity: any,
  accountId: string
): Promise<boolean> {
  try {
    const participant = await client.invoke(
      new Api.channels.GetParticipant({
        channel: targetEntity,
        participant: 'me'
      })
    );

    const participantData = participant.participant as any;
    const canInvite =
      participantData?.adminRights?.inviteUsers ||
      participantData?.className === 'ChannelParticipantCreator';

    if (!canInvite) {
      log('warn', `Account ${accountId} lacks invite permission`);
      
      await supabase
        .from('session_accounts')
        .update({ is_active: false })
        .eq('account_id', accountId);

      await supabase.from('member_scraping_logs').insert({
        account_id: accountId,
        status: 'error',
        error_message: 'CHAT_ADMIN_REQUIRED - No invite permission',
        details: { check: 'permission' }
      });

      return false;
    }

    return true;
  } catch (error: any) {
    log('error', `Permission check failed: ${error.message}`);
    
    await supabase
      .from('session_accounts')
      .update({ is_active: false })
      .eq('account_id', accountId);

    return false;
  }
}

// Check if user is already member
async function isAlreadyMember(
  client: TelegramClient,
  targetEntity: any,
  userEntity: any
): Promise<boolean> {
  try {
    await client.invoke(
      new Api.channels.GetParticipant({
        channel: targetEntity,
        participant: userEntity
      })
    );
    return true;
  } catch (error: any) {
    if (error.errorMessage === 'USER_NOT_PARTICIPANT') {
      return false;
    }
    throw error;
  }
}

// Invite user to channel
async function inviteUser(
  client: TelegramClient,
  targetEntity: any,
  userEntity: any
): Promise<void> {
  await client.invoke(
    new Api.channels.InviteToChannel({
      channel: targetEntity,
      users: [userEntity]
    })
  );
}

// Process single member
async function processMember(
  member: ScrapedMember,
  sessionAccount: SessionAccount,
  client: TelegramClient,
  targetEntity: any,
  dailyLimit: number,
  inviteDelay: number
): Promise<{ success: boolean; error?: string }> {
  const account = sessionAccount.telegram_accounts;

  // Check daily limit
  if (sessionAccount.added_today >= dailyLimit) {
    log('info', `Account ${account.phone_number} reached daily limit`);
    await supabase
      .from('session_accounts')
      .update({ is_active: false })
      .eq('id', sessionAccount.id);
    return { success: false, error: 'DAILY_LIMIT_REACHED' };
  }

  // Mark as processing
  await supabase
    .from('scraped_members')
    .update({ status: 'processing' })
    .eq('id', member.id);

  try {
    // Resolve user entity
    let userEntity = null;

    if (member.access_hash) {
      try {
        const inputUser = new Api.InputUser({
          userId: member.user_id as any,
          accessHash: member.access_hash as any
        });
        const result = await client.invoke(new Api.users.GetUsers({ id: [inputUser] }));
        userEntity = result[0];
        log('debug', `User entity resolved for ${member.user_id}`);
      } catch (error: any) {
        log('error', `Failed to resolve user ${member.user_id}:`, error.message);
      }
    }

    if (!userEntity) {
      log('warn', `Cannot resolve user ${member.user_id}`);
      
      await supabase
        .from('scraped_members')
        .update({ status: 'failed', processed_by_account_id: account.id })
        .eq('id', member.id);

      await supabase.from('member_scraping_logs').insert({
        account_id: account.id,
        status: 'error',
        error_message: 'USER_ID_INVALID - Cannot resolve user entity',
        details: { user_id: member.user_id }
      });

      return { success: false, error: 'USER_ID_INVALID' };
    }

    // Check if already member
    if (await isAlreadyMember(client, targetEntity, userEntity)) {
      log('info', `User ${member.user_id} already member`);
      
      await supabase
        .from('scraped_members')
        .update({ status: 'success', processed_by_account_id: account.id })
        .eq('id', member.id);

      await supabase
        .from('session_accounts')
        .update({
          total_success: sessionAccount.total_success + 1,
          total_attempts: sessionAccount.total_attempts + 1,
          last_activity_at: new Date().toISOString()
        })
        .eq('id', sessionAccount.id);

      return { success: true };
    }

    // Invite user
    await inviteUser(client, targetEntity, userEntity);
    log('info', `✅ Successfully invited user ${member.user_id}`);

    // Update member status
    await supabase
      .from('scraped_members')
      .update({ status: 'success', processed_by_account_id: account.id })
      .eq('id', member.id);

    // Update daily limit
    const today = new Date().toISOString().split('T')[0];
    await supabase
      .from('account_daily_limits')
      .upsert({
        account_id: account.id,
        date: today,
        members_added_today: (sessionAccount.added_today || 0) + 1,
        last_used_at: new Date().toISOString()
      }, {
        onConflict: 'account_id,date'
      });

    // Update session account
    await supabase
      .from('session_accounts')
      .update({
        added_today: sessionAccount.added_today + 1,
        total_success: sessionAccount.total_success + 1,
        total_attempts: sessionAccount.total_attempts + 1,
        last_activity_at: new Date().toISOString()
      })
      .eq('id', sessionAccount.id);

    // Log success
    await supabase.from('member_scraping_logs').insert({
      account_id: account.id,
      status: 'success',
      details: { user_id: member.user_id, action: 'invite' }
    });

    // Wait before next invite
    await new Promise(resolve => setTimeout(resolve, inviteDelay * 1000));

    return { success: true };
  } catch (error: any) {
    const errorMsg = error.errorMessage || error.message || 'Unknown error';
    log('error', `Invite error for user ${member.user_id}:`, errorMsg);

    // Handle FLOOD_WAIT
    if (errorMsg === 'FLOOD_WAIT') {
      const seconds = error.seconds || 300;
      const waitUntil = new Date(Date.now() + seconds * 1000);

      log('warn', `⏳ FLOOD_WAIT ${seconds}s for account ${account.phone_number}`);

      await supabase
        .from('session_accounts')
        .update({
          flood_wait_until: waitUntil.toISOString(),
          total_attempts: sessionAccount.total_attempts + 1
        })
        .eq('id', sessionAccount.id);

      // Requeue member
      await supabase
        .from('scraped_members')
        .update({ status: 'queued' })
        .eq('id', member.id);

      return { success: false, error: 'FLOOD_WAIT' };
    }

    // Handle permanent errors
    if (PERMANENT_ERRORS.includes(errorMsg)) {
      log('warn', `Permanent error for user ${member.user_id}: ${errorMsg}`);
      
      await supabase
        .from('scraped_members')
        .update({ status: 'failed', processed_by_account_id: account.id })
        .eq('id', member.id);

      await supabase.from('member_scraping_logs').insert({
        account_id: account.id,
        status: 'error',
        error_message: errorMsg,
        details: { user_id: member.user_id }
      });

      await supabase
        .from('session_accounts')
        .update({ total_attempts: sessionAccount.total_attempts + 1 })
        .eq('id', sessionAccount.id);

      return { success: false, error: errorMsg };
    }

    // Temporary errors - requeue
    log('warn', `Temporary error, requeuing member ${member.user_id}: ${errorMsg}`);
    
    await supabase
      .from('scraped_members')
      .update({ status: 'queued' })
      .eq('id', member.id);

    await supabase
      .from('session_accounts')
      .update({ total_attempts: sessionAccount.total_attempts + 1 })
      .eq('id', sessionAccount.id);

    return { success: false, error: errorMsg };
  }
}

// Process session
async function processSession(session: ScrapingSession) {
  log('info', `📋 Processing session ${session.id}`);

  const settings = session.settings;
  const dailyLimit = settings?.daily_limit || 50;
  const inviteDelay = settings?.invite_delay || 60;

  // Get active accounts
  const { data: sessionAccounts, error: accountsError } = await supabase
    .from('session_accounts')
    .select('*, telegram_accounts(*, telegram_api_credentials(*))')
    .eq('session_id', session.id)
    .eq('is_active', true)
    .or(`flood_wait_until.is.null,flood_wait_until.lt.${new Date().toISOString()}`);

  if (accountsError || !sessionAccounts || sessionAccounts.length === 0) {
    log('warn', 'No active accounts available, pausing session');
    
    await supabase
      .from('scraping_sessions')
      .update({ status: 'paused' })
      .eq('id', session.id);

    return;
  }

  log('info', `Found ${sessionAccounts.length} active accounts`);

  // Connect accounts and verify permissions
  const validAccounts: SessionAccount[] = [];
  let targetEntity: any = null;

  for (const sessionAccount of sessionAccounts as SessionAccount[]) {
    const account = sessionAccount.telegram_accounts;
    
    const client = await getTelegramClient(account);
    if (!client) continue;

    // Resolve target entity once
    if (!targetEntity) {
      try {
        targetEntity = await resolveTargetEntity(client, session.target_group_input);
      } catch (error) {
        log('error', 'Failed to resolve target group');
        await supabase
          .from('scraping_sessions')
          .update({
            status: 'error',
            error_message: 'Cannot resolve target group'
          })
          .eq('id', session.id);
        return;
      }
    }

    // Check permission
    const hasPermission = await checkInvitePermission(client, targetEntity, account.id);
    if (!hasPermission) continue;

    validAccounts.push(sessionAccount);
  }

  if (validAccounts.length === 0) {
    log('warn', 'No accounts with invite permission');
    
    await supabase
      .from('scraping_sessions')
      .update({
        status: 'paused',
        error_message: 'No accounts have invite permission'
      })
      .eq('id', session.id);

    return;
  }

  log('info', `✅ ${validAccounts.length} valid accounts ready`);

  // Get queued members
  const { data: queuedMembers } = await supabase
    .from('scraped_members')
    .select('*')
    .eq('session_id', session.id)
    .eq('status', 'queued')
    .order('sequence_number')
    .limit(BATCH_SIZE);

  if (!queuedMembers || queuedMembers.length === 0) {
    log('info', '✅ All members processed, completing session');
    
    await supabase
      .from('scraping_sessions')
      .update({ status: 'completed' })
      .eq('id', session.id);

    return;
  }

  log('info', `👥 Processing ${queuedMembers.length} queued members`);

  // Process members using round-robin
  let accountIndex = 0;
  
  for (const member of queuedMembers as ScrapedMember[]) {
    if (isShuttingDown) break;

    // Check session status
    const { data: currentSession } = await supabase
      .from('scraping_sessions')
      .select('status')
      .eq('id', session.id)
      .single();

    if (!currentSession || currentSession.status !== 'running') {
      log('info', 'Session status changed, stopping');
      break;
    }

    // Get next account
    const sessionAccount = validAccounts[accountIndex % validAccounts.length];
    const account = sessionAccount.telegram_accounts;
    const client = clientCache.get(account.id);

    if (!client) {
      accountIndex++;
      continue;
    }

    log('info', `Processing member ${member.user_id} with ${account.phone_number}`);

    const result = await processMember(
      member,
      sessionAccount,
      client,
      targetEntity,
      dailyLimit,
      inviteDelay
    );

    if (result.error === 'FLOOD_WAIT') {
      // Remove this account from rotation
      validAccounts.splice(accountIndex % validAccounts.length, 1);
      
      if (validAccounts.length === 0) {
        log('warn', 'All accounts in flood wait, pausing session');
        await supabase
          .from('scraping_sessions')
          .update({ status: 'paused' })
          .eq('id', session.id);
        break;
      }
    } else {
      accountIndex++;
    }
  }

  log('info', `Batch processing completed for session ${session.id}`);
}

// Main loop
async function mainLoop() {
  log('info', '🔄 Starting main loop...');

  while (!isShuttingDown) {
    try {
      // Guard: Wait if Supabase not ready
      if (!supabase) {
        log('warn', 'Supabase not initialized, waiting...');
        await new Promise(resolve => setTimeout(resolve, POLL_INTERVAL));
        continue;
      }

      await sendHeartbeat();

      // Get running sessions
      const { data: sessions, error } = await supabase
        .from('scraping_sessions')
        .select('*')
        .eq('status', 'running')
        .order('created_at')
        .limit(5);

      if (error) {
        log('error', 'Failed to fetch sessions', error);
      } else if (sessions && sessions.length > 0) {
        log('info', `Found ${sessions.length} running sessions`);
        
        for (const session of sessions as ScrapingSession[]) {
          if (isShuttingDown) break;
          await processSession(session);
        }
      } else {
        log('debug', 'No running sessions');
      }
    } catch (error) {
      log('error', 'Main loop error', error);
    }

    // Wait before next poll
    await new Promise(resolve => setTimeout(resolve, POLL_INTERVAL));
  }

  log('info', 'Main loop stopped');
}

// Cleanup on shutdown
async function cleanup() {
  log('info', '🛑 Shutting down worker...');
  isShuttingDown = true;

  // Close HTTP server
  if (server) {
    await new Promise<void>((resolve) => server!.close(() => {
      log('info', 'HTTP server closed');
      resolve();
    }));
    server = null;
  }

  // Disconnect all clients
  for (const [accountId, client] of clientCache.entries()) {
    try {
      await client.disconnect();
      log('info', `Disconnected client ${accountId}`);
    } catch (error) {
      log('error', `Error disconnecting client ${accountId}`, error);
    }
  }

  // Update heartbeat status
  if (supabase) {
    try {
      await supabase
        .from('worker_heartbeats')
        .update({ status: 'offline' })
        .eq('worker_id', WORKER_ID);
    } catch (error) {
      log('error', 'Failed to update heartbeat status', error);
    }
  }

  log('info', '✅ Worker shutdown complete');
  process.exit(0);
}

// Start worker
async function start() {
  log('info', '🚀 Starting Telegram Inviter Worker...');
  log('info', `Worker ID: ${WORKER_ID}`);
  log('info', `Batch Size: ${BATCH_SIZE}`);
  log('info', `Poll Interval: ${POLL_INTERVAL}ms`);

  startHttpServer();
  initSupabase();
  await sendHeartbeat();

  // Register shutdown handlers
  process.on('SIGINT', cleanup);
  process.on('SIGTERM', cleanup);
  process.on('exit', () => {
    log('info', 'Process exiting');
  });

  // Start main loop
  await mainLoop();
}

// Global error handlers
process.on('unhandledRejection', (reason) => {
  log('error', '❌ Unhandled rejection', reason);
});

process.on('uncaughtException', (err) => {
  log('error', '❌ Uncaught exception', err);
});

// Run with retry on fatal error
start().catch(error => {
  log('error', '❌ Fatal error in start()', error);
  log('info', '🔄 Retrying in 5 seconds...');
  setTimeout(() => {
    start().catch(e => {
      log('error', '❌ Retry failed', e);
    });
  }, 5000);
});
