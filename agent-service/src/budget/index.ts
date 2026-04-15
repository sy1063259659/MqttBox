export interface BudgetManagerConfig {
  perSessionLimit?: number;
  globalLimit?: number;
}

const DEFAULT_CONFIG: Required<BudgetManagerConfig> = {
  perSessionLimit: 100_000,
  globalLimit: 1_000_000,
};

export class BudgetManager {
  private readonly config: Required<BudgetManagerConfig>;
  private readonly usageBySession = new Map<string, number>();
  private globalUsage = 0;

  constructor(config: BudgetManagerConfig = {}) {
    this.config = {
      ...DEFAULT_CONFIG,
      ...config,
    };
  }

  canRun(sessionId: string): boolean {
    return (
      this.getUsage(sessionId) < this.config.perSessionLimit &&
      this.globalUsage < this.config.globalLimit
    );
  }

  recordUsage(sessionId: string, tokens: number): void {
    if (!Number.isFinite(tokens) || tokens < 0) {
      throw new Error(`Invalid token usage: ${tokens}`);
    }

    const nextSessionUsage = this.getUsage(sessionId) + tokens;
    const nextGlobalUsage = this.globalUsage + tokens;

    this.usageBySession.set(sessionId, nextSessionUsage);
    this.globalUsage = nextGlobalUsage;
  }

  getUsage(sessionId: string): number {
    return this.usageBySession.get(sessionId) ?? 0;
  }

  getGlobalUsage(): number {
    return this.globalUsage;
  }
}
