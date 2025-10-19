import { useState, useEffect } from 'react';
import { Header } from '@/components/Header';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { toast } from 'sonner';
import { Loader2, Play, Trash2 } from 'lucide-react';
import { TelegramClient } from 'telegram';
import { StringSession } from 'telegram/sessions';
import { Api } from 'telegram/tl';
import { Input } from '@/components/ui/input';

const DEFAULT_DAILY_LIMIT = 50; // Varsayılan günlük limit
const DEFAULT_INVITE_DELAY = 3; // Davet başına bekleme süresi (saniye)
const DEFAULT_BATCH_DELAY = 40; // 5 üye sonrası bekleme süresi (saniye)
const DEFAULT_FLOOD_WAIT_DELAY = 5; // FLOOD_WAIT sonrası bekleme (dakika)

export default function MemberScraping() {
  const { user, isSuperAdmin } = useAuth();
  const [showAllAccounts, setShowAllAccounts] = useState(true);
  const [sourceGroupInput, setSourceGroupInput] = useState('');
  const [targetGroupInput, setTargetGroupInput] = useState('');
  const [sourceGroupInfo, setSourceGroupInfo] = useState<any>(null);
  const [targetGroupInfo, setTargetGroupInfo] = useState<any>(null);
  const [isScraperRunning, setIsScraperRunning] = useState(false);
  const [isVerifyingSource, setIsVerifyingSource] = useState(false);
  const [isVerifyingTarget, setIsVerifyingTarget] = useState(false);
  const [dailyLimit, setDailyLimit] = useState(DEFAULT_DAILY_LIMIT);
  const [inviteDelay, setInviteDelay] = useState(DEFAULT_INVITE_DELAY);
  const [batchDelay, setBatchDelay] = useState(DEFAULT_BATCH_DELAY);
  const [floodWaitDelay, setFloodWaitDelay] = useState(DEFAULT_FLOOD_WAIT_DELAY);

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

  const handleStartScraping = async () => {
    if (!sourceGroupInfo || !targetGroupInfo) {
      toast.error('Lütfen önce grupları doğrulayın');
      return;
    }

    if (!accounts || accounts.length === 0) {
      toast.error('Aktif hesap bulunamadı');
      return;
    }

    setIsScraperRunning(true);
    toast.info('Üye çekme işlemi başlatılıyor...');

    try {

      // Get today's date for checking limits (UTC based - Telegram resets limits at UTC 00:00)
      const today = new Date().toISOString().split('T')[0];

      for (const account of accounts) {
        // Check if account has reached daily limit
        const { data: limitData } = await supabase
          .from('account_daily_limits')
          .select('members_added_today')
          .eq('account_id', account.id)
          .eq('date', today)
          .single();

        if (limitData && limitData.members_added_today >= dailyLimit) {
          await supabase.from('member_scraping_logs').insert({
            created_by: user?.id,
            account_id: account.id,
            source_group_id: sourceGroupInfo.id,
            target_group_id: targetGroupInfo.id,
            source_group_title: sourceGroupInfo.title,
            target_group_title: targetGroupInfo.title,
            members_added: 0,
            status: 'skipped',
            error_message: `Günlük limit aşıldı (${dailyLimit} üye)`,
          });
          
          toast.warning(`${account.name || account.phone_number} hesabı günlük limitini aştı`);
          continue;
        }

        try {
          // Connect to Telegram
          const client = new TelegramClient(
            new StringSession(account.session_string || ''),
            parseInt(account.telegram_api_credentials.api_id),
            account.telegram_api_credentials.api_hash,
            { connectionRetries: 5 }
          );

          await client.connect();
          
          toast.info(`${account.name || account.phone_number} hesabıyla üye çekimi başlatıldı`);

          // Get members from source group
          const sourceEntity = await client.getEntity(sourceGroupInput);
          const participants = await client.getParticipants(sourceEntity, { limit: 200 });

          const targetEntity = await client.getEntity(targetGroupInput);
          
          let addedCount = 0;
          const currentLimit = limitData?.members_added_today || 0;
          const remainingLimit = dailyLimit - currentLimit;

          for (const participant of participants) {
            if (addedCount >= remainingLimit) {
              toast.warning(`${account.name || account.phone_number} günlük limitine ulaştı`);
              break;
            }

            try {
              // Skip bots and deleted accounts
              if ((participant as any).bot || (participant as any).deleted) {
                continue;
              }

              // Skip restricted users
              if ((participant as any).restricted) {
                continue;
              }

              // Check user activity status - only add recently active users
              const status = (participant as any).status;
              if (status) {
                const statusClass = status.className;
                // Skip if user hasn't been active recently
                // Accept: UserStatusOnline, UserStatusRecently (within last few days)
                // Skip: UserStatusLastWeek, UserStatusLastMonth, UserStatusOffline (long time)
                if (statusClass === 'UserStatusLastWeek' || 
                    statusClass === 'UserStatusLastMonth' || 
                    statusClass === 'UserStatusOffline') {
                  continue;
                }
              }

              // Try to add user to target group using user ID
              await client.invoke(
                new Api.channels.InviteToChannel({
                  channel: targetEntity,
                  users: [await client.getInputEntity(participant.id)],
                })
              );

              addedCount++;
              toast.success(`Üye eklendi (${addedCount}/${remainingLimit})`);

              // Wait based on settings
              if (addedCount % 5 === 0) {
                toast.info(`5 üye eklendi, ${batchDelay} saniye bekleniyor...`);
                await new Promise(resolve => setTimeout(resolve, batchDelay * 1000));
              } else {
                await new Promise(resolve => setTimeout(resolve, inviteDelay * 1000));
              }
            } catch (error: any) {
              console.error('Error adding member:', error);
              
              // Check for privacy/permission errors
              if (error.message?.includes('USER_PRIVACY_RESTRICTED') || 
                  error.message?.includes('USER_NOT_MUTUAL_CONTACT') ||
                  error.message?.includes('USER_CHANNELS_TOO_MUCH')) {
                // Skip this user silently - privacy settings prevent adding
                continue;
              }
              
              if (error.message?.includes('FLOOD')) {
                toast.error(`Flood hatası! ${floodWaitDelay} dakika bekleniyor...`);
                await new Promise(resolve => setTimeout(resolve, floodWaitDelay * 60 * 1000));
                break;
              }
            }
          }

          await client.disconnect();

          // Update daily limit
          await supabase.from('account_daily_limits').upsert({
            account_id: account.id,
            date: today,
            members_added_today: currentLimit + addedCount,
            last_used_at: new Date().toISOString(),
          });

          // Log the operation
          await supabase.from('member_scraping_logs').insert({
            created_by: user?.id,
            account_id: account.id,
            source_group_id: sourceGroupInfo.id,
            target_group_id: targetGroupInfo.id,
            source_group_title: sourceGroupInfo.title,
            target_group_title: targetGroupInfo.title,
            members_added: addedCount,
            status: 'success',
          });

          if (addedCount < remainingLimit) {
            toast.info('Tüm uygun üyeler eklendi veya limit doldu');
            break;
          }
        } catch (error: any) {
          console.error('Account error:', error);
          
          await supabase.from('member_scraping_logs').insert({
            created_by: user?.id,
            account_id: account.id,
            source_group_id: sourceGroupInfo.id,
            target_group_id: targetGroupInfo.id,
            source_group_title: sourceGroupInfo.title,
            target_group_title: targetGroupInfo.title,
            members_added: 0,
            status: 'error',
            error_message: error.message || 'Bilinmeyen hata',
          });
        }
      }

      toast.success('Üye çekme işlemi tamamlandı');
      refetchLogs();
    } catch (error: any) {
      console.error('Scraping error:', error);
      toast.error('İşlem sırasında hata oluştu: ' + error.message);
    } finally {
      setIsScraperRunning(false);
    }
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'success':
        return <Badge variant="default">Başarılı</Badge>;
      case 'error':
        return <Badge variant="destructive">Hata</Badge>;
      case 'skipped':
        return <Badge variant="secondary">Atlandı</Badge>;
      default:
        return <Badge variant="outline">{status}</Badge>;
    }
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
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="flood-delay">FLOOD Sonrası Bekleme (dakika)</Label>
                    <Input
                      id="flood-delay"
                      type="number"
                      min="1"
                      max="60"
                      value={floodWaitDelay}
                      onChange={(e) => setFloodWaitDelay(Number(e.target.value))}
                    />
                  </div>
                </div>

                <Button
                  onClick={handleStartScraping} 
                  disabled={isScraperRunning || !sourceGroupInfo || !targetGroupInfo}
                  className="w-full"
                >
                  {isScraperRunning ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      İşlem Devam Ediyor...
                    </>
                  ) : (
                    <>
                      <Play className="mr-2 h-4 w-4" />
                      Üye Çekmeyi Başlat
                    </>
                  )}
                </Button>
              </CardContent>
            </Card>
          </div>

          {/* Right Panel - Logs */}
          <div className="lg:col-span-2">
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
                <ScrollArea className="h-[600px] w-full pr-4">
                  {logs && logs.length > 0 ? (
                    <div className="space-y-3">
                      {logs.map((log) => (
                        <div
                          key={log.id}
                          className="p-4 rounded-lg border bg-card hover:bg-accent/50 transition-colors"
                        >
                          <div className="flex items-start justify-between gap-4">
                            <div className="flex-1 space-y-1">
                              <div className="flex items-center gap-2">
                                {getStatusBadge(log.status)}
                                <span className="text-sm font-medium">
                                  {log.members_added} üye eklendi
                                </span>
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
