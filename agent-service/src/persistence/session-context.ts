import type { AgentSessionDetailDto, AgentThreadMessageDto } from "@agent-contracts";

const RECENT_MESSAGE_WINDOW = 8;

export interface PackedSessionContext {
  packedText: string;
  usedSummary: boolean;
}

export function packSessionContext(
  detail: AgentSessionDetailDto,
  currentMessage: string,
): PackedSessionContext {
  const recentMessages = detail.messages.slice(-RECENT_MESSAGE_WINDOW);
  const lines: string[] = [];

  if (detail.contextSummary?.content.trim()) {
    lines.push("Session summary:");
    lines.push(detail.contextSummary.content.trim());
    lines.push("");
  }

  if (recentMessages.length > 0) {
    lines.push("Recent conversation:");
    for (const message of recentMessages) {
      lines.push(formatMessageLine(message));
    }
    lines.push("");
  }

  const latestArtifact = detail.artifacts[0];
  if (latestArtifact) {
    lines.push(
      `Latest parser artifact: ${latestArtifact.title} — ${latestArtifact.summary.trim() || "No summary."}`,
    );
  }

  const pendingApproval = detail.approvals[0];
  if (pendingApproval) {
    lines.push(`Pending approval: ${pendingApproval.actionSummary}`);
  }

  if (lines.length === 0) {
    return {
      packedText: currentMessage,
      usedSummary: false,
    };
  }

  return {
    packedText: [
      "Session context below. Use it as the active conversation state before answering the latest user message.",
      ...lines,
      "Latest user message:",
      currentMessage,
    ]
      .filter(Boolean)
      .join("\n"),
    usedSummary: Boolean(detail.contextSummary?.content.trim()),
  };
}

function formatMessageLine(message: AgentThreadMessageDto) {
  const role =
    message.role === "assistant" ? "Assistant" : message.role === "system" ? "System" : "User";
  const content = message.content.replace(/\s+/g, " ").trim();
  return `${role}: ${content}`;
}
