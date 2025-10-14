import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

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

    // Telegram Auth Service URL - kullanıcı kendi servisini buraya ekleyecek
    const TELEGRAM_AUTH_SERVICE = Deno.env.get('TELEGRAM_AUTH_SERVICE_URL')
    
    if (!TELEGRAM_AUTH_SERVICE) {
      throw new Error('TELEGRAM_AUTH_SERVICE_URL environment variable is not set')
    }

    if (action === 'send_code') {
      // Harici servise kod gönderme isteği yap
      const response = await fetch(`${TELEGRAM_AUTH_SERVICE}/send-code`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          phone: phone_number,
          api_id,
          api_hash
        })
      })

      if (!response.ok) {
        const errorData = await response.json()
        throw new Error(errorData.error || 'Failed to send code')
      }

      const data = await response.json()

      return new Response(
        JSON.stringify({ 
          success: true,
          phone_code_hash: data.phone_code_hash
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    if (action === 'verify_code') {
      // Harici servise kod doğrulama isteği yap
      const response = await fetch(`${TELEGRAM_AUTH_SERVICE}/verify-code`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          phone: phone_number,
          phone_code_hash,
          code,
          api_id,
          api_hash
        })
      })

      if (!response.ok) {
        const errorData = await response.json()
        throw new Error(errorData.error || 'Failed to verify code')
      }

      const data = await response.json()

      // Update account with session string and activate it
      const { error: updateError } = await supabaseClient
        .from('telegram_accounts')
        .update({
          session_string: data.session_string,
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
    console.error('Telegram auth error:', error)
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
