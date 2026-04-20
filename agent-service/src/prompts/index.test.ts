import { describe, expect, it } from "vitest";
import { PromptRegistry } from "./index.js";

describe("PromptRegistry", () => {
  const registry = new PromptRegistry();

  it("builds a parser-authoring prompt that enforces helper-driven scripts and concise replies", () => {
    const prompt = registry.getSystemPrompt("execute", "parser-authoring");

    expect(prompt).toContain("1 to 3 short plain-text paragraphs");
    expect(prompt).toContain("Lead with the result in the first paragraph");
    expect(prompt).toContain("Avoid openings like I inspected");
    expect(prompt).toContain("Do not use Markdown headings");
    expect(prompt).toContain("describe_parser_helpers");
    expect(prompt).toContain("readUint16BE");
    expect(prompt).toContain("readUint16LE");
    expect(prompt).toContain("hexToBytes");
    expect(prompt).toContain("Never assume a default endian");
    expect(prompt).toContain("Prefer a partial but specific parser");
    expect(prompt).toContain("Do not fall back to field1/value1");
    expect(prompt).toContain("attachments are present");
  });

  it("keeps general chat prompts concise by default", () => {
    const prompt = registry.getSystemPrompt("chat");

    expect(prompt).toContain("1 to 3 short plain-text paragraphs");
    expect(prompt).toContain("Lead with the result in the first paragraph");
    expect(prompt).toContain("Do not use Markdown headings");
  });
});
