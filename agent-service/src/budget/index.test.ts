import { describe, expect, it } from "vitest";
import { BudgetManager } from "./index.js";

describe("BudgetManager", () => {
  it("tracks per-session and global usage", () => {
    const budget = new BudgetManager({
      perSessionLimit: 100,
      globalLimit: 500,
    });

    budget.recordUsage("session-1", 40);
    budget.recordUsage("session-1", 10);
    budget.recordUsage("session-2", 25);

    expect(budget.getUsage("session-1")).toBe(50);
    expect(budget.getUsage("session-2")).toBe(25);
    expect(budget.getGlobalUsage()).toBe(75);
  });

  it("blocks runs when a session reaches its limit", () => {
    const budget = new BudgetManager({
      perSessionLimit: 50,
      globalLimit: 500,
    });

    expect(budget.canRun("session-1")).toBe(true);

    budget.recordUsage("session-1", 50);

    expect(budget.canRun("session-1")).toBe(false);
    expect(budget.canRun("session-2")).toBe(true);
  });

  it("blocks all runs when the global limit is reached", () => {
    const budget = new BudgetManager({
      perSessionLimit: 500,
      globalLimit: 75,
    });

    budget.recordUsage("session-1", 25);
    budget.recordUsage("session-2", 50);

    expect(budget.getGlobalUsage()).toBe(75);
    expect(budget.canRun("session-1")).toBe(false);
    expect(budget.canRun("session-2")).toBe(false);
    expect(budget.canRun("session-3")).toBe(false);
  });

  it("rejects invalid token usage", () => {
    const budget = new BudgetManager();

    expect(() => budget.recordUsage("session-1", -1)).toThrow("Invalid token usage: -1");
  });
});
