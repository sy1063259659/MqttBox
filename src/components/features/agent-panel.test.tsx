import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/services/agent-service", () => ({
  createAgentSession: vi.fn(),
  getAgentServiceConfig: vi.fn(),
  getAgentServiceHealth: vi.fn(),
  getAgentSessionDetail: vi.fn(),
  listAgentSessions: vi.fn(),
  resolveAgentApproval: vi.fn(),
  streamAgentMessage: vi.fn(),
}));

vi.mock("@/services/tauri", () => ({
  getAgentContext: vi.fn(),
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
      activeSessionId: null,
      sessionSummaries: [],
      sessionDetailsById: {},
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
      contextSummary: null,
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
          protocol: "responses",
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

    const composerStatus = container?.querySelector(".agent-panel-composer-status");
    const composer = container?.querySelector(".agent-panel-composer");

    expect(container?.querySelector(".agent-panel-toolbar")).toBeNull();
    expect(container?.querySelector(".agent-panel-composer-shell")).toBeNull();
    expect(composer?.querySelector(".agent-panel-composer-textarea")).toBeTruthy();
    expect(composer?.querySelector(".agent-panel-composer-bar")).toBeTruthy();
    expect(composerStatus?.textContent).toContain("Preparing result");
    expect(container?.textContent).toContain("Execute");
    expect(container?.textContent).toContain("Confirm");
    expect(container?.textContent).toContain("Open in parser library");
    expect(container?.textContent).not.toContain("Details");
    expect(container?.textContent).not.toContain("Up to 4 images");
    expect(container?.textContent).not.toContain("Draft generated from screenshots and text");
    expect(container?.querySelector(".agent-panel-feed-item--followup .agent-panel-result-block")).toBeTruthy();

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

  it("keeps the empty state minimal without topic, health, or shortcut badges", () => {
    useAgentStore.setState({
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
      pendingAssistantState: null,
    });

    ({ mounted: container, mountedRoot: root } = renderPanel());

    const textarea = container?.querySelector("textarea") as HTMLTextAreaElement | null;

    expect(container?.querySelector(".agent-panel-toolbar")).toBeNull();
    expect(container?.querySelector(".agent-panel-composer-status")?.textContent).toContain("Idle");
    expect(container?.querySelector(".agent-panel-empty-state")).toBeTruthy();
    expect(container?.textContent).not.toContain("Start with a parsing task");
    expect(container?.textContent).not.toContain("Describe the payload layout");
    expect(container?.textContent).not.toContain("factory/raw");
    expect(container?.textContent).not.toContain("connected");
    expect(container?.textContent).not.toContain("Paste");
    expect(textarea?.getAttribute("placeholder")).toBe("Ask or describe a task");
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

  it("normalizes assistant markdown-like text into short plain-text paragraphs", () => {
    useAgentStore.setState({
      timeline: {
        activeRunId: null,
        latestPlan: null,
        runs: [],
      },
      artifacts: [],
      approvals: [],
      runStatus: "completed",
      pendingAssistantState: null,
      messages: [
        {
          id: "assistant-markdown-1",
          role: "assistant",
          content: "**Summary**\n- First point\n- Second point\n```js\nconst x = 1;\n```\nNext steps: keep testing.",
          createdAt: "2026-04-15T00:00:00.000Z",
          mode: "chat",
          safetyLevel: "confirm",
          attachments: [],
          isStreaming: false,
          isOptimistic: false,
        },
      ],
    });

    ({ mounted: container, mountedRoot: root } = renderPanel());

    const assistantBody = container?.querySelector(".agent-panel-message-body");
    const assistantParagraphs = Array.from(
      container?.querySelectorAll(".agent-panel-message-paragraph") ?? [],
    ).map((node) => node.textContent);

    expect(assistantBody?.textContent).toContain("First point\nSecond point\nconst x = 1;\nkeep testing.");
    expect(assistantBody?.textContent).not.toContain("First point Second point");
    expect(assistantBody?.textContent).not.toContain("**Summary**");
    expect(assistantBody?.textContent).not.toContain("- First point");
    expect(assistantBody?.textContent).not.toContain("```");
    expect(assistantBody?.textContent).not.toContain("Next steps:");
    expect(assistantParagraphs).toEqual(["First point\nSecond point\nconst x = 1;\nkeep testing."]);
  });

  it("renders assistant replies as lightweight paragraphs with a stronger lead paragraph", () => {
    useAgentStore.setState({
      timeline: {
        activeRunId: null,
        latestPlan: null,
        runs: [],
      },
      artifacts: [],
      approvals: [],
      runStatus: "completed",
      pendingAssistantState: null,
      messages: [
        {
          id: "assistant-paragraphs-1",
          role: "assistant",
          content: "Parser draft is ready.\n\nIt decodes battery voltage and status bits.\n\nPlease validate one live sample before saving.",
          createdAt: "2026-04-15T00:00:00.000Z",
          mode: "chat",
          safetyLevel: "confirm",
          attachments: [],
          isStreaming: false,
          isOptimistic: false,
        },
      ],
    });

    ({ mounted: container, mountedRoot: root } = renderPanel());

    const paragraphs = Array.from(
      container?.querySelectorAll(".agent-panel-message-paragraph") ?? [],
    ) as HTMLParagraphElement[];

    expect(paragraphs).toHaveLength(3);
    expect(paragraphs[0]?.getAttribute("data-paragraph-index")).toBe("0");
    expect(paragraphs[0]?.textContent).toBe("Parser draft is ready.");
    expect(paragraphs[1]?.textContent).toBe("It decodes battery voltage and status bits.");
    expect(paragraphs[2]?.textContent).toBe("Please validate one live sample before saving.");
  });

  it("renders parser save approvals with parser-specific actions", () => {
    const resolveApproval = vi.fn(async () => {});
    useAgentStore.setState({
      approvals: [
        {
          id: "approval-save-1",
          runId: "run-1",
          stepId: null,
          toolName: "save_parser_draft",
          title: "Approve saving parser draft",
          actionSummary: 'Save parser draft "Factory Parser" to Parser Library',
          reason: "Parser draft save requests require explicit confirmation.",
          riskLevel: "medium",
          safetyLevel: "confirm",
          inputPreview: JSON.stringify(
            {
              name: "Factory Parser",
              suggestedTopicFilter: "factory/raw",
              scriptPreview: "function parse(input) { return { ok: true }; }",
            },
            null,
            2,
          ),
          requestedAt: "2026-04-15T00:00:02.000Z",
          expiresAt: null,
        },
      ],
      resolveApproval: resolveApproval as never,
    } as never);

    ({ mounted: container, mountedRoot: root } = renderPanel());

    expect(container?.textContent).toContain("Save this parser to parser library?");
    expect(container?.textContent).toContain("Factory Parser");
    expect(container?.textContent).toContain("factory/raw");
    expect(container?.textContent).toContain("Save parser");
    expect(container?.textContent).toContain("Not now");
    expect(container?.textContent).not.toContain('"name":"Factory Parser"');

    const saveButton = Array.from(container?.querySelectorAll("button") ?? []).find((button) =>
      button.textContent?.includes("Save parser"),
    );
    expect(saveButton).toBeTruthy();

    act(() => {
      saveButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(resolveApproval).toHaveBeenCalledWith("approval-save-1", "approved");
  });

  it("adds pasted images from anywhere in the panel while preserving pasted text", async () => {
    ({ mounted: container, mountedRoot: root } = renderPanel());

    const panel = container?.querySelector(".agent-panel");
    const composer = container?.querySelector(".agent-panel-composer");
    expect(panel).toBeTruthy();
    expect(composer?.querySelector(".agent-panel-composer-preview-strip")).toBeNull();

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
    expect(composer?.querySelector(".agent-panel-composer-preview-strip")).toBeTruthy();
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
        createdAt: "2026-04-15T00:00:00.000Z",
        updatedAt: "2026-04-15T00:00:00.000Z",
        title: "Create parser from screenshot",
        lastMessagePreview: null,
        draftMode: "execute",
        draftSafetyLevel: "confirm",
        workspaceId: null,
      },
      activeSessionId: "session-1",
      sessionSummaries: [],
      sessionDetailsById: {},
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
    expect(container?.querySelector(".agent-panel-composer-status")?.textContent).toContain("Sending");
    expect((sendButton as HTMLButtonElement).disabled).toBe(true);
    expect(
      Array.from(container?.querySelectorAll(".agent-panel-feed-item") ?? []).map((item) =>
        item.textContent?.replace(/\s+/g, " ").trim(),
      ),
    ).toEqual([
      expect.stringContaining("Create parser from screenshot"),
      expect.stringContaining("Sending"),
    ]);

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
    expect(
      Array.from(container?.querySelectorAll(".agent-panel-feed-item") ?? []).map((item) =>
        item.textContent?.replace(/\s+/g, " ").trim(),
      ),
    ).toEqual([
      expect.stringContaining("Create parser from screenshot"),
      expect.stringContaining("Planning"),
    ]);

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
    expect(container?.querySelector(".agent-panel-composer-status")?.textContent).toContain("Completed");
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
        createdAt: "2026-04-15T00:00:00.000Z",
        updatedAt: "2026-04-15T00:00:00.000Z",
        title: "Create parser with enter",
        lastMessagePreview: null,
        draftMode: "execute",
        draftSafetyLevel: "confirm",
        workspaceId: null,
      },
      activeSessionId: "session-1",
      sessionSummaries: [],
      sessionDetailsById: {},
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
