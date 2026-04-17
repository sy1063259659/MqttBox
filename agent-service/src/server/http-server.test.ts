import type { Server as NodeServer } from "node:http";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AgentEvent, AgentSessionDto } from "@agent-contracts";
import type { AgentHarness } from "../harness/agent-harness.js";
import { Logger } from "../observability/logger.js";
import { HttpServer } from "./http-server.js";

type HarnessStub = {
  health: ReturnType<typeof vi.fn>;
  getConfig: ReturnType<typeof vi.fn>;
  updateModelConfig: ReturnType<typeof vi.fn>;
  createSession: ReturnType<typeof vi.fn>;
  getSession: ReturnType<typeof vi.fn>;
  appendSessionMessage: ReturnType<typeof vi.fn>;
  resolveApproval: ReturnType<typeof vi.fn>;
};

function createSession(
  overrides: Partial<AgentSessionDto> = {},
): AgentSessionDto {
  return {
    id: "session-1",
    mode: "chat",
    safetyLevel: "observe",
    createdAt: "2026-04-15T00:00:00.000Z",
    ...overrides,
  };
}

function createEvent(type: AgentEvent["type"], sessionId = "session-1"): AgentEvent {
  return {
    id: `${type}-event`,
    type,
    timestamp: "2026-04-15T00:00:00.000Z",
    sessionId,
    runId: null,
    payload:
      type === "session.message"
        ? {
            messageId: "message-1",
            role: "assistant",
            content: "done",
            mode: "chat",
            safetyLevel: "observe",
            attachments: [],
          }
        : {
            session: createSession({ id: sessionId }),
          },
  } as AgentEvent;
}

function createHarnessStub(): HarnessStub {
  const session = createSession();

  return {
    health: vi.fn(() => ({
      status: "ok",
      service: "agent-service",
      capabilities: [{ id: "chat.basic" }],
      tools: [],
      deepagentsRuntime: "stub",
      model: { provider: "mock", model: "test" },
    })),
    getConfig: vi.fn(() => ({
      service: "agent-service",
      model: { provider: "mock", model: "test" },
      transport: { modes: ["in-memory", "ws"] },
      runtime: { deepagentsRuntime: "stub" },
    })),
    updateModelConfig: vi.fn(),
    createSession: vi.fn(({ mode, safetyLevel }: { mode?: string; safetyLevel?: string }) => ({
      session: createSession({
        id: "created-session",
        mode: (mode as AgentSessionDto["mode"] | undefined) ?? "chat",
        safetyLevel: (safetyLevel as AgentSessionDto["safetyLevel"] | undefined) ?? "observe",
      }),
      events: [createEvent("session.start", "created-session")],
    })),
    getSession: vi.fn((sessionId: string) => (sessionId === session.id ? session : null)),
    appendSessionMessage: vi.fn(
      async ({
        sessionId,
        message,
        attachments,
        onEvent,
      }: {
        sessionId: string;
        message: string;
        attachments: unknown[];
        onEvent?: (event: AgentEvent) => void;
      }) => {
        const activeSession = createSession({ id: sessionId });
        onEvent?.(createEvent("session.message", sessionId));
        onEvent?.(createEvent("assistant.final", sessionId));

        return {
          session: activeSession,
          userMessageId: "user-1",
          assistantMessageId: "assistant-1",
          assistantContent: `echo:${message}`,
          events: attachments.length ? [createEvent("session.message", sessionId)] : [],
        };
      },
    ),
    resolveApproval: vi.fn(
      async (
        sessionId: string,
        requestId: string,
        outcome: "approved" | "rejected" | "expired",
      ) => ({
        session: createSession({ id: sessionId, mode: "execute" }),
        runId: "run-1",
        requestId,
        outcome,
        events: [createEvent("session.start", sessionId)],
      }),
    ),
  };
}

