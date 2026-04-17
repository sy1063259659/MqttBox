import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/services/agent-service", () => ({
  createAgentSession: vi.fn(),
  getAgentServiceConfig: vi.fn(),
  getAgentServiceHealth: vi.fn(),
  resolveAgentApproval: vi.fn(),
  streamAgentMessage: vi.fn(),
}));

vi.mock("@/services/tauri", () => ({
  getAgentContext: vi.fn(),
  listAgentTools: vi.fn(),
}));

import type { AgentArtifactDto, AgentEvent } from "@agent-contracts";
import { AgentPanel } from "@/components/features/agent-panel";
import { I18nProvider } from "@/lib/i18n";
import { streamAgentMessage } from "@/services/agent-service";
import { useAgentStore } from "@/stores/agent-store";
import { useParserStore } from "@/stores/parser-store";
import { useUiStore } from "@/stores/ui-store";

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
        summary: "Draft generated from screenshots and text",
        assumptions: ["Topic is stable"],
        risks: ["Field mapping still needs review"],
        nextSteps: ["Open parser library"],
      },
    },
    createdAt: "2026-04-15T00:00:00.000Z",
  };
}

function renderPanel() {
  const mounted = document.createElement("div");
  document.body.appendChild(mounted);
  const mountedRoot = createRoot(mounted);

  act(() => {
    mountedRoot.render(
      <I18nProvider localePreference="en-US">
        <AgentPanel />
      </I18nProvider>,
    );
  });

  return { mounted, mountedRoot };
}

