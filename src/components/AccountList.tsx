import { useStore } from '@/store/useStore';
import { Checkbox } from '@/components/ui/checkbox';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Users, CheckSquare, Square, Trash2, RefreshCw } from 'lucide-react';
import { AddAccountDialog } from './AddAccountDialog';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { TelegramClient } from 'telegram';
import { StringSession } from 'telegram/sessions';

export const AccountList = () => {
  const {
    selectedAccountIds,
    toggleAccount,
    deselectAllAccounts,
  } = useStore();

  const queryClient = useQueryClient();

  const { data: accounts = [], refetch } = useQuery({
    queryKey: ['telegram-accounts'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('telegram_accounts')
        .select('*')
        .order('created_at', { ascending: false });
      
      if (error) throw error;
      return data || [];
    }
  });

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

      // Session geçerli mi?
      try {
        await client.getMe();
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

      // 5) Eski kayıtları sil ve yenilerini ekle
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
            className={`flex items-center gap-3 p-2.5 md:p-3 rounded-lg border transition-all duration-200 ${
              selectedAccountIds.includes(account.id.toString())
                ? 'bg-primary/10 border-primary'
                : 'bg-muted/30 border-border hover:bg-muted/50'
            } ${!account.is_active ? 'opacity-50' : ''}`}
          >
            <Checkbox
              checked={selectedAccountIds.includes(account.id.toString())}
              onCheckedChange={() => toggleAccount(account.id.toString())}
              disabled={!account.is_active}
                className="border-border data-[state=checked]:bg-primary data-[state=checked]:border-primary"
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
                    <Badge variant="default" className="text-xs bg-success">
                      Aktif
                    </Badge>
                  )}
                </div>
                <p className="text-xs text-muted-foreground mt-1">
                  {account.phone_number}
                </p>
              </div>
              <div className="flex gap-1">
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
  );
};
