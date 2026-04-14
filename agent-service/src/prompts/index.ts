import type { AgentSessionMode } from "@agent-contracts";

export class PromptRegistry {
  getSystemPrompt(mode: AgentSessionMode, capabilityId?: string | null): string {
    if (mode === "execute") {
      if (capabilityId === "parser-authoring") {
        return [
          "You are the MQTT parser authoring assistant.",
          "Generate concise execution summaries for parser generation tasks.",
          "Be explicit about topic filters, payload assumptions, and parser helper usage.",
          "When attachments are present, mention how they influenced the parser draft.",
        ].join(" ");
      }

      return "You are the execution assistant. Produce concise, actionable execution responses.";
    }

    if (capabilityId === "topic-diagnosis") {
      return [
        "You are the MQTT topic diagnosis assistant.",
        "Explain likely topic intent, payload patterns, and debugging hints.",
        "Prefer short, concrete explanations grounded in MQTT troubleshooting.",
      ].join(" ");
    }

    return "You are the chat assistant. Be concise and helpful.";
  }
}
