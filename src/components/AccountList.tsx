import { useStore } from '@/store/useStore';
import { Checkbox } from '@/components/ui/checkbox';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Users, CheckSquare, Square } from 'lucide-react';

export const AccountList = () => {
  const {
    accounts,
    selectedAccountIds,
    toggleAccount,
    selectAllAccounts,
    deselectAllAccounts,
  } = useStore();

  const activeAccounts = accounts.filter(acc => acc.active);
  const allSelected = activeAccounts.length > 0 && 
    activeAccounts.every((acc) => selectedAccountIds.includes(acc.id));

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
        </div>
      </div>

      <div className="space-y-2 max-h-[400px] overflow-y-auto pr-2 custom-scrollbar">
        {accounts.map((account) => (
          <div
            key={account.id}
            className={`flex items-center gap-3 p-3 rounded-lg border transition-all duration-200 ${
              selectedAccountIds.includes(account.id)
                ? 'bg-primary/10 border-primary'
                : 'bg-muted/30 border-border hover:bg-muted/50'
            } ${!account.active ? 'opacity-50' : ''}`}
          >
            <Checkbox
              checked={selectedAccountIds.includes(account.id)}
              onCheckedChange={() => toggleAccount(account.id)}
              disabled={!account.active}
              className="border-border data-[state=checked]:bg-primary data-[state=checked]:border-primary"
            />
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <p className="font-medium text-foreground truncate">{account.name}</p>
                {!account.active && (
                  <Badge variant="destructive" className="text-xs">
                    Pasif
                  </Badge>
                )}
              </div>
              <p className="text-sm text-muted-foreground">{account.username}</p>
              <p className="text-xs text-muted-foreground">{account.phone}</p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};
