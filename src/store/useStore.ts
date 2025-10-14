import { create } from 'zustand';

interface StoreState {
  selectedAccountIds: string[];
  selectedGroupIds: string[];
  
  toggleAccount: (id: string) => void;
  selectAllAccounts: () => void;
  deselectAllAccounts: () => void;
  toggleGroup: (id: string) => void;
  selectAllGroups: () => void;
  deselectAllGroups: () => void;
}

export const useStore = create<StoreState>((set, get) => ({
  selectedAccountIds: [],
  selectedGroupIds: [],

  toggleAccount: (id) =>
    set((state) => ({
      selectedAccountIds: state.selectedAccountIds.includes(id)
        ? state.selectedAccountIds.filter((accId) => accId !== id)
        : [...state.selectedAccountIds, id],
    })),

  selectAllAccounts: () => set({ selectedAccountIds: [] }), // Will be updated with actual IDs from component

  deselectAllAccounts: () => set({ selectedAccountIds: [] }),

  toggleGroup: (id) =>
    set((state) => ({
      selectedGroupIds: state.selectedGroupIds.includes(id)
        ? state.selectedGroupIds.filter((grpId) => grpId !== id)
        : [...state.selectedGroupIds, id],
    })),

  selectAllGroups: () => set({ selectedGroupIds: [] }), // Will be updated with actual IDs from component

  deselectAllGroups: () => set({ selectedGroupIds: [] }),
}));

