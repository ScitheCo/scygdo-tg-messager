import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.75.0";
import { TelegramClient, sessions, Api } from "npm:telegram@2.26.22";
const { StringSession } = sessions;

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const TELEGRAM_BOT_TOKEN = Deno.env.get('TELEGRAM_BOT_TOKEN')!;

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const POSITIVE_EMOJIS = ['👍', '❤️', '🔥', '👏', '🎉', '💯'];
const NEGATIVE_EMOJIS = ['👎', '💔', '😢', '😡', '🤮'];

async function ensureGroupMembership(
  client: TelegramClient, 
  groupEntity: any, 
  accountPhone: string,
  supabase: any,
  taskId: string,
  accountId: string
): Promise<{ joined: boolean; alreadyMember: boolean }> {
  try {
    // Check if account is already a member
    await client.invoke(new Api.channels.GetParticipant({
      channel: groupEntity,
      participant: 'me',
    }));
    
    console.log(`Account ${accountPhone}: Already a member`);
    return { joined: false, alreadyMember: true };
    
  } catch (error: any) {
    // USER_NOT_PARTICIPANT error = not a member, try to join
    if (error.message?.includes('USER_NOT_PARTICIPANT')) {
      try {
        console.log(`Account ${accountPhone}: Not a member, attempting to join...`);
        
        // Try to join the group/channel
        await client.invoke(new Api.channels.JoinChannel({
          channel: groupEntity,
        }));
        
        console.log(`Account ${accountPhone}: Successfully joined the group`);
        
        // Log the join action
        await supabase
          .from('emoji_task_logs')
          .insert({
            task_id: taskId,
            account_id: accountId,
            action_type: 'group_join',
            status: 'success',
          });
        
        // Wait 2 seconds after joining (Telegram rate limit)
        await new Promise(resolve => setTimeout(resolve, 2000));
        
        return { joined: true, alreadyMember: false };
        
      } catch (joinError: any) {
        const errorMsg = joinError.message || String(joinError);
        console.error(`Account ${accountPhone}: Failed to join group:`, errorMsg);
        
        // Log the failed join attempt
        await supabase
          .from('emoji_task_logs')
          .insert({
            task_id: taskId,
            account_id: accountId,
            action_type: 'group_join',
            status: 'failed',
            error_message: errorMsg,
          });
        
        throw new Error(`Gruba katılamadı: ${errorMsg}`);
      }
    }
    
    // Other errors
    throw error;
  }
}

