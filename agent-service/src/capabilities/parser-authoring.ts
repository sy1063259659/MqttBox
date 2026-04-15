import { randomUUID } from "node:crypto";
import type {
  AgentArtifactDto,
  AgentAttachmentDto,
  AgentRunDto,
  AgentSafetyLevel,
  AgentSessionDto,
  ApprovalRequestDto,
  ExecutionPlanDto,
  ExecutionStepDto,
  RunStatus,
} from "@agent-contracts";

export const PARSER_AUTHORING_ATTACHMENT_POLICY = {
  maxAttachmentCount: 4,
  maxAttachmentBytes: 5 * 1024 * 1024,
  acceptedImageMimeTypes: ["image/png", "image/jpeg", "image/webp"] as const,
};

export interface ParserAuthoringHandlerContract {
  createRun(input: {
    session: AgentSessionDto;
    runId: string;
    goal: string;
    capabilityId: string;
    status: RunStatus;
    startedAt: string;
    completedAt?: string | null;
  }): AgentRunDto;
  createPlan(runId: string, goal: string): ExecutionPlanDto;
  inferSuggestedTopicFilter(message: string): string;
  createApprovalRequest(
    runId: string,
    topicFilter: string,
    request: string,
    safetyLevel: AgentSafetyLevel,
  ): ApprovalRequestDto;
  createArtifact(
    runId: string,
    request: string,
    topicFilter: string,
    attachmentCount: number,
  ): AgentArtifactDto;
  buildExecutePrompt(request: string, topicFilter: string, artifact: AgentArtifactDto): string;
}

export class ParserAuthoringHandler implements ParserAuthoringHandlerContract {
  createRun(input: {
    session: AgentSessionDto;
    runId: string;
    goal: string;
    capabilityId: string;
    status: RunStatus;
    startedAt: string;
    completedAt?: string | null;
  }): AgentRunDto {
    return {
      id: input.runId,
      sessionId: input.session.id,
      mode: input.session.mode,
      safetyLevel: input.session.safetyLevel,
      capabilityId: input.capabilityId,
      status: input.status,
      goal: input.goal,
      createdAt: input.startedAt,
      startedAt: input.startedAt,
      completedAt: input.completedAt ?? null,
    };
  }

  createPlan(runId: string, goal: string): ExecutionPlanDto {
    return {
      runId,
      capabilityId: "parser-authoring",
      goal,
      steps: [
        this.createPlanStep(runId, 0, "Inspect parser request", "planning"),
        this.createPlanStep(runId, 1, "Build parser draft", "artifact"),
        this.createPlanStep(runId, 2, "Prepare parser artifact", "artifact"),
      ],
    };
  }

  inferSuggestedTopicFilter(message: string) {
    const directTopic =
      message.match(/(?:topic|主题)\s*[:：]\s*([A-Za-z0-9/_#+-]+)/i)?.[1] ??
      message.match(/\b([A-Za-z0-9_-]+\/[A-Za-z0-9/_#+-]+)\b/)?.[1];

    return directTopic?.trim() || "telemetry/raw";
  }

  createApprovalRequest(
    runId: string,
    topicFilter: string,
    request: string,
    safetyLevel: AgentSafetyLevel,
  ): ApprovalRequestDto {
    return {
      id: randomUUID(),
      runId,
      stepId: null,
      toolName: "artifact.createParserDraft",
      title: "Approve parser draft creation",
      actionSummary: `Create a parser draft artifact for ${topicFilter}`,
      reason:
        request.trim().slice(0, 160) ||
        "Execute mode requires confirmation before producing the parser draft artifact.",
      riskLevel: "medium",
      safetyLevel,
      inputPreview: JSON.stringify(
        {
          suggestedTopicFilter: topicFilter,
          request: request.trim().slice(0, 200),
        },
        null,
        2,
      ),
      requestedAt: new Date().toISOString(),
      expiresAt: null,
    };
  }

  createArtifact(
    runId: string,
    request: string,
    topicFilter: string,
    attachmentCount: number,
  ): AgentArtifactDto {
    const name = this.toParserName(topicFilter);
    const requestSummary = request.trim().slice(0, 120);
    const generatedFromImages =
      attachmentCount > 0
        ? `Generated from execute mode with ${attachmentCount} image attachment(s).`
        : "Generated from execute mode without attachments.";

    const script = `function parse(input, helpers) {
  const bytes = helpers.hexToBytes(input.payloadHex);

  return {
    topic: input.topic,
    topicFilter: "${topicFilter}",
    payloadHex: input.payloadHex,
    payloadSize: input.payloadSize,
    byteLength: bytes.length,
    requestSummary: ${JSON.stringify(requestSummary)},
  };
}`;

    return {
      id: randomUUID(),
      runId,
      capabilityId: "parser-authoring",
      type: "parser-script",
      schemaVersion: 1,
      title: name,
      summary: `Parser draft for ${topicFilter}`,
      payload: {
        editorPayload: {
          name,
          script,
          suggestedTestPayloadHex: "01020304",
        },
        reviewPayload: {
          summary: `${generatedFromImages} Draft targets ${topicFilter}.`,
          assumptions: [
            "Input topic structure remains stable enough to derive the parser name.",
            "The first parser version should preserve raw payload metadata for follow-up editing.",
          ],
          risks: [
            "Payload field semantics still need validation in ParserLibrary test runs.",
            "Image references may be insufficient for exact field naming without human review.",
          ],
          nextSteps: [
            "Open the draft in ParserLibrary.",
            "Run the suggested payload smoke test and adjust field extraction.",
            "Save the parser once the topic filter and output shape are confirmed.",
          ],
        },
        suggestedTopicFilter: topicFilter,
        sourceSampleSummary: requestSummary,
      },
      createdAt: new Date().toISOString(),
    };
  }

  buildExecutePrompt(request: string, topicFilter: string, artifact: AgentArtifactDto) {
    return `Generate a concise execute-mode summary for parser authoring.\nRequest: ${request}\nSuggested topic filter: ${topicFilter}\nArtifact title: ${artifact.title}`;
  }

  private createPlanStep(
    runId: string,
    index: number,
    title: string,
    kind: string,
  ): ExecutionStepDto {
    return {
      id: randomUUID(),
      runId,
      index,
      title,
      kind,
      status: "pending",
      toolName: null,
      attempt: 0,
      startedAt: null,
      completedAt: null,
      error: null,
    };
  }

  private toParserName(topicFilter: string) {
    return topicFilter
      .split(/[\/_-]+/)
      .filter(Boolean)
      .map((part) => `${part.slice(0, 1).toUpperCase()}${part.slice(1)}`)
      .join(" ")
      .concat(" Parser");
  }
}
