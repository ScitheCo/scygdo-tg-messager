import { useStore } from '@/store/useStore';
import { Checkbox } from '@/components/ui/checkbox';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Users, CheckSquare, Square, Trash2, RefreshCw, AlertTriangle } from 'lucide-react';
import { AddAccountDialog } from './AddAccountDialog';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { TelegramClient } from 'telegram';
import { StringSession } from 'telegram/sessions';
import { useAuth } from '@/hooks/useAuth';
import { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';

interface SessionTestResult {
  account_id: string;
  phone_number: string;
  status: 'ok' | 'invalid_session' | 'rate_limited' | 'connection_timeout' | 'dc_migrate_required' | 'unknown_error';
  message?: string;
}

export const AccountList = () => {
  const { user } = useAuth();
  const {
    selectedAccountIds,
    toggleAccount,
    deselectAllAccounts,
  } = useStore();

  const queryClient = useQueryClient();
  const [isTestingSession, setIsTestingSession] = useState(false);
  const [sessionTestResults, setSessionTestResults] = useState<SessionTestResult[]>([]);
  const [showResultsDialog, setShowResultsDialog] = useState(false);
  const [showDeactivateDialog, setShowDeactivateDialog] = useState(false);

  const { data: accounts = [], refetch } = useQuery({
    queryKey: ['telegram-accounts', user?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('telegram_accounts')
        .select('*')
        .eq('created_by', user?.id)
        .order('created_at', { ascending: false });
      
      if (error) throw error;
      return data || [];
    },
    enabled: !!user
  });

  // Fetch account health status
  const { data: healthStatuses = [] } = useQuery<any[]>({
    queryKey: ['account-health', user?.id],
    queryFn: async () => {
      const accountIds = accounts.map(a => a.id);
      if (accountIds.length === 0) return [];

      const { data, error } = await (supabase as any)
        .from('account_health_status')
        .select('*')
        .in('account_id', accountIds as any);

      if (error) throw error;
      return data || [];
    },
    enabled: !!user && accounts.length > 0
  });

  // Fetch daily limits for accounts
  const { data: dailyLimits = [] } = useQuery({
    queryKey: ['account-daily-limits', user?.id],
    queryFn: async () => {
      const today = new Date().toISOString().split('T')[0]; // UTC date
      const accountIds = accounts.map(acc => acc.id);
      
      if (accountIds.length === 0) return [];
      
      const { data, error } = await supabase
        .from('account_daily_limits')
        .select('*')
        .eq('date', today)
        .in('account_id', accountIds);
      
      if (error) throw error;
      return data || [];
    },
    enabled: !!user && accounts.length > 0
  });

  // Helper to check if account has reached daily limit
  const getAccountLimitStatus = (accountId: string) => {
    const limit = dailyLimits.find(l => l.account_id === accountId);
    return limit;
  };

  // Helper to get account health status
  const getAccountHealth = (accountId: string) => {
    return healthStatuses.find(h => h.account_id === accountId);
  };

  const getHealthBadge = (status: string) => {
    const variants = {
      ok: { label: '✓', className: 'bg-green-600 hover:bg-green-600' },
      invalid_session: { label: '✗', className: 'bg-red-600 hover:bg-red-600' },
      rate_limited: { label: '⏱', className: 'bg-yellow-600 hover:bg-yellow-600' },
      connection_timeout: { label: '⏸', className: 'bg-gray-500 hover:bg-gray-500' },
      dc_migrate_required: { label: '↔', className: 'bg-purple-600 hover:bg-purple-600' },
      unknown_error: { label: '?', className: 'bg-orange-600 hover:bg-orange-600' }
    };
    const config = variants[status as keyof typeof variants];
    if (!config) return null;
    return <Badge variant="default" className={`text-xs ${config.className}`}>{config.label}</Badge>;
  };

  const activeAccounts = accounts.filter(acc => acc.is_active);
  const allSelected = activeAccounts.length > 0 && 
    activeAccounts.every((acc) => selectedAccountIds.includes(acc.id.toString()));
  
  const handleSelectAll = () => {
    const allActiveIds = activeAccounts.map(acc => acc.id.toString());
    useStore.setState({ selectedAccountIds: allActiveIds });
  };

  const handleDeleteAccount = async (accountId: string) => {
    try {
      const { error } = await supabase
        .from('telegram_accounts')
        .delete()
        .eq('id', accountId);

      if (error) throw error;

      toast.success('Hesap silindi');
      refetch();
    } catch (error: any) {
      toast.error('Hesap silinemedi: ' + error.message);
    }
  };

  const handleTestSessions = async () => {
    setIsTestingSession(true);
    const toastId = toast.loading('Oturumlar test ediliyor...');
    
    try {
      const { data, error } = await supabase.functions.invoke('validate-telegram-sessions', {
        body: { 
          account_ids: selectedAccountIds.length > 0 ? selectedAccountIds : undefined,
          deactivate_invalid: false 
        }
      });

      if (error) throw error;

      setSessionTestResults(data.results || []);
      setShowResultsDialog(true);

      toast.success(`Test tamamlandı: ${data.summary.ok} başarılı, ${data.summary.invalid_session} geçersiz`, {
        id: toastId
      });
    } catch (error: any) {
      console.error('Session test error:', error);
      toast.error('Oturum testi başarısız: ' + error.message, { id: toastId });
    } finally {
      setIsTestingSession(false);
    }
  };

  const handleDeactivateInvalid = async () => {
    const toastId = toast.loading('Geçersiz oturumlar pasifleştiriliyor...');
    
    try {
      const { data, error } = await supabase.functions.invoke('validate-telegram-sessions', {
        body: { 
          account_ids: selectedAccountIds.length > 0 ? selectedAccountIds : undefined,
          deactivate_invalid: true 
        }
      });

      if (error) throw error;

      setSessionTestResults(data.results || []);
      toast.success(`${data.summary.invalid_session} hesap pasifleştirildi`, { id: toastId });
      
      refetch();
      setShowDeactivateDialog(false);
    } catch (error: any) {
      console.error('Deactivate error:', error);
      toast.error('Pasifleştirme başarısız: ' + error.message, { id: toastId });
    }
  };

  const getStatusBadge = (status: SessionTestResult['status']) => {
    const variants = {
      ok: { variant: 'default' as const, label: '✓ Geçerli', className: 'bg-green-600' },
      invalid_session: { variant: 'destructive' as const, label: '✗ Geçersiz', className: 'bg-red-600' },
      rate_limited: { variant: 'secondary' as const, label: '⏱ Rate Limit', className: 'bg-yellow-600' },
      connection_timeout: { variant: 'secondary' as const, label: '⏸ Zaman Aşımı', className: 'bg-gray-500' },
      dc_migrate_required: { variant: 'secondary' as const, label: '↔ DC Migrasyon', className: 'bg-purple-600' },
      unknown_error: { variant: 'outline' as const, label: '? Bilinmeyen', className: '' }
    };
    
    const config = variants[status];
    return <Badge variant={config.variant} className={config.className}>{config.label}</Badge>;
  };

  const handleSyncGroups = async (accountId: string) => {
    const toastId = toast.loading('Gruplar senkronize ediliyor...');
    
    try {
      // 1) Hesabı getir
      const { data: account, error: accErr } = await supabase
        .from('telegram_accounts')
        .select('id, session_string, is_active, api_credential_id')
        .eq('id', accountId)
        .maybeSingle();

      if (accErr) throw accErr;
      if (!account || !account.session_string || !account.is_active) {
        throw new Error('Hesap aktif değil veya oturum bilgisi eksik');
      }

      // 2) API bilgilerini getir
      const { data: cred, error: credErr } = await supabase
        .from('telegram_api_credentials')
        .select('api_id, api_hash')
        .eq('id', account.api_credential_id)
        .maybeSingle();

      if (credErr) throw credErr;
      if (!cred) throw new Error('API kimlik bilgileri bulunamadı');

      // 3) Telegram client ile bağlan
      const client = new TelegramClient(
        new StringSession(account.session_string as string),
        parseInt(cred.api_id as any),
        cred.api_hash as string,
        { connectionRetries: 5 }
      );

      await client.connect();

      // Session geçerli mi? Aynı zamanda kullanıcı bilgisini al
      let displayName = '';
      try {
        const me = await client.getMe();
        const firstName = (me as any).firstName || '';
        const lastName = (me as any).lastName || '';
        const username = (me as any).username || '';
        displayName = username ? `@${username}` : `${firstName} ${lastName}`.trim();
      } catch (e) {
        await client.disconnect();
        throw new Error('Oturum geçersiz. Hesabı tekrar ekleyin.');
      }

      // 4) Dialogları al ve grupları/kanalları çıkar
      const dialogs = await client.getDialogs({ limit: 200 });
      const groupsToInsert: any[] = [];

      for (const dialog of dialogs) {
        const entity: any = dialog.entity;
        if (!entity) continue;
        if (entity.className === 'Channel' || entity.className === 'Chat') {
          const isChannel = entity.className === 'Channel' && entity.broadcast === true;
          groupsToInsert.push({
            account_id: accountId,
            telegram_id: entity.id?.toString?.() ?? String(entity.id),
            title: entity.title || 'Untitled',
            username: entity.username || null,
            is_channel: isChannel,
          });
        }
      }

      await client.disconnect();

      // 5) Hesap ismini güncelle (eğer yoksa)
      if (displayName) {
        await supabase
          .from('telegram_accounts')
          .update({ name: displayName })
          .eq('id', accountId);
      }

      // 6) Eski kayıtları sil ve yenilerini ekle
      await supabase.from('telegram_groups').delete().eq('account_id', accountId);

      if (groupsToInsert.length > 0) {
        const { error: insertErr } = await supabase
          .from('telegram_groups')
          .insert(groupsToInsert);
        if (insertErr) throw insertErr;
      }

      await queryClient.invalidateQueries({ queryKey: ['telegram-groups'] });

      toast.success(`${groupsToInsert.length} grup/kanal senkronize edildi`, { id: toastId });
    } catch (error: any) {
      console.error('Sync error:', error);
      toast.error('Senkronizasyon hatası: ' + (error.message || 'Bilinmeyen hata'), { id: toastId });
    }
  };

  return (
    <>
      <div className="bg-card rounded-xl p-4 md:p-4 border border-border">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4">
          <div className="flex items-center gap-2">
            <Users className="w-5 h-5 text-primary" />
            <h2 className="text-base md:text-lg font-semibold text-foreground">Hesaplar</h2>
            {selectedAccountIds.length > 0 && (
              <Badge variant="secondary" className="bg-primary/20 text-primary text-xs">
                {selectedAccountIds.length} seçili
              </Badge>
            )}
          </div>
          <div className="flex gap-2">
            <AddAccountDialog onAccountAdded={() => refetch()} />
            {activeAccounts.length > 0 && (
              <Button
                variant="ghost"
                size="sm"
                onClick={allSelected ? deselectAllAccounts : handleSelectAll}
                className="h-8 text-xs hover:bg-muted"
              >
                {allSelected ? (
                  <>
                    <Square className="w-3 h-3 mr-1" />
                    Temizle
                  </>
                ) : (
                  <>
                    <CheckSquare className="w-3 h-3 mr-1" />
                    Tümünü Seç
                  </>
                )}
              </Button>
            )}
          </div>
        </div>

      <div className="space-y-2 max-h-[400px] overflow-y-auto pr-2 custom-scrollbar">
        {accounts.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground text-sm">
            <p>Henüz hesap eklenmemiş</p>
            <p className="text-xs mt-1">Başlamak için "Hesap Ekle" butonuna tıklayın</p>
          </div>
        ) : (
          accounts.map((account) => (
            <div
              key={account.id}
              onClick={() => account.is_active && toggleAccount(account.id.toString())}
              className={`flex items-center gap-3 p-2.5 md:p-3 rounded-lg border transition-all duration-200 cursor-pointer ${
                selectedAccountIds.includes(account.id.toString())
                  ? 'bg-primary/10 border-primary'
                  : 'bg-muted/30 border-border hover:bg-muted/50'
              } ${!account.is_active ? 'opacity-50 cursor-not-allowed' : ''}`}
            >
              <Checkbox
                checked={selectedAccountIds.includes(account.id.toString())}
                onCheckedChange={() => toggleAccount(account.id.toString())}
                disabled={!account.is_active}
                className="border-border data-[state=checked]:bg-primary data-[state=checked]:border-primary pointer-events-none"
              />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <p className="text-sm md:text-base font-medium text-foreground truncate">
                    {account.name || account.phone_number}
                  </p>
                  {!account.is_active ? (
                    <Badge variant="destructive" className="text-xs">
                      Pasif
                    </Badge>
                  ) : (
                    <>
                      <Badge variant="default" className="text-xs bg-success">
                        Aktif
                      </Badge>
                      {(() => {
                        const limitStatus = getAccountLimitStatus(account.id);
                        if (limitStatus && limitStatus.members_added_today >= 50) {
                          return (
                            <Badge variant="outline" className="text-xs bg-orange-500/10 text-orange-600 border-orange-500/20">
                              Üye Çekimi Limit Doldu
                            </Badge>
                          );
                        }
                        return null;
                      })()}
                    </>
                  )}
                </div>
                <p className="text-xs text-muted-foreground mt-1">
                  {account.phone_number}
                </p>
              </div>
              <div className="flex gap-1" onClick={(e) => e.stopPropagation()}>
                {account.is_active && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => handleSyncGroups(account.id)}
                    className="h-7 w-7 md:h-8 md:w-8 p-0"
                    title="Grupları senkronize et"
                  >
                    <RefreshCw className="h-3 w-3 md:h-4 md:w-4" />
                  </Button>
                )}
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => handleDeleteAccount(account.id)}
                  className="h-7 w-7 md:h-8 md:w-8 p-0 hover:bg-destructive/20 hover:text-destructive"
                  title="Hesabı sil"
                >
                  <Trash2 className="h-3 w-3 md:h-4 md:w-4" />
                </Button>
              </div>
            </div>
          ))
        )}
      </div>
    </div>

    <Dialog open={showResultsDialog} onOpenChange={setShowResultsDialog}>
      <DialogContent className="max-w-4xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Oturum Test Sonuçları</DialogTitle>
          <DialogDescription>
            Telegram hesap oturumlarınızın durumu
          </DialogDescription>
        </DialogHeader>
        
        <div className="space-y-4">
          {sessionTestResults.filter(r => r.status === 'invalid_session').length > 0 && (
            <div className="flex items-start gap-2 p-3 bg-destructive/10 border border-destructive/20 rounded-lg">
              <AlertTriangle className="h-5 w-5 text-destructive shrink-0 mt-0.5" />
              <div className="flex-1">
                <p className="text-sm font-medium text-destructive">
                  {sessionTestResults.filter(r => r.status === 'invalid_session').length} hesap geçersiz oturum hatası aldı
                </p>
                <p className="text-xs text-muted-foreground mt-1">
                  Bu hesapları pasifleştirmek için aşağıdaki butona tıklayabilirsiniz.
                </p>
              </div>
              <Button
                variant="destructive"
                size="sm"
                onClick={() => setShowDeactivateDialog(true)}
              >
                Geçersizleri Pasifleştir
              </Button>
            </div>
          )}

          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Telefon</TableHead>
                <TableHead>Durum</TableHead>
                <TableHead>Açıklama</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {sessionTestResults.map((result) => (
                <TableRow key={result.account_id}>
                  <TableCell className="font-mono text-sm">{result.phone_number}</TableCell>
                  <TableCell>{getStatusBadge(result.status)}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">{result.message}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </DialogContent>
    </Dialog>

    <AlertDialog open={showDeactivateDialog} onOpenChange={setShowDeactivateDialog}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Geçersiz Hesapları Pasifleştir</AlertDialogTitle>
          <AlertDialogDescription>
            Geçersiz oturum hatası alan {sessionTestResults.filter(r => r.status === 'invalid_session').length} hesap pasifleştirilecek.
            Bu işlem geri alınamaz. Devam etmek istiyor musunuz?
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>İptal</AlertDialogCancel>
          <AlertDialogAction onClick={handleDeactivateInvalid}>
            Pasifleştir
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
    </>
  );
};
