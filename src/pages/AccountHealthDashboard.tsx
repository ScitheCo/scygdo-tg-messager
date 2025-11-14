import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { Header } from '@/components/Header';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { ArrowLeft, RefreshCw, AlertTriangle, CheckCircle2, XCircle, Clock, Activity } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { useState } from 'react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

type HealthStatus = 'ok' | 'invalid_session' | 'rate_limited' | 'connection_timeout' | 'dc_migrate_required' | 'unknown_error';

interface AccountWithHealth {
  id: string;
  phone_number: string;
  name: string | null;
  is_active: boolean;
  health?: {
    status: HealthStatus;
    last_checked: string | null;
    error_message: string | null;
    consecutive_failures: number;
    last_success: string | null;
  };
}

export default function AccountHealthDashboard() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [isTesting, setIsTesting] = useState(false);
  const [statusFilter, setStatusFilter] = useState<'all' | 'healthy' | 'issues'>('all');

  const { data: accounts = [], isLoading } = useQuery<AccountWithHealth[]>({
    queryKey: ['accounts-with-health', user?.id],
    queryFn: async () => {
      const { data: accountsData, error: accountsError } = await (supabase as any)
        .from('telegram_accounts')
        .select('id, phone_number, name, is_active')
        .eq('created_by', user?.id)
        .order('created_at', { ascending: false });

      if (accountsError) throw accountsError;

      const { data: healthData, error: healthError } = await (supabase as any)
        .from('account_health_status')
        .select('*')
        .in('account_id', accountsData?.map(a => a.id) || []);

      if (healthError) throw healthError;

      return accountsData?.map(account => ({
        ...account,
        health: (healthData as any)?.find((h: any) => h.account_id === account.id)
      })) || [];
    },
    enabled: !!user
  });

  const handleTestAll = async () => {
    setIsTesting(true);
    try {
      const accountIds = statusFilter === 'all' 
        ? null 
        : accounts
            .filter(a => statusFilter === 'issues' ? a.health?.status !== 'ok' : a.health?.status === 'ok')
            .map(a => a.id);

      const { data, error } = await supabase.functions.invoke('request-health-check', {
        body: { account_ids: accountIds }
      });

      if (error) throw error;

      toast.success('Hesap sağlık kontrolü kuyruğa eklendi. Desktop worker işlemeye başlayacak.');

      // Poll for updates
      const pollInterval = setInterval(async () => {
        await queryClient.invalidateQueries({ queryKey: ['accounts-with-health'] });
      }, 3000);

      // Stop polling after 60 seconds
      setTimeout(() => {
        clearInterval(pollInterval);
        setIsTesting(false);
      }, 60000);

    } catch (error: any) {
      console.error('Test error:', error);
      toast.error(error.message || 'Test başlatılamadı');
      setIsTesting(false);
    }
  };

  const handleDeactivateInvalid = async () => {
    const toastId = toast.loading('Geçersiz hesaplar pasifleştiriliyor...');

    try {
      const invalidAccounts = accounts.filter(a => a.health?.status === 'invalid_session');
      
      if (invalidAccounts.length === 0) {
        toast.info('Pasifleştirilecek geçersiz hesap yok', { id: toastId });
        return;
      }

      const { error } = await supabase
        .from('telegram_accounts')
        .update({ is_active: false })
        .in('id', invalidAccounts.map(a => a.id));

      if (error) throw error;

      await queryClient.invalidateQueries({ queryKey: ['accounts-with-health'] });
      toast.success(`${invalidAccounts.length} hesap pasifleştirildi`, { id: toastId });
    } catch (error: any) {
      toast.error('Pasifleştirme başarısız: ' + error.message, { id: toastId });
    }
  };

  const getStatusBadge = (status: string) => {
    const variants = {
      ok: { icon: CheckCircle2, label: 'Sağlıklı', className: 'bg-green-600 hover:bg-green-600' },
      invalid_session: { icon: XCircle, label: 'Geçersiz', className: 'bg-red-600 hover:bg-red-600' },
      rate_limited: { icon: Clock, label: 'Rate Limit', className: 'bg-yellow-600 hover:bg-yellow-600' },
      connection_timeout: { icon: AlertTriangle, label: 'Zaman Aşımı', className: 'bg-gray-500 hover:bg-gray-500' },
      dc_migrate_required: { icon: RefreshCw, label: 'DC Migrasyon', className: 'bg-purple-600 hover:bg-purple-600' },
      unknown_error: { icon: AlertTriangle, label: 'Bilinmeyen', className: 'bg-orange-600 hover:bg-orange-600' }
    } as const;
    
    const key = (status in variants ? status : 'unknown_error') as keyof typeof variants;
    const config = variants[key];
    const Icon = config.icon;
    return (
      <Badge variant="default" className={config.className}>
        <Icon className="w-3 h-3 mr-1" />
        {config.label}
      </Badge>
    );
  };

  const formatDate = (dateStr: string | null) => {
    if (!dateStr) return 'Hiç test edilmedi';
    const date = new Date(dateStr);
    return date.toLocaleString('tr-TR', { 
      day: '2-digit', 
      month: '2-digit', 
      year: 'numeric',
      hour: '2-digit', 
      minute: '2-digit' 
    });
  };

  const filteredAccounts = accounts.filter(account => {
    if (statusFilter === 'all') return true;
    if (statusFilter === 'healthy') return account.health?.status === 'ok';
    if (statusFilter === 'issues') return account.health?.status && account.health.status !== 'ok';
    return true;
  });

  const stats = {
    total: accounts.length,
    healthy: accounts.filter(a => a.health?.status === 'ok').length,
    issues: accounts.filter(a => a.health?.status && a.health.status !== 'ok').length,
    untested: accounts.filter(a => !a.health).length
  };

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <Header />
      
      <main className="flex-1 container mx-auto p-4 md:p-6">
        <div className="mb-6">
          <Button 
            variant="ghost" 
            size="sm" 
            onClick={() => navigate('/')}
            className="mb-4"
          >
            <ArrowLeft className="w-4 h-4 mr-2" />
            Ana Sayfa
          </Button>

          <div className="flex items-center justify-between mb-4">
            <div>
              <h1 className="text-2xl font-bold text-foreground">Hesap Sağlığı</h1>
              <p className="text-sm text-muted-foreground">Telegram hesaplarınızın durumunu izleyin</p>
            </div>
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={handleTestAll}
                disabled={isTesting || accounts.length === 0}
              >
                <Activity className="w-4 h-4 mr-2" />
                {isTesting ? 'Test Ediliyor...' : 'Tümünü Test Et'}
              </Button>
              <Button
                variant="destructive"
                size="sm"
                onClick={handleDeactivateInvalid}
                disabled={stats.issues === 0}
              >
                <XCircle className="w-4 h-4 mr-2" />
                Geçersizleri Pasifleştir
              </Button>
            </div>
          </div>

          {/* Stats Cards */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
            <Card className="p-4">
              <div className="flex items-center gap-2">
                <Activity className="w-5 h-5 text-primary" />
                <div>
                  <p className="text-2xl font-bold">{stats.total}</p>
                  <p className="text-xs text-muted-foreground">Toplam Hesap</p>
                </div>
              </div>
            </Card>
            <Card className="p-4">
              <div className="flex items-center gap-2">
                <CheckCircle2 className="w-5 h-5 text-green-600" />
                <div>
                  <p className="text-2xl font-bold">{stats.healthy}</p>
                  <p className="text-xs text-muted-foreground">Sağlıklı</p>
                </div>
              </div>
            </Card>
            <Card className="p-4">
              <div className="flex items-center gap-2">
                <AlertTriangle className="w-5 h-5 text-red-600" />
                <div>
                  <p className="text-2xl font-bold">{stats.issues}</p>
                  <p className="text-xs text-muted-foreground">Sorunlu</p>
                </div>
              </div>
            </Card>
            <Card className="p-4">
              <div className="flex items-center gap-2">
                <Clock className="w-5 h-5 text-gray-500" />
                <div>
                  <p className="text-2xl font-bold">{stats.untested}</p>
                  <p className="text-xs text-muted-foreground">Test Edilmedi</p>
                </div>
              </div>
            </Card>
          </div>

          {/* Filter */}
          <div className="flex items-center gap-2 mb-4">
            <span className="text-sm text-muted-foreground">Filtrele:</span>
            <Select value={statusFilter} onValueChange={(v: any) => setStatusFilter(v)}>
              <SelectTrigger className="w-[180px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Tümü ({accounts.length})</SelectItem>
                <SelectItem value="healthy">Sağlıklı ({stats.healthy})</SelectItem>
                <SelectItem value="issues">Sorunlu ({stats.issues})</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        {/* Accounts Table */}
        <Card className="p-4">
          {isLoading ? (
            <div className="text-center py-8 text-muted-foreground">Yükleniyor...</div>
          ) : filteredAccounts.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">Hesap bulunamadı</div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Hesap</TableHead>
                  <TableHead>Telefon</TableHead>
                  <TableHead>Durum</TableHead>
                  <TableHead>Son Kontrol</TableHead>
                  <TableHead>Son Başarı</TableHead>
                  <TableHead>Ardışık Hata</TableHead>
                  <TableHead>Hata Mesajı</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredAccounts.map((account) => (
                  <TableRow key={account.id}>
                    <TableCell className="font-medium">
                      <div className="flex items-center gap-2">
                        {account.name || 'İsimsiz'}
                        {!account.is_active && (
                          <Badge variant="destructive" className="text-xs">Pasif</Badge>
                        )}
                      </div>
                    </TableCell>
                    <TableCell className="font-mono text-sm">{account.phone_number}</TableCell>
                    <TableCell>
                      {account.health?.status ? (
                        getStatusBadge(account.health.status)
                      ) : (
                        <Badge variant="outline">Test Edilmedi</Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-sm">
                      {formatDate(account.health?.last_checked || null)}
                    </TableCell>
                    <TableCell className="text-sm">
                      {formatDate(account.health?.last_success || null)}
                    </TableCell>
                    <TableCell>
                      {account.health?.consecutive_failures ? (
                        <Badge variant="destructive">{account.health.consecutive_failures}</Badge>
                      ) : (
                        <span className="text-muted-foreground">-</span>
                      )}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground max-w-xs truncate">
                      {account.health?.error_message || '-'}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </Card>
      </main>
    </div>
  );
}
