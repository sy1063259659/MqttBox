import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getCurrentWindow: vi.fn(),
}));

vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: mocks.getCurrentWindow,
}));

import {
  closeCurrentWindow,
  minimizeCurrentWindow,
  subscribeCurrentWindowState,
  toggleMaximizeCurrentWindow,
} from "@/services/window";

describe("window service", () => {
  it("falls back gracefully when Tauri window APIs are unavailable", async () => {
    delete (globalThis as typeof globalThis & { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;

    const onChange = vi.fn();
    const cleanup = await subscribeCurrentWindowState(onChange);

    expect(onChange).toHaveBeenCalledWith({
      isWindowMaximized: false,
      windowSize: null,
    });
    expect(mocks.getCurrentWindow).not.toHaveBeenCalled();
    expect(cleanup).toBeTypeOf("function");

    await expect(minimizeCurrentWindow()).resolves.toBeUndefined();
    await expect(toggleMaximizeCurrentWindow()).resolves.toBeUndefined();
    await expect(closeCurrentWindow()).resolves.toBeUndefined();
    expect(mocks.getCurrentWindow).not.toHaveBeenCalled();
  });
});
