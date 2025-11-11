import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.75.0";

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const TELEGRAM_BOT_TOKEN = Deno.env.get('TELEGRAM_BOT_TOKEN')!;

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface TelegramUpdate {
  message?: {
    message_id: number;
    from: {
      id: number;
      username?: string;
      first_name: string;
    };
    chat: {
      id: number;
    };
    text?: string;
  };
  callback_query?: {
    id: string;
    from: {
      id: number;
      username?: string;
    };
    message: {
      chat: {
        id: number;
      };
    };
    data: string;
  };
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    const update: TelegramUpdate = await req.json();
    
    console.log('Received update:', JSON.stringify(update));

    // Handle callback query (inline keyboard button clicks)
    if (update.callback_query) {
      await handleCallbackQuery(supabase, update.callback_query);
      return new Response(JSON.stringify({ ok: true }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Handle text messages
    if (update.message?.text) {
      await handleMessage(supabase, update.message);
    }

    return new Response(JSON.stringify({ ok: true }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('Error:', error);
    return new Response(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});

async function handleMessage(supabase: any, message: any) {
  const userId = message.from.id;
  const chatId = message.chat.id;
  const text = message.text;
  const username = message.from.username || message.from.first_name;

  // Check if user is authorized
  const { data: authorized } = await supabase
    .from('authorized_bot_users')
    .select('*')
    .eq('telegram_username', username)
    .eq('is_active', true)
    .single();

  if (!authorized && text !== '/start') {
    await sendMessage(chatId, '⛔ Yetkiniz yok. Lütfen panel yöneticisine başvurun.');
    return;
  }

  if (text === '/start') {
    if (!authorized) {
      await sendMessage(chatId, '⛔ Yetkiniz yok. Lütfen panel yöneticisine başvurun.');
      return;
    }
    
    // Reset conversation state
    await supabase
      .from('bot_conversation_states')
      .upsert({
        telegram_user_id: userId,
        chat_id: chatId,
        current_step: 'group_link',
      }, { onConflict: 'telegram_user_id' });
    
    await sendMessage(chatId, '👋 Merhaba! Hedef grup linkini gönderin.');
    return;
  }

  // Get conversation state
  const { data: state } = await supabase
    .from('bot_conversation_states')
    .select('*')
    .eq('telegram_user_id', userId)
    .single();

  if (!state) {
    await sendMessage(chatId, 'Lütfen /start komutu ile başlayın.');
    return;
  }

  // Handle conversation flow
  await handleConversationStep(supabase, state, message);
}

async function handleConversationStep(supabase: any, state: any, message: any) {
  const userId = message.from.id;
  const chatId = message.chat.id;
  const text = message.text;

  switch (state.current_step) {
    case 'group_link':
      // Save group link and ask for post link
      await supabase
        .from('bot_conversation_states')
        .update({
          group_link: text,
          current_step: 'post_link',
          updated_at: new Date().toISOString(),
        })
        .eq('telegram_user_id', userId);
      
      await sendMessage(chatId, '📨 Gönderi linkini gönderin.');
      break;

    case 'post_link':
      // Save post link and show preset options
      await supabase
        .from('bot_conversation_states')
        .update({
          post_link: text,
          current_step: 'preset',
          updated_at: new Date().toISOString(),
        })
        .eq('telegram_user_id', userId);
      
      await sendMessageWithKeyboard(chatId, 'Lütfen bir seçenek seçin:', [
        [{ text: '📈 Pozitif Emojiler + Görüntüleme', callback_data: 'positive_emoji' }],
        [{ text: '📉 Negatif Emojiler + Görüntüleme', callback_data: 'negative_emoji' }],
        [{ text: '👁️ Sadece Görüntüleme', callback_data: 'view_only' }],
        [{ text: '🎨 Özel Emoji Seçimi + Görüntüleme', callback_data: 'custom_emoji' }],
      ]);
      break;

    case 'custom_emojis':
      // Parse custom emojis
      const emojis = text.split(',').map((e: string) => e.trim()).filter((e: string) => e);
      
      if (emojis.length === 0) {
        await sendMessage(chatId, '❌ Lütfen en az bir emoji girin. Örnek: 👍,❤️,🔥');
        return;
      }

      await supabase
        .from('bot_conversation_states')
        .update({
          custom_emojis: emojis,
          current_step: 'count',
          updated_at: new Date().toISOString(),
        })
        .eq('telegram_user_id', userId);
      
      // Get active account count
      const { count } = await supabase
        .from('telegram_accounts')
        .select('*', { count: 'exact', head: true })
        .eq('is_active', true);
      
      await sendMessage(chatId, `Kaç hesap kullanılsın? (Mevcut aktif hesap: ${count || 0})`);
      break;

    case 'count':
      const requestedCount = parseInt(text);
      
      if (isNaN(requestedCount) || requestedCount <= 0) {
        await sendMessage(chatId, '❌ Lütfen geçerli bir sayı girin.');
        return;
      }

      // Get active account count
      const { count: availableCount } = await supabase
        .from('telegram_accounts')
        .select('*', { count: 'exact', head: true })
        .eq('is_active', true);

      if (requestedCount > availableCount) {
        await sendMessage(chatId, `❌ İstenen hesap sayısı (${requestedCount}), mevcut aktif hesap sayısından (${availableCount}) fazla olamaz.`);
        return;
      }

      // Get updated state with all data
      const { data: finalState } = await supabase
        .from('bot_conversation_states')
        .select('*')
        .eq('telegram_user_id', userId)
        .single();

      // Check if any desktop workers are online
      const { data: onlineWorkers } = await supabase
        .from('worker_heartbeats')
        .select('worker_id')
        .eq('worker_type', 'desktop')
        .eq('status', 'online')
        .gte('last_seen', new Date(Date.now() - 60000).toISOString()); // Last minute

      const processingMode = onlineWorkers && onlineWorkers.length > 0 
        ? 'desktop_worker' 
        : 'edge_function';

      console.log(`Processing mode: ${processingMode} (${onlineWorkers?.length || 0} online workers)`);

      // Get next queue number
      const { data: lastTask } = await supabase
        .from('emoji_tasks')
        .select('queue_number')
        .order('queue_number', { ascending: false })
        .limit(1)
        .single();

      const queueNumber = (lastTask?.queue_number || 0) + 1;

      // Create task
      const { error: taskError } = await supabase
        .from('emoji_tasks')
        .insert({
          telegram_user_id: userId,
          telegram_username: message.from.username || message.from.first_name,
          chat_id: chatId,
          group_link: finalState.group_link,
          post_link: finalState.post_link,
          task_type: finalState.task_type,
          custom_emojis: finalState.custom_emojis,
          requested_count: requestedCount,
          available_count: availableCount,
          queue_number: queueNumber,
          status: 'queued',
          processing_mode: processingMode,
        });

      if (taskError) {
        console.error('Task creation error:', taskError);
        await sendMessage(chatId, '❌ Görev oluşturulurken hata oluştu.');
        return;
      }

      // Reset state
      await supabase
        .from('bot_conversation_states')
        .update({
          current_step: 'idle',
          updated_at: new Date().toISOString(),
        })
        .eq('telegram_user_id', userId);

      await sendMessage(chatId, `✅ Göreviniz kuyruğa eklendi!\n🔢 Sıra numaranız: #${queueNumber}\n\nİşlem tamamlandığında bildirim alacaksınız.`);
      
      // Trigger worker with retry
      try {
        await supabase.functions.invoke('process-emoji-tasks');
        console.log('Worker triggered successfully');
      } catch (error) {
        console.error('Failed to trigger worker, retrying in 2s:', error);
        // Retry after 2 seconds
        setTimeout(async () => {
          try {
            await supabase.functions.invoke('process-emoji-tasks');
            console.log('Worker triggered on retry');
          } catch (retryError) {
            console.error('Failed to trigger worker on retry:', retryError);
          }
        }, 2000);
      }
      break;
  }
}

async function handleCallbackQuery(supabase: any, callbackQuery: any) {
  const userId = callbackQuery.from.id;
  const chatId = callbackQuery.message.chat.id;
  const data = callbackQuery.data;

  // Answer callback query to remove loading state
  await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/answerCallbackQuery`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ callback_query_id: callbackQuery.id }),
  });

  if (data === 'custom_emoji') {
    // Ask for custom emojis
    await supabase
      .from('bot_conversation_states')
      .update({
        task_type: data,
        current_step: 'custom_emojis',
        updated_at: new Date().toISOString(),
      })
      .eq('telegram_user_id', userId);
    
    await sendMessage(chatId, '🎨 Hangi emojileri kullanmak istersiniz?\n\nVirgülle ayırarak gönderin. Örnek: 👍,❤️,🔥');
  } else {
    // Save task type and ask for count
    await supabase
      .from('bot_conversation_states')
      .update({
        task_type: data,
        current_step: 'count',
        updated_at: new Date().toISOString(),
      })
      .eq('telegram_user_id', userId);
    
    // Get active account count
    const { count } = await supabase
      .from('telegram_accounts')
      .select('*', { count: 'exact', head: true })
      .eq('is_active', true);
    
    await sendMessage(chatId, `Kaç hesap kullanılsın? (Mevcut aktif hesap: ${count || 0})`);
  }
}

async function sendMessage(chatId: number, text: string) {
  await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text }),
  });
}

async function sendMessageWithKeyboard(chatId: number, text: string, keyboard: any[]) {
  await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: chatId,
      text,
      reply_markup: { inline_keyboard: keyboard },
    }),
  });
}
