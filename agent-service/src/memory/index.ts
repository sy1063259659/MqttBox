import type { WorkspaceMemoryDto } from "@agent-contracts";

export class MemoryStore {
  private readonly items = new Map<string, WorkspaceMemoryDto>();

  list(): WorkspaceMemoryDto[] {
    return [...this.items.values()];
  }
}
