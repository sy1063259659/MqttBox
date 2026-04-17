import { beforeEach, describe, expect, it } from "vitest";

import type {
  AgentArtifactDto,
  AgentAttachmentDto,
  AgentEvent,
  AgentRunDto,
  ApprovalRequestDto,
} from "@agent-contracts";
import { useAgentStore } from "@/stores/agent-store";

function resetAgentStore() {
  useAgentStore.setState({
    session: null,
    mode: "chat",
    safetyLevel: "confirm",
    timeline: {
      activeRunId: null,
      runs: [],
      latestPlan: null,
    },
    messages: [],
    draftAttachments: [],
    approvals: [],
    approvalHistory: [],
    artifacts: [],
    capabilities: [],
    serviceConfig: null,
    transportFlavor: "unknown",
    runStatus: "idle",
    statusMessage: null,
    draftPrompt: "",
    isSubmitting: false,
    pendingAssistantState: null,
    activePhaseSummary: null,
    tools: [],
    context: null,
  });
}

function createRun(overrides: Partial<AgentRunDto> = {}): AgentRunDto {
  return {
    id: "run-1",
    sessionId: "session-1",
    mode: "execute",
    safetyLevel: "confirm",
    capabilityId: "parser-authoring",
    status: "planning",
    goal: "Create parser draft",
    createdAt: "2026-04-15T00:00:00.000Z",
    startedAt: "2026-04-15T00:00:00.000Z",
    completedAt: null,
    ...overrides,
  };
}

function createAttachment(): AgentAttachmentDto {
  return {
    id: "attachment-1",
    kind: "image",
    source: "file",
    mimeType: "image/png",
    filename: "capture.png",
    dataUrl: "data:image/png;base64,AAAA",
    byteSize: 4,
  };
}

function createArtifact(): AgentArtifactDto {
  return {
    id: "artifact-1",
    runId: "run-1",
    capabilityId: "parser-authoring",
    type: "parser-script",
    schemaVersion: 1,
    title: "Factory Parser",
    summary: "Parser draft for factory/raw",
    payload: {
      editorPayload: {
        name: "Factory Parser",
        script: "function parse() { return {}; }",
        suggestedTestPayloadHex: "0102",
      },
      reviewPayload: {
        summary: "Draft generated from image and text",
        assumptions: ["Topic remains stable"],
        risks: ["Field offsets may need review"],
        nextSteps: ["Open ParserLibrary"],
      },
    },
    createdAt: "2026-04-15T00:00:00.000Z",
  };
}

function createApprovalRequest(): ApprovalRequestDto {
  return {
    id: "approval-1",
    runId: "run-1",
    stepId: null,
    toolName: "artifact.createParserDraft",
    title: "Approve parser draft creation",
    actionSummary: "Create a parser draft artifact for factory/raw",
    reason: "Need confirmation",
    riskLevel: "medium",
    safetyLevel: "confirm",
    inputPreview: "{}",
    requestedAt: "2026-04-15T00:00:00.000Z",
    expiresAt: null,
  };
}

function applyEvents(events: AgentEvent[]) {
  for (const event of events) {
    useAgentStore.getState().applyIncomingEvent(event);
  }
}

