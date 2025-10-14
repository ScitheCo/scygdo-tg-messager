import { Header } from '@/components/Header';
import { AccountList } from '@/components/AccountList';
import { GroupList } from '@/components/GroupList';
import { MessagePanel } from '@/components/MessagePanel';
import { LogsPanel } from '@/components/LogsPanel';

const Index = () => {

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <Header />
      
      <main className="flex-1 container mx-auto p-6">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 h-full">
          {/* Left Sidebar - Accounts & Groups */}
          <div className="lg:col-span-1 space-y-6">
            <AccountList />
            <GroupList />
          </div>

          {/* Right Panel - Message & Logs */}
          <div className="lg:col-span-2 grid grid-rows-2 gap-6">
            <MessagePanel />
            <LogsPanel />
          </div>
        </div>
      </main>
    </div>
  );
};

export default Index;
