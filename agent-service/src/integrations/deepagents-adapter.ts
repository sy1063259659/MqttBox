import type { Logger } from "../observability/logger.js";

export class DeepAgentsAdapter {
  readonly runtime = "deepagentsjs";

  constructor(private readonly logger: Logger) {}

  async initialize(): Promise<void> {
    this.logger.info("deepagents runtime initialized");
  }
}
