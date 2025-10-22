import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.7.1';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    const { session_id, scanner_account_id, filters } = await req.json();
    
    console.log('Marking session for scraping:', { session_id, scanner_account_id });

    // Simply update session to 'pending_scrape' status
    // The worker will pick this up and do the actual scraping
    const { error: updateError } = await supabaseClient
      .from('scraping_sessions')
      .update({
        status: 'pending_scrape',
        settings: {
          scanner_account_id,
          ...filters
        }
      })
      .eq('id', session_id);
    
    if (updateError) {
      console.error('Error updating session:', updateError);
      throw updateError;
    }
    
    return new Response(
      JSON.stringify({ 
        success: true,
        message: 'Session queued for scraping. Worker will process it.'
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error: any) {
    console.error('Error in scrape-source-members:', error);
    
    return new Response(
      JSON.stringify({ success: false, error: error?.message || 'Unknown error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
