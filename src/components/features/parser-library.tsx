import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { FlaskConical, Plus, Trash2 } from "lucide-react";

import { ParserScriptEditor } from "@/components/features/parser-script-editor";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  getDefaultParserScript,
  getParserHelpers,
} from "@/features/parsers/helpers";
import type { MessageParserDto } from "@/features/parsers/types";
import { useI18n } from "@/lib/i18n";
import { useConnectionStore } from "@/stores/connection-store";
import { useParserStore } from "@/stores/parser-store";
import { useSubscriptionStore } from "@/stores/subscription-store";

type SelectedParserId = string | "new";

interface ParserDraft {
  id?: string;
  name: string;
  script: string;
}

interface ParserTestDraft {
  payloadHex: string;
}

function createDraft(
  locale: "en-US" | "zh-CN",
  parser?: MessageParserDto | null,
): ParserDraft {
  if (!parser) {
    return {
      name: "",
      script: getDefaultParserScript(locale),
    };
  }

  return {
    id: parser.id,
    name: parser.name,
    script: parser.script,
  };
}

export function ParserLibrary() {
  const { locale, t } = useI18n();
  const parserStore = useParserStore();
  const activeConnectionId = useConnectionStore((state) => state.activeConnectionId);
  const loadSubscriptions = useSubscriptionStore((state) => state.loadSubscriptions);
  const [selectedParserId, setSelectedParserId] = useState<SelectedParserId>("new");
  const [draft, setDraft] = useState<ParserDraft>(() => createDraft(locale));
  const [testDraft, setTestDraft] = useState<ParserTestDraft>({
    payloadHex: "",
  });
  const [testResult, setTestResult] = useState<{
    ok: boolean;
    output: string | null;
    error: string | null;
  } | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [isTesting, setIsTesting] = useState(false);

  const selectedParser = useMemo(
    () =>
      selectedParserId === "new"
        ? null
        : parserStore.items.find((item) => item.id === selectedParserId) ?? null,
    [parserStore.items, selectedParserId],
  );
  const parserHelpers = useMemo(() => getParserHelpers(locale), [locale]);

  useEffect(() => {
    if (!parserStore.items.length) {
      setSelectedParserId("new");
      return;
    }

    if (
      selectedParserId === "new" ||
      parserStore.items.some((item) => item.id === selectedParserId)
    ) {
      return;
    }

    setSelectedParserId("new");
  }, [parserStore.items, selectedParserId]);

  useEffect(() => {
    setDraft(createDraft(locale, selectedParser));
    setTestResult(null);
  }, [selectedParser]);

  return (
    <div className="parser-library">
      <aside className="parser-library-sidebar">
        <div className="parser-library-sidebar-header">
          <Button
            variant="outline"
            className="parser-library-new"
            onClick={() => {
              setSelectedParserId("new");
              setDraft(createDraft(locale));
              setTestResult(null);
            }}
            type="button"
          >
            <Plus className="size-3.5" />
            {t("parsers.new")}
          </Button>
        </div>

        <div className="parser-library-list scrollbar-thin">
          {parserStore.items.map((item) => {
            const isActive = selectedParserId === item.id;

            return (
              <button
                key={item.id}
                type="button"
                className="parser-library-item"
                data-active={isActive}
                onClick={() => {
                  setSelectedParserId(item.id);
                  setDraft(createDraft(locale, item));
                }}
              >
                <span className="parser-library-item-name truncate">{item.name}</span>
              </button>
            );
          })}

          {!parserStore.items.length ? (
            <div className="parser-library-empty">{t("parsers.empty")}</div>
          ) : null}
        </div>
      </aside>

      <div className="parser-library-editor">
        <section className="parser-library-section">
          <div className="parser-library-grid">
            <div className="parser-library-field">
              <Label htmlFor="parser-name">{t("parsers.name")}</Label>
              <Input
                id="parser-name"
                value={draft.name}
                onChange={(event) => {
                  const value = event.currentTarget.value;
                  setDraft((current) => ({
                    ...current,
                    name: value,
                  }));
                }}
              />
            </div>
          </div>

          <div className="parser-library-field">
            <Label htmlFor="parser-script">{t("parsers.script")}</Label>
            <ParserScriptEditor
              value={draft.script}
              onChange={(value) => {
                setDraft((current) => ({
                  ...current,
                  script: value,
                }));
              }}
            />
          </div>

          <div className="parser-library-helper-card">
            <div className="parser-library-helper-header">
              <div className="parser-library-section-title">{t("parsers.helpersTitle")}</div>
              <div className="parser-library-helper-caption">
                {t("parsers.helpersCaption")}
              </div>
            </div>
            <div className="parser-library-helper-list">
              {parserHelpers.map((helper) => (
                <div key={helper.name} className="parser-library-helper-item">
                  <div className="parser-library-helper-signature mono">
                    {`helpers.${helper.signature}`}
                  </div>
                  <div className="parser-library-helper-detail">{helper.detail}</div>
                  <div className="parser-library-helper-detail">{helper.documentation}</div>
                  <div className="parser-library-helper-example mono">{helper.example}</div>
                </div>
              ))}
            </div>
          </div>

          <div className="parser-library-actions">
            <Button
              type="button"
              variant="outline"
              disabled={isSaving || !draft.name.trim() || !draft.script.trim()}
              onClick={async () => {
                setIsSaving(true);
                try {
                  const saved = await parserStore.saveParser({
                    id: draft.id,
                    name: draft.name.trim(),
                    script: draft.script,
                  });
                  setSelectedParserId(saved.id);
                  setDraft(createDraft(locale, saved));
                  toast.success(t("toast.parserSaved"));
                } catch (error) {
                  toast.error(error instanceof Error ? error.message : t("toast.operationFailed"));
                } finally {
                  setIsSaving(false);
                }
              }}
            >
              {t("button.save")}
            </Button>
            <Button
              type="button"
              variant="ghost"
              disabled={isDeleting || !draft.id}
              onClick={async () => {
                if (!draft.id) {
                  return;
                }

                setIsDeleting(true);
                try {
                  await parserStore.removeParser(draft.id);
                  if (activeConnectionId) {
                    await loadSubscriptions(activeConnectionId);
                  }
                  setSelectedParserId("new");
                  setDraft(createDraft(locale));
                  setTestResult(null);
                  toast.success(t("toast.parserRemoved"));
                } catch (error) {
                  toast.error(error instanceof Error ? error.message : t("toast.operationFailed"));
                } finally {
                  setIsDeleting(false);
                }
              }}
            >
              <Trash2 className="size-3.5" />
              {t("button.deleteParser")}
            </Button>
          </div>
        </section>

        <section className="parser-library-section">
          <div className="parser-library-section-title">{t("parsers.testTitle")}</div>

          <div className="parser-library-field">
            <Label htmlFor="parser-test-payload">{t("parsers.testPayloadHex")}</Label>
            <Textarea
              id="parser-test-payload"
              className="parser-library-test-payload mono"
              value={testDraft.payloadHex}
              onChange={(event) => {
                const value = event.currentTarget.value;
                setTestDraft((current) => ({
                  ...current,
                  payloadHex: value,
                }));
              }}
            />
          </div>

          <div className="parser-library-actions">
            <Button
              type="button"
              variant="outline"
              disabled={isTesting || !draft.script.trim()}
              onClick={async () => {
                setIsTesting(true);
                try {
                  const result = await parserStore.testParser({
                    script: draft.script,
                    payloadHex: testDraft.payloadHex,
                  });
                  setTestResult({
                    ok: result.ok,
                    output: result.parsedPayloadJson ?? null,
                    error: result.parseError ?? null,
                  });
                } catch (error) {
                  setTestResult({
                    ok: false,
                    output: null,
                    error: error instanceof Error ? error.message : t("toast.operationFailed"),
                  });
                } finally {
                  setIsTesting(false);
                }
              }}
            >
              <FlaskConical className="size-3.5" />
              {t("parsers.runTest")}
            </Button>
          </div>

          {testResult ? (
            <div
              className="parser-library-result"
              data-state={testResult.ok ? "success" : "error"}
            >
              <div className="parser-library-result-label">
                {testResult.ok ? t("parsers.testResult") : t("parsers.testError")}
              </div>
              <pre className="parser-library-result-body mono scrollbar-thin">
                {testResult.ok ? testResult.output ?? "" : testResult.error ?? ""}
              </pre>
            </div>
          ) : null}
        </section>
      </div>
    </div>
  );
}
