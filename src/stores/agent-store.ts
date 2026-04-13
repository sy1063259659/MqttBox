import { create } from "zustand";

import type { AgentContextDto, AgentToolDescriptor } from "@/features/agent/types";
import { getAgentContext, listAgentTools } from "@/services/tauri";

interface AgentStore {
  tools: AgentToolDescriptor[];
  context: AgentContextDto | null;
  statusMessage: string | null;
  loadTools: () => Promise<void>;
  loadContext: (connectionId?: string | null) => Promise<void>;
  setStatusMessage: (message: string | null) => void;
}

export const useAgentStore = create<AgentStore>((set) => ({
  tools: [],
  context: null,
  statusMessage: null,
  async loadTools() {
    const tools = await listAgentTools();
    set({ tools });
  },
  async loadContext(connectionId) {
    const context = await getAgentContext(connectionId ?? undefined);
    set({ context });
  },
  setStatusMessage(message) {
    set({ statusMessage: message });
  },
}));