describe("AgentPanel", () => {
  let container: HTMLDivElement | null = null;
  let root: Root | null = null;
  const OriginalFileReader = globalThis.FileReader;

  beforeEach(() => {
    useParserStore.setState({ draft: null, items: [] });
    useUiStore.setState({ activeOverlay: null });
    useAgentStore.setState({
      session: null,
      mode: "execute",
      safetyLevel: "confirm",
      timeline: {
        activeRunId: "run-1",
        latestPlan: null,
        runs: [
          {
            id: "run-1",
            sessionId: "session-1",
            mode: "execute",
            safetyLevel: "confirm",
            capabilityId: "parser-authoring",
            status: "producing_artifact",
            goal: "Create parser for factory/raw",
            createdAt: "2026-04-15T00:00:00.000Z",
            startedAt: "2026-04-15T00:00:00.000Z",
            completedAt: null,
            steps: [],
          },
        ],
      },
      messages: [],
      draftAttachments: [],
      approvals: [],
      approvalHistory: [],
      artifacts: [createArtifact()],
      capabilities: [
        {
          id: "parser-authoring",
          name: "Parser Authoring",
          description: "Generate parser drafts",
          supportedModes: ["execute"],
          defaultSafetyLevel: "draft",
          enabled: true,
        },
      ],
      serviceConfig: {
        service: "agent-service",
        model: {
          provider: "mock",
          configured: true,
          model: "gpt-5.4",
          baseUrl: "http://localhost/mock",
          enabled: true,
        },
        transport: {
          modes: ["in-memory", "ws"],
        },
        runtime: {
          deepagentsRuntime: "deepagentsjs",
        },
        supportsImageInput: true,
        supportsParserAuthoring: true,
        supportsApproval: true,
        maxAttachmentCount: 4,
        maxAttachmentBytes: 5 * 1024 * 1024,
        acceptedImageMimeTypes: ["image/png", "image/jpeg"],
      },
      transportFlavor: "contract",
      runStatus: "producing_artifact",
      statusMessage: "Building parser draft artifact",
      draftPrompt: "Create parser from screenshot",
      isSubmitting: false,
      pendingAssistantState: null,
      activePhaseSummary: null,
      tools: [
        {
          id: "describe_parser_helpers",
          name: "Describe parser helpers",
          description: "Explain helper usage",
          toolKind: "context",
          riskLevel: "low",
          allowedModes: ["chat", "execute"],
          minSafetyLevel: "observe",
          requiresApproval: false,
          inputSchema: null,
          outputSchema: null,
          timeoutMs: null,
          retryPolicy: null,
        },
      ],
      context: {
        activeConnectionId: "connection-1",
        selectedTopic: "factory/raw",
        recentMessages: 4,
        connectionHealth: "connected",
        availableTools: [],
      },
    });

    class MockFileReader {
      result: string | ArrayBuffer | null = null;
      error: DOMException | null = null;
      onload: ((this: FileReader, ev: ProgressEvent<FileReader>) => unknown) | null = null;
      onerror: ((this: FileReader, ev: ProgressEvent<FileReader>) => unknown) | null = null;

      readAsDataURL(file: Blob) {
        this.result = `data:${file.type || "image/png"};base64,mock-image`;
        this.onload?.call(
          this as unknown as FileReader,
          new ProgressEvent("load") as ProgressEvent<FileReader>,
        );
      }
    }

    vi.stubGlobal("FileReader", MockFileReader);
    vi.clearAllMocks();
  });

  afterEach(() => {
    act(() => {
      root?.unmount();
    });
    container?.remove();
    root = null;
    container = null;
    document.body.innerHTML = "";
    vi.unstubAllGlobals();
    vi.stubGlobal("FileReader", OriginalFileReader);
  });

  it("renders the codex-style agent shell and opens parser drafts from the light result block", () => {
    ({ mounted: container, mountedRoot: root } = renderPanel());

    expect(container?.textContent).toContain("Conversation");
    expect(container?.textContent).toContain("Create parser for factory/raw");
    expect(container?.textContent).toContain("Create parser for factory/raw");
    expect(container?.textContent).toContain("Execute");
    expect(container?.textContent).toContain("Confirm");
    expect(container?.textContent).toContain("Open in parser library");
    expect(container?.textContent).not.toContain("Details");
    expect(container?.textContent).not.toContain("Up to 4 images");

    const modeButton = Array.from(container?.querySelectorAll("button") ?? []).find(
      (button) => button.getAttribute("aria-label") === "Mode: execute",
    );
    expect(modeButton).toBeTruthy();

    expect((modeButton as HTMLButtonElement).disabled).toBe(true);

    const openButton = Array.from(container?.querySelectorAll("button") ?? []).find((button) =>
      button.textContent?.includes("Open in parser library"),
    );
    expect(openButton).toBeTruthy();

    act(() => {
      openButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(useUiStore.getState().activeOverlay).toBe("parsers");
    expect(useParserStore.getState().draft).toEqual(
      expect.objectContaining({
        name: "Factory Parser",
        script: "function parse() { return {}; }",
        suggestedTestPayloadHex: "0102",
      }),
    );
  });

  it("renders approval requests inline and resolves them from the message flow", () => {
    const resolveApproval = vi.fn(async () => {});
    useAgentStore.setState({
      approvals: [
        {
          id: "approval-1",
          runId: "run-1",
          stepId: null,
          toolName: "capture_parser_artifact",
          title: "Review parser draft",
          actionSummary: "Check the generated parser before saving it.",
          reason: "confirm mode requires approval",
          riskLevel: "medium",
          safetyLevel: "confirm",
          inputPreview: '{"name":"Factory Parser"}',
          requestedAt: "2026-04-15T00:00:02.000Z",
          expiresAt: null,
        },
      ],
      resolveApproval: resolveApproval as never,
    } as never);

    ({ mounted: container, mountedRoot: root } = renderPanel());

    expect(container?.textContent).toContain("Review parser draft");
    expect(container?.textContent).toContain("Check the generated parser before saving it.");

    const approveButton = Array.from(container?.querySelectorAll("button") ?? []).find((button) =>
      button.textContent?.includes("Approve"),
    );
    expect(approveButton).toBeTruthy();

    act(() => {
      approveButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(resolveApproval).toHaveBeenCalledWith("approval-1", "approved");
  });

  it("adds pasted images from anywhere in the panel while preserving pasted text", async () => {
    ({ mounted: container, mountedRoot: root } = renderPanel());

    const panel = container?.querySelector(".agent-panel");
    expect(panel).toBeTruthy();

    const file = new File(["binary"], "clipboard.png", { type: "image/png" });
    const pasteEvent = new Event("paste", { bubbles: true, cancelable: true });

    Object.defineProperty(pasteEvent, "clipboardData", {
      value: {
        items: [
          {
            kind: "file",
            type: "image/png",
            getAsFile: () => file,
          },
        ],
        files: [file],
        getData: (type: string) => (type === "text/plain" ? " + clipboard note" : ""),
      },
    });

    await act(async () => {
      panel?.dispatchEvent(pasteEvent);
      await Promise.resolve();
    });

    expect(pasteEvent.defaultPrevented).toBe(true);
    expect(useAgentStore.getState().draftPrompt).toBe("Create parser from screenshot + clipboard note");
    expect(useAgentStore.getState().draftAttachments).toHaveLength(1);
    expect(container?.textContent).toContain("clipboard.png");
  });

  it("clears the composer on send, shows phase summaries, and transitions to the streamed reply", async () => {
    let emitEvent: ((event: AgentEvent) => void) | null = null;
    let finishStream: ((result: {
      sessionId: string;
      userMessageId: string;
      assistantMessageId: string;
      assistantContent: string;
    }) => void) | null = null;

    useAgentStore.setState({
      session: {
        id: "session-1",
        mode: "execute",
        safetyLevel: "confirm",
        createdAt: "2026-04-15T00:00:00.000Z",
        workspaceId: null,
      },
      timeline: {
        activeRunId: null,
        latestPlan: null,
        runs: [],
      },
      artifacts: [],
      messages: [],
      approvals: [],
      runStatus: "idle",
      statusMessage: null,
      draftPrompt: "Create parser from screenshot",
      isSubmitting: false,
      pendingAssistantState: null,
      activePhaseSummary: null,
    });

    vi.mocked(streamAgentMessage).mockImplementation(
      async ({ onEvent }) =>
        await new Promise((resolve) => {
          emitEvent = onEvent;
          finishStream = resolve;
        }),
    );

    ({ mounted: container, mountedRoot: root } = renderPanel());

    const textarea = container?.querySelector("textarea") as HTMLTextAreaElement | null;
    const sendButton = Array.from(container?.querySelectorAll("button") ?? []).find(
      (button) => button.getAttribute("aria-label") === "Send to agent",
    );

    expect(textarea).toBeTruthy();
    expect(sendButton).toBeTruthy();

    await act(async () => {
      sendButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
    });

    expect(textarea?.value).toBe("");
    expect(container?.textContent).toContain("Create parser from screenshot");
    expect(container?.textContent).toContain("Sending");
    expect(container?.querySelector(".agent-panel-pending-block")).toBeTruthy();
    expect((sendButton as HTMLButtonElement).disabled).toBe(true);

    expect(textarea?.disabled).toBe(false);

    act(() => {
      useAgentStore.getState().setDraftPrompt("Follow-up question");
    });

    expect((container?.querySelector("textarea") as HTMLTextAreaElement | null)?.value).toBe(
      "Follow-up question",
    );
    expect((sendButton as HTMLButtonElement).disabled).toBe(true);

    await act(async () => {
      emitEvent?.({
        id: "evt-run-started",
        type: "run.started",
        timestamp: "2026-04-15T00:00:01.000Z",
        sessionId: "session-1",
        runId: "run-1",
        payload: {
          run: {
            id: "run-1",
            sessionId: "session-1",
            mode: "execute",
            safetyLevel: "confirm",
            capabilityId: "parser-authoring",
            status: "planning",
            goal: "Create parser for factory/raw",
            createdAt: "2026-04-15T00:00:01.000Z",
            startedAt: "2026-04-15T00:00:01.000Z",
            completedAt: null,
          },
        },
      });
      emitEvent?.({
        id: "evt-plan-ready",
        type: "plan.ready",
        timestamp: "2026-04-15T00:00:02.000Z",
        sessionId: "session-1",
        runId: "run-1",
        payload: {
          plan: {
            runId: "run-1",
            capabilityId: "parser-authoring",
            goal: "Create parser for factory/raw",
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
      });
      await Promise.resolve();
    });

    expect(container?.textContent).toContain("Planning");
    expect(container?.textContent).toContain("Inspect payload bytes");

    await act(async () => {
      emitEvent?.({
        id: "evt-assistant-delta",
        type: "assistant.delta",
        timestamp: "2026-04-15T00:00:03.000Z",
        sessionId: "session-1",
        runId: "run-1",
        payload: {
          messageId: "assistant-1",
          delta: "Here is the first draft",
        },
      });
      emitEvent?.({
        id: "evt-assistant-final",
        type: "assistant.final",
        timestamp: "2026-04-15T00:00:04.000Z",
        sessionId: "session-1",
        runId: "run-1",
        payload: {
          messageId: "assistant-1",
          content: "Here is the first draft parser",
          finishReason: "stop",
        },
      });
      emitEvent?.({
        id: "evt-run-completed",
        type: "run.completed",
        timestamp: "2026-04-15T00:00:05.000Z",
        sessionId: "session-1",
        runId: "run-1",
        payload: {
          run: {
            id: "run-1",
            sessionId: "session-1",
            mode: "execute",
            safetyLevel: "confirm",
            capabilityId: "parser-authoring",
            status: "completed",
            goal: "Create parser for factory/raw",
            createdAt: "2026-04-15T00:00:01.000Z",
            startedAt: "2026-04-15T00:00:01.000Z",
            completedAt: "2026-04-15T00:00:05.000Z",
          },
          finishReason: "stop",
        },
      });
      finishStream?.({
        sessionId: "session-1",
        userMessageId: "message-1",
        assistantMessageId: "assistant-1",
        assistantContent: "Here is the first draft parser",
      });
      await Promise.resolve();
    });

    expect(container?.querySelector(".agent-panel-pending-block")).toBeNull();
    expect(container?.textContent).toContain("Here is the first draft parser");
    expect((sendButton as HTMLButtonElement).disabled).toBe(false);
  });

  it("sends with Enter, keeps Shift+Enter for newline, and disables mode changes while a run is active", async () => {
    let resolver:
      | ((result: {
          sessionId: string;
          userMessageId: string;
          assistantMessageId: string;
          assistantContent: string;
        }) => void)
      | null = null;
    useAgentStore.setState({
      session: {
        id: "session-1",
        mode: "execute",
        safetyLevel: "confirm",
        createdAt: "2026-04-15T00:00:00.000Z",
        workspaceId: null,
      },
      timeline: {
        activeRunId: null,
        latestPlan: null,
        runs: [],
      },
      artifacts: [],
      messages: [],
      approvals: [],
      runStatus: "idle",
      statusMessage: null,
      draftPrompt: "Create parser with enter",
      isSubmitting: false,
      pendingAssistantState: null,
      activePhaseSummary: null,
    });

    vi.mocked(streamAgentMessage).mockImplementation(
      async () =>
        await new Promise<{
          sessionId: string;
          userMessageId: string;
          assistantMessageId: string;
          assistantContent: string;
        }>((resolve) => {
          resolver = resolve;
        }),
    );

    ({ mounted: container, mountedRoot: root } = renderPanel());

    const textarea = container?.querySelector("textarea") as HTMLTextAreaElement | null;
    const modeButton = Array.from(container?.querySelectorAll("button") ?? []).find(
      (button) => button.getAttribute("aria-label") === "Mode: execute",
    ) as HTMLButtonElement | undefined;

    expect(textarea).toBeTruthy();
    expect(modeButton).toBeTruthy();

    await act(async () => {
      textarea?.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "Enter",
          bubbles: true,
        }),
      );
      await Promise.resolve();
    });

    expect(vi.mocked(streamAgentMessage)).toHaveBeenCalledTimes(1);
    expect(modeButton?.disabled).toBe(true);

    act(() => {
      useAgentStore.getState().setDraftPrompt("Line one");
    });

    await act(async () => {
      textarea?.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "Enter",
          shiftKey: true,
          bubbles: true,
        }),
      );
      await Promise.resolve();
    });

    expect(vi.mocked(streamAgentMessage)).toHaveBeenCalledTimes(1);

    await act(async () => {
      resolver?.({
        sessionId: "session-1",
        userMessageId: "message-1",
        assistantMessageId: "assistant-1",
        assistantContent: "",
      });
      await Promise.resolve();
    });
  });
});
