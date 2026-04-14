import type {
  AgentAttachmentDto,
  CapabilityDescriptor,
  AgentEvent,
  AgentSafetyLevel,
  AgentSessionDto,
  AgentSessionMode,
} from "@agent-contracts";
import {
  getAgentSettings,
  peekCachedAgentSettings,
  type AgentSettingsDto,
} from "@/services/tauri";

interface AgentSessionResponse {
  session: AgentSessionDto;
  events: AgentEvent[];
}

interface AgentMessageResponse {
  session: AgentSessionDto;
  userMessageId: string;
  assistantMessageId: string;
  assistantContent: string;
  events: AgentEvent[];
}

interface AgentMessageStreamDone {
  sessionId: string;
  userMessageId: string;
  assistantMessageId: string;
  assistantContent: string;
}

interface ApprovalResolveResponse {
  session: AgentSessionDto;
  runId: string;
  requestId: string;
  outcome: "approved" | "rejected" | "expired";
  events: AgentEvent[];
}

export interface AgentServiceHealthDto {
  status: string;
  service: string;
  transport: string;
  capabilities: CapabilityDescriptor[];
  memories: number;
  deepagentsRuntime: string;
  model?: {
    provider: string;
    configured: boolean;
    model: string;
    baseUrl: string;
    enabled: boolean;
  };
}

const DEFAULT_AGENT_SERVICE_URL = "http://127.0.0.1:8787";

async function resolveAgentSettings() {
  return peekCachedAgentSettings() ?? (await getAgentSettings().catch(() => null));
}

async function resolveAgentServiceUrl(explicit?: string) {
  if (explicit?.trim()) {
    return explicit.trim().replace(/\/+$/, "");
  }

  const settings = await resolveAgentSettings();
  const configured =
    settings?.serviceUrl?.trim() ||
    (typeof import.meta !== "undefined" && import.meta.env?.VITE_AGENT_SERVICE_URL
      ? import.meta.env.VITE_AGENT_SERVICE_URL
      : "");

  return (configured || DEFAULT_AGENT_SERVICE_URL).replace(/\/+$/, "");
}

async function requestJson<T>(path: string, init?: RequestInit & { serviceUrl?: string }): Promise<T> {
  const serviceUrl = await resolveAgentServiceUrl(init?.serviceUrl);
  const response = await fetch(`${serviceUrl}${path}`, {
    ...init,
    headers: {
      "content-type": "application/json",
      ...(init?.headers ?? {}),
    },
  });

  const payload = (await response.json().catch(() => null)) as
    | { error?: string; message?: string }
    | null;

  if (!response.ok) {
    throw new Error(payload?.message ?? payload?.error ?? `Agent service request failed: ${path}`);
  }

  return payload as T;
}

export async function createAgentSession(input: {
  mode: AgentSessionMode;
  safetyLevel: AgentSafetyLevel;
}) {
  return requestJson<AgentSessionResponse>("/sessions", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export async function sendAgentMessage(input: {
  sessionId: string;
  content: string;
  attachments: AgentAttachmentDto[];
}) {
  return requestJson<AgentMessageResponse>(`/sessions/${encodeURIComponent(input.sessionId)}/messages`, {
    method: "POST",
    body: JSON.stringify({
      content: input.content,
      attachments: input.attachments,
    }),
  });
}

export async function streamAgentMessage(input: {
  sessionId: string;
  content: string;
  attachments: AgentAttachmentDto[];
  onEvent: (event: AgentEvent) => void;
}) {
  const serviceUrl = await resolveAgentServiceUrl();
  const response = await fetch(
    `${serviceUrl}/sessions/${encodeURIComponent(input.sessionId)}/messages/stream`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        content: input.content,
        attachments: input.attachments,
      }),
    },
  );

  if (!response.ok || !response.body) {
    const payload = (await response.json().catch(() => null)) as
      | { error?: string; message?: string }
      | null;
    throw new Error(payload?.message ?? payload?.error ?? "Agent stream request failed");
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let donePayload: AgentMessageStreamDone | null = null;

  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";

    for (const rawLine of lines) {
      const line = rawLine.trim();
      if (!line) {
        continue;
      }

      const chunk = JSON.parse(line) as
        | { kind: "event"; event: AgentEvent }
        | { kind: "done"; result: AgentMessageStreamDone }
        | { kind: "error"; error: string };

      if (chunk.kind === "event") {
        input.onEvent(chunk.event);
        continue;
      }

      if (chunk.kind === "done") {
        donePayload = chunk.result;
        continue;
      }

      throw new Error(chunk.error);
    }
  }

  if (buffer.trim()) {
    const chunk = JSON.parse(buffer.trim()) as
      | { kind: "done"; result: AgentMessageStreamDone }
      | { kind: "error"; error: string };

    if (chunk.kind === "error") {
      throw new Error(chunk.error);
    }
    donePayload = chunk.result;
  }

  if (!donePayload) {
    throw new Error("Agent stream ended without completion payload");
  }

  return donePayload;
}

export async function getAgentServiceHealth(serviceUrl?: string) {
  return requestJson<AgentServiceHealthDto>("/health", {
    method: "GET",
    serviceUrl,
  });
}

export async function resolveAgentApproval(input: {
  sessionId: string;
  requestId: string;
  outcome: "approved" | "rejected" | "expired";
}) {
  return requestJson<ApprovalResolveResponse>(
    `/sessions/${encodeURIComponent(input.sessionId)}/approvals/${encodeURIComponent(input.requestId)}`,
    {
      method: "POST",
      body: JSON.stringify({
        outcome: input.outcome,
      }),
    },
  );
}

export async function syncAgentServiceConfig(settings: AgentSettingsDto) {
  return requestJson<{ ok: true; settings: Record<string, unknown> }>("/config", {
    method: "POST",
    serviceUrl: settings.serviceUrl,
    body: JSON.stringify({
      provider: settings.provider,
      baseUrl: settings.baseUrl,
      apiKey: settings.apiKey,
      model: settings.model,
      enabled: settings.enabled,
    }),
  });
}
