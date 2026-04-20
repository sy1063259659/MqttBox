import { randomUUID } from "node:crypto";
import type {
  AgentArtifactDto,
  AgentAttachmentDto,
  AgentRunDto,
  AgentSafetyLevel,
  AgentSessionDto,
  AgentSessionMode,
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
    mode: AgentSessionMode;
    safetyLevel: AgentSafetyLevel;
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
    artifactCandidate?: unknown,
    approvalDescription?: string | null,
  ): ApprovalRequestDto;
  normalizeArtifactCandidate(input: {
    runId: string;
    request: string;
    topicFilter: string;
    attachmentCount: number;
    artifactCandidate: unknown;
  }): { artifact: AgentArtifactDto | null; error: string | null };
  shouldRequestSave(request: string): boolean;
  createSaveApprovalRequest(input: {
    runId: string;
    request: string;
    safetyLevel: AgentSafetyLevel;
    artifact: AgentArtifactDto;
    existingParserId?: string | null;
  }): ApprovalRequestDto;
}

export class ParserAuthoringHandler implements ParserAuthoringHandlerContract {
  createRun(input: {
    session: AgentSessionDto;
    runId: string;
    goal: string;
    capabilityId: string;
    mode: AgentSessionMode;
    safetyLevel: AgentSafetyLevel;
    status: RunStatus;
    startedAt: string;
    completedAt?: string | null;
  }): AgentRunDto {
    return {
      id: input.runId,
      sessionId: input.session.id,
      mode: input.mode,
      safetyLevel: input.safetyLevel,
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
    artifactCandidate?: unknown,
    approvalDescription?: string | null,
  ): ApprovalRequestDto {
    const candidate = this.asRecord(artifactCandidate);
    const payloadCandidate = this.asRecord(candidate?.payload) ?? candidate;
    const editorCandidate = this.asRecord(payloadCandidate?.editorPayload) ?? payloadCandidate;
    const reviewCandidate = this.asRecord(payloadCandidate?.reviewPayload) ?? payloadCandidate;
    const draftName =
      this.readNonEmptyString(editorCandidate?.name) ?? this.readNonEmptyString(candidate?.title);
    const draftSummary =
      this.readNonEmptyString(candidate?.summary) ??
      this.readNonEmptyString(reviewCandidate?.summary) ??
      this.readNonEmptyString(approvalDescription);

    return {
      id: randomUUID(),
      runId,
      stepId: null,
      toolName: "artifact.createParserDraft",
      title: "Approve parser draft creation",
      actionSummary: draftName
        ? `Create parser draft "${draftName}" for ${topicFilter}`
        : `Create a parser draft artifact for ${topicFilter}`,
      reason:
        request.trim().slice(0, 160) ||
        "Execute mode requires confirmation before producing the parser draft artifact.",
      riskLevel: "medium",
      safetyLevel,
      inputPreview: JSON.stringify(
          {
            suggestedTopicFilter: topicFilter,
            request: request.trim().slice(0, 200),
            ...(draftName ? { draftName } : {}),
            ...(draftSummary ? { draftSummary } : {}),
          },
          null,
          2,
        ),
      requestedAt: new Date().toISOString(),
      expiresAt: null,
    };
  }

  normalizeArtifactCandidate(input: {
    runId: string;
    request: string;
    topicFilter: string;
    attachmentCount: number;
    artifactCandidate: unknown;
  }): { artifact: AgentArtifactDto | null; error: string | null } {
    const candidate = this.asRecord(input.artifactCandidate);
    if (!candidate) {
      return {
        artifact: null,
        error: "Parser authoring runtime did not return an artifact candidate.",
      };
    }

    const payloadCandidate = this.asRecord(candidate.payload) ?? candidate;
    const editorCandidate = this.asRecord(payloadCandidate.editorPayload) ?? payloadCandidate;
    const reviewCandidate = this.asRecord(payloadCandidate.reviewPayload) ?? payloadCandidate;

    const topicFilter =
      this.readNonEmptyString(payloadCandidate.suggestedTopicFilter) ?? input.topicFilter;
    const script = this.readNonEmptyString(editorCandidate.script);
    if (!script) {
      return {
        artifact: null,
        error: "Parser authoring runtime returned an artifact candidate without a parser script.",
      };
    }

    const name =
      this.readNonEmptyString(editorCandidate.name) ??
      this.readNonEmptyString(candidate.title) ??
      this.toParserName(topicFilter);
    const requestSummary = input.request.trim().slice(0, 120);
    const suggestedTestPayloadHex = this.readNonEmptyString(editorCandidate.suggestedTestPayloadHex);
    const summary =
      this.readNonEmptyString(candidate.summary) ??
      this.readNonEmptyString(reviewCandidate.summary) ??
      (requestSummary
        ? `Parser draft for ${topicFilter} based on ${requestSummary}.`
        : `Parser draft for ${topicFilter}.`);
    const sourceSampleSummary =
      this.readNonEmptyString(payloadCandidate.sourceSampleSummary) ?? requestSummary;
    const generatedFromImages =
      input.attachmentCount > 0
        ? `Inferred from ${input.attachmentCount} attached protocol image(s) and the current request.`
        : "Inferred from the current request without image attachments.";
    const reviewSummary =
      this.readNonEmptyString(reviewCandidate.summary) ??
      `${generatedFromImages} Draft targets ${topicFilter}.`;
    const assumptions = this.readStringList(reviewCandidate.assumptions, [
      "The topic naming is stable enough to keep the current parser name and topic filter.",
      "Byte offsets and scaling still need one live payload verification run before production use.",
    ]);
    const risks = this.readStringList(reviewCandidate.risks, [
      "Payload field semantics still need validation in Parser Library test runs.",
      "Field naming, scaling, or endian assumptions may need adjustment after comparing against live samples.",
    ]);
    const nextSteps = this.readStringList(reviewCandidate.nextSteps, [
      "Open the draft in Parser Library.",
      "Run the suggested payload smoke test and adjust field extraction.",
      "Save the parser once the topic filter, field names, and output shape are confirmed.",
    ]);

    return {
      artifact: {
        id: randomUUID(),
        runId: input.runId,
        capabilityId: "parser-authoring",
        type: "parser-script",
        schemaVersion: 1,
        title: name,
        summary,
        payload: {
          editorPayload: {
            name,
            script,
            ...(suggestedTestPayloadHex ? { suggestedTestPayloadHex } : {}),
          },
          reviewPayload: {
            summary: reviewSummary,
            assumptions,
            risks,
            nextSteps,
          },
          suggestedTopicFilter: topicFilter,
          sourceSampleSummary,
        },
        createdAt: new Date().toISOString(),
      },
      error: null,
    };
  }

  shouldRequestSave(request: string): boolean {
    return /\b(save|persist|store|commit|overwrite|replace|update)\b|保存|落库|覆盖|替换|更新/.test(
      request.toLowerCase(),
    );
  }

  createSaveApprovalRequest(input: {
    runId: string;
    request: string;
    safetyLevel: AgentSafetyLevel;
    artifact: AgentArtifactDto;
    existingParserId?: string | null;
  }): ApprovalRequestDto {
    const payload = this.asRecord(input.artifact.payload);
    const editorPayload = this.asRecord(payload?.editorPayload);
    const parserName =
      this.readNonEmptyString(editorPayload?.name) ??
      this.readNonEmptyString(input.artifact.title) ??
      "Parser Draft";
    const script = this.readNonEmptyString(editorPayload?.script) ?? "";
    const suggestedTopicFilter = this.readNonEmptyString(payload?.suggestedTopicFilter);

    return {
      id: randomUUID(),
      runId: input.runId,
      stepId: null,
      toolName: "save_parser_draft",
      title: "Approve saving parser draft",
      actionSummary: input.existingParserId
        ? `Overwrite local parser "${parserName}" in Parser Library`
        : `Save parser draft "${parserName}" to Parser Library`,
      reason:
        input.request.trim().slice(0, 160) ||
        "Parser draft save requests require explicit confirmation.",
      riskLevel: "medium",
      safetyLevel: input.safetyLevel,
      inputPreview: JSON.stringify(
        {
          ...(input.existingParserId ? { id: input.existingParserId } : {}),
          name: parserName,
          suggestedTopicFilter,
          scriptPreview: script.slice(0, 240),
        },
        null,
        2,
      ),
      requestedAt: new Date().toISOString(),
      expiresAt: null,
    };
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

  private asRecord(value: unknown): Record<string, unknown> | null {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      return null;
    }

    return value as Record<string, unknown>;
  }

  private readNonEmptyString(value: unknown): string | null {
    if (typeof value !== "string") {
      return null;
    }

    const trimmed = value.trim();
    return trimmed ? trimmed : null;
  }

  private readStringList(value: unknown, fallback: string[]) {
    if (!Array.isArray(value)) {
      return fallback;
    }

    const normalized = value
      .filter((item): item is string => typeof item === "string")
      .map((item) => item.trim())
      .filter(Boolean);

    return normalized.length > 0 ? normalized : fallback;
  }
}
