import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import { SubscriptionPanel } from "@/components/features/subscription-panel";
import { I18nProvider } from "@/lib/i18n";
import type { SubscriptionDto, SubscriptionInput } from "@/features/subscriptions/types";

describe("SubscriptionPanel", () => {
  let container: HTMLDivElement | null = null;
  let root: Root | null = null;

  const renderPanel = (items: SubscriptionDto[] = []) => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);

    act(() => {
      root?.render(
        <I18nProvider localePreference="zh-CN">
          <SubscriptionPanel
            connectionId="connection-1"
            items={items}
            variant="workspace"
            onSubmit={vi.fn<(_: SubscriptionInput) => Promise<void>>().mockResolvedValue()}
            onRemove={vi.fn<(_: string) => Promise<void>>().mockResolvedValue()}
            onToggle={vi.fn<(_: string, __: boolean) => Promise<void>>().mockResolvedValue()}
          />
        </I18nProvider>,
      );
    });
  };

  afterEach(() => {
    act(() => {
      root?.unmount();
    });
    container?.remove();
    root = null;
    container = null;
    document.body.innerHTML = "";
  });

  it("keeps the dialog mounted while typing into topic filter", () => {
    renderPanel();

    const openButton = Array.from(document.querySelectorAll("button")).find((button) =>
      button.textContent?.includes("订阅主题"),
    );
    expect(openButton).toBeTruthy();

    act(() => {
      openButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    const input = document.getElementById(
      "subscription-topic-filter",
    ) as HTMLInputElement | null;
    expect(input).toBeTruthy();

    act(() => {
      input!.value = "sensors/+/status";
      input!.dispatchEvent(new Event("input", { bubbles: true }));
      input!.dispatchEvent(new Event("change", { bubbles: true }));
    });

    const dialogTitle = Array.from(document.querySelectorAll(".overlay-sheet-title")).find((node) =>
      node.textContent?.includes("订阅主题"),
    );

    expect(dialogTitle).toBeTruthy();
    expect((document.getElementById("subscription-topic-filter") as HTMLInputElement).value).toBe(
      "sensors/+/status",
    );
  });
});
