import { Header } from '@/components/Header';
import { AccountList } from '@/components/AccountList';
import { GroupList } from '@/components/GroupList';
import { MessagePanel } from '@/components/MessagePanel';
import { LogsPanel } from '@/components/LogsPanel';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Activity, CheckCircle2, AlertTriangle } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { useNavigate } from 'react-router-dom';

const Index = () => {
  const { user } = useAuth();
  const navigate = useNavigate();

  const { data: healthSummary } = useQuery({
    queryKey: ['health-summary', user?.id],
    queryFn: async () => {
      const { data: accounts } = await supabase
        .from('telegram_accounts')
        .select('id')
        .eq('created_by', user?.id);

      if (!accounts || accounts.length === 0) return { total: 0, healthy: 0, issues: 0 };

      const { data: healthData } = await supabase
        .from('account_health_status')
        .select('status')
        .in('account_id', accounts.map(a => a.id));

      return {
        total: accounts.length,
        healthy: healthData?.filter(h => h.status === 'ok').length || 0,
        issues: healthData?.filter(h => h.status !== 'ok').length || 0
      };
    },
    enabled: !!user
  });

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <Header />
      
      <main className="flex-1 container mx-auto p-4 md:p-6">
        {/* Health Summary Card */}
        {healthSummary && healthSummary.total > 0 && (
          <Card className="p-4 mb-4 md:mb-6 bg-gradient-to-br from-card to-muted/30 border-primary/20">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-4">
                <Activity className="w-8 h-8 text-primary" />
                <div>
                  <h3 className="text-lg font-semibold text-foreground">Hesap Sağlığı</h3>
                  <div className="flex items-center gap-4 mt-2">
                    <div className="flex items-center gap-2">
                      <Activity className="w-4 h-4 text-muted-foreground" />
                      <span className="text-sm text-muted-foreground">Toplam: <span className="font-medium text-foreground">{healthSummary.total}</span></span>
                    </div>
                    <div className="flex items-center gap-2">
                      <CheckCircle2 className="w-4 h-4 text-green-600" />
                      <span className="text-sm text-muted-foreground">Sağlıklı: <span className="font-medium text-foreground">{healthSummary.healthy}</span></span>
                    </div>
                    <div className="flex items-center gap-2">
                      <AlertTriangle className="w-4 h-4 text-red-600" />
                      <span className="text-sm text-muted-foreground">Sorunlu: <span className="font-medium text-foreground">{healthSummary.issues}</span></span>
                    </div>
                  </div>
                </div>
              </div>
              <Button 
                variant="outline" 
                size="sm"
                onClick={() => navigate('/account-health')}
              >
                Detayları Gör
              </Button>
            </div>
          </Card>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 md:gap-6">
          {/* Left Sidebar - Accounts & Groups */}
          <div className="lg:col-span-1 space-y-4 md:space-y-6">
            <AccountList />
            <GroupList />
          </div>

          {/* Right Panel - Message & Logs */}
          <div className="lg:col-span-2 space-y-4 md:space-y-6">
            <MessagePanel />
            <LogsPanel />
          </div>
        </div>
      </main>
    </div>
  );
};

export default Index;
