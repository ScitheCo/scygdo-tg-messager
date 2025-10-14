import { useState } from 'react';
import { useStore } from '@/store/useStore';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { toast } from 'sonner';
import { Send, Loader2 } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { TelegramClient } from 'telegram';
import { StringSession } from 'telegram/sessions/StringSession';

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
        // Get account credentials
        const { data: accountData } = await supabase
          .from('telegram_accounts')
          .select('session_string, api_credential_id')
          .eq('id', accountId)
          .single();

        if (!accountData) {
          toast.error('Hesap bilgileri bulunamadı');
          continue;
        }

        const { data: apiData } = await supabase
          .from('telegram_api_credentials')
          .select('api_id, api_hash')
          .eq('id', accountData.api_credential_id)
          .single();

        if (!apiData) {
          toast.error('API bilgileri bulunamadı');
          continue;
        }

        // Initialize Telegram client
        const stringSession = new StringSession(accountData.session_string);
        const client = new TelegramClient(
          stringSession,
          parseInt(apiData.api_id),
          apiData.api_hash,
          { connectionRetries: 5 }
        );

        try {
          await client.connect();

          for (const group of groups) {
            // Check if this group belongs to this account
            if (group.account_id !== accountId.toString()) continue;

            // Log the message attempt
            const { error: logError } = await supabase.from('message_logs').insert({
              account_id: accountId,
              group_id: group.id,
              message_text: message,
              status: 'pending'
            });

            if (logError) {
              console.error('Log error:', logError);
            }

            try {
              // Get the entity first to ensure proper ID format
              const entity = await client.getEntity(group.telegram_id.toString());
              
              // Send the actual message
              await client.sendMessage(entity, { message });
              
              // Log success
              await supabase.from('message_logs').insert({
                account_id: accountId,
                group_id: group.id,
                message_text: message,
                status: 'success'
              });
            } catch (error: any) {
              // Log error
              await supabase.from('message_logs').insert({
                account_id: accountId,
                group_id: group.id,
                message_text: message,
                status: 'error',
                error_message: error.message
              });
              console.error('Message send error:', error);
            }
          }

          await client.disconnect();
        } catch (error: any) {
          console.error('Client error:', error);
          toast.error(`Hesap bağlantı hatası: ${error.message}`);
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
