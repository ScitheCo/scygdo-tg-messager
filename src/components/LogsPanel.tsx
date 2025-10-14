import { useQuery } from '@tanstack/react-query';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ClipboardList, Trash2 } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

export const LogsPanel = () => {
  const { data: logs = [], refetch } = useQuery({
    queryKey: ['message-logs'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('message_logs')
        .select(`
          *,
          telegram_accounts(phone_number),
          telegram_groups(title)
        `)
        .order('created_at', { ascending: false })
        .limit(50);
      
      if (error) throw error;
      return data || [];
    },
    refetchInterval: 3000 // Refresh every 3 seconds
  });

  const handleClearLogs = async () => {
    try {
      const { error } = await supabase
        .from('message_logs')
        .delete()
        .neq('id', '00000000-0000-0000-0000-000000000000'); // Delete all
      
      if (error) throw error;
      
      toast.success('Loglar temizlendi');
      refetch();
    } catch (error: any) {
      toast.error('Loglar temizlenemedi: ' + error.message);
    }
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'success':
        return <Badge className="bg-success text-success-foreground">Başarılı</Badge>;
      case 'error':
        return <Badge variant="destructive">Hata</Badge>;
      case 'pending':
        return <Badge variant="secondary">Gönderiliyor</Badge>;
      default:
        return <Badge variant="outline">{status}</Badge>;
    }
  };

  return (
    <div className="bg-card rounded-xl p-4 border border-border h-full flex flex-col">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <ClipboardList className="w-5 h-5 text-accent" />
          <h2 className="text-lg font-semibold text-foreground">Gönderim Logları</h2>
          {logs.length > 0 && (
            <Badge variant="outline">{logs.length} kayıt</Badge>
          )}
        </div>
        {logs.length > 0 && (
          <Button
            variant="ghost"
            size="sm"
            onClick={handleClearLogs}
            className="h-8 text-xs hover:bg-destructive/20 hover:text-destructive"
          >
            <Trash2 className="w-3 h-3 mr-1" />
            Temizle
          </Button>
        )}
      </div>

      <ScrollArea className="flex-1 pr-4">
        <div className="space-y-2">
          {logs.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              <p>Henüz log kaydı yok</p>
              <p className="text-sm mt-1">Mesaj gönderdiğinizde burada görünecektir</p>
            </div>
          ) : (
            logs.map((log: any) => (
              <div
                key={log.id}
                className="p-3 rounded-lg bg-muted/30 border border-border hover:bg-muted/50 transition-colors"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1 min-w-0 space-y-1">
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-medium text-foreground truncate">
                        {log.telegram_accounts?.phone_number || 'Bilinmeyen hesap'}
                      </p>
                      <span className="text-muted-foreground">→</span>
                      <p className="text-sm font-medium text-foreground truncate">
                        {log.telegram_groups?.title || 'Bilinmeyen grup'}
                      </p>
                    </div>
                    <p className="text-xs text-muted-foreground line-clamp-2">
                      {log.message_text}
                    </p>
                    {log.error_message && (
                      <p className="text-xs text-destructive">
                        Hata: {log.error_message}
                      </p>
                    )}
                    <p className="text-xs text-muted-foreground">
                      {log.created_at ? new Date(log.created_at).toLocaleString('tr-TR') : ''}
                    </p>
                  </div>
                  {getStatusBadge(log.status)}
                </div>
              </div>
            ))
          )}
        </div>
      </ScrollArea>
    </div>
  );
};
