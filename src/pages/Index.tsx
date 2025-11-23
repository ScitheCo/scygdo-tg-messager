import { Header } from '@/components/Header';
import { AccountList } from '@/components/AccountList';
import { GroupList } from '@/components/GroupList';
import { MessagePanel } from '@/components/MessagePanel';
import { LogsPanel } from '@/components/LogsPanel';

const Index = () => {
  return (
    <div className="min-h-screen bg-background flex flex-col">
      <Header />
      
      <main className="flex-1 container mx-auto p-4 md:p-6">
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
