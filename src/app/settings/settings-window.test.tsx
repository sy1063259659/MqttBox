import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("sonner", () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
  Toaster: () => null,
}));

vi.mock("@/services/agent-service", () => ({
  getAgentServiceHealth: vi.fn(),
  isAgentServiceUnreachableError: vi.fn(
    (error: unknown) =>
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      (error as { code?: string }).code === "agent_service_unreachable",
  ),
  syncAgentServiceConfig: vi.fn(),
}));

vi.mock("@/services/window", () => ({
  closeCurrentWindow: vi.fn(),
}));

vi.mock("@/services/tauri", async () => {
  const actual = await vi.importActual<typeof import("@/services/tauri")>("@/services/tauri");

  return {
    ...actual,
    getAgentSettings: vi.fn(async () => ({
      enabled: true,
      provider: "openai",
      apiKey: "",
      model: "gpt-5.4",
    })),
    peekCachedAgentSettings: vi.fn(() => null),
    peekCachedAppSettings: vi.fn(() => null),
    saveAgentSettings: vi.fn(async () => undefined),
    saveAppSettings: vi.fn(async () => undefined),
  };
});

import { SettingsView } from "@/app/settings/settings-window";
import { I18nProvider } from "@/lib/i18n";
import {
  getAgentSettings,
  saveAgentSettings,
  saveAppSettings,
  type AppSettingsDto,
} from "@/services/tauri";
import { syncAgentServiceConfig } from "@/services/agent-service";
import { toast } from "sonner";

const initialSettings: AppSettingsDto = {
  activeConnectionId: null,
  messageHistoryLimitPerConnection: 5000,
  autoScrollMessages: true,
  timestampFormat: "datetime",
  theme: "graphite",
  locale: "en-US",
};

describe("SettingsView", () => {
  let container: HTMLDivElement | null = null;
  let root: Root | null = null;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getAgentSettings).mockResolvedValue({
      enabled: false,
      provider: "openai",
      baseUrl: "https://api.openai.com/v1",
      apiKey: "",
      model: "gpt-5.4",
    });
  });

  afterEach(() => {
    act(() => {
      root?.unmount();
    });
    container?.remove();
    root = null;
    container = null;
    document.body.innerHTML = "";
  });

  it("keeps the API base URL input editable even when async agent settings are incomplete", async () => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);

    await act(async () => {
      root?.render(
        <I18nProvider localePreference="en-US">
          <SettingsView initialSettings={initialSettings} onClose={() => undefined} standalone />
        </I18nProvider>,
      );
    });

    await act(async () => {
      await Promise.resolve();
    });

    const baseUrlInput = Array.from(
      container.querySelectorAll("input"),
    ).find((input) => input.value === "https://api.openai.com/v1");

    expect(baseUrlInput).toBeTruthy();

    act(() => {
      const nativeSetter = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )?.set;
      nativeSetter?.call(baseUrlInput, "https://api.example.com/v1");
      baseUrlInput?.dispatchEvent(new Event("input", { bubbles: true }));
    });

    expect(container.textContent).toContain("API base URL");
    expect((baseUrlInput as HTMLInputElement).value).toBe("https://api.example.com/v1");
  });

  it("still saves locally when the local agent service is unavailable", async () => {
    vi.mocked(syncAgentServiceConfig).mockRejectedValueOnce(
      Object.assign(new Error("service unavailable"), {
        code: "agent_service_unreachable",
      }),
    );

    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);

    await act(async () => {
      root?.render(
        <I18nProvider localePreference="en-US">
          <SettingsView initialSettings={initialSettings} onClose={() => undefined} standalone />
        </I18nProvider>,
      );
    });

    await act(async () => {
      await Promise.resolve();
    });

    const saveButton = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent === "Save",
    );

    expect(saveButton).toBeTruthy();

    await act(async () => {
      saveButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
    });

    expect(saveAppSettings).toHaveBeenCalledTimes(1);
    expect(saveAgentSettings).toHaveBeenCalledTimes(1);
    expect(syncAgentServiceConfig).toHaveBeenCalledTimes(1);
    expect(container.textContent).toContain(
      "Local agent service is not running. Start it first, then check again.",
    );
    expect(toast.success).toHaveBeenCalledWith(
      "Settings saved locally. Start the local agent service to apply them now.",
    );
  });

  it("auto-enables the agent on the first save with a valid model configuration", async () => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);

    await act(async () => {
      root?.render(
        <I18nProvider localePreference="en-US">
          <SettingsView initialSettings={initialSettings} onClose={() => undefined} standalone />
        </I18nProvider>,
      );
    });

    await act(async () => {
      await Promise.resolve();
    });

    const apiKeyInput = Array.from(container.querySelectorAll("input")).find(
      (input) => input.type === "password",
    ) as HTMLInputElement | undefined;
    const saveButton = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent === "Save",
    );

    expect(apiKeyInput).toBeTruthy();
    expect(saveButton).toBeTruthy();

    act(() => {
      const nativeSetter = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )?.set;
      nativeSetter?.call(apiKeyInput, "test-api-key");
      apiKeyInput?.dispatchEvent(new Event("input", { bubbles: true }));
    });

    await act(async () => {
      saveButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
    });

    expect(saveAgentSettings).toHaveBeenCalledWith({
      enabled: true,
      provider: "openai",
      baseUrl: "https://api.openai.com/v1",
      apiKey: "test-api-key",
      model: "gpt-5.4",
    });
    expect(syncAgentServiceConfig).toHaveBeenCalledWith({
      enabled: true,
      provider: "openai",
      baseUrl: "https://api.openai.com/v1",
      apiKey: "test-api-key",
      model: "gpt-5.4",
    });
  });

  it("keeps the agent disabled on later saves after a user has already configured it", async () => {
    vi.mocked(getAgentSettings).mockResolvedValueOnce({
      enabled: false,
      provider: "openai",
      baseUrl: "https://api.example.com/v1",
      apiKey: "saved-api-key",
      model: "gpt-5.4",
    });

    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);

    await act(async () => {
      root?.render(
        <I18nProvider localePreference="en-US">
          <SettingsView initialSettings={initialSettings} onClose={() => undefined} standalone />
        </I18nProvider>,
      );
    });

    await act(async () => {
      await Promise.resolve();
    });

    const saveButton = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent === "Save",
    );

    expect(saveButton).toBeTruthy();

    await act(async () => {
      saveButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
    });

    expect(saveAgentSettings).toHaveBeenCalledWith({
      enabled: false,
      provider: "openai",
      baseUrl: "https://api.example.com/v1",
      apiKey: "saved-api-key",
      model: "gpt-5.4",
    });
    expect(syncAgentServiceConfig).toHaveBeenCalledWith({
      enabled: false,
      provider: "openai",
      baseUrl: "https://api.example.com/v1",
      apiKey: "saved-api-key",
      model: "gpt-5.4",
    });
  });
});
