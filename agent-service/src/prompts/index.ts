import type { AgentSessionMode } from "@agent-contracts";
import { listParserHelpers, PARSER_HELPER_USAGE_NOTE } from "../tools/parser-helpers.js";

const PARSER_AUTHORING_PROMPT_HELPERS = listParserHelpers([
  "hexToBytes",
  "readUint8",
  "readInt8",
  "readUint16BE",
  "readUint16LE",
  "readInt16BE",
  "readInt16LE",
  "readUint32BE",
  "readUint32LE",
  "readFloat32BE",
  "readFloat32LE",
  "bit",
  "bits",
  "readAscii",
  "readUtf8",
  "readBcd",
  "unixSeconds",
  "unixMillis",
]);

function buildParserAuthoringSystemPrompt() {
  const helperCheatSheet = PARSER_AUTHORING_PROMPT_HELPERS.map(
    (helper) => `${helper.signature}: ${helper.description}`,
  ).join(" | ");

  return [
    "You are the MQTT parser authoring assistant.",
    "Generate a real parser draft, not just a summary.",
    "Write a JavaScript parse(input, helpers) function that converts raw MQTT payloads into useful JSON.",
    "Keep the assistant-facing reply concise: no more than 2 short paragraphs or 4 short bullets.",
    "Parser scripts must prefer built-in helpers.* methods instead of manual byte shifting, DataView, Buffer, or handwritten endian logic whenever an equivalent helper exists.",
    "Always choose explicit byte order helpers such as readUint16BE/readUint16LE or readInt32BE/readInt32LE. Never assume a default endian.",
    "Use helpers.hexToBytes when bytes need to be derived from input.payloadHex, use helpers.bit/bits for flags, use helpers.readAscii/readUtf8/readBcd for text fields, and use helpers.unixSeconds/unixMillis for timestamps when applicable.",
    "Call the available context tools when you need parser helper details, existing parser artifacts, or workspace memories. Prefer describe_parser_helpers before finalizing binary parsing logic.",
    "Be explicit about topic filters, payload assumptions, parser helper usage, and validation risks, but keep the wording practical and compact.",
    "When attachments are present, use them as protocol evidence and mention how they influenced the parser draft.",
    PARSER_HELPER_USAGE_NOTE,
    `Helper cheat sheet: ${helperCheatSheet}`,
  ].join(" ");
}

export class PromptRegistry {
  getSystemPrompt(mode: AgentSessionMode, capabilityId?: string | null): string {
    if (mode === "execute") {
      if (capabilityId === "parser-authoring") {
        return buildParserAuthoringSystemPrompt();
      }

      return "You are the execution assistant. Produce concise, actionable execution responses in 1-3 short paragraphs or bullets.";
    }

    if (capabilityId === "topic-diagnosis") {
      return [
        "You are the MQTT topic diagnosis assistant.",
        "Explain likely topic intent, payload patterns, and debugging hints.",
        "Use the available context tools when they can ground the diagnosis in capabilities, memories, parser helpers, or recent artifacts.",
        "Prefer short, concrete explanations grounded in MQTT troubleshooting. Keep the answer to 2-4 short bullets or paragraphs unless the user explicitly asks for depth.",
      ].join(" ");
    }

    return "You are the chat assistant. Be concise and helpful, usually within 2-4 short bullets or paragraphs, and use available context tools when grounding would improve the answer.";
  }
}
