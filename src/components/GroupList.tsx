import { useStore } from '@/store/useStore';
import { Checkbox } from '@/components/ui/checkbox';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { MessageSquare, CheckSquare, Square, Users2 } from 'lucide-react';
import { useMemo } from 'react';

export const GroupList = () => {
  const {
    groups,
    selectedAccountIds,
    selectedGroupIds,
    toggleGroup,
    selectAllGroups,
    deselectAllGroups,
  } = useStore();

  const availableGroups = useMemo(() => {
    if (selectedAccountIds.length === 0) return [];
    return groups.filter((group) =>
      group.accountIds.some((accId) => selectedAccountIds.includes(accId))
    );
  }, [groups, selectedAccountIds]);

  const allSelected = availableGroups.length > 0 &&
    availableGroups.every((grp) => selectedGroupIds.includes(grp.id));

  if (selectedAccountIds.length === 0) {
    return (
      <div className="bg-card rounded-xl p-6 border border-border text-center">
        <Users2 className="w-12 h-12 text-muted-foreground mx-auto mb-3 opacity-50" />
        <p className="text-muted-foreground">
          Grupları görmek için önce hesap seçin
        </p>
      </div>
    );
  }

  return (
    <div className="bg-card rounded-xl p-4 border border-border">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <MessageSquare className="w-5 h-5 text-secondary" />
          <h2 className="text-lg font-semibold text-foreground">Gruplar</h2>
          {selectedGroupIds.length > 0 && (
            <Badge variant="secondary" className="bg-secondary/20 text-secondary">
              {selectedGroupIds.length} seçili
            </Badge>
          )}
        </div>
        {availableGroups.length > 0 && (
          <div className="flex gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={allSelected ? deselectAllGroups : selectAllGroups}
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
        )}
      </div>

      <div className="space-y-2 max-h-[400px] overflow-y-auto pr-2 custom-scrollbar">
        {availableGroups.map((group) => (
          <div
            key={group.id}
            className={`flex items-center gap-3 p-3 rounded-lg border transition-all duration-200 ${
              selectedGroupIds.includes(group.id)
                ? 'bg-secondary/10 border-secondary'
                : 'bg-muted/30 border-border hover:bg-muted/50'
            }`}
          >
            <Checkbox
              checked={selectedGroupIds.includes(group.id)}
              onCheckedChange={() => toggleGroup(group.id)}
              className="border-border data-[state=checked]:bg-secondary data-[state=checked]:border-secondary"
            />
            <div className="flex-1 min-w-0">
              <p className="font-medium text-foreground truncate">{group.name}</p>
              <div className="flex items-center gap-2 mt-1">
                <p className="text-xs text-muted-foreground font-mono">
                  ID: {group.chatId}
                </p>
                <Badge variant="outline" className="text-xs">
                  {group.memberCount.toLocaleString('tr-TR')} üye
                </Badge>
              </div>
              <p className="text-xs text-muted-foreground mt-1 truncate">
                Hash: {group.accessHash}
              </p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};
