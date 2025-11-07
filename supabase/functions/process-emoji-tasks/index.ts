import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.75.0";
import { TelegramClient } from "npm:telegram@2.26.22";
import { StringSession } from "npm:telegram@2.26.22/sessions";
import { Api } from "npm:telegram@2.26.22";

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const TELEGRAM_BOT_TOKEN = Deno.env.get('TELEGRAM_BOT_TOKEN')!;

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const POSITIVE_EMOJIS = ['👍', '❤️', '🔥', '👏', '🎉', '💯'];
const NEGATIVE_EMOJIS = ['👎', '💔', '😢', '😡', '🤮'];

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // Get next queued task
    const { data: task } = await supabase
      .from('emoji_tasks')
      .select('*')
      .eq('status', 'queued')
      .order('queue_number', { ascending: true })
      .limit(1)
      .single();

    if (!task) {
      return new Response(JSON.stringify({ message: 'No tasks in queue' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    console.log('Processing task:', task.id);

    // Update task status to processing
    await supabase
      .from('emoji_tasks')
      .update({ status: 'processing', started_at: new Date().toISOString() })
      .eq('id', task.id);

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

    // Get active accounts
    const { data: accounts } = await supabase
      .from('telegram_accounts')
      .select(`
        *,
        telegram_api_credentials (api_id, api_hash)
      `)
      .eq('is_active', true)
      .limit(task.requested_count);

    if (!accounts || accounts.length === 0) {
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

    // Get emojis based on task type
    const emojis = getEmojis(task.task_type, task.custom_emojis);

    let successCount = 0;
    let failedCount = 0;

    // Process each account
    for (const account of accounts) {
      try {
        console.log(`Processing account: ${account.phone_number}`);
        
        const client = new TelegramClient(
          new StringSession(account.session_string),
          parseInt(account.telegram_api_credentials.api_id),
          account.telegram_api_credentials.api_hash,
          {
            connectionRetries: 5,
            useWSS: true,
            timeout: 30000,
          }
        );

        await client.connect();

        // Get group entity
        const groupEntity = await client.getEntity(groupId);

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

        await client.disconnect();
        successCount++;

        // Rate limiting: 2-3 seconds between accounts
        await new Promise(resolve => setTimeout(resolve, 2500));

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

        failedCount++;
      }
    }

    // Update task as completed
    await supabase
      .from('emoji_tasks')
      .update({
        status: 'completed',
        total_success: successCount,
        total_failed: failedCount,
        completed_at: new Date().toISOString(),
      })
      .eq('id', task.id);

    // Notify user
    const message = `✅ Görev #${task.queue_number} tamamlandı!\n\n` +
      `📊 Başarılı: ${successCount}\n` +
      `❌ Başarısız: ${failedCount}\n` +
      `📝 Toplam: ${successCount + failedCount}`;
    
    await notifyUser(task.chat_id, message);

    return new Response(JSON.stringify({
      success: true,
      task_id: task.id,
      total_success: successCount,
      total_failed: failedCount,
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

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
