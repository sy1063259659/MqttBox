import { randomUUID } from "node:crypto";
import type { AgentSafetyLevel, AgentSessionDto, AgentSessionMode } from "@agent-contracts";

export class InMemorySessionStore {
  private readonly sessions = new Map<string, AgentSessionDto>();

  create(mode: AgentSessionMode, safetyLevel: AgentSafetyLevel): AgentSessionDto {
    const session: AgentSessionDto = {
      id: randomUUID(),
      mode,
      safetyLevel,
      createdAt: new Date().toISOString(),
      workspaceId: null,
    };
    this.sessions.set(session.id, session);
    return session;
  }

  getById(sessionId: string): AgentSessionDto | null {
    return this.sessions.get(sessionId) ?? null;
  }
}
