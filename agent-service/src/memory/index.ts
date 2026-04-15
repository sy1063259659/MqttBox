import type { WorkspaceMemoryDto } from "@agent-contracts";
import { loadJsonFile, writeJsonFileAtomic } from "../persistence/json-file-store.js";

const MEMORY_STORE_FILE = "memories.json";

export class MemoryStore {
  private readonly items = new Map<string, WorkspaceMemoryDto>();

  constructor() {
    const persistedMemories = loadJsonFile<WorkspaceMemoryDto[]>(MEMORY_STORE_FILE, []);
    for (const memory of persistedMemories) {
      this.items.set(memory.id, memory);
    }
  }

  list(): WorkspaceMemoryDto[] {
    return [...this.items.values()];
  }

  add(memory: WorkspaceMemoryDto): WorkspaceMemoryDto {
    this.items.set(memory.id, memory);
    this.flush();
    return memory;
  }

  update(memory: WorkspaceMemoryDto): WorkspaceMemoryDto {
    this.items.set(memory.id, memory);
    this.flush();
    return memory;
  }

  delete(memoryId: string): boolean {
    const deleted = this.items.delete(memoryId);
    if (deleted) {
      this.flush();
    }
    return deleted;
  }

  private flush(): void {
    writeJsonFileAtomic(MEMORY_STORE_FILE, [...this.items.values()]);
  }
}
