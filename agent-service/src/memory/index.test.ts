import { existsSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { MemoryStore } from "./index.js";

const DATA_FILE = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "data",
  "memories.json",
);
let originalFile: string | null | undefined;

function backupFile() {
  if (originalFile !== undefined) {
    return;
  }

  originalFile = existsSync(DATA_FILE) ? readFileSync(DATA_FILE, "utf8") : null;
}

function restoreFile() {
  if (originalFile === undefined) {
    return;
  }

  if (originalFile === null) {
    if (existsSync(DATA_FILE)) {
      unlinkSync(DATA_FILE);
    }
  } else {
    writeFileSync(DATA_FILE, originalFile, "utf8");
  }

  originalFile = undefined;
}

describe("MemoryStore", () => {
  afterEach(() => {
    restoreFile();
  });

  it("loads persisted memories and flushes writes to memories.json", () => {
    backupFile();
    if (existsSync(DATA_FILE)) {
      unlinkSync(DATA_FILE);
    }

    const store = new MemoryStore();
    const memory = {
      id: "mem-1",
      kind: "note",
      scopeType: "global" as const,
      scopeRef: "workspace",
      title: "Persisted memory",
      content: "Remember this",
      summary: "Short summary",
      language: "en",
      createdAt: "2026-04-15T00:00:00.000Z",
      updatedAt: "2026-04-15T00:00:00.000Z",
      source: "test",
      pinned: false,
    };

    store.add(memory);

    expect(existsSync(DATA_FILE)).toBe(true);
    expect(JSON.parse(readFileSync(DATA_FILE, "utf8"))).toEqual([memory]);

    const reloaded = new MemoryStore();
    expect(reloaded.list()).toEqual([memory]);
  });
});
