import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.75.0';
import { TelegramClient } from 'npm:telegram@2.26.22';
import { StringSession } from 'npm:telegram@2.26.22/sessions/index.js';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? '',
      { global: { headers: { Authorization: req.headers.get('Authorization')! } } }
    );

    const { data: { user }, error: userError } = await supabaseClient.auth.getUser();
    if (userError || !user) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    const { group_input, account_id } = await req.json();

    if (!group_input || !account_id) {
      return new Response(JSON.stringify({ error: 'group_input ve account_id gereklidir' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    console.log(`Validating group: ${group_input} with account: ${account_id}`);

    // Get account credentials
    const { data: account, error: accountError } = await supabaseClient
      .from('telegram_accounts')
      .select('session_string, api_credential_id, telegram_api_credentials(api_id, api_hash)')
      .eq('id', account_id)
      .single();

    if (accountError || !account) {
      console.error('Account fetch error:', accountError);
      return new Response(JSON.stringify({ error: 'Hesap bulunamadı' }), {
        status: 404,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    if (!account.session_string) {
      return new Response(JSON.stringify({ error: 'Hesap oturum bilgisi bulunamadı' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    const apiCreds = account.telegram_api_credentials as any;
    if (!apiCreds) {
      return new Response(JSON.stringify({ error: 'API bilgileri bulunamadı' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    // Connect to Telegram
    const client = new TelegramClient(
      new StringSession(account.session_string),
      parseInt(apiCreds.api_id),
      apiCreds.api_hash,
      { connectionRetries: 5 }
    );

    await client.connect();
    console.log('Connected to Telegram');

    try {
      let entity: any;
      
      // Check if input is numeric ID
      if (/^-?\d+$/.test(group_input.trim())) {
        console.log('Input is numeric ID:', group_input);
        entity = await client.getEntity(parseInt(group_input));
      } else {
        // Username or invite link
        console.log('Input is username or link:', group_input);
        entity = await client.getEntity(group_input);
      }
      
      const result = {
        valid: true,
        telegram_id: entity.id.toString(),
        title: entity.title || entity.firstName || 'Unknown',
        username: entity.username || null,
        is_channel: entity.className === 'Channel',
        access_hash: entity.accessHash?.toString() || null
      };

      console.log('Group validated:', result);

      await client.disconnect();

      return new Response(JSON.stringify(result), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });

    } catch (error: any) {
      console.error('Telegram error:', error);
      await client.disconnect();

      return new Response(JSON.stringify({
        valid: false,
        error: error.message || 'Grup bulunamadı veya erişim yok'
      }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

  } catch (error: any) {
    console.error('Error in validate-telegram-group:', error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
});
