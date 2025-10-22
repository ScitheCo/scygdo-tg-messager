import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.75.0";
import { TelegramClient } from "npm:telegram@2.26.22";
import { StringSession } from "npm:telegram@2.26.22/sessions";
import { Api } from "npm:telegram@2.26.22";

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

    const { session_id, scanner_account_id, filters } = await req.json();

    console.log('Starting member scraping for session:', session_id);

    // Update session status
    await supabase
      .from('scraping_sessions')
      .update({ status: 'fetching_members', updated_at: new Date().toISOString() })
      .eq('id', session_id);

    // Get session details
    const { data: session, error: sessionError } = await supabase
      .from('scraping_sessions')
      .select('*')
      .eq('id', session_id)
      .single();

    if (sessionError || !session) {
      throw new Error('Session not found');
    }

    // Get scanner account
    const { data: account, error: accountError } = await supabase
      .from('telegram_accounts')
      .select('*, telegram_api_credentials(*)')
      .eq('id', scanner_account_id)
      .single();

    if (accountError || !account) {
      throw new Error('Scanner account not found');
    }

    // Initialize Telegram client
    const stringSession = new StringSession(account.session_string || '');
    const client = new TelegramClient(
      stringSession,
      parseInt(account.telegram_api_credentials.api_id),
      account.telegram_api_credentials.api_hash,
      { connectionRetries: 3 }
    );

    await client.connect();
    console.log('Telegram client connected');

    // Resolve source group
    let sourceEntity;
    try {
      if (session.source_group_input.startsWith('@') || !session.source_group_input.match(/^\d+$/)) {
        sourceEntity = await client.getEntity(session.source_group_input);
      } else {
        sourceEntity = await client.getEntity(parseInt(session.source_group_input));
      }
    } catch (error) {
      console.error('Failed to resolve source group:', error);
      throw new Error('Cannot find source group');
    }

    const sourceEntityAny = sourceEntity as any;
    console.log('Source group resolved:', sourceEntityAny.title);

    // Update session with source group info
    await supabase
      .from('scraping_sessions')
      .update({
        source_group_id: sourceEntityAny.id.toString(),
        source_group_title: sourceEntityAny.title
      })
      .eq('id', session_id);

    // Fetch all participants with pagination
    let allParticipants: any[] = [];
    let offset = 0;
    const limit = 200;
    let hasMore = true;

    while (hasMore) {
      try {
        const result: any = await client.invoke(
          new Api.channels.GetParticipants({
            channel: sourceEntity,
            filter: new Api.ChannelParticipantsSearch({ q: '' }),
            offset: offset,
            limit: limit,
            hash: 0 as any,
          })
        );

        if (result.users.length === 0) {
          hasMore = false;
        } else {
          allParticipants = allParticipants.concat(
            result.users.map((user: any, idx: number) => {
              const participant = result.participants[idx];
              return {
                user,
                participant,
                isAdmin: participant.className === 'ChannelParticipantAdmin' || 
                        participant.className === 'ChannelParticipantCreator'
              };
            })
          );
          offset += result.users.length;
          
          console.log(`Fetched ${offset} members so far...`);
          
          // Update progress
          await supabase
            .from('scraping_sessions')
            .update({ total_members_fetched: offset })
            .eq('id', session_id);
        }

        // Rate limiting
        await new Promise(resolve => setTimeout(resolve, 1000));
      } catch (error) {
        console.error('Error fetching participants batch:', error);
        hasMore = false;
      }
    }

    console.log(`Total participants fetched: ${allParticipants.length}`);

    // Filter and insert members
    let sequenceNumber = 1;
    let filteredCount = 0;
    let queuedCount = 0;

    const settings = session.settings as any;
    const excludeBots = filters?.exclude_bots ?? settings?.filter_bots ?? true;
    const excludeAdmins = filters?.exclude_admins ?? settings?.filter_admins ?? true;

    for (const item of allParticipants) {
      const user = item.user;
      
      // Apply filters
      if (excludeBots && user.bot) {
        filteredCount++;
        continue;
      }
      
      if (excludeAdmins && item.isAdmin) {
        filteredCount++;
        continue;
      }

      // Insert into scraped_members
      const { error: insertError } = await supabase
        .from('scraped_members')
        .insert({
          session_id: session_id,
          sequence_number: sequenceNumber++,
          user_id: user.id.toString(),
          username: user.username || null,
          first_name: user.firstName || null,
          last_name: user.lastName || null,
          access_hash: user.accessHash?.toString() || null,
          phone: user.phone || null,
          is_bot: user.bot || false,
          is_admin: item.isAdmin,
          status: 'queued'
        });

      if (!insertError) {
        queuedCount++;
      }
    }

    // Update session with final counts
    await supabase
      .from('scraping_sessions')
      .update({
        status: 'ready',
        total_members_fetched: allParticipants.length,
        total_filtered_out: filteredCount,
        total_in_queue: queuedCount,
        fetched_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      })
      .eq('id', session_id);

    await client.disconnect();

    console.log('Scraping completed:', { total: allParticipants.length, filtered: filteredCount, queued: queuedCount });

    return new Response(
      JSON.stringify({
        success: true,
        session_id,
        total_fetched: allParticipants.length,
        total_filtered: filteredCount,
        total_queued: queuedCount
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