import { useStore } from '@/store/useStore';
import { Checkbox } from '@/components/ui/checkbox';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Users, CheckSquare, Square, Trash2, RefreshCw } from 'lucide-react';
import { AddAccountDialog } from './AddAccountDialog';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

export const AccountList = () => {
  const {
    selectedAccountIds,
    toggleAccount,
    selectAllAccounts,
    deselectAllAccounts,
  } = useStore();

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
    toast.info('Grup senkronizasyonu için telegram-sync-groups edge fonksiyonu kullanılacak');
    // Edge function will be called here
  };

  return (
    <div className="bg-card rounded-xl p-4 border border-border">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <Users className="w-5 h-5 text-primary" />
          <h2 className="text-lg font-semibold text-foreground">Hesaplar</h2>
          {selectedAccountIds.length > 0 && (
            <Badge variant="secondary" className="bg-primary/20 text-primary">
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
              onClick={allSelected ? deselectAllAccounts : selectAllAccounts}
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
          <div className="text-center py-8 text-muted-foreground">
            <p>Henüz hesap eklenmemiş</p>
            <p className="text-sm mt-1">Başlamak için "Hesap Ekle" butonuna tıklayın</p>
          </div>
        ) : (
          accounts.map((account) => (
            <div
              key={account.id}
            className={`flex items-center gap-3 p-3 rounded-lg border transition-all duration-200 ${
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
                <div className="flex items-center gap-2">
                  <p className="font-medium text-foreground truncate">{account.phone_number}</p>
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
                  {account.created_at ? new Date(account.created_at).toLocaleDateString('tr-TR') : ''}
                </p>
              </div>
              <div className="flex gap-1">
                {account.is_active && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => handleSyncGroups(account.id)}
                    className="h-8 w-8 p-0"
                    title="Grupları senkronize et"
                  >
                    <RefreshCw className="h-4 w-4" />
                  </Button>
                )}
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => handleDeleteAccount(account.id)}
                  className="h-8 w-8 p-0 hover:bg-destructive/20 hover:text-destructive"
                  title="Hesabı sil"
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
};
