import { useStore } from '@/store/useStore';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { FileText, Trash2, CheckCircle2, XCircle, Clock } from 'lucide-react';

export const LogsPanel = () => {
  const { logs, clearLogs } = useStore();

  const formatTime = (date: Date) => {
    return new Intl.DateTimeFormat('tr-TR', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    }).format(date);
  };

  const getStatusIcon = (status: 'success' | 'error' | 'pending') => {
    switch (status) {
      case 'success':
        return <CheckCircle2 className="w-4 h-4 text-success" />;
      case 'error':
        return <XCircle className="w-4 h-4 text-destructive" />;
      case 'pending':
        return <Clock className="w-4 h-4 text-muted-foreground animate-pulse" />;
    }
  };

  const getStatusColor = (status: 'success' | 'error' | 'pending') => {
    switch (status) {
      case 'success':
        return 'border-success/30 bg-success/5';
      case 'error':
        return 'border-destructive/30 bg-destructive/5';
      case 'pending':
        return 'border-muted bg-muted/20';
    }
  };

  return (
    <div className="bg-card rounded-xl p-6 border border-border h-full flex flex-col">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <FileText className="w-5 h-5 text-accent" />
          <h2 className="text-lg font-semibold text-foreground">Gönderim Logları</h2>
          {logs.length > 0 && (
            <span className="text-sm text-muted-foreground">({logs.length})</span>
          )}
        </div>
        {logs.length > 0 && (
          <Button
            variant="ghost"
            size="sm"
            onClick={clearLogs}
            className="hover:bg-destructive/10 hover:text-destructive"
          >
            <Trash2 className="w-4 h-4 mr-1" />
            Temizle
          </Button>
        )}
      </div>

      <ScrollArea className="flex-1 pr-4">
        {logs.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full py-12 text-center">
            <FileText className="w-16 h-16 text-muted-foreground opacity-20 mb-4" />
            <p className="text-muted-foreground">Henüz log kaydı yok</p>
            <p className="text-sm text-muted-foreground mt-1">
              Mesaj gönderdiğinizde burada görünecek
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            {logs.map((log) => (
              <div
                key={log.id}
                className={`p-3 rounded-lg border transition-all duration-200 ${getStatusColor(
                  log.status
                )} hover:scale-[1.02]`}
              >
                <div className="flex items-start gap-3">
                  <div className="mt-0.5">{getStatusIcon(log.status)}</div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-2 mb-1">
                      <p className="text-sm font-medium text-foreground truncate">
                        {log.accountName} → {log.groupName}
                      </p>
                      <span className="text-xs text-muted-foreground whitespace-nowrap">
                        {formatTime(log.timestamp)}
                      </span>
                    </div>
                    <p
                      className={`text-xs ${
                        log.status === 'success'
                          ? 'text-success'
                          : log.status === 'error'
                          ? 'text-destructive'
                          : 'text-muted-foreground'
                      }`}
                    >
                      {log.message}
                    </p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </ScrollArea>
    </div>
  );
};
