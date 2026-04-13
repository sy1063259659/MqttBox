import { create } from "zustand";

import type { SubscriptionDto, SubscriptionInput } from "@/features/subscriptions/types";
import {
  listSubscriptions,
  setSubscriptionEnabled,
  subscribeTopics,
  unsubscribeTopics,
} from "@/services/tauri";

interface SubscriptionStore {
  connectionId: string | null;
  items: SubscriptionDto[];
  isLoading: boolean;
  loadSubscriptions: (connectionId?: string | null) => Promise<void>;
  reset: () => void;
  addSubscription: (connectionId: string, entry: SubscriptionInput) => Promise<void>;
  removeSubscription: (connectionId: string, subscriptionId: string) => Promise<void>;
  toggleSubscription: (
    connectionId: string,
    subscriptionId: string,
    enabled: boolean,
  ) => Promise<void>;
}

export const useSubscriptionStore = create<SubscriptionStore>((set) => ({
  connectionId: null,
  items: [],
  isLoading: false,
  async loadSubscriptions(connectionId) {
    if (!connectionId) {
      set({ connectionId: null, items: [], isLoading: false });
      return;
    }

    set((state) => ({
      connectionId,
      isLoading: true,
      items: state.connectionId === connectionId ? state.items : [],
    }));
    const items = await listSubscriptions(connectionId);
    set((state) =>
      state.connectionId === connectionId
        ? { items, isLoading: false }
        : state,
    );
  },
  reset() {
    set({ connectionId: null, items: [], isLoading: false });
  },
  async addSubscription(connectionId, entry) {
    const saved = await subscribeTopics(connectionId, [entry]);
    set((state) => ({
      items:
        state.connectionId === connectionId
          ? [...saved, ...state.items.filter((item) => item.id !== saved[0]?.id)]
          : state.items,
    }));
  },
  async removeSubscription(connectionId, subscriptionId) {
    await unsubscribeTopics(connectionId, [subscriptionId]);
    set((state) => ({
      items:
        state.connectionId === connectionId
          ? state.items.filter((item) => item.id !== subscriptionId)
          : state.items,
    }));
  },
  async toggleSubscription(connectionId, subscriptionId, enabled) {
    const updated = await setSubscriptionEnabled(connectionId, subscriptionId, enabled);
    set((state) => ({
      items:
        state.connectionId === connectionId
          ? state.items.map((item) => (item.id === subscriptionId ? updated : item))
          : state.items,
    }));
  },
}));
