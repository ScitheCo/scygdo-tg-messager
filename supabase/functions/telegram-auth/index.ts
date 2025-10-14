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
    const { action, phone_number, api_credential_id, phone_code_hash, code } = await req.json()

    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    )

    // Get API credentials
    const { data: apiCred, error: apiError } = await supabaseClient
      .from('telegram_api_credentials')
      .select('*')
      .eq('id', api_credential_id)
      .single()

    if (apiError || !apiCred) throw (apiError ?? new Error('API credentials not found'))

    const apiId = Number(apiCred.api_id)
    const apiHash = String(apiCred.api_hash)

    if (Number.isNaN(apiId) || !apiHash) throw new Error('Invalid API credentials')

    if (action === 'send_code') {
      const tg = new TelegramClient({ apiId, apiHash, storage: `acc-${phone_number}` })

      // Request code from Telegram
      // requestCode returns an object containing phoneCodeHash
      // Reference: https://mtcute.dev
      // deno-lint-ignore no-explicit-any
      const codeInfo: any = await (tg as any).requestCode({ phone: phone_number })

      console.log('Sent code to:', phone_number)

      return new Response(
        JSON.stringify({ 
          phone_code_hash: codeInfo?.phoneCodeHash,
          message: 'Kod Telegram üzerinden gönderildi' 
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    if (action === 'verify_code') {
      const tg = new TelegramClient({ apiId, apiHash, storage: `acc-${phone_number}` })

      // deno-lint-ignore no-explicit-any
      const me: any = await (tg as any).signIn({
        phone: phone_number,
        phoneCodeHash: phone_code_hash,
        phoneCode: code
      })

      // Try exporting session
      // deno-lint-ignore no-explicit-any
      const session: any = await (tg as any).exportSession?.()

      return new Response(
        JSON.stringify({ 
          session_string: session ?? null,
          user: me ?? null,
          message: 'Doğrulama başarılı' 
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
