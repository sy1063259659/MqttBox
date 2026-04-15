import type { AgentSessionMode, CapabilityDescriptor } from "@agent-contracts";

const DEFAULT_CAPABILITIES: CapabilityDescriptor[] = [
  {
    id: "chat.basic",
    name: "Basic Chat",
    description: "Minimal chat capability scaffold",
    supportedModes: ["chat"],
    defaultSafetyLevel: "observe",
    enabled: true,
  },
  {
    id: "parser-authoring",
    name: "Parser Authoring",
    description: "Generate parser-script artifacts from MQTT payload requirements",
    supportedModes: ["execute"],
    defaultSafetyLevel: "draft",
    enabled: true,
  },
  {
    id: "topic-diagnosis",
    name: "Topic Diagnosis",
    description: "Explain MQTT topic usage, payload patterns, and debugging hints",
    supportedModes: ["chat"],
    defaultSafetyLevel: "observe",
    enabled: true,
  },
];

const DEFAULT_THRESHOLD = 0.3;

export interface CapabilityMatch {
  capability: CapabilityDescriptor;
  confidence: number;
  matchReason: string;
}

export interface CapabilityRouter {
  resolve(mode: AgentSessionMode, message: string): Promise<CapabilityMatch>;
}

type WeightedKeyword = {
  term: string;
  score: number;
  kind: "exact" | "fuzzy";
};

const CHAT_BASIC = findCapability("chat.basic");
const PARSER_AUTHORING = findCapability("parser-authoring");
const TOPIC_DIAGNOSIS = findCapability("topic-diagnosis");

const KEYWORDS: Record<string, WeightedKeyword[]> = {
  "parser-authoring": [
    { term: "parser", score: 0.75, kind: "exact" },
    { term: "parse", score: 0.45, kind: "fuzzy" },
    { term: "topic:", score: 0.7, kind: "exact" },
    { term: "主题:", score: 0.7, kind: "exact" },
    { term: "payload", score: 0.45, kind: "fuzzy" },
    { term: "脚本", score: 0.45, kind: "fuzzy" },
  ],
  "topic-diagnosis": [
    { term: "diagnose", score: 0.7, kind: "exact" },
    { term: "诊断", score: 0.7, kind: "exact" },
    { term: "topic", score: 0.45, kind: "fuzzy" },
    { term: "主题", score: 0.45, kind: "fuzzy" },
    { term: "debug", score: 0.4, kind: "fuzzy" },
    { term: "排查", score: 0.4, kind: "fuzzy" },
  ],
  "chat.basic": [
    { term: "help", score: 0.2, kind: "fuzzy" },
    { term: "hello", score: 0.15, kind: "fuzzy" },
  ],
};

function findCapability(id: string): CapabilityDescriptor {
  const capability = DEFAULT_CAPABILITIES.find((item) => item.id === id);
  if (!capability) {
    throw new Error(`Capability not found: ${id}`);
  }
  return capability;
}

function clampConfidence(value: number): number {
  return Math.max(0, Math.min(1, Number(value.toFixed(2))));
}

function containsKeyword(message: string, keyword: WeightedKeyword): boolean {
  if (keyword.kind === "exact") {
    return message.includes(keyword.term);
  }

  return message.includes(keyword.term);
}

export class KeywordCapabilityRouter implements CapabilityRouter {
  constructor(
    private readonly capabilities: CapabilityDescriptor[] = DEFAULT_CAPABILITIES,
    private readonly fallbackCapability: CapabilityDescriptor = CHAT_BASIC,
  ) {}

  async resolve(mode: AgentSessionMode, message: string): Promise<CapabilityMatch> {
    const normalized = message.trim().toLowerCase();

    if (mode === "execute") {
      return {
        capability: this.findById("parser-authoring"),
        confidence: normalized.length > 0 ? 1 : 0.6,
        matchReason:
          normalized.length > 0
            ? "execute mode defaults to parser authoring"
            : "execute mode fallback without message content",
      };
    }

    const scoredMatches = this.capabilities
      .filter((capability) => capability.supportedModes.includes(mode) && capability.enabled)
      .map((capability) => {
        const keywords = KEYWORDS[capability.id] ?? [];
        const matched = keywords.filter((keyword) => containsKeyword(normalized, keyword));
        const rawScore = matched.reduce((sum, keyword) => sum + keyword.score, 0);
        const confidence = clampConfidence(rawScore);
        const matchReason =
          matched.length > 0
            ? `matched ${matched.map((keyword) => `${keyword.kind}:${keyword.term}`).join(", ")}`
            : `no keywords matched for ${capability.id}`;

        return {
          capability,
          confidence,
          matchReason,
        } satisfies CapabilityMatch;
      })
      .sort((left, right) => right.confidence - left.confidence);

    return (
      scoredMatches[0] ?? {
        capability: this.fallbackCapability,
        confidence: 0,
        matchReason: "no enabled capability available",
      }
    );
  }

  private findById(id: string): CapabilityDescriptor {
    return this.capabilities.find((item) => item.id === id) ?? this.fallbackCapability;
  }
}

export class CapabilityRegistry {
  constructor(
    private readonly router: CapabilityRouter = new KeywordCapabilityRouter(DEFAULT_CAPABILITIES, CHAT_BASIC),
    private readonly fallbackCapability: CapabilityDescriptor = CHAT_BASIC,
    private readonly defaultThreshold = DEFAULT_THRESHOLD,
  ) {}

  list(): CapabilityDescriptor[] {
    return [...DEFAULT_CAPABILITIES];
  }

  async resolve(mode: AgentSessionMode, message: string): Promise<CapabilityMatch> {
    return this.router.resolve(mode, message);
  }

  async resolveWithFallback(
    mode: AgentSessionMode,
    message: string,
    threshold = this.defaultThreshold,
  ): Promise<CapabilityMatch> {
    const match = await this.resolve(mode, message);
    if (match.confidence >= threshold) {
      return match;
    }

    return {
      capability: this.fallbackCapability,
      confidence: match.confidence,
      matchReason: `fallback to ${this.fallbackCapability.id}: ${match.matchReason}`,
    };
  }
}
