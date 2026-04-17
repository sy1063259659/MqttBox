import { describe, expect, it } from "vitest";
import { PromptRegistry } from "./index.js";

describe("PromptRegistry", () => {
  const registry = new PromptRegistry();

  it("builds a parser-authoring prompt that enforces helper-driven scripts and concise replies", () => {
    const prompt = registry.getSystemPrompt("execute", "parser-authoring");

    expect(prompt).toContain("Keep the assistant-facing reply concise");
    expect(prompt).toContain("describe_parser_helpers");
    expect(prompt).toContain("readUint16BE");
    expect(prompt).toContain("readUint16LE");
    expect(prompt).toContain("hexToBytes");
    expect(prompt).toContain("Never assume a default endian");
  });

  it("keeps general chat prompts concise by default", () => {
    const prompt = registry.getSystemPrompt("chat");

    expect(prompt).toContain("2-4 short bullets or paragraphs");
  });
});
