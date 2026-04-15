import type { AgentArtifactDto } from "@agent-contracts";
import { loadJsonFile, writeJsonFileAtomic } from "../persistence/json-file-store.js";

const ARTIFACT_STORE_FILE = "artifacts.json";

export class ArtifactStore {
  private readonly items = new Map<string, AgentArtifactDto>();

  constructor() {
    const persistedArtifacts = loadJsonFile<AgentArtifactDto[]>(ARTIFACT_STORE_FILE, []);
    for (const artifact of persistedArtifacts) {
      this.items.set(artifact.id, artifact);
    }
  }

  save(artifact: AgentArtifactDto): AgentArtifactDto {
    this.items.set(artifact.id, artifact);
    this.flush();
    return artifact;
  }

  listByRun(runId: string): AgentArtifactDto[] {
    return [...this.items.values()].filter((artifact) => artifact.runId === runId);
  }

  getByRunId(runId: string): AgentArtifactDto[] {
    return this.listByRun(runId);
  }

  getById(artifactId: string): AgentArtifactDto | null {
    return this.items.get(artifactId) ?? null;
  }

  private flush(): void {
    writeJsonFileAtomic(ARTIFACT_STORE_FILE, [...this.items.values()]);
  }
}
