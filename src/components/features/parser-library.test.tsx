import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { ParserLibrary } from "@/components/features/parser-library";
import { I18nProvider } from "@/lib/i18n";
import { useConnectionStore } from "@/stores/connection-store";
import { useParserStore } from "@/stores/parser-store";
import { useSubscriptionStore } from "@/stores/subscription-store";

describe("ParserLibrary", () => {
  let container: HTMLDivElement | null = null;
  let root: Root | null = null;

  beforeEach(() => {
    useConnectionStore.setState({ activeConnectionId: "connection-1" });
    useSubscriptionStore.setState({ connectionId: "connection-1", items: [], isLoading: false });
    useParserStore.setState({
      items: [],
      isLoading: false,
      draft: {
        name: "Factory Parser",
        script: "function parse() { return {}; }",
        suggestedTestPayloadHex: "0102",
      },
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

  it("hydrates parser drafts with the suggested test payload from artifacts", () => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);

    act(() => {
      root?.render(
        <I18nProvider localePreference="en-US">
          <ParserLibrary />
        </I18nProvider>,
      );
    });

    const nameInput = document.getElementById("parser-name") as HTMLInputElement | null;
    const payloadTextarea = document.getElementById(
      "parser-test-payload",
    ) as HTMLTextAreaElement | null;

    expect(nameInput?.value).toBe("Factory Parser");
    expect(payloadTextarea?.value).toBe("0102");
    expect(useParserStore.getState().draft).toBeNull();
  });
});
