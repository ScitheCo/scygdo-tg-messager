import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.75.0";

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    const { worker_id } = await req.json();

    if (!worker_id) {
      return new Response(
        JSON.stringify({ error: 'worker_id is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log(`Worker ${worker_id} requesting task...`);

    // Check if worker is online
    const { data: heartbeat } = await supabase
      .from('worker_heartbeats')
      .select('*')
      .eq('worker_id', worker_id)
      .eq('status', 'online')
      .gte('last_seen', new Date(Date.now() - 60000).toISOString()) // Last minute
      .single();

    if (!heartbeat) {
      return new Response(
        JSON.stringify({ error: 'Worker not online or heartbeat expired' }),
        { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // First, check for stuck tasks assigned to this worker (recovery mechanism)
    const { data: stuckTask } = await supabase
      .from('emoji_tasks')
      .select('*')
      .eq('status', 'processing')
      .eq('assigned_worker_id', worker_id)
      .eq('processing_mode', 'desktop_worker')
      .lt('started_at', new Date(Date.now() - 600000).toISOString()) // Stuck for >10 min
      .order('started_at', { ascending: true })
      .limit(1)
      .single();

    if (stuckTask) {
      console.log(`Recovering stuck task ${stuckTask.id} for worker ${worker_id}`);
      
      // Get accounts and processed logs for stuck task
      const { data: accounts } = await supabase
        .from('telegram_accounts')
        .select(`
          *,
          telegram_api_credentials (api_id, api_hash)
        `)
        .eq('is_active', true);

      const { data: processedLogs } = await supabase
        .from('emoji_task_logs')
        .select('account_id')
        .eq('task_id', stuckTask.id)
        .eq('status', 'success');

      const processedAccountIds = processedLogs?.map(log => log.account_id) || [];

      return new Response(
        JSON.stringify({
          task: {
            ...stuckTask,
            accounts: accounts || [],
            processed_account_ids: processedAccountIds
          }
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Get next queued task
    const { data: task, error: taskError } = await supabase
      .from('emoji_tasks')
      .select('*')
      .eq('status', 'queued')
      .eq('processing_mode', 'desktop_worker')
      .is('assigned_worker_id', null)
      .order('queue_number', { ascending: true })
      .limit(1)
      .single();

    if (taskError || !task) {
      console.log('No tasks available');
      return new Response(
        JSON.stringify({ task: null }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Claim task
    const { error: claimError } = await supabase
      .from('emoji_tasks')
      .update({
        status: 'processing',
        assigned_worker_id: worker_id,
        started_at: new Date().toISOString()
      })
      .eq('id', task.id)
      .eq('status', 'queued'); // Optimistic locking

    if (claimError) {
      console.log('Failed to claim task:', claimError);
      return new Response(
        JSON.stringify({ error: 'Task already claimed by another worker' }),
        { status: 409, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Get active accounts with credentials
    const { data: accounts } = await supabase
      .from('telegram_accounts')
      .select(`
        *,
        telegram_api_credentials (api_id, api_hash)
      `)
      .eq('is_active', true);

    // Get already processed account IDs
    const { data: processedLogs } = await supabase
      .from('emoji_task_logs')
      .select('account_id')
      .eq('task_id', task.id)
      .eq('status', 'success');

    const processedAccountIds = processedLogs?.map(log => log.account_id) || [];

    console.log(`Task ${task.id} claimed by worker ${worker_id}`);

    return new Response(
      JSON.stringify({
        task: {
          ...task,
          accounts: accounts || [],
          processed_account_ids: processedAccountIds
        }
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Error:', error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : String(error) }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});