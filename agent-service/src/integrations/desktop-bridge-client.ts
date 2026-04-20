export interface DesktopBridgeParserDto {
  id: string;
  name: string;
  script: string;
  createdAt: number;
  updatedAt: number;
}

export interface DesktopBridgeParserTestResultDto {
  ok: boolean;
  parsedPayloadJson?: string | null;
  parseError?: string | null;
}

export interface DesktopBridgeMessageSampleDto {
  id: string;
  topic: string;
  rawPayloadHex: string;
  parsedPayloadJson?: string | null;
  parseError?: string | null;
  receivedAt: number;
}

export interface DesktopBridgeClientOptions {
  baseUrl?: string;
  token?: string;
}

export class DesktopBridgeClientError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DesktopBridgeClientError";
  }
}

export class DesktopBridgeClient {
  private readonly baseUrl: string | null;
  private readonly token: string | null;

  constructor(options: DesktopBridgeClientOptions = {}) {
    this.baseUrl = options.baseUrl?.trim().replace(/\/+$/, "") || null;
    this.token = options.token?.trim() || null;
  }

  isConfigured() {
    return Boolean(this.baseUrl && this.token);
  }

  async listSavedParsers(limit?: number): Promise<DesktopBridgeParserDto[]> {
    const query = typeof limit === "number" ? `?limit=${encodeURIComponent(String(limit))}` : "";
    const response = await this.requestJson<{ items: DesktopBridgeParserDto[] }>(`/parsers${query}`);
    return response.items;
  }

  async testParserScript(input: {
    script: string;
    payloadHex: string;
    topic?: string;
  }): Promise<DesktopBridgeParserTestResultDto> {
    return this.requestJson<DesktopBridgeParserTestResultDto>("/parsers/test", {
      method: "POST",
      body: input,
    });
  }

  async loadTopicMessageSamples(input: {
    topic?: string;
    connectionId?: string;
    limit?: number;
  }): Promise<DesktopBridgeMessageSampleDto[]> {
    const params = new URLSearchParams();
    if (input.topic?.trim()) {
      params.set("topic", input.topic.trim());
    }
    if (input.connectionId?.trim()) {
      params.set("connectionId", input.connectionId.trim());
    }
    if (typeof input.limit === "number") {
      params.set("limit", String(input.limit));
    }
    const response = await this.requestJson<{ items: DesktopBridgeMessageSampleDto[] }>(
      `/messages/samples${params.size > 0 ? `?${params.toString()}` : ""}`,
    );
    return response.items;
  }

  async saveParserDraft(input: {
    id?: string;
    name: string;
    script: string;
  }): Promise<DesktopBridgeParserDto> {
    return this.requestJson<DesktopBridgeParserDto>("/parsers/save", {
      method: "POST",
      body: input,
    });
  }

  private async requestJson<T>(
    path: string,
    init: {
      method?: string;
      body?: unknown;
    } = {},
  ): Promise<T> {
    if (!this.baseUrl || !this.token) {
      throw new DesktopBridgeClientError(
        "Desktop parser bridge is not configured for this agent-service process.",
      );
    }

    const response = await fetch(`${this.baseUrl}${path}`, {
      method: init.method ?? "GET",
      headers: {
        "content-type": "application/json",
        "x-agent-bridge-token": this.token,
      },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
    }).catch((error: unknown) => {
      throw new DesktopBridgeClientError(
        error instanceof Error
          ? error.message
          : "Failed to reach the local desktop parser bridge.",
      );
    });

    const payload = (await response.json().catch(() => null)) as
      | {
          error?: string;
          message?: string;
        }
      | null;

    if (!response.ok) {
      throw new DesktopBridgeClientError(
        payload?.message ?? payload?.error ?? `Desktop bridge request failed: ${path}`,
      );
    }

    return payload as T;
  }
}
