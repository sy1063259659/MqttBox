import { describe, expect, it } from "vitest";
import type { AgentSessionMode, CapabilityDescriptor } from "@agent-contracts";
import {
  CapabilityRegistry,
  KeywordCapabilityRouter,
  type CapabilityMatch,
  type CapabilityRouter,
} from "./index.js";

describe("CapabilityRegistry", () => {
  it("lists all enabled default capabilities", () => {
    const registry = new CapabilityRegistry();

    expect(registry.list()).toEqual([
      expect.objectContaining({ id: "chat.basic", supportedModes: ["chat"] }),
      expect.objectContaining({ id: "parser-authoring", supportedModes: ["execute"] }),
      expect.objectContaining({ id: "topic-diagnosis", supportedModes: ["chat"] }),
    ]);
  });

  it("routes execute mode to parser authoring", () => {
    const registry = new CapabilityRegistry();

    return expect(registry.resolve("execute", "anything")).resolves.toEqual(
      expect.objectContaining({
        capability: expect.objectContaining({ id: "parser-authoring" }),
        confidence: 1,
      }),
    );
  });

  it("matches diagnosis keywords in english and chinese", () => {
    const registry = new CapabilityRegistry();

    return Promise.all([
      expect(registry.resolve("chat", "Please diagnose this topic")).resolves.toEqual(
        expect.objectContaining({
          capability: expect.objectContaining({ id: "topic-diagnosis" }),
          confidence: 1,
        }),
      ),
      expect(registry.resolve("chat", "帮我诊断这个主题")).resolves.toEqual(
        expect.objectContaining({
          capability: expect.objectContaining({ id: "topic-diagnosis" }),
          confidence: 1,
        }),
      ),
    ]);
  });

  it("scores exact matches higher than fuzzy matches", async () => {
    const registry = new CapabilityRegistry();

    const exactMatch = await registry.resolve("chat", "diagnose topic issue");
    const fuzzyMatch = await registry.resolve("chat", "topic help");

    expect(exactMatch.capability.id).toBe("topic-diagnosis");
    expect(fuzzyMatch.capability.id).toBe("topic-diagnosis");
    expect(exactMatch.confidence).toBeGreaterThan(fuzzyMatch.confidence);
  });

  it("falls back to basic chat when confidence is below threshold", async () => {
    const registry = new CapabilityRegistry();

    await expect(registry.resolveWithFallback("chat", "hello world")).resolves.toEqual(
      expect.objectContaining({
        capability: expect.objectContaining({ id: "chat.basic" }),
        confidence: 0.15,
        matchReason: expect.stringContaining("fallback to chat.basic"),
      }),
    );
  });

  it("returns the matched capability when confidence meets a lower threshold", async () => {
    const registry = new CapabilityRegistry();

    await expect(registry.resolveWithFallback("chat", "topic help", 0.2)).resolves.toEqual(
      expect.objectContaining({
        capability: expect.objectContaining({ id: "topic-diagnosis" }),
        confidence: 0.45,
      }),
    );
  });

  it("matches keywords case-insensitively", async () => {
    const registry = new CapabilityRegistry();

    await expect(registry.resolve("chat", "TOPIC DIAGNOSE")).resolves.toEqual(
      expect.objectContaining({
        capability: expect.objectContaining({ id: "topic-diagnosis" }),
      }),
    );
  });

  it("allows router injection for future model-based routing", async () => {
    const customCapability: CapabilityDescriptor = {
      id: "chat.basic",
      name: "Basic Chat",
      description: "Minimal chat capability scaffold",
      supportedModes: ["chat"],
      defaultSafetyLevel: "observe",
      enabled: true,
    };
    const router: CapabilityRouter = {
      resolve: async (_mode: AgentSessionMode, _message: string): Promise<CapabilityMatch> => ({
        capability: customCapability,
        confidence: 0.91,
        matchReason: "mocked router",
      }),
    };
    const registry = new CapabilityRegistry(router);

    await expect(registry.resolve("chat", "anything")).resolves.toEqual({
      capability: customCapability,
      confidence: 0.91,
      matchReason: "mocked router",
    });
  });
});

describe("KeywordCapabilityRouter", () => {
  it("returns a low-confidence chat match when nothing meaningful matches", async () => {
    const router = new KeywordCapabilityRouter();

    await expect(router.resolve("chat", "unknown request")).resolves.toEqual(
      expect.objectContaining({
        capability: expect.objectContaining({ id: "chat.basic" }),
        confidence: 0,
        matchReason: expect.stringContaining("no keywords matched"),
      }),
    );
  });
});
