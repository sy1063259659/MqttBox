import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { URL } from "node:url";
import type { AgentAttachmentDto, AgentSafetyLevel, AgentSessionMode } from "@agent-contracts";
import { PARSER_AUTHORING_ATTACHMENT_POLICY } from "../capabilities/parser-authoring.js";
import { AgentHarnessHttpError, type AgentHarness } from "../harness/agent-harness.js";
import type { Logger } from "../observability/logger.js";

interface SessionCreateRequestBody {
  mode?: AgentSessionMode;
  safetyLevel?: AgentSafetyLevel;
}

interface ConfigUpdateRequestBody {
  enabled?: boolean;
  provider?: string;
  baseUrl?: string;
  apiKey?: string;
  model?: string;
}

interface SessionMessageRequestBody {
  content?: string;
  attachments?: AgentAttachmentDto[];
}

interface ApprovalResolveRequestBody {
  outcome?: "approved" | "rejected" | "expired";
}

interface StreamChunkDone {
  kind: "done";
  result: {
    sessionId: string;
    userMessageId: string;
    assistantMessageId: string;
    assistantContent: string;
  };
}

interface StreamChunkEvent {
  kind: "event";
  event: unknown;
}

interface StreamChunkError {
  kind: "error";
  error: string;
}

export class HttpServer {
  private server: Server | null = null;

  constructor(
    private readonly harness: AgentHarness,
    private readonly logger: Logger,
    private readonly port: number,
  ) {}

  async start(): Promise<void> {
    if (this.server) {
      return;
    }
    this.server = createServer((req: IncomingMessage, res: ServerResponse) => {
      void this.handle(req, res);
    });
    await new Promise<void>((resolve) => {
      this.server?.listen(this.port, () => resolve());
    });
    this.logger.info("http server started", { port: this.port });
  }

  async stop(): Promise<void> {
    if (!this.server) {
      return;
    }
    const active = this.server;
    this.server = null;
    await new Promise<void>((resolve, reject) => {
      active.close((error?: Error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve();
      });
    });
    this.logger.info("http server stopped");
  }

