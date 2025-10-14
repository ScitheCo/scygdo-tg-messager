import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { TelegramClient } from 'jsr:@mtcute/deno'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders })
  }

  try {
    const { action, account_id, phone_number, api_id, api_hash, phone_code_hash, code } = await req.json()

    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    )

    if (action === 'send_code') {
      // Import telegram library from esm.sh
      const telegram = await import('https://esm.sh/telegram@2.22.2')
      const TelegramClient = telegram.TelegramClient
      const { StringSession } = await import('https://esm.sh/telegram@2.22.2/sessions')
      const { Api } = await import('https://esm.sh/telegram@2.22.2')
      
      const client = new TelegramClient(
        new StringSession(),
        parseInt(api_id),
        api_hash,
        { connectionRetries: 5 }
      )

      await client.connect()
      
      const result: any = await client.invoke(
        new Api.auth.SendCode({
          phoneNumber: phone_number,
          apiId: parseInt(api_id),
          apiHash: api_hash,
          settings: new Api.CodeSettings({})
        })
      )

      await client.disconnect()

      return new Response(
        JSON.stringify({ 
          success: true,
          phone_code_hash: result.phoneCodeHash
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    if (action === 'verify_code') {
      const telegram = await import('https://esm.sh/telegram@2.22.2')
      const TelegramClient = telegram.TelegramClient
      const { StringSession } = await import('https://esm.sh/telegram@2.22.2/sessions')
      const { Api } = await import('https://esm.sh/telegram@2.22.2')
      
      const client = new TelegramClient(
        new StringSession(),
        parseInt(api_id),
        api_hash,
        { connectionRetries: 5 }
      )

      await client.connect()
      
      const result: any = await client.invoke(
        new Api.auth.SignIn({
          phoneNumber: phone_number,
          phoneCodeHash: phone_code_hash,
          phoneCode: code
        })
      )

      const sessionString = String(client.session.save())
      await client.disconnect()

      // Update account with session string and activate it
      const { error: updateError } = await supabaseClient
        .from('telegram_accounts')
        .update({
          session_string: sessionString,
          is_active: true
        })
        .eq('id', account_id)

      if (updateError) throw updateError

      return new Response(
        JSON.stringify({ 
          success: true,
          message: 'Hesap başarıyla aktif edildi' 
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    throw new Error('Invalid action')

  } catch (error) {
    console.error('Error:', error)
    const errorMessage = error instanceof Error ? error.message : 'Unknown error'
    return new Response(
      JSON.stringify({ error: errorMessage }),
      { 
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      }
    )
  }
})
