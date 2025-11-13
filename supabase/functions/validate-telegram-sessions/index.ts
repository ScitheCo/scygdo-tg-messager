import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.75.0';
import { TelegramClient } from 'npm:telegram@2.26.22';
import { StringSession } from 'npm:telegram@2.26.22/sessions/index.js';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface SessionTestResult {
  account_id: string;
  phone_number: string;
  status: 'ok' | 'invalid_session' | 'rate_limited' | 'connection_timeout' | 'dc_migrate_required' | 'unknown_error';
  message?: string;
}

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

    const { account_ids, deactivate_invalid = false } = await req.json();

    console.log(`Testing sessions for user: ${user.id}, accounts: ${account_ids?.length || 'all'}`);

    // Get accounts to test
    let query = supabaseClient
      .from('telegram_accounts')
      .select('id, phone_number, session_string, is_active, api_credential_id, telegram_api_credentials(api_id, api_hash)')
      .eq('created_by', user.id)
      .not('session_string', 'is', null);

    if (account_ids && account_ids.length > 0) {
      query = query.in('id', account_ids);
    }

    const { data: accounts, error: accountsError } = await query;

    if (accountsError) {
      console.error('Accounts fetch error:', accountsError);
      return new Response(JSON.stringify({ error: 'Hesaplar getirilemedi' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    if (!accounts || accounts.length === 0) {
      return new Response(JSON.stringify({ 
        summary: { total: 0, ok: 0, invalid_session: 0, rate_limited: 0, connection_timeout: 0, dc_migrate_required: 0, unknown_error: 0 },
        results: [] 
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    const results: SessionTestResult[] = [];
    const invalidAccountIds: string[] = [];

    // Test each account
    for (const account of accounts) {
      console.log(`Testing account: ${account.phone_number}`);
      
      const apiCreds = account.telegram_api_credentials as any;
      if (!apiCreds || !apiCreds.api_id || !apiCreds.api_hash) {
        results.push({
          account_id: account.id,
          phone_number: account.phone_number,
          status: 'unknown_error',
          message: 'API bilgileri eksik'
        });
        continue;
      }

      let client: TelegramClient | null = null;

      try {
        client = new TelegramClient(
          new StringSession(account.session_string),
          parseInt(apiCreds.api_id),
          apiCreds.api_hash,
          { 
            connectionRetries: 2,
            timeout: 15000
          }
        );

        // Try to connect with timeout
        const connectPromise = client.connect();
        const timeoutPromise = new Promise((_, reject) => 
          setTimeout(() => reject(new Error('Connection timeout')), 20000)
        );

        await Promise.race([connectPromise, timeoutPromise]);
        
        // Try getMe
        await client.getMe();
        
        results.push({
          account_id: account.id,
          phone_number: account.phone_number,
          status: 'ok',
          message: 'Oturum geçerli ve aktif'
        });

        console.log(`✓ Account ${account.phone_number}: OK`);

      } catch (error: any) {
        console.error(`✗ Account ${account.phone_number} error:`, error);
        
        const errorMsg = error.message?.toLowerCase() || '';
        const errorCode = error.errorMessage?.toLowerCase() || '';

        if (
          errorMsg.includes('auth_key_unregistered') ||
          errorMsg.includes('session_revoked') ||
          errorMsg.includes('user_deactivated') ||
          errorMsg.includes('auth_key_duplicated') ||
          errorCode.includes('session_revoked') ||
          errorMsg.includes('invalid buffer')
        ) {
          results.push({
            account_id: account.id,
            phone_number: account.phone_number,
            status: 'invalid_session',
            message: 'Oturum geçersiz veya iptal edilmiş'
          });
          invalidAccountIds.push(account.id);
        } else if (
          errorMsg.includes('flood') ||
          errorMsg.includes('too many requests') ||
          errorCode.includes('flood_wait')
        ) {
          results.push({
            account_id: account.id,
            phone_number: account.phone_number,
            status: 'rate_limited',
            message: 'Rate limit (çok fazla istek)'
          });
        } else if (
          errorMsg.includes('timeout') ||
          errorMsg.includes('connection') ||
          errorMsg.includes('network')
        ) {
          results.push({
            account_id: account.id,
            phone_number: account.phone_number,
            status: 'connection_timeout',
            message: 'Bağlantı zaman aşımı'
          });
        } else if (
          errorMsg.includes('phone_migrate') ||
          errorMsg.includes('user_migrate') ||
          errorMsg.includes('network_migrate')
        ) {
          results.push({
            account_id: account.id,
            phone_number: account.phone_number,
            status: 'dc_migrate_required',
            message: 'DC migrasyonu gerekli'
          });
        } else {
          results.push({
            account_id: account.id,
            phone_number: account.phone_number,
            status: 'unknown_error',
            message: error.message || 'Bilinmeyen hata'
          });
        }
      } finally {
        if (client) {
          try {
            await client.disconnect();
          } catch (e) {
            console.error('Disconnect error:', e);
          }
        }
      }
    }

    // Deactivate invalid sessions if requested
    if (deactivate_invalid && invalidAccountIds.length > 0) {
      console.log(`Deactivating ${invalidAccountIds.length} invalid accounts`);
      
      const { error: updateError } = await supabaseClient
        .from('telegram_accounts')
        .update({ is_active: false, updated_at: new Date().toISOString() })
        .in('id', invalidAccountIds);

      if (updateError) {
        console.error('Failed to deactivate accounts:', updateError);
      }
    }

    // Calculate summary
    const summary = {
      total: results.length,
      ok: results.filter(r => r.status === 'ok').length,
      invalid_session: results.filter(r => r.status === 'invalid_session').length,
      rate_limited: results.filter(r => r.status === 'rate_limited').length,
      connection_timeout: results.filter(r => r.status === 'connection_timeout').length,
      dc_migrate_required: results.filter(r => r.status === 'dc_migrate_required').length,
      unknown_error: results.filter(r => r.status === 'unknown_error').length,
    };

    console.log('Test summary:', summary);

    return new Response(JSON.stringify({ summary, results }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });

  } catch (error: any) {
    console.error('Error in validate-telegram-sessions:', error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
});
