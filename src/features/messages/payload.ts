import type { MessageRecordDto } from "@/features/messages/types";

export type PayloadViewMode = "text" | "json" | "hex" | "base64";

function normalizeBase64(value: string) {
  return value.replace(/\s+/g, "");
}

export function decodePayloadBytes(message: MessageRecordDto) {
  try {
    const base64 = normalizeBase64(message.payloadBase64);
    const binary = atob(base64);
    return Uint8Array.from(binary, (char) => char.charCodeAt(0));
  } catch {
    return new Uint8Array();
  }
}

export function decodePayloadText(message: MessageRecordDto) {
  if (message.payloadText) {
    return message.payloadText;
  }

  const bytes = decodePayloadBytes(message);
  if (bytes.length === 0) {
    return "";
  }

  return new TextDecoder("utf-8", { fatal: false }).decode(bytes);
}

export function tryFormatJson(message: MessageRecordDto) {
  const source = decodePayloadText(message);
  if (!source) {
    return null;
  }

  try {
    return JSON.stringify(JSON.parse(source), null, 2);
  } catch {
    return null;
  }
}

export function formatPayloadAsHex(message: MessageRecordDto) {
  if (message.rawPayloadHex) {
    return message.rawPayloadHex;
  }

  const bytes = decodePayloadBytes(message);
  if (bytes.length === 0) {
    return "";
  }

  return Array.from(bytes, (byte, index) => {
    const prefix = index % 2 === 0 && index > 0 ? " " : "";
    return `${prefix}${byte.toString(16).padStart(2, "0")}`;
  }).join("");
}

export function isParsedIncomingMessage(message: MessageRecordDto) {
  return message.direction === "incoming" && Boolean(message.parserId);
}

export function getPayloadViewContent(message: MessageRecordDto, mode: PayloadViewMode) {
  switch (mode) {
    case "json":
      return tryFormatJson(message) ?? decodePayloadText(message);
    case "hex":
      return formatPayloadAsHex(message);
    case "base64":
      return message.payloadBase64;
    case "text":
    default:
      return decodePayloadText(message);
  }
}

export function getDefaultPayloadViewMode(message: MessageRecordDto): PayloadViewMode {
  if (message.payloadType === "json") {
    return "json";
  }

  if (message.payloadType === "binary" || message.payloadType === "binary_base64") {
    return "hex";
  }

  return "text";
}

export function getMessagePayloadViewMode(
  message: MessageRecordDto,
  incomingViewMode: PayloadViewMode,
): PayloadViewMode {
  if (isParsedIncomingMessage(message)) {
    return "json";
  }

  if (message.direction === "incoming") {
    return incomingViewMode;
  }

  return getDefaultPayloadViewMode(message);
}

export function getPayloadPreview(message: MessageRecordDto, emptyLabel: string, binaryLabel: string) {
  if (message.payloadType === "binary" || message.payloadType === "binary_base64") {
    return `${binaryLabel} · ${message.payloadSize} bytes`;
  }

  const compact = decodePayloadText(message).replace(/\s+/g, " ").trim();
  return compact || emptyLabel;
}

export function getPayloadDisplayContent(
  message: MessageRecordDto,
  mode: PayloadViewMode,
  emptyLabel: string,
  binaryLabel: string,
) {
  if (message.payloadType === "binary" || message.payloadType === "binary_base64") {
    if (mode === "hex" || mode === "base64") {
      return getPayloadViewContent(message, mode) || `${binaryLabel} · ${message.payloadSize} bytes`;
    }

    return `${binaryLabel} · ${message.payloadSize} bytes`;
  }

  const content = getPayloadViewContent(message, mode);
  return content || emptyLabel;
}