const BATCH_SIZE = 8; // Process 8 accounts at a time

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // Get next queued OR processing task (to continue batch processing)
    const { data: task } = await supabase
      .from('emoji_tasks')
      .select('*')
      .in('status', ['queued', 'processing'])
      .order('queue_number', { ascending: true })
      .limit(1)
      .single();

    if (!task) {
      console.log('No tasks in queue');
      return new Response(JSON.stringify({ message: 'No tasks in queue' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    console.log('Processing task:', task.id, 'Status:', task.status);

    // Update task status to processing if it's queued
    if (task.status === 'queued') {
      await supabase
        .from('emoji_tasks')
        .update({ status: 'processing', started_at: new Date().toISOString() })
        .eq('id', task.id);
    }

    // Parse group and message IDs from links
    const { groupId, messageId } = parseLinks(task.group_link, task.post_link);
    
    if (!groupId || !messageId) {
      await supabase
        .from('emoji_tasks')
        .update({
          status: 'failed',
          error_message: 'Invalid group or message link format',
          completed_at: new Date().toISOString(),
        })
        .eq('id', task.id);
      
      await notifyUser(task.chat_id, `❌ Görev #${task.queue_number} başarısız!\nHata: Geçersiz link formatı.`);
      return new Response(JSON.stringify({ error: 'Invalid links' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Update task with parsed IDs
    await supabase
      .from('emoji_tasks')
      .update({ group_id: groupId, message_id: messageId })
      .eq('id', task.id);

    // Get already processed account IDs from logs
    const { data: processedLogs } = await supabase
      .from('emoji_task_logs')
      .select('account_id')
      .eq('task_id', task.id)
      .in('action_type', ['view_message', 'emoji_reaction'])
      .eq('status', 'success');

    const processedAccountIds = new Set(processedLogs?.map(log => log.account_id) || []);
    console.log(`Already processed ${processedAccountIds.size} accounts for this task`);

    // Get active accounts NOT yet processed
    const { data: allAccounts } = await supabase
      .from('telegram_accounts')
      .select(`
        *,
        telegram_api_credentials (api_id, api_hash)
      `)
      .eq('is_active', true);

    if (!allAccounts || allAccounts.length === 0) {
      await supabase
        .from('emoji_tasks')
        .update({
          status: 'failed',
          error_message: 'No active accounts available',
          completed_at: new Date().toISOString(),
        })
        .eq('id', task.id);
      
      await notifyUser(task.chat_id, `❌ Görev #${task.queue_number} başarısız!\nHata: Aktif hesap bulunamadı.`);
      return new Response(JSON.stringify({ error: 'No accounts' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Filter out already processed accounts and take batch
    const remainingAccounts = allAccounts.filter(acc => !processedAccountIds.has(acc.id));
    const accountsToProcess = remainingAccounts.slice(0, BATCH_SIZE);

    console.log(`Processing batch of ${accountsToProcess.length} accounts (${remainingAccounts.length} remaining)`);

    if (accountsToProcess.length === 0) {
      // All accounts processed, mark as completed
      const { data: finalLogs } = await supabase
        .from('emoji_task_logs')
        .select('status')
        .eq('task_id', task.id)
        .in('action_type', ['view_message', 'emoji_reaction']);

      const successCount = finalLogs?.filter(log => log.status === 'success').length || 0;
      const failedCount = finalLogs?.filter(log => log.status === 'failed').length || 0;

      await supabase
        .from('emoji_tasks')
        .update({
          status: 'completed',
          total_success: successCount,
          total_failed: failedCount,
          completed_at: new Date().toISOString(),
        })
        .eq('id', task.id);

      await notifyUser(task.chat_id, `✅ Görev #${task.queue_number} tamamlandı!\n📊 Başarılı: ${successCount}\n❌ Başarısız: ${failedCount}`);
      
      return new Response(JSON.stringify({ message: 'Task completed', successCount, failedCount }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Log batch start
    await supabase
      .from('emoji_task_logs')
      .insert({
        task_id: task.id,
        account_id: accountsToProcess[0].id,
        action_type: 'batch_start',
        status: 'success',
        error_message: `Processing batch of ${accountsToProcess.length} accounts`,
      });

    // Get emojis based on task type
    const emojis = getEmojis(task.task_type, task.custom_emojis);

    let batchSuccessCount = 0;
    let batchFailedCount = 0;
    let joinedCount = 0;

    // Process each account in this batch
    for (const account of accountsToProcess) {
      let client: TelegramClient | null = null;
      
      try {
        console.log(`Processing account: ${account.phone_number}`);
        
        client = new TelegramClient(
          new StringSession(account.session_string),
          parseInt(account.telegram_api_credentials.api_id),
          account.telegram_api_credentials.api_hash,
          {
            connectionRetries: 3,
            useWSS: false, // Use TCP instead of WebSocket in edge functions
            timeout: 20000,
            floodSleepThreshold: 60,
          }
        );

        console.log(`Connecting account: ${account.phone_number}...`);
        await client.connect();
        console.log(`Connected: ${account.phone_number}`);

        // Get group entity
        const groupEntity = await client.getEntity(groupId);

        // Ensure account is a member of the group, join if not
        const membershipStatus = await ensureGroupMembership(
          client,
          groupEntity,
          account.phone_number,
          supabase,
          task.id,
          account.id
        );

        if (membershipStatus.joined) {
          joinedCount++;
        }

        // View message (increases view count)
        await client.invoke(new Api.messages.GetMessages({
          id: [new Api.InputMessageID({ id: messageId })],
        }));

        console.log(`Account ${account.phone_number}: Message viewed`);

        // Log view action
        await supabase
          .from('emoji_task_logs')
          .insert({
            task_id: task.id,
            account_id: account.id,
            action_type: 'view_message',
            status: 'success',
          });

        // Add emoji reaction if not view_only
        if (task.task_type !== 'view_only' && emojis.length > 0) {
          const randomEmoji = emojis[Math.floor(Math.random() * emojis.length)];
          
          await client.invoke(new Api.messages.SendReaction({
            peer: groupEntity,
            msgId: messageId,
            reaction: [new Api.ReactionEmoji({ emoticon: randomEmoji })],
          }));

          console.log(`Account ${account.phone_number}: Emoji ${randomEmoji} sent`);

          // Log emoji action
          await supabase
            .from('emoji_task_logs')
            .insert({
              task_id: task.id,
              account_id: account.id,
              action_type: 'emoji_reaction',
              emoji_used: randomEmoji,
              status: 'success',
            });
        }

        batchSuccessCount++;

      } catch (error) {
        console.error(`Error processing account ${account.phone_number}:`, error);
        
        // Log error
        await supabase
          .from('emoji_task_logs')
          .insert({
            task_id: task.id,
            account_id: account.id,
            action_type: task.task_type === 'view_only' ? 'view_message' : 'emoji_reaction',
            status: 'failed',
            error_message: error instanceof Error ? error.message : String(error),
          });

        batchFailedCount++;
      } finally {
        // Always disconnect client
        if (client) {
          try {
            await client.disconnect();
            console.log(`Disconnected: ${account.phone_number}`);
          } catch (e) {
            console.error(`Error disconnecting ${account.phone_number}:`, e);
          }
        }
        
        // Rate limiting: 2-3 seconds between accounts
        await new Promise(resolve => setTimeout(resolve, 2500));
      }
    }

    // Log batch end
    await supabase
      .from('emoji_task_logs')
      .insert({
        task_id: task.id,
        account_id: accountsToProcess[0].id,
        action_type: 'batch_end',
        status: 'success',
        error_message: `Batch complete: ${batchSuccessCount} success, ${batchFailedCount} failed`,
      });

    // Get total counts from logs
    const { data: allLogs } = await supabase
      .from('emoji_task_logs')
      .select('status')
      .eq('task_id', task.id)
      .in('action_type', ['view_message', 'emoji_reaction']);

    const totalSuccess = allLogs?.filter(log => log.status === 'success').length || 0;
    const totalFailed = allLogs?.filter(log => log.status === 'failed').length || 0;

    // Update current counts
    await supabase
      .from('emoji_tasks')
      .update({
        total_success: totalSuccess,
        total_failed: totalFailed,
      })
      .eq('id', task.id);

    // Check if we need to continue processing
    const totalProcessed = totalSuccess + totalFailed;
    const needMoreProcessing = totalProcessed < task.requested_count && remainingAccounts.length > accountsToProcess.length;

    if (needMoreProcessing) {
      console.log(`Task needs more processing: ${totalProcessed}/${task.requested_count} complete`);
      
      // Self-invoke for next batch
      try {
        await supabase.functions.invoke('process-emoji-tasks');
      } catch (error) {
        console.error('Failed to trigger next batch:', error);
      }

      return new Response(JSON.stringify({
        success: true,
        task_id: task.id,
        batch_success: batchSuccessCount,
        batch_failed: batchFailedCount,
        total_success: totalSuccess,
        total_failed: totalFailed,
        more_processing_needed: true,
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    } else {
      // Task complete
      await supabase
        .from('emoji_tasks')
        .update({
          status: 'completed',
          completed_at: new Date().toISOString(),
        })
        .eq('id', task.id);

      let message = `✅ Görev #${task.queue_number} tamamlandı!\n\n`;
      
      if (joinedCount > 0) {
        message += `👥 Gruba katılan: ${joinedCount}\n`;
      }
      
      message += `📊 Başarılı: ${totalSuccess}\n` +
        `❌ Başarısız: ${totalFailed}\n` +
        `📝 Toplam: ${totalSuccess + totalFailed}`;
      
      await notifyUser(task.chat_id, message);

      return new Response(JSON.stringify({
        success: true,
        task_id: task.id,
        total_success: totalSuccess,
        total_failed: totalFailed,
        completed: true,
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

  } catch (error) {
    console.error('Error processing task:', error);
    return new Response(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});

function parseLinks(groupLink: string, postLink: string): { groupId: any, messageId: number | null } {
  try {
    // Extract from links like: https://t.me/groupname/123 or https://t.me/c/1234567890/123
    const postMatch = postLink.match(/\/(?:c\/)?([^\/]+)\/(\d+)/);
    if (!postMatch) return { groupId: null, messageId: null };

    const messageId = parseInt(postMatch[2]);
    const groupIdentifier = postMatch[1];

    // If it's a channel ID (numeric), use it directly; otherwise use username
    const groupId = /^\d+$/.test(groupIdentifier) ? parseInt(groupIdentifier) : groupIdentifier;

    return { groupId, messageId };
  } catch {
    return { groupId: null, messageId: null };
  }
}

function getEmojis(taskType: string, customEmojis?: string[]): string[] {
  switch (taskType) {
    case 'positive_emoji':
      return POSITIVE_EMOJIS;
    case 'negative_emoji':
      return NEGATIVE_EMOJIS;
    case 'custom_emoji':
      return customEmojis || [];
    case 'view_only':
      return [];
    default:
      return [];
  }
}

async function notifyUser(chatId: number, text: string) {
  try {
    await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text }),
    });
  } catch (error) {
    console.error('Error sending notification:', error);
  }
}
