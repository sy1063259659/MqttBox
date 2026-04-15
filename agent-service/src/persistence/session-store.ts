import { randomUUID } from "node:crypto";
import type { AgentSafetyLevel, AgentSessionDto, AgentSessionMode } from "@agent-contracts";
import { loadJsonFile, writeJsonFileAtomic } from "./json-file-store.js";

const SESSION_STORE_FILE = "sessions.json";

export class InMemorySessionStore {
  private readonly sessions = new Map<string, AgentSessionDto>();

  constructor() {
    const persistedSessions = loadJsonFile<AgentSessionDto[]>(SESSION_STORE_FILE, []);
    for (const session of persistedSessions) {
      this.sessions.set(session.id, session);
    }
  }

  create(mode: AgentSessionMode, safetyLevel: AgentSafetyLevel): AgentSessionDto {
    const session: AgentSessionDto = {
      id: randomUUID(),
      mode,
      safetyLevel,
      createdAt: new Date().toISOString(),
      workspaceId: null,
    };
    this.sessions.set(session.id, session);
    this.flush();
    return session;
  }

  getById(sessionId: string): AgentSessionDto | null {
    return this.sessions.get(sessionId) ?? null;
  }

  private flush(): void {
    writeJsonFileAtomic(SESSION_STORE_FILE, [...this.sessions.values()]);
  }
}
