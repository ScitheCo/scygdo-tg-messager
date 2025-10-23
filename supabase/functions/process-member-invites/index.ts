import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.75.0";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    const { session_id } = await req.json();

    console.log('📊 Checking session status:', session_id);

    // Get session with current stats
    const { data: session } = await supabase
      .from('scraping_sessions')
      .select('*')
      .eq('id', session_id)
      .single();

    if (!session) {
      return new Response(
        JSON.stringify({ 
          success: false, 
          error: 'Session not found' 
        }),
        { 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          status: 404
        }
      );
    }

    // This edge function now only returns session status
    // Actual invite processing is handled by external Node.js worker
    console.log('Session status:', session.status);
    console.log('Progress:', session.total_processed, '/', session.total_in_queue);

    return new Response(
      JSON.stringify({
        success: true,
        mode: 'external_worker',
        session_status: session.status,
        total_processed: session.total_processed,
        total_success: session.total_success,
        total_failed: session.total_failed,
        total_in_queue: session.total_in_queue,
        message: 'Invites are being processed by external worker'
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error: any) {
    console.error('Error:', error);
    return new Response(
      JSON.stringify({ 
        success: false, 
        error: error.message 
      }),
      { 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 500
      }
    );
  }
});
