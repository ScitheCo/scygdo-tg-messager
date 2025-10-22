import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.75.0";
import { TelegramClient } from "npm:telegram@2.26.22";
import { StringSession } from "npm:telegram@2.26.22/sessions/index.js";
import { Api } from "npm:telegram@2.26.22";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Permanent error types that should not be retried
const PERMANENT_ERRORS = [
  'CHAT_ADMIN_REQUIRED',
  'USER_PRIVACY_RESTRICTED',
  'USER_ID_INVALID',
  'USER_BOT',
  'PEER_FLOOD',
  'CHANNEL_PRIVATE',
  'INVITE_REQUEST_SENT',
  'USER_RESTRICTED',
  'USER_KICKED',
  'USER_BANNED_IN_CHANNEL',
  'USER_NOT_MUTUAL_CONTACT',
  'USER_CHANNELS_TOO_MUCH',
  'CHANNELS_TOO_MUCH'
];

// Temporary errors that should requeue the member
const TEMPORARY_ERRORS = [
  'FLOOD_WAIT',
  'TIMEOUT',
  'CONNECTION_FAILED',
  'NETWORK_ERROR'
];

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    const { session_id, batch_size = 10 } = await req.json();

    console.log('🚀 Processing invites for session:', session_id);

    // Get session
    const { data: session } = await supabase
      .from('scraping_sessions')
      .select('*')
      .eq('id', session_id)
      .single();

    if (!session || session.status !== 'running') {
      console.log('⏸️ Session not running, status:', session?.status);
      return new Response(
        JSON.stringify({ success: true, message: 'Session not running', session_status: session?.status }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const settings = session.settings as any;
    const dailyLimit = settings?.daily_limit || 50;
    const inviteDelay = settings?.invite_delay || 60;

    // Get active accounts
    const { data: sessionAccounts } = await supabase
      .from('session_accounts')
      .select('*, telegram_accounts(*, telegram_api_credentials(*))')
      .eq('session_id', session_id)
      .eq('is_active', true)
      .or(`flood_wait_until.is.null,flood_wait_until.lt.${new Date().toISOString()}`);

    if (!sessionAccounts || sessionAccounts.length === 0) {
      console.log('⏸️ No active accounts available, pausing session');
      await supabase
        .from('scraping_sessions')
        .update({ status: 'paused' })
        .eq('id', session_id);

      return new Response(
        JSON.stringify({ 
          success: true, 
          processed: 0,
          session_status: 'paused',
          message: 'All accounts reached daily limit or in flood wait'
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log(`📋 Found ${sessionAccounts.length} active accounts`);

    // Get queued members
    const { data: queuedMembers } = await supabase
      .from('scraped_members')
      .select('*')
      .eq('session_id', session_id)
      .eq('status', 'queued')
      .order('sequence_number')
      .limit(batch_size);

    if (!queuedMembers || queuedMembers.length === 0) {
      console.log('✅ All members processed, completing session');
      await supabase
        .from('scraping_sessions')
        .update({ status: 'completed' })
        .eq('id', session_id);

      return new Response(
        JSON.stringify({ 
          success: true, 
          processed: 0,
          session_status: 'completed'
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log(`👥 Processing ${queuedMembers.length} queued members`);

    // Step 1: Connect all accounts once and cache clients
    const accountClients = new Map();
    const validAccounts = [];
    let targetEntity = null;

    for (const sessionAccount of sessionAccounts) {
      const account = sessionAccount.telegram_accounts;
      
      // Check daily limit
      if ((sessionAccount.added_today || 0) >= dailyLimit) {
        console.log(`⏭️ Account ${account.phone_number} reached daily limit`);
        await supabase
          .from('session_accounts')
          .update({ is_active: false })
          .eq('id', sessionAccount.id);
        continue;
      }

      try {
        console.log(`🔌 Connecting account ${account.phone_number}...`);
        const stringSession = new StringSession(account.session_string || '');
        const client = new TelegramClient(
          stringSession,
          parseInt(account.telegram_api_credentials.api_id),
          account.telegram_api_credentials.api_hash,
          { 
            useWSS: true,
            connectionRetries: 2,
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
        console.log(`✅ Connected: ${account.phone_number}`);

        // Resolve target entity once
        if (!targetEntity) {
          try {
            if (session.target_group_input.startsWith('-100')) {
              const channelId = session.target_group_input.replace('-100', '');
              targetEntity = await client.getEntity(parseInt(channelId));
            } else if (session.target_group_input.startsWith('@')) {
              targetEntity = await client.getEntity(session.target_group_input);
            } else {
              targetEntity = await client.getEntity(parseInt(session.target_group_input));
            }
            console.log(`🎯 Target group resolved: ${targetEntity.title || 'Unknown'}`);
          } catch (error: any) {
            console.error('❌ Cannot resolve target group:', error.message);
            throw new Error('Cannot resolve target group');
          }
        }

        // Check if this account has invite permission
        try {
          const participant = await client.invoke(
            new Api.channels.GetParticipant({
              channel: targetEntity,
              participant: 'me'
            })
          );

          const canInvite = participant.participant?.adminRights?.inviteUsers || 
                           participant.participant?.className === 'ChannelParticipantCreator';

          if (!canInvite) {
            console.log(`❌ Account ${account.phone_number} lacks invite permission`);
            await supabase
              .from('session_accounts')
              .update({ is_active: false })
              .eq('id', sessionAccount.id);
            
            await supabase
              .from('member_scraping_logs')
              .insert({
                account_id: account.id,
                status: 'error',
                error_message: 'CHAT_ADMIN_REQUIRED - No invite permission',
                details: { check: 'permission' }
              });
            
            await client.disconnect();
            continue;
          }

          console.log(`✅ Account ${account.phone_number} has invite permission`);
        } catch (error: any) {
          console.error(`❌ Permission check failed for ${account.phone_number}:`, error.message);
          await supabase
            .from('session_accounts')
            .update({ is_active: false })
            .eq('id', sessionAccount.id);
          await client.disconnect();
          continue;
        }

        // Store valid client and account
        accountClients.set(account.id, { client, sessionAccount, account });
        validAccounts.push({ sessionAccount, account });

      } catch (error: any) {
        console.error(`❌ Failed to connect account ${account.phone_number}:`, error.message);
        await supabase
          .from('session_accounts')
          .update({ is_active: false })
          .eq('id', sessionAccount.id);
      }
    }

    // Check if we have any valid accounts after connection and permission checks
    if (validAccounts.length === 0) {
      console.log('⏸️ No accounts with invite permission, pausing session');
      
      // Disconnect any clients that were connected
      for (const [_, { client }] of accountClients) {
        try {
          await client.disconnect();
        } catch (e) {
          console.error('Error disconnecting client:', e);
        }
      }

      await supabase
        .from('scraping_sessions')
        .update({ 
          status: 'paused',
          error_message: 'No accounts have invite permission in target group'
        })
        .eq('id', session_id);

      return new Response(
        JSON.stringify({ 
          success: true, 
          processed: 0,
          session_status: 'paused',
          message: 'No accounts have invite permission'
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log(`✅ ${validAccounts.length} valid accounts ready for inviting`);

    // Step 2: Process members using round-robin
    let processedCount = 0;
    let successCount = 0;
    let failedCount = 0;
    let currentAccountIndex = 0;

    for (const member of queuedMembers) {
      // Check session status before each member
      const { data: currentSession } = await supabase
        .from('scraping_sessions')
        .select('status')
        .eq('id', session_id)
        .single();

      if (!currentSession || currentSession.status !== 'running') {
        console.log('⏸️ Session status changed, stopping processing');
        break;
      }

      // Mark as processing
      await supabase
        .from('scraped_members')
        .update({ status: 'processing' })
        .eq('id', member.id);

      // Get next account (round-robin)
      const { sessionAccount, account } = validAccounts[currentAccountIndex % validAccounts.length];
      const { client } = accountClients.get(account.id);

      console.log(`👤 Processing member ${member.user_id} with account ${account.phone_number}`);

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
            console.log(`✅ User entity resolved via access_hash`);
          } catch (error: any) {
            console.error('Failed to resolve user via access_hash:', error.message);
          }
        }

        if (!userEntity) {
          console.log(`❌ Cannot resolve user ${member.user_id} - marking as failed`);
          await supabase
            .from('scraped_members')
            .update({
              status: 'failed',
              processed_by_account_id: account.id
            })
            .eq('id', member.id);

          await supabase
            .from('member_scraping_logs')
            .insert({
              account_id: account.id,
              status: 'error',
              error_message: 'USER_ID_INVALID - Cannot resolve user entity',
              details: { user_id: member.user_id }
            });

          failedCount++;
          processedCount++;
          currentAccountIndex++;
          continue;
        }

        // Pre-check if already member
        try {
          await client.invoke(
            new Api.channels.GetParticipant({
              channel: targetEntity,
              participant: userEntity
            })
          );

          console.log(`✅ User ${member.user_id} already member, marking success`);
          await supabase
            .from('scraped_members')
            .update({
              status: 'success',
              processed_by_account_id: account.id
            })
            .eq('id', member.id);

          // Update session account stats (but not daily limit)
          await supabase
            .from('session_accounts')
            .update({
              total_success: sessionAccount.total_success + 1,
              total_attempts: sessionAccount.total_attempts + 1,
              last_activity_at: new Date().toISOString()
            })
            .eq('id', sessionAccount.id);

          successCount++;
          processedCount++;
          currentAccountIndex++;
          continue;

        } catch (error: any) {
          if (error.errorMessage !== 'USER_NOT_PARTICIPANT') {
            console.log('Pre-check error (continuing):', error.errorMessage);
          }
        }

        // Invite user
        try {
          await client.invoke(
            new Api.channels.InviteToChannel({
              channel: targetEntity,
              users: [userEntity]
            })
          );

          console.log(`✅ Successfully invited user ${member.user_id}`);

          // Mark success
          await supabase
            .from('scraped_members')
            .update({
              status: 'success',
              processed_by_account_id: account.id
            })
            .eq('id', member.id);

          // Update daily limit
          const today = new Date().toISOString().split('T')[0];
          const { data: dailyLimitData } = await supabase
            .from('account_daily_limits')
            .select('*')
            .eq('account_id', account.id)
            .eq('date', today)
            .single();

          if (dailyLimitData) {
            await supabase
              .from('account_daily_limits')
              .update({
                members_added_today: (dailyLimitData.members_added_today || 0) + 1,
                last_used_at: new Date().toISOString()
              })
              .eq('account_id', account.id)
              .eq('date', today);
          } else {
            await supabase
              .from('account_daily_limits')
              .insert({
                account_id: account.id,
                date: today,
                members_added_today: 1,
                last_used_at: new Date().toISOString()
              });
          }

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
          await supabase
            .from('member_scraping_logs')
            .insert({
              account_id: account.id,
              status: 'success',
              details: {
                user_id: member.user_id,
                action: 'invite'
              }
            });

          successCount++;

        } catch (error: any) {
          const errorMsg = error.errorMessage || error.message || 'Unknown error';
          console.error(`❌ Invite error for user ${member.user_id}:`, errorMsg);

          // Classify error
          if (errorMsg === 'FLOOD_WAIT') {
            const seconds = error.seconds || 300;
            const waitUntil = new Date(Date.now() + seconds * 1000);

            console.log(`⏳ FLOOD_WAIT ${seconds}s for account ${account.phone_number}`);

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

            // Remove this account from rotation for this batch
            validAccounts.splice(currentAccountIndex % validAccounts.length, 1);
            
            if (validAccounts.length === 0) {
              console.log('⏸️ All accounts in flood wait, pausing session');
              await supabase
                .from('scraping_sessions')
                .update({ status: 'paused' })
                .eq('id', session_id);
              break;
            }

          } else if (PERMANENT_ERRORS.some(perm => errorMsg.includes(perm))) {
            // Permanent error - don't retry
            console.log(`❌ Permanent error for user ${member.user_id}: ${errorMsg}`);
            
            await supabase
              .from('scraped_members')
              .update({
                status: 'failed',
                processed_by_account_id: account.id
              })
              .eq('id', member.id);

            await supabase
              .from('session_accounts')
              .update({
                total_attempts: sessionAccount.total_attempts + 1
              })
              .eq('id', sessionAccount.id);

            await supabase
              .from('member_scraping_logs')
              .insert({
                account_id: account.id,
                status: 'error',
                error_message: errorMsg,
                details: { user_id: member.user_id }
              });

            failedCount++;

          } else {
            // Temporary/unknown error - requeue
            console.log(`⚠️ Temporary error for user ${member.user_id}: ${errorMsg}, requeuing`);
            
            await supabase
              .from('scraped_members')
              .update({ status: 'queued' })
              .eq('id', member.id);

            await supabase
              .from('session_accounts')
              .update({
                total_attempts: sessionAccount.total_attempts + 1
              })
              .eq('id', sessionAccount.id);
          }
        }

        processedCount++;
        currentAccountIndex++;

        // Delay between invites
        if (processedCount < queuedMembers.length) {
          await new Promise(resolve => setTimeout(resolve, inviteDelay * 1000));
        }

      } catch (error: any) {
        console.error(`❌ Processing error for member ${member.user_id}:`, error.message);
        
        await supabase
          .from('scraped_members')
          .update({
            status: 'failed',
            processed_by_account_id: account?.id
          })
          .eq('id', member.id);

        await supabase
          .from('member_scraping_logs')
          .insert({
            account_id: account?.id,
            status: 'error',
            error_message: error.message,
            details: { user_id: member.user_id }
          });

        failedCount++;
        processedCount++;
        currentAccountIndex++;
      }
    }

    // Disconnect all clients
    console.log('🔌 Disconnecting all clients...');
    for (const [_, { client }] of accountClients) {
      try {
        await client.disconnect();
      } catch (e) {
        console.error('Error disconnecting client:', e);
      }
    }

    // Update session totals
    await supabase
      .from('scraping_sessions')
      .update({
        total_processed: session.total_processed + processedCount,
        total_success: session.total_success + successCount,
        total_failed: session.total_failed + failedCount
      })
      .eq('id', session_id);

    console.log(`✅ Batch complete: ${processedCount} processed, ${successCount} success, ${failedCount} failed`);

    return new Response(
      JSON.stringify({
        success: true,
        processed: processedCount,
        success_count: successCount,
        failed_count: failedCount,
        session_status: 'running'
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error: any) {
    console.error('❌ Error in process-member-invites:', error);
    
    return new Response(
      JSON.stringify({ success: false, error: error?.message || 'Unknown error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
