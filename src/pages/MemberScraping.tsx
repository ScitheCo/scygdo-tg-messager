import { useState } from 'react';
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

const DAILY_LIMIT_PER_ACCOUNT = 50; // Spam limiti - günlük hesap başına üye ekleme limiti

export default function MemberScraping() {
  const { user, isSuperAdmin } = useAuth();
  const [showAllAccounts, setShowAllAccounts] = useState(true);
  const [sourceGroupId, setSourceGroupId] = useState('');
  const [targetGroupId, setTargetGroupId] = useState('');
  const [isScraperRunning, setIsScraperRunning] = useState(false);

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

  // Fetch all groups for selection
  const { data: allGroups } = useQuery({
    queryKey: ['all-telegram-groups'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('telegram_groups')
        .select('*')
        .order('title', { ascending: true });
      
      if (error) throw error;
      return data;
    },
    enabled: !!user && isSuperAdmin
  });

  // Fetch scraping logs
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
    refetchInterval: 3000
  });

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
    if (!sourceGroupId || !targetGroupId) {
      toast.error('Lütfen kaynak ve hedef grupları seçin');
      return;
    }

    if (!accounts || accounts.length === 0) {
      toast.error('Aktif hesap bulunamadı');
      return;
    }

    setIsScraperRunning(true);
    toast.info('Üye çekme işlemi başlatılıyor...');

    try {
      const sourceGroup = allGroups?.find(g => g.id === sourceGroupId);
      const targetGroup = allGroups?.find(g => g.id === targetGroupId);

      if (!sourceGroup || !targetGroup) {
        throw new Error('Gruplar bulunamadı');
      }

      // Get today's date for checking limits
      const today = new Date().toISOString().split('T')[0];

      for (const account of accounts) {
        // Check if account has reached daily limit
        const { data: limitData } = await supabase
          .from('account_daily_limits')
          .select('members_added_today')
          .eq('account_id', account.id)
          .eq('date', today)
          .single();

        if (limitData && limitData.members_added_today >= DAILY_LIMIT_PER_ACCOUNT) {
          await supabase.from('member_scraping_logs').insert({
            created_by: user?.id,
            account_id: account.id,
            source_group_id: sourceGroupId,
            target_group_id: targetGroupId,
            source_group_title: sourceGroup.title,
            target_group_title: targetGroup.title,
            members_added: 0,
            status: 'skipped',
            error_message: `Günlük limit aşıldı (${DAILY_LIMIT_PER_ACCOUNT} üye)`,
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
          const sourceEntity = await client.getEntity(sourceGroup.telegram_id);
          const participants = await client.getParticipants(sourceEntity, { limit: 200 });

          const targetEntity = await client.getEntity(targetGroup.telegram_id);
          
          let addedCount = 0;
          const currentLimit = limitData?.members_added_today || 0;
          const remainingLimit = DAILY_LIMIT_PER_ACCOUNT - currentLimit;

          for (const participant of participants) {
            if (addedCount >= remainingLimit) {
              toast.warning(`${account.name || account.phone_number} günlük limitine ulaştı`);
              break;
            }

            try {
              // Try to add user to target group
              await client.invoke(
                new Api.channels.InviteToChannel({
                  channel: targetEntity,
                  users: [participant],
                })
              );

              addedCount++;
              toast.success(`Üye eklendi (${addedCount}/${remainingLimit})`);

              // Wait to avoid flood limits
              await new Promise(resolve => setTimeout(resolve, 2000));
            } catch (error: any) {
              console.error('Error adding member:', error);
              
              if (error.message?.includes('FLOOD')) {
                toast.error('Flood hatası! Sonraki hesaba geçiliyor...');
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
            source_group_id: sourceGroupId,
            target_group_id: targetGroupId,
            source_group_title: sourceGroup.title,
            target_group_title: targetGroup.title,
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
            source_group_id: sourceGroupId,
            target_group_id: targetGroupId,
            source_group_title: sourceGroup.title,
            target_group_title: targetGroup.title,
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
                  <p className="text-xs text-muted-foreground">
                    Günlük limit: {DAILY_LIMIT_PER_ACCOUNT} üye/hesap
                  </p>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="source-group">Kaynak Grup</Label>
                  <Select value={sourceGroupId} onValueChange={setSourceGroupId}>
                    <SelectTrigger id="source-group">
                      <SelectValue placeholder="Grup seçin..." />
                    </SelectTrigger>
                    <SelectContent>
                      {allGroups?.map((group) => (
                        <SelectItem key={group.id} value={group.id}>
                          {group.title}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="target-group">Hedef Grup</Label>
                  <Select value={targetGroupId} onValueChange={setTargetGroupId}>
                    <SelectTrigger id="target-group">
                      <SelectValue placeholder="Grup seçin..." />
                    </SelectTrigger>
                    <SelectContent>
                      {allGroups?.map((group) => (
                        <SelectItem key={group.id} value={group.id}>
                          {group.title}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <Button 
                  onClick={handleStartScraping} 
                  disabled={isScraperRunning || !sourceGroupId || !targetGroupId}
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
