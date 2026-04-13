import { create } from "zustand";

import type {
  ExportRequest,
  MessageFilter,
  MessageRecordDto,
  PublishRequest,
} from "@/features/messages/types";
import {
  clearMessageHistory,
  exportMessages,
  loadMessageHistory,
  publishMessage,
} from "@/services/tauri";

interface MessageStore {
  connectionId: string | null;
  items: MessageRecordDto[];
  selectedMessageId: string | null;
  filter: MessageFilter;
  isPaused: boolean;
  isLoading: boolean;
  hasMore: boolean;
  nextOffset: number | null;
  loadMessages: (connectionId: string | null) => Promise<void>;
  loadMore: (connectionId: string) => Promise<void>;
  reset: () => void;
  setFilter: (filter: Partial<MessageFilter>) => void;
  setSelectedMessage: (messageId: string | null) => void;
  togglePause: () => void;
  handleIncoming: (message: MessageRecordDto) => void;
  publish: (request: PublishRequest) => Promise<void>;
  clear: (connectionId: string) => Promise<void>;
  export: (request: ExportRequest) => Promise<void>;
}

const defaultFilter: MessageFilter = {
  keyword: "",
  topic: "",
  direction: "all",
};

export const useMessageStore = create<MessageStore>((set, get) => ({
  connectionId: null,
  items: [],
  selectedMessageId: null,
  filter: defaultFilter,
  isPaused: false,
  isLoading: false,
  hasMore: false,
  nextOffset: null,
  async loadMessages(connectionId) {
    if (!connectionId) {
      set({
        connectionId: null,
        items: [],
        selectedMessageId: null,
        isLoading: false,
        hasMore: false,
        nextOffset: null,
      });
      return;
    }

    set((state) => ({
      connectionId,
      isLoading: true,
      items: state.connectionId === connectionId ? state.items : [],
      selectedMessageId:
        state.connectionId === connectionId ? state.selectedMessageId : null,
      hasMore: state.connectionId === connectionId ? state.hasMore : false,
      nextOffset: state.connectionId === connectionId ? state.nextOffset : null,
    }));
    const page = await loadMessageHistory(connectionId, {
      ...get().filter,
      limit: 200,
      offset: 0,
    });
    set((state) =>
      state.connectionId === connectionId
        ? {
            items: page.items,
            hasMore: page.hasMore,
            nextOffset: page.nextOffset ?? null,
            isLoading: false,
          }
        : state,
    );
  },
  async loadMore(connectionId) {
    const { isLoading, hasMore, nextOffset, filter, connectionId: scopedConnectionId } =
      get();
    if (
      isLoading ||
      !hasMore ||
      nextOffset == null ||
      !connectionId ||
      scopedConnectionId !== connectionId
    ) {
      return;
    }

    set({ isLoading: true });
    const page = await loadMessageHistory(connectionId, {
      ...filter,
      limit: 200,
      offset: nextOffset,
    });
    set((state) =>
      state.connectionId === connectionId
        ? {
            items: [...state.items, ...page.items],
            hasMore: page.hasMore,
            nextOffset: page.nextOffset ?? null,
            isLoading: false,
          }
        : state,
    );
  },
  reset() {
    set({
      connectionId: null,
      items: [],
      selectedMessageId: null,
      isLoading: false,
      hasMore: false,
      nextOffset: null,
    });
  },
  setFilter(filter) {
    set((state) => ({ filter: { ...state.filter, ...filter } }));
  },
  setSelectedMessage(messageId) {
    set({ selectedMessageId: messageId });
  },
  togglePause() {
    set((state) => ({ isPaused: !state.isPaused }));
  },
  handleIncoming(message) {
    set((state) => ({
      items:
        state.connectionId === message.connectionId
          ? [message, ...state.items]
          : state.items,
      selectedMessageId:
        state.connectionId === message.connectionId
          ? state.selectedMessageId ?? message.id
          : state.selectedMessageId,
    }));
  },
  async publish(request) {
    await publishMessage(request);
  },
  async clear(connectionId) {
    await clearMessageHistory(connectionId);
    set({ items: [], selectedMessageId: null });
  },
  async export(request) {
    await exportMessages(request);
  },
}));
