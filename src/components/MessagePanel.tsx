import { useState } from 'react';
import { useStore } from '@/store/useStore';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { toast } from 'sonner';
import { Send, Loader2 } from 'lucide-react';

export const MessagePanel = () => {
  const [message, setMessage] = useState('');
  const {
    accounts,
    groups,
    selectedAccountIds,
    selectedGroupIds,
    addLog,
    isSending,
    setIsSending,
  } = useStore();

  const handleSend = async () => {
    if (!message.trim()) {
      toast.error('Mesaj boş olamaz!');
      return;
    }

    if (selectedAccountIds.length === 0) {
      toast.error('Lütfen en az bir hesap seçin!');
      return;
    }

    if (selectedGroupIds.length === 0) {
      toast.error('Lütfen en az bir grup seçin!');
      return;
    }

    setIsSending(true);

    const selectedAccounts = accounts.filter((acc) =>
      selectedAccountIds.includes(acc.id)
    );
    const selectedGroups = groups.filter((grp) =>
      selectedGroupIds.includes(grp.id)
    );

    try {
      for (const account of selectedAccounts) {
        for (const group of selectedGroups) {
          // Check if this account can access this group
          if (!group.accountIds.includes(account.id)) {
            addLog({
              accountName: account.name,
              groupName: group.name,
              status: 'error',
              message: 'Bu hesap bu gruba erişemiyor',
            });
            continue;
          }

          // Simulate sending
          addLog({
            accountName: account.name,
            groupName: group.name,
            status: 'pending',
            message: 'Gönderiliyor...',
          });

          // Fake delay
          await new Promise((resolve) => setTimeout(resolve, 800 + Math.random() * 400));

          // Simulate random success/failure
          const success = Math.random() > 0.1; // 90% success rate

          addLog({
            accountName: account.name,
            groupName: group.name,
            status: success ? 'success' : 'error',
            message: success ? 'Mesaj gönderildi' : 'Gönderim başarısız',
          });
        }
      }

      toast.success('Tüm mesajlar işlendi!', {
        description: `${selectedAccounts.length} hesaptan ${selectedGroups.length} gruba mesaj gönderildi.`,
      });

      setMessage('');
    } catch (error) {
      toast.error('Bir hata oluştu!');
    } finally {
      setIsSending(false);
    }
  };

  return (
    <div className="bg-card rounded-xl p-6 border border-border h-full flex flex-col">
      <div className="flex items-center gap-2 mb-4">
        <Send className="w-5 h-5 text-primary" />
        <h2 className="text-lg font-semibold text-foreground">Mesaj Gönder</h2>
      </div>

      <div className="flex-1 flex flex-col gap-4">
        <Textarea
          placeholder="Mesajınızı buraya yazın..."
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          className="flex-1 min-h-[200px] resize-none bg-muted/30 border-border focus:border-primary transition-colors"
          disabled={isSending}
        />

        <div className="flex items-center justify-between">
          <div className="text-sm text-muted-foreground">
            <span className="font-medium text-primary">{selectedAccountIds.length}</span> hesap,{' '}
            <span className="font-medium text-secondary">{selectedGroupIds.length}</span> grup seçili
          </div>
          <Button
            onClick={handleSend}
            disabled={
              isSending ||
              !message.trim() ||
              selectedAccountIds.length === 0 ||
              selectedGroupIds.length === 0
            }
            className="bg-primary hover:bg-primary/90 text-primary-foreground min-w-[120px]"
          >
            {isSending ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                Gönderiliyor...
              </>
            ) : (
              <>
                <Send className="w-4 h-4 mr-2" />
                Gönder
              </>
            )}
          </Button>
        </div>
      </div>
    </div>
  );
};
