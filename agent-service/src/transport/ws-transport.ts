import { WebSocket, WebSocketServer, type RawData } from "ws";
import type { AgentEvent } from "@agent-contracts";
import type { Logger } from "../observability/logger.js";
import type { AgentTransport, TransportEventHandler } from "./types.js";

const DEFAULT_WS_PORT = 8788;

export interface WsTransportOptions {
  port?: number;
}

export class WsTransport implements AgentTransport {
  private readonly handlers = new Set<TransportEventHandler>();
  private readonly clients = new Set<WebSocket>();
  private readonly port: number;
  private server: WebSocketServer | null = null;

  constructor(
    private readonly logger: Logger,
    options: WsTransportOptions = {},
  ) {
    this.port = options.port ?? DEFAULT_WS_PORT;
  }

  async start(): Promise<void> {
    if (this.server) {
      return;
    }

    await new Promise<void>((resolve, reject) => {
      const server = new WebSocketServer({ port: this.port });
      const onListening = () => {
        cleanup();
        this.server = server;
        this.bindServer(server);
        this.logger.info("websocket transport started", {
          port: this.port,
        });
        resolve();
      };
      const onError = (error: Error) => {
        cleanup();
        server.close();
        reject(error);
      };
      const cleanup = () => {
        server.off("listening", onListening);
        server.off("error", onError);
      };

      server.once("listening", onListening);
      server.once("error", onError);
    });
  }

  async stop(): Promise<void> {
    const server = this.server;
    this.server = null;

    for (const client of this.clients) {
      client.terminate();
    }
    this.clients.clear();
    this.handlers.clear();

    if (!server) {
      return;
    }

    await new Promise<void>((resolve, reject) => {
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        this.logger.info("websocket transport stopped", {
          port: this.port,
        });
        resolve();
      });
    });
  }

  async publish(event: AgentEvent): Promise<void> {
    const payload = JSON.stringify(event);

    await Promise.all(
      [...this.clients].map(
        (client) =>
          new Promise<void>((resolve) => {
            if (client.readyState !== WebSocket.OPEN) {
              this.detachClient(client);
              resolve();
              return;
            }

            client.send(payload, (error) => {
              if (error) {
                this.logger.error("failed to publish websocket event", {
                  error: error.message,
                });
                this.detachClient(client);
              }
              resolve();
            });
          }),
      ),
    );
  }

  subscribe(handler: TransportEventHandler): () => void {
    this.handlers.add(handler);
    return () => {
      this.handlers.delete(handler);
    };
  }

  private bindServer(server: WebSocketServer): void {
    server.on("connection", (client) => {
      this.clients.add(client);
      this.logger.info("websocket client connected", {
        clients: this.clients.size,
      });

      client.on("message", (data) => {
        this.handleClientMessage(data);
      });
      client.on("close", () => {
        this.detachClient(client);
      });
      client.on("error", (error) => {
        this.logger.error("websocket client error", {
          error: error.message,
        });
        this.detachClient(client);
      });
    });
  }

  private handleClientMessage(data: RawData): void {
    let parsedEvent: AgentEvent;
    try {
      parsedEvent = JSON.parse(data.toString()) as AgentEvent;
    } catch (error) {
      this.logger.error("failed to parse websocket client message", {
        error: error instanceof Error ? error.message : String(error),
      });
      return;
    }

    for (const handler of this.handlers) {
      try {
        handler(parsedEvent);
      } catch (error) {
        this.logger.error("websocket subscriber handler failed", {
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }

  private detachClient(client: WebSocket): void {
    if (!this.clients.delete(client)) {
      return;
    }

    if (client.readyState === WebSocket.OPEN || client.readyState === WebSocket.CONNECTING) {
      client.terminate();
    }

    this.logger.info("websocket client disconnected", {
      clients: this.clients.size,
    });
  }
}
