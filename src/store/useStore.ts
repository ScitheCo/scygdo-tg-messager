import { create } from 'zustand';

interface Account {
  id: number;
  name: string;
  username: string;
  phone: string;
  active: boolean;
}

interface Group {
  id: number;
  name: string;
  chatId: string;
  accessHash: string;
  memberCount: number;
  accountIds: number[];
}

interface LogEntry {
  id: string;
  timestamp: Date;
  accountName: string;
  groupName: string;
  status: 'success' | 'error' | 'pending';
  message: string;
}

interface StoreState {
  accounts: Account[];
  groups: Group[];
  selectedAccountIds: number[];
  selectedGroupIds: number[];
  logs: LogEntry[];
  isSending: boolean;
  
  setAccounts: (accounts: Account[]) => void;
  setGroups: (groups: Group[]) => void;
  toggleAccount: (id: number) => void;
  selectAllAccounts: () => void;
  deselectAllAccounts: () => void;
  toggleGroup: (id: number) => void;
  selectAllGroups: () => void;
  deselectAllGroups: () => void;
  addLog: (log: Omit<LogEntry, 'id' | 'timestamp'>) => void;
  clearLogs: () => void;
  setIsSending: (isSending: boolean) => void;
}

export const useStore = create<StoreState>((set, get) => ({
  accounts: [],
  groups: [],
  selectedAccountIds: [],
  selectedGroupIds: [],
  logs: [],
  isSending: false,

  setAccounts: (accounts) => set({ accounts }),
  
  setGroups: (groups) => set({ groups }),

  toggleAccount: (id) =>
    set((state) => ({
      selectedAccountIds: state.selectedAccountIds.includes(id)
        ? state.selectedAccountIds.filter((accId) => accId !== id)
        : [...state.selectedAccountIds, id],
    })),

  selectAllAccounts: () =>
    set((state) => ({
      selectedAccountIds: state.accounts.filter(acc => acc.active).map((acc) => acc.id),
    })),

  deselectAllAccounts: () => set({ selectedAccountIds: [] }),

  toggleGroup: (id) =>
    set((state) => ({
      selectedGroupIds: state.selectedGroupIds.includes(id)
        ? state.selectedGroupIds.filter((grpId) => grpId !== id)
        : [...state.selectedGroupIds, id],
    })),

  selectAllGroups: () =>
    set((state) => ({
      selectedGroupIds: state.groups.map((grp) => grp.id),
    })),

  deselectAllGroups: () => set({ selectedGroupIds: [] }),

  addLog: (log) =>
    set((state) => ({
      logs: [
        {
          ...log,
          id: `${Date.now()}-${Math.random()}`,
          timestamp: new Date(),
        },
        ...state.logs,
      ].slice(0, 50), // Keep only last 50 logs
    })),

  clearLogs: () => set({ logs: [] }),

  setIsSending: (isSending) => set({ isSending }),
}));
