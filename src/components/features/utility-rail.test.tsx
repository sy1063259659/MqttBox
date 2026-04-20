import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import { UtilityRail } from "@/components/features/utility-rail";
import { I18nProvider } from "@/lib/i18n";

function renderRail({
  activeOverlay = null,
  agentPanelCollapsed = false,
  onOpenParsers = vi.fn(),
  onToggleAgentPanel = vi.fn(),
}: {
  activeOverlay?: "connections" | "topics" | "message" | "settings" | "parsers" | null;
  agentPanelCollapsed?: boolean;
  onOpenParsers?: () => void;
  onToggleAgentPanel?: () => void;
}) {
  const mounted = document.createElement("div");
  document.body.appendChild(mounted);
  const mountedRoot = createRoot(mounted);

  act(() => {
    mountedRoot.render(
      <I18nProvider localePreference="en-US">
        <UtilityRail
          activeOverlay={activeOverlay}
          agentPanelCollapsed={agentPanelCollapsed}
          onOpenParsers={onOpenParsers}
          onToggleAgentPanel={onToggleAgentPanel}
        />
      </I18nProvider>,
    );
  });

  return { mounted, mountedRoot, onOpenParsers, onToggleAgentPanel };
}

describe("UtilityRail", () => {
  let container: HTMLDivElement | null = null;
  let root: Root | null = null;

  afterEach(() => {
    act(() => {
      root?.unmount();
    });
    container?.remove();
    root = null;
    container = null;
    document.body.innerHTML = "";
  });

  it("treats parser as overlay-backed and agent as docked panel state", () => {
    const onOpenParsers = vi.fn();
    const onToggleAgentPanel = vi.fn();

    ({ mounted: container, mountedRoot: root } = renderRail({
      activeOverlay: "parsers",
      agentPanelCollapsed: false,
      onOpenParsers,
      onToggleAgentPanel,
    }));

    const buttons = Array.from(container?.querySelectorAll("button") ?? []);
    const parserButton = buttons.find((button) => button.getAttribute("aria-label") === "Parsers");
    const agentButton = buttons.find((button) => button.getAttribute("aria-label") === "Hide assistant panel");

    expect(parserButton?.className).toContain("is-active");
    expect(parserButton?.getAttribute("aria-pressed")).toBe("true");
    expect(agentButton?.className).toContain("is-active");
    expect(agentButton?.getAttribute("aria-pressed")).toBe("true");

    act(() => {
      parserButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      agentButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(onOpenParsers).toHaveBeenCalledTimes(1);
    expect(onToggleAgentPanel).toHaveBeenCalledTimes(1);
  });

  it("shows the collapsed agent rail affordance when the docked panel is hidden", () => {
    ({ mounted: container, mountedRoot: root } = renderRail({
      activeOverlay: null,
      agentPanelCollapsed: true,
    }));

    const agentButton = Array.from(container?.querySelectorAll("button") ?? []).find(
      (button) => button.getAttribute("aria-label") === "Show assistant panel",
    );

    expect(agentButton).toBeTruthy();
    expect(agentButton?.className).not.toContain("is-active");
    expect(agentButton?.getAttribute("aria-pressed")).toBe("false");
  });
});
