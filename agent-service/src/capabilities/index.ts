import type { CapabilityDescriptor } from "@agent-contracts";

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

export class CapabilityRegistry {
  list(): CapabilityDescriptor[] {
    return [...DEFAULT_CAPABILITIES];
  }

  resolve(mode: "chat" | "execute", message: string) {
    if (mode === "execute") {
      return DEFAULT_CAPABILITIES.find((item) => item.id === "parser-authoring") ?? DEFAULT_CAPABILITIES[0];
    }

    const normalized = message.toLowerCase();
    if (
      normalized.includes("topic") ||
      normalized.includes("主题") ||
      normalized.includes("diagnose") ||
      normalized.includes("诊断")
    ) {
      return DEFAULT_CAPABILITIES.find((item) => item.id === "topic-diagnosis") ?? DEFAULT_CAPABILITIES[0];
    }

    return DEFAULT_CAPABILITIES.find((item) => item.id === "chat.basic") ?? DEFAULT_CAPABILITIES[0];
  }
}
