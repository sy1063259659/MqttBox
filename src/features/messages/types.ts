export type PayloadType = "text" | "json" | "binary" | "binary_base64";
export type MessageDirection = "incoming" | "outgoing";

export interface MessageRecordDto {
  id: string;
  connectionId: string;
  topic: string;
  payloadText: string;
  payloadBase64: string;
  rawPayloadHex: string;
  payloadType: PayloadType;
  payloadSize: number;
  direction: MessageDirection;
  qos: 0 | 1 | 2;
  retain: boolean;
  dup: boolean;
  parserId?: string | null;
  parsedPayloadJson?: string | null;
  parseError?: string | null;
  propertiesJson?: string | null;
  receivedAt: number;
}

export interface MessageFilter {
  keyword: string;
  topic: string;
  direction: "all" | MessageDirection;
  limit?: number;
  offset?: number;
}

export interface MessageHistoryPageDto {
  items: MessageRecordDto[];
  hasMore: boolean;
  nextOffset?: number | null;
}

export interface PublishRequest {
  connectionId: string;
  topic: string;
  payloadText: string;
  payloadType: PayloadType;
  qos: 0 | 1 | 2;
  retain: boolean;
}

export interface ExportRequest {
  connectionId: string;
  format: "json" | "csv";
  path: string;
}
