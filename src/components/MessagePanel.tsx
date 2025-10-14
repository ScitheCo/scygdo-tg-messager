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
              // Resolve entity robustly: prefer username, then cached dialogs by id, then fallback
              let target: any = null;

              if (group.username) {
                try {
                  target = await client.getEntity(group.username);
                } catch (_) {}
              }

              if (!target) {
                try {
                  const dialogs: any[] = await client.getDialogs({ limit: 500 });
                  const match = dialogs.find((d: any) => {
                    const ent = d?.entity;
                    return (
                      ent && (
                        String(ent.id) === String(group.telegram_id) ||
                        (group.username && ent.username && ent.username.toLowerCase() === String(group.username).toLowerCase())
                      )
                    );
                  });
                  if (match?.entity) target = match.entity;
                } catch (_) {}
              }

              if (!target) {
                // Final fallback: try resolving by numeric id as string
                target = await client.getEntity(String(group.telegram_id));
              }

              await client.sendMessage(target, { message });
              
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
                error_message: error?.message || 'Unknown error'
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
    <div className="bg-card rounded-xl p-4 md:p-6 border border-border">
      <div className="flex items-center gap-2 mb-4">
        <Send className="w-5 h-5 text-primary" />
        <h2 className="text-lg font-semibold text-foreground">Mesaj Gönder</h2>
      </div>

      <div className="space-y-4">
        <Textarea
          placeholder="Mesajınızı buraya yazın..."
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          className="h-32 md:h-40 resize-none bg-muted/30 border-border focus:border-primary transition-colors"
          disabled={isSending}
        />

        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
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
            className="bg-primary hover:bg-primary/90 text-primary-foreground w-full sm:w-auto min-w-[120px]"
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
