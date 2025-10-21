import { useState, useEffect, useRef } from 'react';
import { Header } from '@/components/Header';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Progress } from '@/components/ui/progress';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { toast } from 'sonner';
import { Loader2, Play, Pause, StopCircle, Trash2, Download } from 'lucide-react';
import { TelegramClient } from 'telegram';
import { StringSession } from 'telegram/sessions';
import { Api } from 'telegram/tl';
import { Input } from '@/components/ui/input';

const DEFAULT_DAILY_LIMIT = 50;
const DEFAULT_INVITE_DELAY = 3;
const DEFAULT_BATCH_DELAY = 40;

type ScrapingStatus = 'idle' | 'running' | 'paused' | 'cancelled';

interface ProgressState {
  currentAccount: string;
  currentAccountIndex: number;
  totalAccounts: number;
  membersAdded: number;
  totalTarget: number;
  currentLogId: string | null;
}

interface AddedMember {
  id: string;
  username: string;
  firstName: string;
  lastName: string;
  accountUsed: string;
  addedAt: string;
}

interface CompletionState {
  isOpen: boolean;
  addedMembers: AddedMember[];
  totalAttempts: number;
  successCount: number;
  failedCount: number;
  accountStats: Array<{
    accountName: string;
    targetSuccess: number;
    achievedSuccess: number;
    attempts: number;
  }>;
}

