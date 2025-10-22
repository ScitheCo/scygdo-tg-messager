import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.75.0";
import { TelegramClient } from "npm:telegram@2.26.22";
import { StringSession } from "npm:telegram@2.26.22/sessions/index.js";
import { Api } from "npm:telegram@2.26.22";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

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

    console.log('Processing invites for session:', session_id);

    // Get session
    const { data: session } = await supabase
      .from('scraping_sessions')
      .select('*')
      .eq('id', session_id)
      .single();

    if (!session || session.status !== 'running') {
      return new Response(
        JSON.stringify({ success: false, message: 'Session not running' }),
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
      .is('flood_wait_until', null)
      .or(`flood_wait_until.lt.${new Date().toISOString()}`);

    if (!sessionAccounts || sessionAccounts.length === 0) {
      // No active accounts, pause session
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

    // Get queued members
    const { data: queuedMembers } = await supabase
      .from('scraped_members')
      .select('*')
      .eq('session_id', session_id)
      .eq('status', 'queued')
      .order('sequence_number')
      .limit(batch_size);

    if (!queuedMembers || queuedMembers.length === 0) {
      // All done
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

    let processedCount = 0;
    let successCount = 0;
    let failedCount = 0;
    let currentAccountIndex = 0;

    // Process each member
    for (const member of queuedMembers) {
      // Mark as processing
      await supabase
        .from('scraped_members')
        .update({ status: 'processing' })
        .eq('id', member.id);

      // Select account (round-robin)
      const sessionAccount = sessionAccounts[currentAccountIndex % sessionAccounts.length];
      const account = sessionAccount.telegram_accounts;

      // Check daily limit
      const { data: dailyLimitData } = await supabase
        .from('account_daily_limits')
        .select('members_added_today')
        .eq('account_id', account.id)
        .eq('date', new Date().toISOString().split('T')[0])
        .single();

      const addedToday = dailyLimitData?.members_added_today || 0;

      if (addedToday >= dailyLimit) {
        // Deactivate account
        await supabase
          .from('session_accounts')
          .update({ is_active: false })
          .eq('id', sessionAccount.id);

        currentAccountIndex++;
        continue;
      }

      try {
        // Connect to Telegram with improved settings
        const stringSession = new StringSession(account.session_string || '');
        const client = new TelegramClient(
          stringSession,
          parseInt(account.telegram_api_credentials.api_id),
          account.telegram_api_credentials.api_hash,
          { 
            connectionRetries: 5,
            retryDelay: 2000,
            autoReconnect: true,
            requestRetries: 3
          }
        );

        // Connect with timeout
        const connectPromise = client.connect();
        const timeoutPromise = new Promise((_, reject) => 
          setTimeout(() => reject(new Error('Connection timeout')), 20000)
        );
        
        await Promise.race([connectPromise, timeoutPromise]);
        console.log('Connected to Telegram for member processing');

        // Resolve target channel
        let targetEntity;
        try {
          if (session.target_group_input.startsWith('@') || !session.target_group_input.match(/^\d+$/)) {
            targetEntity = await client.getEntity(session.target_group_input);
          } else {
            targetEntity = await client.getEntity(parseInt(session.target_group_input));
          }
        } catch (error) {
          throw new Error('Cannot resolve target group');
        }

        // Cache user entity
        let userEntity;
        if (member.username) {
          try {
            userEntity = await client.getEntity(member.username);
          } catch (error) {
            console.error('Failed to get entity by username:', error);
          }
        }

        if (!userEntity && member.access_hash) {
          try {
            const inputUser = new Api.InputUser({
              userId: member.user_id as any,
              accessHash: member.access_hash as any
            });
            const result = await client.invoke(new Api.users.GetUsers({ id: [inputUser] }));
            userEntity = result[0];
          } catch (error) {
            console.error('Failed to get entity by access_hash:', error);
          }
        }

        if (!userEntity) {
          throw new Error('Cannot resolve user entity');
        }

        // Pre-check if already member
        try {
          await client.invoke(
            new Api.channels.GetParticipant({
              channel: targetEntity,
              participant: userEntity
            })
          );

          // Already member
          await supabase
            .from('scraped_members')
            .update({
              status: 'success',
              processed_by_account_id: account.id,
              processed_at: new Date().toISOString(),
              error_reason: 'Already member'
            })
            .eq('id', member.id);

          successCount++;
          processedCount++;
          currentAccountIndex++;
          await client.disconnect();
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

          // Success
          await supabase
            .from('scraped_members')
            .update({
              status: 'success',
              processed_by_account_id: account.id,
              processed_at: new Date().toISOString()
            })
            .eq('id', member.id);

          // Update daily limit
          await supabase.rpc('increment', {
            table_name: 'account_daily_limits',
            account_id: account.id
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
          await supabase
            .from('member_scraping_logs')
            .insert({
              account_id: account.id,
              status: 'success',
              details: {
                user_id: member.user_id,
                username: member.username,
                action: 'invite'
              }
            });

          successCount++;
          console.log(`Successfully invited user ${member.user_id}`);

        } catch (error: any) {
          console.error('Invite error:', error.errorMessage || error.message);

          if (error.errorMessage === 'FLOOD_WAIT') {
            const seconds = error.seconds || 300;
            const waitUntil = new Date(Date.now() + seconds * 1000);

            await supabase
              .from('session_accounts')
              .update({ flood_wait_until: waitUntil.toISOString() })
              .eq('id', sessionAccount.id);

            await supabase
              .from('scraped_members')
              .update({ status: 'queued' }) // Put back in queue
              .eq('id', member.id);

            currentAccountIndex++;
            await client.disconnect();
            continue;
          }

          // Other errors
          await supabase
            .from('scraped_members')
            .update({
              status: 'failed',
              processed_by_account_id: account.id,
              processed_at: new Date().toISOString(),
              error_reason: error.errorMessage || error.message,
              retry_count: member.retry_count + 1
            })
            .eq('id', member.id);

          await supabase
            .from('member_scraping_logs')
            .insert({
              account_id: account.id,
              status: 'error',
              error_message: error.errorMessage || error.message,
              details: {
                user_id: member.user_id,
                username: member.username
              }
            });

          failedCount++;
        }

        await client.disconnect();
        processedCount++;
        currentAccountIndex++;

        // Delay between invites
        await new Promise(resolve => setTimeout(resolve, inviteDelay * 1000));

      } catch (error: any) {
        console.error('Processing error:', error);
        
        await supabase
          .from('scraped_members')
          .update({
            status: 'failed',
            error_reason: error.message,
            retry_count: member.retry_count + 1
          })
          .eq('id', member.id);

        failedCount++;
        processedCount++;
        currentAccountIndex++;
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
    console.error('Error in process-member-invites:', error);
    
    return new Response(
      JSON.stringify({ success: false, error: error?.message || 'Unknown error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
