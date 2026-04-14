import { create } from "zustand";

import type {
  MessageParserDto,
  MessageParserInput,
  MessageParserTestRequest,
  MessageParserTestResultDto,
} from "@/features/parsers/types";
import {
  listMessageParsers,
  removeMessageParser,
  saveMessageParser,
  testMessageParser,
} from "@/services/tauri";

interface ParserStore {
  items: MessageParserDto[];
  isLoading: boolean;
  draft: MessageParserInput | null;
  loadParsers: () => Promise<void>;
  saveParser: (input: MessageParserInput) => Promise<MessageParserDto>;
  removeParser: (parserId: string) => Promise<void>;
  testParser: (request: MessageParserTestRequest) => Promise<MessageParserTestResultDto>;
  setDraft: (draft: MessageParserInput | null) => void;
  clearDraft: () => void;
}

export const useParserStore = create<ParserStore>((set) => ({
  items: [],
  isLoading: false,
  draft: null,
  async loadParsers() {
    set({ isLoading: true });
    const items = await listMessageParsers();
    set({ items, isLoading: false });
  },
  async saveParser(input) {
    const saved = await saveMessageParser(input);
    set((state) => ({
      items: [saved, ...state.items.filter((item) => item.id !== saved.id)],
    }));
    return saved;
  },
  async removeParser(parserId) {
    await removeMessageParser(parserId);
    set((state) => ({
      items: state.items.filter((item) => item.id !== parserId),
    }));
  },
  async testParser(request) {
    return testMessageParser(request);
  },
  setDraft(draft) {
    set({ draft });
  },
  clearDraft() {
    set({ draft: null });
  },
}));
