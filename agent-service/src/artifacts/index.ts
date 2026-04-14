import type { AgentArtifactDto } from "@agent-contracts";

export class ArtifactStore {
  private readonly items = new Map<string, AgentArtifactDto>();

  save(artifact: AgentArtifactDto): AgentArtifactDto {
    this.items.set(artifact.id, artifact);
    return artifact;
  }

  listByRun(runId: string): AgentArtifactDto[] {
    return [...this.items.values()].filter((artifact) => artifact.runId === runId);
  }
}