export default function MemberScraping() {
  const { user, isSuperAdmin } = useAuth();
  const [showAllAccounts, setShowAllAccounts] = useState(true);
  const [sourceGroupInput, setSourceGroupInput] = useState('');
  const [targetGroupInput, setTargetGroupInput] = useState('');
  const [sourceGroupInfo, setSourceGroupInfo] = useState<any>(null);
  const [targetGroupInfo, setTargetGroupInfo] = useState<any>(null);
  const [isVerifyingSource, setIsVerifyingSource] = useState(false);
  const [isVerifyingTarget, setIsVerifyingTarget] = useState(false);
  const [dailyLimit, setDailyLimit] = useState(DEFAULT_DAILY_LIMIT);
  const [inviteDelay, setInviteDelay] = useState(DEFAULT_INVITE_DELAY);
  const [batchDelay, setBatchDelay] = useState(DEFAULT_BATCH_DELAY);
  
  // Progress control states
  const [scrapingStatus, setScrapingStatus] = useState<ScrapingStatus>('idle');
  const [currentProgress, setCurrentProgress] = useState<ProgressState>({
    currentAccount: '',
    currentAccountIndex: 0,
    totalAccounts: 0,
    membersAdded: 0,
    totalTarget: 0,
    currentLogId: null,
  });
  
  // Completion dialog state
  const [completedScraping, setCompletedScraping] = useState<CompletionState>({
    isOpen: false,
    addedMembers: [],
    totalAttempts: 0,
    successCount: 0,
    failedCount: 0,
    accountStats: [],
  });
  
  // Use ref to track status for async operations (mutable across function calls)
  const statusRef = useRef<ScrapingStatus>('idle' as ScrapingStatus);
  
  // Sync statusRef when scrapingStatus changes
  useEffect(() => {
    statusRef.current = scrapingStatus;
  }, [scrapingStatus]);

  // Fetch accounts based on filter
  const { data: accounts, refetch: refetchAccounts } = useQuery({
    queryKey: ['telegram-accounts-scraping', showAllAccounts],
    queryFn: async () => {
      let query = supabase
        .from('telegram_accounts')
        .select('*, telegram_api_credentials(*)')
        .eq('is_active', true);
      
      if (!showAllAccounts) {
        query = query.eq('created_by', user?.id);
      }
      
      const { data, error } = await query.order('created_at', { ascending: false });
      
      if (error) throw error;
      return data;
    },
    enabled: !!user && isSuperAdmin
  });

  const handleVerifyGroup = async (input: string, type: 'source' | 'target') => {
    if (!input.trim()) {
      toast.error('Lütfen grup ID veya kullanıcı adı girin');
      return;
    }

    if (!accounts || accounts.length === 0) {
      toast.error('Aktif hesap bulunamadı');
      return;
    }

    const setVerifying = type === 'source' ? setIsVerifyingSource : setIsVerifyingTarget;
    const setGroupInfo = type === 'source' ? setSourceGroupInfo : setTargetGroupInfo;

    setVerifying(true);
    try {
      const account = accounts[0];
      const client = new TelegramClient(
        new StringSession(account.session_string || ''),
        parseInt(account.telegram_api_credentials.api_id),
        account.telegram_api_credentials.api_hash,
        { connectionRetries: 5 }
      );

      await client.connect();
      
      const entity = await client.getEntity(input);
      await client.disconnect();

      const groupInfo = {
        id: String(entity.id),
        title: (entity as any).title || input,
        username: (entity as any).username || null,
        accessHash: (entity as any).accessHash || null,
      };

      setGroupInfo(groupInfo);
      toast.success(`Grup doğrulandı: ${groupInfo.title}`);
    } catch (error: any) {
      console.error('Group verification error:', error);
      toast.error('Grup doğrulanamadı: ' + error.message);
      setGroupInfo(null);
    } finally {
      setVerifying(false);
    }
  };

  // Fetch scraping logs with realtime updates
  const { data: logs, refetch: refetchLogs } = useQuery({
    queryKey: ['member-scraping-logs'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('member_scraping_logs')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(50);
      
      if (error) throw error;
      return data;
    },
    enabled: !!user && isSuperAdmin,
  });

  // Realtime subscription for logs
  useEffect(() => {
    if (!user || !isSuperAdmin) return;

    const channel = supabase
      .channel('member-scraping-logs-changes')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'member_scraping_logs'
        },
        () => {
          refetchLogs();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [user, isSuperAdmin, refetchLogs]);

  const handleClearLogs = async () => {
    try {
      const { error } = await supabase.from('member_scraping_logs').delete().neq('id', '00000000-0000-0000-0000-000000000000');
      
      if (error) throw error;
      
      toast.success('Loglar temizlendi');
      refetchLogs();
    } catch (error: any) {
      toast.error('Loglar temizlenirken hata oluştu: ' + error.message);
    }
  };

  // Helper: Fetch ALL participants from target group with pagination
  const fetchAllParticipants = async (client: TelegramClient, groupIdOrInput: string): Promise<Set<string>> => {
    const allMemberIds = new Set<string>();
    
    try {
      const targetEntity = await client.getEntity(groupIdOrInput);
      let offset = 0;
      const limit = 200; // Smaller batches for stability

      while (true) {
        try {
          const batch = await client.getParticipants(targetEntity, { limit, offset });
          if (!batch || batch.length === 0) break;
          
          batch.forEach(p => allMemberIds.add(String(p.id)));
          offset += batch.length;
          
          console.log(`📊 Fetched ${offset} participants so far...`);
          
          if (batch.length < limit) break; // Last page
          
          // Small delay between batches to avoid rate limiting
          await new Promise(resolve => setTimeout(resolve, 500));
        } catch (error: any) {
          console.error(`Error fetching participants at offset ${offset}:`, error.message);
          // Continue with what we have
          break;
        }
      }
    } catch (error: any) {
      console.error('Error in fetchAllParticipants:', error.message);
      throw error;
    }
    
    return allMemberIds;
  };

  // Helper: Resolve user entity with accessHash priority
  const resolveUserEntity = async (
    client: TelegramClient,
    candidate: any
  ): Promise<{ inputPeerUser: any; inputUser: any } | null> => {
    try {
      const c: any = candidate;
      
      // Priority 1: Use accessHash if available
      if (c && (c.accessHash || c.access_hash)) {
        const accessHash = c.accessHash ?? c.access_hash;
        const userId = c.id;
        return {
          inputPeerUser: new Api.InputPeerUser({ userId, accessHash }),
          inputUser: new Api.InputUser({ userId, accessHash }),
        };
      }
      
      // Priority 2: Try username resolution
      if (c && c.username) {
        try {
          const resolved = await client.invoke(
            new Api.contacts.ResolveUsername({ username: c.username })
          );
          const users = (resolved as any).users;
          if (users && users.length > 0) {
            const user = users[0];
            const userId = user.id;
            const accessHash = user.accessHash || user.access_hash;
            if (accessHash) {
              return {
                inputPeerUser: new Api.InputPeerUser({ userId, accessHash }),
                inputUser: new Api.InputUser({ userId, accessHash }),
              };
            }
          }
        } catch (error: any) {
          console.error(`Username resolution failed for @${c.username}:`, error.message);
        }
      }
      
      
      return null;
    } catch (error: any) {
      console.error('resolveUserEntity error:', error.message);
      return null;
    }
  };

  // Helper: Resolve target channel with username/accessHash priority
  const resolveTargetChannel = async (
    client: TelegramClient,
    groupInfo: any
  ): Promise<any> => {
    try {
      // Priority 1: Use username if available
      if (groupInfo.username) {
        const entity = await client.getEntity(groupInfo.username);
        return await client.getInputEntity(entity);
      }
      
      // Priority 2: Use accessHash if available
      if (groupInfo.accessHash) {
        return new Api.InputChannel({
          channelId: groupInfo.id,
          accessHash: groupInfo.accessHash,
        });
      }
      
      // Priority 3: Try direct resolution
      const entity = await client.getEntity(groupInfo.id);
      return await client.getInputEntity(entity);
    } catch (error: any) {
      console.error('resolveTargetChannel error:', error.message);
      throw error;
    }
  };

  // Helper: Enhanced participant check with detailed status
  const getParticipantInTargetEnhanced = async (
    client: TelegramClient, 
    candidate: any, 
    groupInfo: any
  ): Promise<{ isMember: boolean; raw?: any }> => {
    try {
      // Resolve target channel
      const targetInputChannel = await resolveTargetChannel(client, groupInfo);

      // Resolve user entity
      const userEntities = await resolveUserEntity(client, candidate);
      if (!userEntities) {
        console.error(`Cannot resolve user entity for candidate:`, { id: candidate.id, username: candidate.username });
        return { isMember: false };
      }

      const result = await client.invoke(
        new Api.channels.GetParticipant({
          channel: targetInputChannel,
          participant: userEntities.inputPeerUser,
        })
      );

      const participant = (result as any).participant;

      if (participant.className === 'ChannelParticipant' || 
          participant.className === 'ChannelParticipantAdmin' ||
          participant.className === 'ChannelParticipantCreator') {
        return { isMember: true, raw: participant };
      }

      if (participant.className === 'ChannelParticipantBanned' || 
          participant.className === 'ChannelParticipantLeft') {
        return { isMember: false, raw: participant };
      }

      return { isMember: true, raw: participant };
    } catch (error: any) {
      if (error.message?.includes('USER_NOT_PARTICIPANT')) {
        return { isMember: false };
      }
      if (error.message?.includes('CHANNEL_INVALID') || error.message?.includes('CHANNEL_PRIVATE')) {
        console.error('Invalid channel access:', error.message);
        return { isMember: false };
      }
      console.error('getParticipantInTargetEnhanced error:', error.message);
      return { isMember: false };
    }
  };

  const handleStartScraping = async () => {
    if (!sourceGroupInfo || !targetGroupInfo) {
      toast.error('Lütfen önce grupları doğrulayın');
      return;
    }

    if (!accounts || accounts.length === 0) {
      toast.error('Aktif hesap bulunamadı');
      return;
    }

    const startTime = Date.now();
    const today = new Date().toISOString().split('T')[0];
    
    try {
      // Fetch today's limits for all accounts
      const { data: limitsData } = await supabase
        .from('account_daily_limits')
        .select('account_id, members_added_today')
        .eq('date', today)
        .in('account_id', accounts.map(a => a.id));
      
      const limitsMap = new Map(limitsData?.map(l => [l.account_id, l.members_added_today]) || []);
      
      // Calculate total target
      let totalTargetSuccess = 0;
      for (const account of accounts) {
        const todayAdded = limitsMap.get(account.id) || 0;
        const remainingForAccount = Math.max(0, dailyLimit - todayAdded);
        totalTargetSuccess += remainingForAccount;
      }

      if (totalTargetSuccess === 0) {
        toast.error('Tüm hesaplar günlük limitine ulaşmış');
        return;
      }

      setScrapingStatus('running');
      setCurrentProgress({
        currentAccount: '',
        currentAccountIndex: 0,
        totalAccounts: accounts.length,
        membersAdded: 0,
        totalTarget: totalTargetSuccess,
        currentLogId: null,
      });

      toast.info('Üye çekme işlemi başlatıldı');
      
      let totalAdded = 0;
      let totalAttempts = 0;
      const successfullyAddedMembers: AddedMember[] = [];
      const accountStats: Array<{ accountName: string; targetSuccess: number; achievedSuccess: number; attempts: number; }> = [];
      
      // Create main progress log
      const { data: mainLog } = await supabase
        .from('member_scraping_logs')
        .insert({
          created_by: user?.id,
          source_group_id: sourceGroupInfo.id,
          target_group_id: targetGroupInfo.id,
          source_group_title: sourceGroupInfo.title,
          target_group_title: targetGroupInfo.title,
          members_added: 0,
          status: 'in_progress',
          details: {
            phase: 'initializing',
            total_accounts: accounts.length,
            total_target: totalTargetSuccess,
          },
        })
        .select()
        .single();

      // STEP 1: Fetch ALL target members with full pagination
      let globalTargetMemberIds = new Set<string>();
      
      try {
        const firstAccount = accounts[0];
        const firstClient = new TelegramClient(
          new StringSession(firstAccount.session_string || ''),
          parseInt(firstAccount.telegram_api_credentials.api_id),
          firstAccount.telegram_api_credentials.api_hash,
          { connectionRetries: 5 }
        );
        await firstClient.connect();
        
        await logToDatabase('info', 'Hedef grup üyeleri tam sayım ile alınıyor...', 0);
        globalTargetMemberIds = await fetchAllParticipants(firstClient, targetGroupInfo.id);
        await firstClient.disconnect();
        
        await logToDatabase('info', `✅ Hedef grupta toplam ${globalTargetMemberIds.size} üye tespit edildi`, 0);
        console.log(`🎯 Full pagination complete: ${globalTargetMemberIds.size} existing members in target`);
      } catch (error: any) {
        console.error('Error fetching all target members:', error);
        await logToDatabase('error', `Hedef grup üyeleri alınamadı: ${error.message}`, 0);
        throw error;
      }

      // STEP 2: Build single global candidate queue from first account
      // Global structures for coordination
      const globalCandidateQueue: any[] = [];
      const globalReservedIds = new Set<string>();
      const globalProcessedIds = new Set<string>();
      
      // Fetch source members with first account and build global queue
      try {
        const firstAccount = accounts[0];
        const firstClient = new TelegramClient(
          new StringSession(firstAccount.session_string || ''),
          parseInt(firstAccount.telegram_api_credentials.api_id),
          firstAccount.telegram_api_credentials.api_hash,
          { connectionRetries: 5 }
        );
        await firstClient.connect();
        
        await logToDatabase('info', 'Kaynak grup üyeleri alınıyor...', 0);
        const sourceEntity = await firstClient.getEntity(sourceGroupInfo.username || sourceGroupInfo.id);
        const sourceParticipants = await firstClient.getParticipants(sourceEntity, { limit: 2000 });
        
        // Pre-filter and deduplicate - store rich candidate objects
        const seenIds = new Set<string>();
        let unresolvableCandidates = 0;
        for (const member of sourceParticipants) {
          const memberId = String(member.id);
          
          // Skip if already seen (dedup)
          if (seenIds.has(memberId)) continue;
          seenIds.add(memberId);
          
          // Skip bots, deleted, restricted
          if ((member as any).bot || (member as any).deleted || (member as any).restricted) continue;
          
          // Skip empty status
          const status = (member as any).status;
          if (status?.className === 'UserStatusEmpty') continue;
          
          // Skip if already in target
          if (globalTargetMemberIds.has(memberId)) continue;
          
          // Store rich candidate object with accessHash
          const candidate = {
            id: member.id,
            accessHash: (member as any).accessHash || (member as any).access_hash || null,
            username: (member as any).username || null,
            firstName: (member as any).firstName || '',
            lastName: (member as any).lastName || '',
            bot: (member as any).bot || false,
            deleted: (member as any).deleted || false,
            restricted: (member as any).restricted || false,
          };
          
          if (candidate.accessHash || candidate.username) {
            globalCandidateQueue.push(candidate);
          } else {
            unresolvableCandidates++;
          }
        }
        
        await firstClient.disconnect();
        await logToDatabase('info', `✅ Global aday kuyruğu hazırlandı: ${globalCandidateQueue.length} aday (atlanan: ${unresolvableCandidates} - username/accessHash yok)`, 0);
        console.log(`📋 Global candidate queue: ${globalCandidateQueue.length} candidates`);
      } catch (error: any) {
        console.error('Error building candidate queue:', error);
        await logToDatabase('error', `Aday kuyruğu oluşturulamadı: ${error.message}`, 0);
        throw error;
      }
      
      if (globalCandidateQueue.length === 0) {
        toast.warning('Kaynak grupta eklenebilecek yeni üye bulunamadı');
        throw new Error('Aday bulunamadı');
      }

      // STEP 3: Prepare account data structures
      const accountMembersData: Array<{
        account: any;
        client: TelegramClient | null;
        todayAdded: number;
        successCountThisSession: number;
        attemptsThisSession: number;
        targetSuccess: number;
        isFloodWaiting: boolean;
        floodWaitUntil: number;
      }> = [];

      for (const account of accounts) {
        if (statusRef.current === 'cancelled') break;

        try {
          const client = new TelegramClient(
            new StringSession(account.session_string || ''),
            parseInt(account.telegram_api_credentials.api_id),
            account.telegram_api_credentials.api_hash,
            { connectionRetries: 5 }
          );

          await client.connect();

          const todayAdded = limitsMap.get(account.id) || 0;
          const targetSuccess = Math.max(0, dailyLimit - todayAdded);

          accountMembersData.push({
            account,
            client,
            todayAdded,
            successCountThisSession: 0,
            attemptsThisSession: 0,
            targetSuccess,
            isFloodWaiting: false,
            floodWaitUntil: 0,
          });

          await supabase.from('member_scraping_logs').insert({
            created_by: user?.id,
            account_id: account.id,
            source_group_id: sourceGroupInfo.id,
            target_group_id: targetGroupInfo.id,
            source_group_title: sourceGroupInfo.title,
            target_group_title: targetGroupInfo.title,
            members_added: 0,
            status: 'in_progress',
            details: {
              phase: 'prepared',
              account_name: account.name || account.phone_number,
              global_queue_size: globalCandidateQueue.length,
              target_success: targetSuccess,
              today_added: todayAdded,
            },
          });
        } catch (error: any) {
          console.error(`Error preparing ${account.name}:`, error);
          await logToDatabase('error', `${account.name}: Hazırlık hatası - ${error.message}`, 0, account.id);
        }
      }

      if (accountMembersData.length === 0) {
        throw new Error('Hiçbir hesap hazırlanamadı');
      }

      // STEP 4: Round-robin with global queue consumption
      let currentAccountIndex = 0;
      let allAccountsFinished = false;

      while (!allAccountsFinished) {
        if (statusRef.current === 'cancelled') {
          await logToDatabase('cancelled', 'İşlem kullanıcı tarafından iptal edildi', totalAdded);
          break;
        }

        // Check pause
        while (statusRef.current === 'paused') {
          await new Promise(resolve => setTimeout(resolve, 1000));
        }

        // Check if global queue is exhausted
        if (globalCandidateQueue.length === 0) {
          await logToDatabase('info', 'Global aday kuyruğu tükendi', totalAdded);
          allAccountsFinished = true;
          break;
        }

        // Find next available account
        let attempts = 0;
        let foundAccount = false;
        
        while (attempts < accountMembersData.length) {
          const accountData = accountMembersData[currentAccountIndex];
          const { successCountThisSession, targetSuccess, isFloodWaiting, floodWaitUntil } = accountData;

          // Check if account can continue
          const reachedTarget = successCountThisSession >= targetSuccess;
          const inFloodWait = isFloodWaiting && Date.now() < floodWaitUntil;

          if (!reachedTarget && !inFloodWait) {
            foundAccount = true;
            break;
          }

          // Clear flood wait if time passed
          if (isFloodWaiting && Date.now() >= floodWaitUntil) {
            accountData.isFloodWaiting = false;
          }

          currentAccountIndex = (currentAccountIndex + 1) % accountMembersData.length;
          attempts++;
        }

        if (!foundAccount) {
          // All accounts finished their targets
          allAccountsFinished = true;
          break;
        }

        const accountData = accountMembersData[currentAccountIndex];
        const { account, client } = accountData;

        // Update progress UI
        setCurrentProgress({
          currentAccount: account.name || account.phone_number,
          currentAccountIndex: currentAccountIndex + 1,
          totalAccounts: accounts.length,
          membersAdded: totalAdded,
          totalTarget: totalTargetSuccess,
          currentLogId: mainLog?.id || null,
        });

        // Get next candidate from GLOBAL queue
        const member = globalCandidateQueue.shift();
        if (!member) {
          // Queue exhausted
          allAccountsFinished = true;
          break;
        }

        const memberId = String(member.id);

        // Check if already processed or reserved
        if (globalProcessedIds.has(memberId) || globalReservedIds.has(memberId)) {
          continue;
        }

        // Reserve this member
        globalReservedIds.add(memberId);

        // Enhanced pre-invite verification
        if (client) {
          try {
            const checkResult = await getParticipantInTargetEnhanced(client, member, targetGroupInfo);
            
            if (checkResult.isMember) {
              console.log(`⏭️ Pre-invite check: ${memberId} already in target (enhanced), skipping`);
              globalProcessedIds.add(memberId);
              globalReservedIds.delete(memberId);
              currentAccountIndex = (currentAccountIndex + 1) % accountMembersData.length;
              continue;
            }
          } catch (error: any) {
            console.error('Pre-invite verification error:', error);
            // If verification fails, continue to attempt (safer approach)
          }
        }

        // Try to add member (this is an ATTEMPT)
        if (client) {
          try {
            totalAttempts++;
            accountData.attemptsThisSession++;
            
            // Resolve target channel
            const targetInputChannel = await resolveTargetChannel(client, targetGroupInfo);
            
            // Resolve user entity
            const userEntities = await resolveUserEntity(client, member);
            if (!userEntities) {
              console.error(`Cannot resolve user entity for ${memberId}`);
              globalProcessedIds.add(memberId);
              globalReservedIds.delete(memberId);
              
              await supabase.from('member_scraping_logs').insert({
                created_by: user?.id,
                account_id: account.id,
                source_group_id: sourceGroupInfo.id,
                target_group_id: targetGroupInfo.id,
                source_group_title: sourceGroupInfo.title,
                target_group_title: targetGroupInfo.title,
                members_added: 0,
                status: 'skipped',
                error_message: 'Kullanıcı entity çözülemedi',
                details: { 
                  member_id: memberId, 
                  username: member.username || 'N/A',
                  reason: 'entity_resolution_failed',
                  has_access_hash: !!(member.accessHash || member.access_hash),
                  has_username: !!member.username,
                },
              });
              
              currentAccountIndex = (currentAccountIndex + 1) % accountMembersData.length;
              continue;
            }
            
            // Invoke InviteToChannel with proper InputUser
            await client.invoke(
              new Api.channels.InviteToChannel({
                channel: targetInputChannel,
                users: [userEntities.inputUser],
              })
            );

            // Wait briefly before post-verify
            await new Promise(resolve => setTimeout(resolve, 1500));
            
            // POST-VERIFY: Check if member is actually now in target
            let postVerifySuccess = false;
            try {
              const postCheckResult = await getParticipantInTargetEnhanced(client, member, targetGroupInfo);
              postVerifySuccess = postCheckResult.isMember;
            } catch (error: any) {
              console.error('Post-verify error:', error);
              // Be conservative: if we can't verify, don't count as success
              postVerifySuccess = false;
            }
            
            if (!postVerifySuccess) {
              // Failed post-verify - don't count as success
              console.log(`❌ Post-verify failed for ${memberId}, skipping success count`);
              globalProcessedIds.add(memberId);
              globalReservedIds.delete(memberId);
              
              await supabase.from('member_scraping_logs').insert({
                created_by: user?.id,
                account_id: account.id,
                source_group_id: sourceGroupInfo.id,
                target_group_id: targetGroupInfo.id,
                source_group_title: sourceGroupInfo.title,
                target_group_title: targetGroupInfo.title,
                members_added: 0,
                status: 'skipped',
                error_message: 'Post-verify başarısız: üye eklenmedi',
                details: { member_id: memberId, reason: 'post_verify_failed' },
              });
              
              currentAccountIndex = (currentAccountIndex + 1) % accountMembersData.length;
              continue;
            }
            
            // Post-verify SUCCESS - count it
            totalAdded++;
            accountData.successCountThisSession++;
            accountData.todayAdded++;
            
            // Mark as processed
            globalProcessedIds.add(memberId);
            globalReservedIds.delete(memberId);
            globalTargetMemberIds.add(memberId);
            
            console.log(`✅ Post-verified: ${memberId} successfully added via ${account.name}`);
            
            // Add to success list
            successfullyAddedMembers.push({
              id: memberId,
              username: member.username || 'N/A',
              firstName: member.firstName || '',
              lastName: member.lastName || '',
              accountUsed: account.name || account.phone_number,
              addedAt: new Date().toISOString(),
            });

            // Update progress
            setCurrentProgress(prev => ({ ...prev, membersAdded: totalAdded }));

            // Update daily limit in DB
            await supabase.from('account_daily_limits').upsert({
              account_id: account.id,
              date: today,
              members_added_today: accountData.todayAdded,
              last_used_at: new Date().toISOString(),
            });

            // Log success
            await supabase.from('member_scraping_logs').insert({
              created_by: user?.id,
              account_id: account.id,
              source_group_id: sourceGroupInfo.id,
              target_group_id: targetGroupInfo.id,
              source_group_title: sourceGroupInfo.title,
              target_group_title: targetGroupInfo.title,
              members_added: 1,
              status: 'success',
              details: {
                account_name: account.name || account.phone_number,
                member_id: memberId,
                member_username: member.username || 'N/A',
                member_name: `${member.firstName || ''} ${member.lastName || ''}`.trim(),
                session_stats: {
                  success: accountData.successCountThisSession,
                  target: accountData.targetSuccess,
                  attempts: accountData.attemptsThisSession,
                },
              },
            });

            // Update main log periodically
            if (mainLog?.id && totalAdded % 5 === 0) {
              await supabase
                .from('member_scraping_logs')
                .update({
                  members_added: totalAdded,
                  details: {
                    phase: 'adding_members',
                    current_account: account.name || account.phone_number,
                    progress: {
                      current: totalAdded,
                      target: totalTargetSuccess,
                      percentage: Math.round((totalAdded / totalTargetSuccess) * 100),
                    },
                  },
                })
                .eq('id', mainLog.id);
            }

            // Smart delays
            if (accountData.successCountThisSession % 5 === 0) {
              const randomBatchDelay = Math.random() * 5 + batchDelay;
              await new Promise(resolve => setTimeout(resolve, randomBatchDelay * 1000));
            } else {
              const randomInviteDelay = Math.random() * 2 + inviteDelay;
              await new Promise(resolve => setTimeout(resolve, randomInviteDelay * 1000));
            }
          } catch (error: any) {
            console.error('Error adding member:', error);
            
            // Mark as processed regardless
            globalProcessedIds.add(memberId);
            globalReservedIds.delete(memberId);

            // Handle specific errors
            if (error.message?.includes('USER_ALREADY_PARTICIPANT')) {
              // User is already member - DON'T count as success
              await supabase.from('member_scraping_logs').insert({
                created_by: user?.id,
                account_id: account.id,
                source_group_id: sourceGroupInfo.id,
                target_group_id: targetGroupInfo.id,
                source_group_title: sourceGroupInfo.title,
                target_group_title: targetGroupInfo.title,
                members_added: 0,
                status: 'skipped',
                error_message: 'Üye zaten grupta',
                details: {
                  member_id: memberId,
                  reason: 'USER_ALREADY_PARTICIPANT',
                },
              });
              currentAccountIndex = (currentAccountIndex + 1) % accountMembersData.length;
              continue;
            }

            // Privacy/restriction errors - skip silently
            if (error.message?.includes('USER_PRIVACY_RESTRICTED') || 
                error.message?.includes('USER_NOT_MUTUAL_CONTACT') ||
                error.message?.includes('USER_CHANNELS_TOO_MUCH')) {
              await supabase.from('member_scraping_logs').insert({
                created_by: user?.id,
                account_id: account.id,
                source_group_id: sourceGroupInfo.id,
                target_group_id: targetGroupInfo.id,
                source_group_title: sourceGroupInfo.title,
                target_group_title: targetGroupInfo.title,
                members_added: 0,
                status: 'skipped',
                error_message: error.message,
                details: { member_id: memberId, reason: 'privacy_restriction' },
              });
              currentAccountIndex = (currentAccountIndex + 1) % accountMembersData.length;
              continue;
            }

            // Flood handling
            if (error.message?.includes('FLOOD')) {
              const waitSeconds = error.seconds || 300;
              accountData.isFloodWaiting = true;
              accountData.floodWaitUntil = Date.now() + (waitSeconds * 1000);
              
              await supabase.from('member_scraping_logs').insert({
                created_by: user?.id,
                account_id: account.id,
                source_group_id: sourceGroupInfo.id,
                target_group_id: targetGroupInfo.id,
                source_group_title: sourceGroupInfo.title,
                target_group_title: targetGroupInfo.title,
                members_added: 0,
                status: 'flood_wait',
                error_message: `Flood hatası! ${waitSeconds} saniye beklenecek`,
                details: {
                  wait_seconds: waitSeconds,
                  account_name: account.name || account.phone_number,
                  will_resume_at: new Date(accountData.floodWaitUntil).toISOString(),
                },
              });
              
              currentAccountIndex = (currentAccountIndex + 1) % accountMembersData.length;
              continue;
            }

            // Other errors
            await logToDatabase('error', `${account.name}: ${error.message}`, 0, account.id);
          }
        }

        // Move to next account
        currentAccountIndex = (currentAccountIndex + 1) % accountMembersData.length;
      }

      // STEP 4: Cleanup - disconnect all clients
      for (const accountData of accountMembersData) {
        if (accountData.client) {
          try {
            await accountData.client.disconnect();
          } catch (e) {
            console.error('Error disconnecting:', e);
          }
        }
      }

      // Build per-account stats
      for (const accountData of accountMembersData) {
        accountStats.push({
          accountName: accountData.account.name || accountData.account.phone_number,
          targetSuccess: accountData.targetSuccess,
          achievedSuccess: accountData.successCountThisSession,
          attempts: accountData.attemptsThisSession,
        });
      }

      // Update final main log with statistics
      if (mainLog?.id) {
        const durationSeconds = Math.floor((Date.now() - startTime) / 1000);
        const successRate = totalAttempts > 0 ? Math.round((totalAdded / totalAttempts) * 100) : 0;
        
        await supabase
          .from('member_scraping_logs')
          .update({
            status: statusRef.current === 'cancelled' ? 'cancelled' : 'success',
            members_added: totalAdded,
            details: {
              phase: 'completed',
              statistics: {
                total_attempts: totalAttempts,
                successful: totalAdded,
                failed: totalAttempts - totalAdded,
                success_rate: successRate,
                duration_seconds: durationSeconds,
              },
              per_account_stats: accountStats,
              added_members: successfullyAddedMembers.slice(0, 100).map(m => ({
                id: m.id,
                username: m.username,
                firstName: m.firstName,
                lastName: m.lastName,
                accountUsed: m.accountUsed,
                addedAt: m.addedAt,
              })),
            },
          })
          .eq('id', mainLog.id);
      }

      if (statusRef.current !== 'cancelled') {
        // Show completion dialog
        setCompletedScraping({
          isOpen: true,
          addedMembers: successfullyAddedMembers,
          totalAttempts,
          successCount: totalAdded,
          failedCount: totalAttempts - totalAdded,
          accountStats,
        });
        
        // Check if target was reached
        const targetReached = totalAdded >= totalTargetSuccess;
        if (targetReached) {
          toast.success(`✅ ${totalAdded} üye başarıyla eklendi! Hedef tamamlandı.`);
        } else {
          toast.warning(`⚠️ ${totalAdded} üye eklendi. Hedef: ${totalTargetSuccess}. Aday kuyruğu tükendi veya limitler doldu.`);
        }
      }
    } catch (error: any) {
      console.error('Scraping error:', error);
      await logToDatabase('error', error.message || 'Bilinmeyen hata', 0);
      toast.error('Hata: ' + error.message);
    } finally {
      setScrapingStatus('idle');
      setCurrentProgress({
        currentAccount: '',
        currentAccountIndex: 0,
        totalAccounts: 0,
        membersAdded: 0,
        totalTarget: 0,
        currentLogId: null,
      });
      refetchLogs();
    }
  };

  const logToDatabase = async (status: string, message: string, membersAdded: number, accountId?: string) => {
    await supabase.from('member_scraping_logs').insert({
      created_by: user?.id,
      account_id: accountId || null,
      source_group_id: sourceGroupInfo?.id || null,
      target_group_id: targetGroupInfo?.id || null,
      source_group_title: sourceGroupInfo?.title || null,
      target_group_title: targetGroupInfo?.title || null,
      members_added: membersAdded,
      status,
      error_message: status === 'error' ? message : null,
      details: { message },
    });
  };

  const handlePauseScraping = () => {
    setScrapingStatus('paused');
    toast.info('İşlem duraklatıldı');
  };

  const handleResumeScraping = () => {
    setScrapingStatus('running');
    toast.info('İşlem devam ediyor');
  };

  const handleCancelScraping = () => {
    setScrapingStatus('cancelled');
    toast.warning('İşlem iptal ediliyor...');
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'success':
        return <Badge variant="default" className="bg-success">Başarılı</Badge>;
      case 'error':
        return <Badge variant="destructive">Hata</Badge>;
      case 'skipped':
        return <Badge variant="secondary">Atlandı</Badge>;
      case 'in_progress':
        return <Badge variant="outline" className="bg-blue-500/10 text-blue-600 border-blue-500/20">Devam Ediyor</Badge>;
      case 'paused':
        return <Badge variant="outline" className="bg-yellow-500/10 text-yellow-600 border-yellow-500/20">Duraklatıldı</Badge>;
      case 'cancelled':
        return <Badge variant="outline" className="bg-gray-500/10 text-gray-600 border-gray-500/20">İptal Edildi</Badge>;
      case 'flood_wait':
        return <Badge variant="outline" className="bg-orange-500/10 text-orange-600 border-orange-500/20">Flood Bekliyor</Badge>;
      case 'info':
        return <Badge variant="outline" className="bg-blue-500/10 text-blue-600 border-blue-500/20">Bilgi</Badge>;
      default:
        return <Badge variant="outline">{status}</Badge>;
    }
  };

  const handleExportCSV = () => {
    const headers = 'Ad,Soyad,Kullanıcı Adı,Hesap,Eklenme Zamanı\n';
    const csv = headers + completedScraping.addedMembers.map(m => 
      `"${m.firstName}","${m.lastName}","${m.username}","${m.accountUsed}","${new Date(m.addedAt).toLocaleString('tr-TR')}"`
    ).join('\n');
    
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `eklenen-uyeler-${Date.now()}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success('CSV dosyası indirildi');
  };

  if (!isSuperAdmin) {
    return (
      <div className="min-h-screen bg-background flex flex-col">
        <Header />
        <main className="flex-1 container mx-auto p-4 md:p-6 flex items-center justify-center">
          <Card className="w-full max-w-md">
            <CardHeader>
              <CardTitle>Erişim Engellendi</CardTitle>
              <CardDescription>
                Bu sayfaya erişim yetkiniz bulunmamaktadır.
              </CardDescription>
            </CardHeader>
          </Card>
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <Header />
      
      {/* Completion Dialog */}
      <Dialog open={completedScraping.isOpen} onOpenChange={(open) => 
        setCompletedScraping(prev => ({ ...prev, isOpen: open }))
      }>
        <DialogContent className="max-w-2xl max-h-[80vh] overflow-hidden flex flex-col">
          <DialogHeader>
            <DialogTitle>
              {completedScraping.successCount >= currentProgress.totalTarget ? '✅' : '⚠️'} Üye Çekme İşlemi Tamamlandı
            </DialogTitle>
            <DialogDescription>
              Toplam {completedScraping.totalAttempts} deneme yapıldı, 
              {completedScraping.successCount} üye başarıyla eklendi.
              {completedScraping.successCount < currentProgress.totalTarget && (
                <span className="block mt-1 text-yellow-600 dark:text-yellow-400">
                  Hedef limitine ulaşılamadı: Global aday kuyruğu tükendi veya hesap limitleri doldu.
                </span>
              )}
            </DialogDescription>
          </DialogHeader>
          
          <div className="space-y-4 flex-1 overflow-hidden flex flex-col">
            <div className="grid grid-cols-3 gap-4 flex-shrink-0">
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm">Başarılı</CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-2xl font-bold text-green-600">
                    {completedScraping.successCount}
                  </p>
                </CardContent>
              </Card>
              
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm">Başarısız</CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-2xl font-bold text-red-600">
                    {completedScraping.failedCount}
                  </p>
                </CardContent>
              </Card>
              
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm">Başarı Oranı</CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-2xl font-bold text-blue-600">
                    {completedScraping.totalAttempts > 0 
                      ? Math.round((completedScraping.successCount / completedScraping.totalAttempts) * 100)
                      : 0}%
                  </p>
                </CardContent>
              </Card>
            </div>

            {/* Per-Account Stats */}
            {completedScraping.accountStats.length > 0 && (
              <div className="flex-shrink-0">
                <h3 className="font-semibold mb-2">Hesap Bazlı İstatistikler:</h3>
                <div className="space-y-2">
                  {completedScraping.accountStats.map((stat, idx) => (
                    <div key={idx} className="flex items-center justify-between p-3 bg-muted/50 rounded-lg">
                      <div>
                        <p className="font-medium">{stat.accountName}</p>
                        <p className="text-sm text-muted-foreground">
                          Hedef: {stat.targetSuccess} | Başarılı: {stat.achievedSuccess} | Deneme: {stat.attempts}
                        </p>
                      </div>
                      <Badge variant={stat.achievedSuccess >= stat.targetSuccess ? "default" : "secondary"}>
                        {stat.achievedSuccess}/{stat.targetSuccess}
                      </Badge>
                    </div>
                  ))}
                </div>
              </div>
            )}
            
            <div className="flex-1 overflow-hidden flex flex-col">
              <h3 className="font-semibold mb-2 flex-shrink-0">Eklenen Üyeler ({completedScraping.addedMembers.length}):</h3>
              <ScrollArea className="flex-1 border rounded-md p-4">
                <div className="space-y-2">
                  {completedScraping.addedMembers.map((member, idx) => (
                    <div key={idx} className="flex items-center justify-between p-3 bg-muted rounded-lg">
                      <div className="flex-1">
                        <p className="font-medium">
                          {member.firstName} {member.lastName}
                        </p>
                        <p className="text-sm text-muted-foreground">
                          @{member.username}
                        </p>
                      </div>
                      <Badge variant="outline" className="ml-2">
                        {member.accountUsed}
                      </Badge>
                    </div>
                  ))}
                  {completedScraping.addedMembers.length === 0 && (
                    <p className="text-center text-muted-foreground py-8">
                      Hiç üye eklenmedi
                    </p>
                  )}
                </div>
              </ScrollArea>
            </div>
          </div>
          
          <DialogFooter className="flex-shrink-0">
            <Button 
              variant="outline" 
              onClick={handleExportCSV}
              disabled={completedScraping.addedMembers.length === 0}
            >
              <Download className="h-4 w-4 mr-2" />
              CSV İndir
            </Button>
            <Button onClick={() => setCompletedScraping(prev => ({ ...prev, isOpen: false }))}>
              Kapat
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      
      <main className="flex-1 container mx-auto p-4 md:p-6">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 md:gap-6">
          {/* Left Panel - Configuration */}
          <div className="lg:col-span-1 space-y-4 md:space-y-6">
            <Card>
              <CardHeader>
                <CardTitle>Üye Çekimi Ayarları</CardTitle>
                <CardDescription>
                  Telegram grupları arasında üye aktarımı yapın
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex items-center justify-between">
                  <Label htmlFor="account-filter">Hesap Filtresi</Label>
                  <div className="flex items-center gap-2">
                    <span className="text-sm text-muted-foreground">
                      {showAllAccounts ? 'Tümü' : 'Benimkiler'}
                    </span>
                    <Switch
                      id="account-filter"
                      checked={showAllAccounts}
                      onCheckedChange={setShowAllAccounts}
                    />
                  </div>
                </div>

                <div className="space-y-2">
                  <Label>Aktif Hesap Sayısı</Label>
                  <div className="text-2xl font-bold">{accounts?.length || 0}</div>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="daily-limit">Günlük Üye Ekleme Limiti (hesap başına)</Label>
                  <Input
                    id="daily-limit"
                    type="number"
                    min="1"
                    max="500"
                    value={dailyLimit}
                    onChange={(e) => setDailyLimit(Number(e.target.value))}
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="source-group">Kaynak Grup (ID veya @username)</Label>
                  <div className="flex gap-2">
                    <Input
                      id="source-group"
                      placeholder="Örn: -1001234567890 veya @grupadi"
                      value={sourceGroupInput}
                      onChange={(e) => setSourceGroupInput(e.target.value)}
                      disabled={isVerifyingSource}
                    />
                    <Button
                      onClick={() => handleVerifyGroup(sourceGroupInput, 'source')}
                      disabled={isVerifyingSource || !sourceGroupInput.trim()}
                      variant="outline"
                      size="sm"
                    >
                      {isVerifyingSource ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        'Doğrula'
                      )}
                    </Button>
                  </div>
                  {sourceGroupInfo && (
                    <p className="text-sm text-muted-foreground">
                      ✓ {sourceGroupInfo.title}
                    </p>
                  )}
                </div>

                <div className="space-y-2">
                  <Label htmlFor="target-group">Hedef Grup (ID veya @username)</Label>
                  <div className="flex gap-2">
                    <Input
                      id="target-group"
                      placeholder="Örn: -1001234567890 veya @grupadi"
                      value={targetGroupInput}
                      onChange={(e) => setTargetGroupInput(e.target.value)}
                      disabled={isVerifyingTarget}
                    />
                    <Button
                      onClick={() => handleVerifyGroup(targetGroupInput, 'target')}
                      disabled={isVerifyingTarget || !targetGroupInput.trim()}
                      variant="outline"
                      size="sm"
                    >
                      {isVerifyingTarget ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        'Doğrula'
                      )}
                    </Button>
                  </div>
                  {targetGroupInfo && (
                    <p className="text-sm text-muted-foreground">
                      ✓ {targetGroupInfo.title}
                    </p>
                  )}
                </div>

                <div className="space-y-4 pt-2 border-t">
                  <div className="space-y-2">
                    <Label htmlFor="invite-delay">Davet Başına Bekleme (saniye)</Label>
                    <Input
                      id="invite-delay"
                      type="number"
                      min="1"
                      max="30"
                      value={inviteDelay}
                      onChange={(e) => setInviteDelay(Number(e.target.value))}
                    />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="batch-delay">5 Üye Sonrası Bekleme (saniye)</Label>
                    <Input
                      id="batch-delay"
                      type="number"
                      min="10"
                      max="120"
                      value={batchDelay}
                      onChange={(e) => setBatchDelay(Number(e.target.value))}
                    />
                    <p className="text-xs text-muted-foreground">
                      Flood riskini azaltmak için her 5 üye sonrası otomatik bekleme
                    </p>
                  </div>
                </div>

                <Button
                  onClick={handleStartScraping} 
                  disabled={scrapingStatus !== 'idle' || !sourceGroupInfo || !targetGroupInfo}
                  className="w-full"
                >
                  <Play className="mr-2 h-4 w-4" />
                  Üye Çekmeyi Başlat
                </Button>
              </CardContent>
            </Card>
          </div>

          {/* Right Panel - Progress & Logs */}
          <div className="lg:col-span-2 space-y-4">
            {/* Progress Card */}
            {scrapingStatus !== 'idle' && (
              <Card>
                <CardHeader>
                  <CardTitle>İşlem Durumu</CardTitle>
                  <CardDescription>
                    Üye çekme işlemi canlı takip
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="space-y-2">
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-muted-foreground">İlerleme</span>
                      <span className="font-medium">
                        {currentProgress.membersAdded} / {currentProgress.totalTarget} üye
                      </span>
                    </div>
                    <Progress 
                      value={(currentProgress.membersAdded / currentProgress.totalTarget) * 100} 
                      className="h-2"
                    />
                  </div>

                  <div className="grid grid-cols-2 gap-4 text-sm">
                    <div>
                      <p className="text-muted-foreground">Şu Anki Hesap</p>
                      <p className="font-medium">{currentProgress.currentAccount || '-'}</p>
                    </div>
                    <div>
                      <p className="text-muted-foreground">Hesap İlerlemesi</p>
                      <p className="font-medium">
                        {currentProgress.currentAccountIndex} / {currentProgress.totalAccounts}
                      </p>
                    </div>
                  </div>

                  <div className="flex gap-2 pt-2">
                    {scrapingStatus === 'running' && (
                      <Button
                        onClick={handlePauseScraping}
                        variant="outline"
                        className="flex-1"
                      >
                        <Pause className="mr-2 h-4 w-4" />
                        Duraklat
                      </Button>
                    )}
                    {scrapingStatus === 'paused' && (
                      <Button
                        onClick={handleResumeScraping}
                        variant="outline"
                        className="flex-1"
                      >
                        <Play className="mr-2 h-4 w-4" />
                        Devam Et
                      </Button>
                    )}
                    <Button
                      onClick={handleCancelScraping}
                      variant="destructive"
                      className="flex-1"
                      disabled={scrapingStatus === 'cancelled'}
                    >
                      <StopCircle className="mr-2 h-4 w-4" />
                      İptal Et
                    </Button>
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Logs Card */}
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <div>
                    <CardTitle>İşlem Logları</CardTitle>
                    <CardDescription>
                      Üye çekme işlemlerinin detaylı kaydı ({logs?.length || 0})
                    </CardDescription>
                  </div>
                  <Button 
                    variant="outline" 
                    size="sm" 
                    onClick={handleClearLogs}
                    className="gap-2"
                  >
                    <Trash2 className="h-4 w-4" />
                    Temizle
                  </Button>
                </div>
              </CardHeader>
              <CardContent>
                <ScrollArea className="h-[500px] w-full pr-4">
                  {logs && logs.length > 0 ? (
                    <div className="space-y-3">
                      {logs.map((log) => (
                        <div
                          key={log.id}
                          className="p-4 rounded-lg border bg-card hover:bg-accent/50 transition-colors"
                        >
                          <div className="flex items-start justify-between gap-4">
                            <div className="flex-1 space-y-1">
                              <div className="flex items-center gap-2 flex-wrap">
                                {getStatusBadge(log.status)}
                                <span className="text-sm font-medium">
                                  {log.members_added} üye eklendi
                                </span>
                                {(log.details as any)?.account_name && (
                                  <span className="text-xs text-muted-foreground">
                                    ({(log.details as any).account_name})
                                  </span>
                                )}
                              </div>
                              <div className="text-sm text-muted-foreground">
                                <div><strong>Kaynak:</strong> {log.source_group_title}</div>
                                <div><strong>Hedef:</strong> {log.target_group_title}</div>
                              </div>
                              {log.error_message && (
                                <p className="text-sm text-destructive mt-2">
                                  {log.error_message}
                                </p>
                              )}
                              {(log.details as any)?.wait_seconds && (
                                <p className="text-sm text-orange-600 mt-2">
                                  Bekleme süresi: {(log.details as any).wait_seconds} saniye
                                </p>
                              )}
                            </div>
                            <span className="text-xs text-muted-foreground whitespace-nowrap">
                              {new Date(log.created_at).toLocaleString('tr-TR')}
                            </span>
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="flex items-center justify-center h-[200px] text-muted-foreground">
                      Henüz log kaydı bulunmuyor
                    </div>
                  )}
                </ScrollArea>
              </CardContent>
            </Card>
          </div>
        </div>
      </main>
    </div>
  );
}