describe("useAgentStore.applyIncomingEvent", () => {
  beforeEach(() => {
    resetAgentStore();
  });

  it("tracks run lifecycle events as the primary run-status source", () => {
    const artifact = createArtifact();
    applyEvents([
      {
        id: "evt-session",
        type: "session.start",
        timestamp: "2026-04-15T00:00:00.000Z",
        sessionId: "session-1",
        runId: null,
        payload: {
          session: {
            id: "session-1",
            mode: "execute",
            safetyLevel: "confirm",
            createdAt: "2026-04-15T00:00:00.000Z",
            workspaceId: null,
          },
        },
      },
      {
        id: "evt-run-started",
        type: "run.started",
        timestamp: "2026-04-15T00:00:01.000Z",
        sessionId: "session-1",
        runId: "run-1",
        payload: {
          run: createRun({ status: "planning" }),
        },
      },
      {
        id: "evt-run-status",
        type: "run.status",
        timestamp: "2026-04-15T00:00:02.000Z",
        sessionId: "session-1",
        runId: "run-1",
        payload: {
          runId: "run-1",
          status: "producing_artifact",
          message: "Building parser draft artifact",
        },
      },
      {
        id: "evt-artifact",
        type: "artifact.ready",
        timestamp: "2026-04-15T00:00:03.000Z",
        sessionId: "session-1",
        runId: "run-1",
        payload: {
          artifact,
        },
      },
      {
        id: "evt-run-completed",
        type: "run.completed",
        timestamp: "2026-04-15T00:00:04.000Z",
        sessionId: "session-1",
        runId: "run-1",
        payload: {
          run: createRun({ status: "completed", completedAt: "2026-04-15T00:00:04.000Z" }),
          finishReason: "stop",
        },
      },
    ]);

    const state = useAgentStore.getState();
    expect(state.runStatus).toBe("completed");
    expect(state.statusMessage).toBeNull();
    expect(state.artifacts[0]).toEqual(artifact);
    expect(state.timeline.runs[0]).toEqual(
      expect.objectContaining({
        id: "run-1",
        status: "completed",
      }),
    );
  });

  it("moves approvals into history and surfaces approval expiry/rejection statuses", () => {
    const request = createApprovalRequest();
    applyEvents([
      {
        id: "evt-run-started",
        type: "run.started",
        timestamp: "2026-04-15T00:00:01.000Z",
        sessionId: "session-1",
        runId: "run-1",
        payload: {
          run: createRun({ status: "awaiting_approval" }),
        },
      },
      {
        id: "evt-approval-requested",
        type: "approval.requested",
        timestamp: "2026-04-15T00:00:02.000Z",
        sessionId: "session-1",
        runId: "run-1",
        payload: { request },
      },
      {
        id: "evt-approval-resolved",
        type: "approval.resolved",
        timestamp: "2026-04-15T00:00:03.000Z",
        sessionId: "session-1",
        runId: "run-1",
        payload: {
          requestId: request.id,
          outcome: "rejected",
          resolvedAt: "2026-04-15T00:00:03.000Z",
          resolver: "frontend-shell",
        },
      },
      {
        id: "evt-run-completed",
        type: "run.completed",
        timestamp: "2026-04-15T00:00:04.000Z",
        sessionId: "session-1",
        runId: "run-1",
        payload: {
          run: createRun({ status: "failed", completedAt: "2026-04-15T00:00:04.000Z" }),
          finishReason: "error",
        },
      },
    ]);

    const state = useAgentStore.getState();
    expect(state.approvals).toHaveLength(0);
    expect(state.approvalHistory).toEqual([
      expect.objectContaining({
        requestId: request.id,
        outcome: "rejected",
      }),
    ]);
    expect(state.statusMessage).toBe("Approval rejected");
    expect(state.runStatus).toBe("failed");
  });

  it("tracks pending assistant phases from run and streaming events", () => {
    useAgentStore.setState({
      messages: [
        {
          id: "local-user-1",
          role: "user",
          content: "Create parser",
          mode: "execute",
          safetyLevel: "confirm",
          createdAt: "2026-04-15T00:00:00.000Z",
          attachments: [],
          isOptimistic: true,
        },
      ],
      isSubmitting: true,
      pendingAssistantState: {
        userMessageId: "local-user-1",
        runId: null,
        phase: "sending",
        detail: null,
        createdAt: "2026-04-15T00:00:00.000Z",
      },
      activePhaseSummary: "sending",
    } as never);

    applyEvents([
      {
        id: "evt-run-started",
        type: "run.started",
        timestamp: "2026-04-15T00:00:01.000Z",
        sessionId: "session-1",
        runId: "run-1",
        payload: {
          run: createRun({ status: "planning" }),
        },
      },
      {
        id: "evt-plan-ready",
        type: "plan.ready",
        timestamp: "2026-04-15T00:00:02.000Z",
        sessionId: "session-1",
        runId: "run-1",
        payload: {
          plan: {
            runId: "run-1",
            capabilityId: "parser-authoring",
            goal: "Create parser draft",
            steps: [
              {
                id: "step-1",
                runId: "run-1",
                index: 0,
                title: "Inspect payload bytes",
                kind: "analysis",
                status: "pending",
                attempt: 0,
                startedAt: null,
                completedAt: null,
              },
            ],
          },
        },
      },
    ]);

    expect(useAgentStore.getState().pendingAssistantState).toEqual(
      expect.objectContaining({
        runId: "run-1",
        phase: "planning",
        detail: "Inspect payload bytes",
      }),
    );

    applyEvents([
      {
        id: "evt-assistant-delta",
        type: "assistant.delta",
        timestamp: "2026-04-15T00:00:03.000Z",
        sessionId: "session-1",
        runId: "run-1",
        payload: {
          messageId: "assistant-1",
          delta: "Draft ready",
        },
      },
    ]);

    expect(useAgentStore.getState().pendingAssistantState).toBeNull();
    expect(useAgentStore.getState().activePhaseSummary).toBeNull();
    expect(useAgentStore.getState().isSubmitting).toBe(false);
  });

  it("stores assistant messages with attachment metadata without breaking run state", () => {
    const attachment = createAttachment();
    applyEvents([
      {
        id: "evt-session-message",
        type: "session.message",
        timestamp: "2026-04-15T00:00:00.000Z",
        sessionId: "session-1",
        runId: null,
        payload: {
          messageId: "message-1",
          role: "user",
          content: "Create parser from this screenshot",
          mode: "execute",
          safetyLevel: "confirm",
          attachments: [attachment],
        },
      },
      {
        id: "evt-assistant-final",
        type: "assistant.final",
        timestamp: "2026-04-15T00:00:01.000Z",
        sessionId: "session-1",
        runId: null,
        payload: {
          messageId: "message-2",
          content: "Draft ready",
          finishReason: "stop",
        },
      },
    ]);

    const state = useAgentStore.getState();
    expect(state.messages[0]).toEqual(
      expect.objectContaining({
        id: "message-1",
        attachments: [attachment],
      }),
    );
    expect(state.messages[1]).toEqual(
      expect.objectContaining({
        id: "message-2",
        content: "Draft ready",
      }),
    );
    expect(state.runStatus).toBe("idle");
  });
});