  private async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const method = req.method ?? "GET";
    const url = new URL(req.url ?? "/", `http://localhost:${this.port}`);
    try {
      if (method === "OPTIONS") {
        this.sendEmpty(res, 204);
        return;
      }
      if (method === "GET" && url.pathname === "/health") {
        this.sendJson(res, 200, this.harness.health());
        return;
      }
      if (method === "GET" && url.pathname === "/config") {
        this.sendJson(res, 200, this.harness.getConfig());
        return;
      }
      if (method === "POST" && url.pathname === "/config") {
        const body = await this.readJson<ConfigUpdateRequestBody>(req);
        const settings = this.harness.updateModelConfig(body);
        this.sendJson(res, 200, { ok: true, settings });
        return;
      }
      if (method === "POST" && url.pathname === "/sessions") {
        const body = await this.readJson<SessionCreateRequestBody>(req);
        const result = this.harness.createSession({
          mode: body.mode,
          safetyLevel: body.safetyLevel,
        });
        this.sendJson(res, 201, result);
        return;
      }
      const sessionMatch = /^\/sessions\/([^/]+)$/.exec(url.pathname);
      if (method === "GET" && sessionMatch) {
        const session = this.harness.getSession(decodeURIComponent(sessionMatch[1]));
        if (!session) {
          this.sendJson(res, 404, { error: "session_not_found" });
          return;
        }
        this.sendJson(res, 200, { session });
        return;
      }
      const messageMatch = /^\/sessions\/([^/]+)\/messages$/.exec(url.pathname);
      if (method === "POST" && messageMatch) {
        const body = await this.readJson<SessionMessageRequestBody>(req);
        if (!body.content || typeof body.content !== "string") {
          this.sendJson(res, 400, { error: "content_required", message: "content is required" });
          return;
        }
        this.validateAttachments(Array.isArray(body.attachments) ? body.attachments : []);
        const result = await this.harness.appendSessionMessage({
          sessionId: decodeURIComponent(messageMatch[1]),
          message: body.content,
          attachments: Array.isArray(body.attachments) ? body.attachments : [],
        });
        this.sendJson(res, 200, result);
        return;
      }
      const messageStreamMatch = /^\/sessions\/([^/]+)\/messages\/stream$/.exec(url.pathname);
      if (method === "POST" && messageStreamMatch) {
        const body = await this.readJson<SessionMessageRequestBody>(req);
        if (!body.content || typeof body.content !== "string") {
          this.sendJson(res, 400, { error: "content_required", message: "content is required" });
          return;
        }
        this.validateAttachments(Array.isArray(body.attachments) ? body.attachments : []);
        await this.handleMessageStream(res, {
          sessionId: decodeURIComponent(messageStreamMatch[1]),
          content: body.content,
          attachments: Array.isArray(body.attachments) ? body.attachments : [],
        });
        return;
      }
      const approvalMatch = /^\/sessions\/([^/]+)\/approvals\/([^/]+)$/.exec(url.pathname);
      if (method === "POST" && approvalMatch) {
        const body = await this.readJson<ApprovalResolveRequestBody>(req);
        if (!body.outcome) {
          this.sendJson(res, 400, { error: "outcome_required", message: "outcome is required" });
          return;
        }
        const result = await this.harness.resolveApproval(
          decodeURIComponent(approvalMatch[1]),
          decodeURIComponent(approvalMatch[2]),
          body.outcome,
        );
        this.sendJson(res, 200, result);
        return;
      }
      this.sendJson(res, 404, { error: "not_found" });
    } catch (error: unknown) {
      if (error instanceof AgentHarnessHttpError) {
        this.sendJson(res, error.statusCode, {
          error: error.code,
          message: error.message,
          details: error.details ?? null,
        });
        return;
      }
      if (error instanceof HttpRequestError) {
        this.sendJson(res, error.statusCode, {
          error: error.code,
          message: error.message,
          details: error.details ?? null,
        });
        return;
      }
      this.logger.error("request failed", {
        method,
        path: url.pathname,
        error: String(error),
      });
      const message = error instanceof Error ? error.message : "internal_error";
      this.sendJson(res, 500, { error: message });
    }
  }

  private validateAttachments(attachments: AgentAttachmentDto[]): void {
    if (attachments.length > PARSER_AUTHORING_ATTACHMENT_POLICY.maxAttachmentCount) {
      throw new HttpRequestError(
        400,
        "attachment_count_exceeded",
        `Up to ${PARSER_AUTHORING_ATTACHMENT_POLICY.maxAttachmentCount} images are allowed per request.`,
        { maxAttachmentCount: PARSER_AUTHORING_ATTACHMENT_POLICY.maxAttachmentCount },
      );
    }

    for (const attachment of attachments) {
      if (
        !PARSER_AUTHORING_ATTACHMENT_POLICY.acceptedImageMimeTypes.some(
          (mimeType) => mimeType === attachment.mimeType,
        )
      ) {
        throw new HttpRequestError(
          400,
          "attachment_mime_unsupported",
          `Unsupported image type: ${attachment.mimeType}.`,
          {
            acceptedImageMimeTypes: PARSER_AUTHORING_ATTACHMENT_POLICY.acceptedImageMimeTypes,
            mimeType: attachment.mimeType,
          },
        );
      }

      const byteSize = attachment.byteSize ?? estimateAttachmentBytes(attachment.dataUrl);
      if (byteSize > PARSER_AUTHORING_ATTACHMENT_POLICY.maxAttachmentBytes) {
        throw new HttpRequestError(
          400,
          "attachment_too_large",
          `${attachment.filename ?? "Image"} exceeds the ${PARSER_AUTHORING_ATTACHMENT_POLICY.maxAttachmentBytes} byte limit.`,
          {
            filename: attachment.filename ?? null,
            byteSize,
            maxAttachmentBytes: PARSER_AUTHORING_ATTACHMENT_POLICY.maxAttachmentBytes,
          },
        );
      }
    }
  }

  private async readJson<TBody>(req: IncomingMessage): Promise<TBody> {
    const chunks: Buffer[] = [];
    for await (const chunk of req) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    if (chunks.length === 0) {
      return {} as TBody;
    }
    const raw = Buffer.concat(chunks).toString("utf-8");
    return JSON.parse(raw) as TBody;
  }

  private sendJson(res: ServerResponse, statusCode: number, payload: unknown): void {
    res.statusCode = statusCode;
    this.applyCors(res);
    res.setHeader("content-type", "application/json; charset=utf-8");
    res.end(JSON.stringify(payload));
  }

  private sendEmpty(res: ServerResponse, statusCode: number): void {
    res.statusCode = statusCode;
    this.applyCors(res);
    res.end();
  }

  private applyCors(res: ServerResponse): void {
    res.setHeader("access-control-allow-origin", "*");
    res.setHeader("access-control-allow-methods", "GET,POST,OPTIONS");
    res.setHeader("access-control-allow-headers", "content-type");
  }

  private async handleMessageStream(
    res: ServerResponse,
    input: {
      sessionId: string;
      content: string;
      attachments: AgentAttachmentDto[];
    },
  ): Promise<void> {
    res.statusCode = 200;
    this.applyCors(res);
    res.setHeader("content-type", "application/x-ndjson; charset=utf-8");
    res.setHeader("cache-control", "no-cache, no-transform");
    res.setHeader("connection", "keep-alive");
    res.flushHeaders?.();

    const writeChunk = (chunk: StreamChunkEvent | StreamChunkDone | StreamChunkError): void => {
      res.write(`${JSON.stringify(chunk)}\n`);
    };

    try {
      const result = await this.harness.appendSessionMessage({
        sessionId: input.sessionId,
        message: input.content,
        attachments: input.attachments,
        onEvent: (event) => {
          writeChunk({
            kind: "event",
            event,
          });
        },
      });

      writeChunk({
        kind: "done",
        result: {
          sessionId: result.session.id,
          userMessageId: result.userMessageId,
          assistantMessageId: result.assistantMessageId,
          assistantContent: result.assistantContent,
        },
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "internal_error";
      writeChunk({
        kind: "error",
        error: message,
      });
    } finally {
      res.end();
    }
  }
}

class HttpRequestError extends Error {
  constructor(
    readonly statusCode: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = "HttpRequestError";
  }
}

function estimateAttachmentBytes(dataUrl: string): number {
  const [, encoded = ""] = dataUrl.split(",", 2);
  if (!encoded) {
    return 0;
  }

  const padding = encoded.endsWith("==") ? 2 : encoded.endsWith("=") ? 1 : 0;
  return Math.max(0, Math.floor((encoded.length * 3) / 4) - padding);
}