async function startServer(harness = createHarnessStub()) {
  const server = new HttpServer(
    harness as unknown as AgentHarness,
    new Logger("http-server-test", "error"),
    0,
  );

  await server.start();

  const nodeServer = Reflect.get(server, "server") as NodeServer | null;
  const address = nodeServer?.address();
  if (!address || typeof address === "string") {
    throw new Error("expected http server to listen on an ephemeral port");
  }

  return {
    server,
    harness,
    baseUrl: `http://127.0.0.1:${address.port}`,
  };
}

async function requestJson(
  baseUrl: string,
  path: string,
  init: {
    method?: string;
    body?: unknown;
    headers?: Record<string, string>;
  } = {},
) {
  const response = await fetch(`${baseUrl}${path}`, {
    method: init.method,
    headers: {
      ...(init.body === undefined ? {} : { "content-type": "application/json" }),
      ...(init.headers ?? {}),
    },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
  const raw = await response.text();

  return {
    response,
    body: raw ? (JSON.parse(raw) as unknown) : null,
  };
}

describe("HttpServer", () => {
  let activeServer: HttpServer | null = null;

  afterEach(async () => {
    await activeServer?.stop();
    activeServer = null;
  });

  it("serves /health and /config from distinct harness surfaces", async () => {
    const harness = createHarnessStub();
    const started = await startServer(harness);
    activeServer = started.server;

    const health = await requestJson(started.baseUrl, "/health");
    const config = await requestJson(started.baseUrl, "/config");

    expect(health.response.status).toBe(200);
    expect(config.response.status).toBe(200);
    expect(health.body).toEqual(harness.health.mock.results[0]?.value);
    expect(config.body).toEqual(harness.getConfig.mock.results[0]?.value);
    expect(harness.health).toHaveBeenCalledTimes(1);
    expect(harness.getConfig).toHaveBeenCalledTimes(1);
  });

  it("creates sessions and fetches an existing session", async () => {
    const harness = createHarnessStub();
    harness.getSession.mockReturnValueOnce(createSession({ id: "created-session", mode: "execute" }));
    const started = await startServer(harness);
    activeServer = started.server;

    const created = await requestJson(started.baseUrl, "/sessions", {
      method: "POST",
      body: {
        mode: "execute",
        safetyLevel: "confirm",
      },
    });
    const fetched = await requestJson(started.baseUrl, "/sessions/created-session");

    expect(created.response.status).toBe(201);
    expect(created.body).toMatchObject({
      session: {
        id: "created-session",
        mode: "execute",
        safetyLevel: "confirm",
      },
    });
    expect(harness.createSession).toHaveBeenCalledWith({
      mode: "execute",
      safetyLevel: "confirm",
    });
    expect(fetched.response.status).toBe(200);
    expect(fetched.body).toEqual({
      session: createSession({ id: "created-session", mode: "execute" }),
    });
  });

  it("returns 404 for missing sessions", async () => {
    const started = await startServer();
    activeServer = started.server;

    const result = await requestJson(started.baseUrl, "/sessions/missing-session");

    expect(result.response.status).toBe(404);
    expect(result.body).toEqual({ error: "session_not_found" });
  });

  it("appends session messages and validates required content", async () => {
    const harness = createHarnessStub();
    const started = await startServer(harness);
    activeServer = started.server;

    const created = await requestJson(started.baseUrl, "/sessions/session-1/messages", {
      method: "POST",
      body: {
        content: "hello harness",
        attachments: [
          {
            id: "image-1",
            kind: "image",
            source: "file",
            mimeType: "image/png",
            filename: "capture.png",
            dataUrl: "data:image/png;base64,AAAA",
            byteSize: 4,
          },
        ],
      },
    });
    const invalid = await requestJson(started.baseUrl, "/sessions/session-1/messages", {
      method: "POST",
      body: {},
    });

    expect(created.response.status).toBe(200);
    expect(created.body).toMatchObject({
      session: { id: "session-1" },
      userMessageId: "user-1",
      assistantMessageId: "assistant-1",
      assistantContent: "echo:hello harness",
    });
    expect(harness.appendSessionMessage).toHaveBeenCalledWith({
      sessionId: "session-1",
      message: "hello harness",
      attachments: [
        {
          id: "image-1",
          kind: "image",
          source: "file",
          mimeType: "image/png",
          filename: "capture.png",
          dataUrl: "data:image/png;base64,AAAA",
          byteSize: 4,
        },
      ],
    });
    expect(invalid.response.status).toBe(400);
    expect(invalid.body).toEqual({ error: "content_required", message: "content is required" });
  });

  it("returns 500 for message endpoint failures", async () => {
    const harness = createHarnessStub();
    harness.appendSessionMessage.mockRejectedValueOnce(new Error("message failed"));
    const started = await startServer(harness);
    activeServer = started.server;

    const result = await requestJson(started.baseUrl, "/sessions/session-1/messages", {
      method: "POST",
      body: { content: "hello" },
    });

    expect(result.response.status).toBe(500);
    expect(result.body).toEqual({ error: "message failed" });
  });

  it("streams ndjson events and completion for message streaming", async () => {
    const harness = createHarnessStub();
    const started = await startServer(harness);
    activeServer = started.server;

    const response = await fetch(`${started.baseUrl}/sessions/session-1/messages/stream`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({ content: "stream me" }),
    });
    const text = await response.text();
    const chunks = text
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line) as Record<string, unknown>);

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("application/x-ndjson");
    expect(chunks).toEqual([
      {
        kind: "event",
        event: createEvent("session.message", "session-1"),
      },
      {
        kind: "event",
        event: createEvent("assistant.final", "session-1"),
      },
      {
        kind: "done",
        result: {
          sessionId: "session-1",
          userMessageId: "user-1",
          assistantMessageId: "assistant-1",
          assistantContent: "echo:stream me",
        },
      },
    ]);
  });

  it("returns streaming validation and runtime errors for message stream endpoint", async () => {
    const harness = createHarnessStub();
    harness.appendSessionMessage.mockRejectedValueOnce(new Error("stream failed"));
    const started = await startServer(harness);
    activeServer = started.server;

    const invalid = await requestJson(started.baseUrl, "/sessions/session-1/messages/stream", {
      method: "POST",
      body: {},
    });
    const failedResponse = await fetch(`${started.baseUrl}/sessions/session-1/messages/stream`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({ content: "stream me" }),
    });
    const failedText = await failedResponse.text();
    const chunks = failedText
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line) as Record<string, unknown>);

    expect(invalid.response.status).toBe(400);
    expect(invalid.body).toEqual({ error: "content_required", message: "content is required" });
    expect(failedResponse.status).toBe(200);
    expect(chunks).toEqual([
      {
        kind: "error",
        error: "stream failed",
      },
    ]);
  });

  it("resolves approvals and validates missing outcomes", async () => {
    const harness = createHarnessStub();
    const started = await startServer(harness);
    activeServer = started.server;

    const resolved = await requestJson(started.baseUrl, "/sessions/session-1/approvals/request-1", {
      method: "POST",
      body: { outcome: "approved" },
    });
    const invalid = await requestJson(started.baseUrl, "/sessions/session-1/approvals/request-1", {
      method: "POST",
      body: {},
    });

    expect(resolved.response.status).toBe(200);
    expect(resolved.body).toMatchObject({
      session: { id: "session-1", mode: "execute" },
      runId: "run-1",
      requestId: "request-1",
      outcome: "approved",
    });
    expect(harness.resolveApproval).toHaveBeenCalledWith(
      "session-1",
      "request-1",
      "approved",
    );
    expect(invalid.response.status).toBe(400);
    expect(invalid.body).toEqual({ error: "outcome_required", message: "outcome is required" });
  });

  it("returns 500 when approval resolution fails", async () => {
    const harness = createHarnessStub();
    harness.resolveApproval.mockRejectedValueOnce(new Error("approval failed"));
    const started = await startServer(harness);
    activeServer = started.server;

    const result = await requestJson(started.baseUrl, "/sessions/session-1/approvals/request-1", {
      method: "POST",
      body: { outcome: "rejected" },
    });

    expect(result.response.status).toBe(500);
    expect(result.body).toEqual({ error: "approval failed" });
  });
});
