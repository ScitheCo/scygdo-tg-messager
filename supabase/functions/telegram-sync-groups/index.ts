import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";
import { TelegramClient } from "npm:telegram@2.26.22";
import { StringSession } from "npm:telegram@2.26.22/sessions/StringSession.js";
import { Api } from "npm:telegram@2.26.22/tl";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const { account_id } = await req.json();

    if (!account_id) {
      return new Response(
        JSON.stringify({ error: 'account_id gerekli' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Create Supabase client
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Get account details
    const { data: account, error: accountError } = await supabase
      .from('telegram_accounts')
      .select('*, telegram_api_credentials(*)')
      .eq('id', account_id)
      .single();

    if (accountError || !account) {
      return new Response(
        JSON.stringify({ error: 'Hesap bulunamadı' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (!account.session_string || !account.is_active) {
      return new Response(
        JSON.stringify({ error: 'Hesap aktif değil veya oturum bilgisi eksik' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const apiCredentials = account.telegram_api_credentials;
    if (!apiCredentials) {
      return new Response(
        JSON.stringify({ error: 'API kimlik bilgileri bulunamadı' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Create Telegram client with existing session
    const client = new TelegramClient(
      new StringSession(account.session_string),
      parseInt(apiCredentials.api_id),
      apiCredentials.api_hash,
      {
        connectionRetries: 5,
      }
    );

    await client.connect();

    // Check if session is still valid
    try {
      await client.getMe();
    } catch (error) {
      await client.disconnect();
      
      // Mark account as inactive
      await supabase
        .from('telegram_accounts')
        .update({ is_active: false })
        .eq('id', account_id);

      return new Response(
        JSON.stringify({ 
          error: 'Oturum geçersiz. Hesap pasif duruma getirildi.',
          session_expired: true 
        }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Get all dialogs (chats)
    const dialogs = await client.getDialogs({ limit: 100 });
    
    const groupsToInsert = [];
    
    for (const dialog of dialogs) {
      const entity = dialog.entity;
      
      if (!entity) continue;
      
      // Only process groups and channels
      if (entity.className === 'Channel' || entity.className === 'Chat') {
        const isChannel = entity.className === 'Channel' && (entity as any).broadcast === true;
        
        groupsToInsert.push({
          account_id: account_id,
          telegram_id: entity.id.toString(),
          title: (entity as any).title || 'Untitled',
          username: (entity as any).username || null,
          is_channel: isChannel,
        });
      }
    }

    await client.disconnect();

    if (groupsToInsert.length === 0) {
      return new Response(
        JSON.stringify({ 
          success: true,
          message: 'Grup veya kanal bulunamadı',
          count: 0 
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // First, delete existing groups for this account
    await supabase
      .from('telegram_groups')
      .delete()
      .eq('account_id', account_id);

    // Insert new groups
    const { error: insertError } = await supabase
      .from('telegram_groups')
      .insert(groupsToInsert);

    if (insertError) {
      console.error('Insert error:', insertError);
      return new Response(
        JSON.stringify({ error: 'Gruplar kaydedilirken hata oluştu: ' + insertError.message }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    return new Response(
      JSON.stringify({ 
        success: true,
        message: `${groupsToInsert.length} grup/kanal senkronize edildi`,
        count: groupsToInsert.length 
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Error:', error);
    const errorMessage = error instanceof Error ? error.message : 'Bilinmeyen hata';
    return new Response(
      JSON.stringify({ error: errorMessage }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
