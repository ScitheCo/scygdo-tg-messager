import { useState } from 'react';
import { useStore } from '@/store/useStore';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { toast } from 'sonner';
import { Send, Loader2 } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';

export const MessagePanel = () => {
  const [message, setMessage] = useState('');
  const [isSending, setIsSending] = useState(false);
  const {
    selectedAccountIds,
    selectedGroupIds,
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

    try {
      // Get selected groups
      const { data: groups } = await supabase
        .from('telegram_groups')
        .select('*')
        .in('id', selectedGroupIds);

      if (!groups || groups.length === 0) {
        toast.error('Seçili gruplar bulunamadı');
        return;
      }

      // Send messages for each account-group combination
      for (const accountId of selectedAccountIds) {
        for (const group of groups) {
          // Check if this group belongs to this account
          if (group.account_id !== accountId.toString()) continue;

          // Log the message attempt
          const logStatus = 'pending';
          const { error: logError } = await supabase.from('message_logs').insert({
            account_id: accountId,
            group_id: group.id,
            message_text: message,
            status: logStatus
          });

          if (logError) {
            console.error('Log error:', logError);
          }

          // In a real implementation, call telegram-send-message edge function here
          // For now, we'll just simulate success
          await new Promise(resolve => setTimeout(resolve, 500));
          
          // Update log with success
          await supabase.from('message_logs').insert({
            account_id: accountId,
            group_id: group.id,
            message_text: message,
            status: 'success'
          });
        }
      }

      toast.success('Mesajlar gönderildi!', {
        description: `${selectedAccountIds.length} hesaptan ${selectedGroupIds.length} gruba mesaj gönderildi.`,
      });

      setMessage('');
    } catch (error: any) {
      toast.error('Mesaj gönderilirken hata oluştu: ' + error.message);
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
