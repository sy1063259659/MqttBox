import { useState } from "react";
import { BellPlus, BellRing, BellOff, Pencil, Trash2 } from "lucide-react";

import { OverlaySheet } from "@/components/features/overlay-sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import type { SubscriptionDto, SubscriptionInput } from "@/features/subscriptions/types";
import { useI18n } from "@/lib/i18n";
import { useParserStore } from "@/stores/parser-store";

interface SubscriptionPanelProps {
  connectionId: string | null;
  connectionName?: string | null;
  connectionStatus?: string;
  items: SubscriptionDto[];
  actionsDisabled?: boolean;
  variant?: "popover" | "workspace";
  showHeader?: boolean;
  onSubmit: (entry: SubscriptionInput) => Promise<void>;
  onRemove: (subscriptionId: string) => Promise<void>;
  onToggle: (subscriptionId: string, enabled: boolean) => Promise<void>;
}

interface SubscriptionDraft {
  id?: string;
  topicFilter: string;
  qos: 0 | 1 | 2;
  parserId?: string | null;
  enabled: boolean;
  isPreset: boolean;
  note: string;
}

function createDefaultDraft(): SubscriptionDraft {
  return {
    topicFilter: "",
    qos: 0,
    parserId: null,
    enabled: true,
    isPreset: true,
    note: "",
  };
}

export function SubscriptionPanel({
  connectionId,
  connectionName: _connectionName,
  connectionStatus: _connectionStatus,
  items,
  actionsDisabled = false,
  variant = "popover",
  showHeader = true,
  onSubmit,
  onRemove,
  onToggle,
}: SubscriptionPanelProps) {
  const { t } = useI18n();
  const parsers = useParserStore((state) => state.items);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [draft, setDraft] = useState<SubscriptionDraft>(createDefaultDraft);
  const [dialogRevision, setDialogRevision] = useState(0);
  const rootClassName = variant === "workspace" ? "subscription-workspace" : "topic-popover";

  const openCreateDialog = () => {
    setDraft(createDefaultDraft());
    setDialogRevision((value) => value + 1);
    setDialogOpen(true);
  };

  const openEditDialog = (item: SubscriptionDto) => {
    setDraft({
      id: item.id,
      topicFilter: item.topicFilter,
      qos: item.qos,
      parserId: item.parserId ?? null,
      enabled: item.enabled,
      isPreset: item.isPreset,
      note: item.note ?? "",
    });
    setDialogRevision((value) => value + 1);
    setDialogOpen(true);
  };

  const closeDialog = () => {
    setDialogOpen(false);
    setDraft(createDefaultDraft());
  };

  return (
    <>
      <section className={rootClassName}>
        {showHeader && variant === "workspace" ? (
          <div className="subscription-workspace-shell">
          <div className="subscription-workspace-create">
            <Button
              variant="outline"
              className="subscription-workspace-trigger"
              onClick={openCreateDialog}
              disabled={!connectionId || actionsDisabled}
            >
              <BellPlus className="size-4" />
              {t("subscriptions.openDialog")}
            </Button>
          </div>

          <div className="subscription-workspace-list scrollbar-thin">
            <div className="subscription-workspace-list-inner">
              {items.map((item) => (
                <div key={item.id} className="subscription-workspace-item">
                  <div className="subscription-workspace-content">
                    <div className="subscription-workspace-item-head">
                      <span
                        className="subscription-workspace-status-dot"
                        data-enabled={item.enabled}
                      />
                      <div className="subscription-workspace-topic mono truncate">{item.topicFilter}</div>
                    </div>
                    <div className="subscription-workspace-meta-line">
                      <span>QoS {item.qos}</span>
                    </div>
                  </div>
                  <div className="subscription-workspace-actions">
                    <Button
                      size="icon"
                      variant="ghost"
                      className="subscription-workspace-action"
                      onClick={() => openEditDialog(item)}
                      title={t("button.editSubscription")}
                      disabled={actionsDisabled}
                    >
                      <Pencil className="size-3.5" />
                    </Button>
                    <Button
                      size="icon"
                      variant="ghost"
                      className="subscription-workspace-action"
                      onClick={() => onToggle(item.id, !item.enabled)}
                      title={
                        item.enabled
                          ? t("button.disableSubscription")
                          : t("button.enableSubscription")
                      }
                      disabled={actionsDisabled}
                    >
                      {item.enabled ? (
                        <BellOff className="size-3.5" />
                      ) : (
                        <BellRing className="size-3.5" />
                      )}
                    </Button>
                    <Button
                      size="icon"
                      variant="ghost"
                      className="subscription-workspace-action"
                      onClick={() => onRemove(item.id)}
                      disabled={actionsDisabled}
                    >
                      <Trash2 className="size-3.5" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          </div>
          </div>
        ) : showHeader ? (
          <div className="topic-popover-header">
            <div className="topic-popover-summary">
              <span className="topic-popover-title">{t("subscriptions.sectionTitle")}</span>
            </div>
          </div>
        ) : null}
      </section>

      <OverlaySheet
        open={dialogOpen}
        title={
          draft.id
            ? t("subscriptions.dialog.editTitle")
            : t("subscriptions.dialog.createTitle")
        }
        width="sm"
        backdropClosable={false}
        className="overlay-sheet--subscription"
        onClose={closeDialog}
      >
        <form
          key={`${draft.id ?? "create"}-${dialogRevision}`}
          className="subscription-dialog"
          onSubmit={async (event) => {
            event.preventDefault();
            const formData = new FormData(event.currentTarget);
            const topicFilter = String(formData.get("topicFilter") ?? "").trim();
            const note = String(formData.get("note") ?? "").trim();
            const qos = Number(formData.get("qos") ?? draft.qos) as 0 | 1 | 2;
            const parserId = String(formData.get("parserId") ?? "").trim();

            if (!connectionId || !topicFilter) {
              return;
            }

            await onSubmit({
              id: draft.id,
              connectionId,
              topicFilter,
              qos,
              parserId: parserId || undefined,
              enabled: draft.enabled,
              isPreset: draft.isPreset,
              note: note || undefined,
            });
            closeDialog();
          }}
        >
          <section className="subscription-dialog-section">
            <div className="subscription-dialog-grid">
              <div className="subscription-dialog-field">
                <Label htmlFor="subscription-topic-filter">
                  {t("subscriptions.dialog.topicFilter")}
                </Label>
                <Input
                  id="subscription-topic-filter"
                  name="topicFilter"
                  defaultValue={draft.topicFilter}
                  disabled={!connectionId || actionsDisabled}
                />
              </div>
              <div className="subscription-dialog-field">
                <Label htmlFor="subscription-qos">{t("subscriptions.dialog.qos")}</Label>
                <Select
                  id="subscription-qos"
                  name="qos"
                  defaultValue={String(draft.qos)}
                  disabled={!connectionId || actionsDisabled}
                >
                  <option value="0">QoS 0</option>
                  <option value="1">QoS 1</option>
                  <option value="2">QoS 2</option>
                </Select>
              </div>
              <div className="subscription-dialog-field">
                <Label htmlFor="subscription-parser">{t("subscriptions.dialog.parser")}</Label>
                <Select
                  id="subscription-parser"
                  name="parserId"
                  defaultValue={draft.parserId ?? ""}
                  disabled={!connectionId || actionsDisabled}
                >
                  <option value="">{t("subscriptions.dialog.noParser")}</option>
                  {parsers.map((parser) => (
                    <option key={parser.id} value={parser.id}>
                      {parser.name}
                    </option>
                  ))}
                </Select>
              </div>
            </div>
          </section>

          <section className="subscription-dialog-section">
            <div className="subscription-dialog-toggles">
              <button
                type="button"
                className="subscription-dialog-toggle"
                data-checked={draft.enabled}
                aria-pressed={draft.enabled}
                disabled={!connectionId || actionsDisabled}
                onClick={() =>
                  setDraft((current) => ({
                    ...current,
                    enabled: !current.enabled,
                  }))
                }
              >
                <span className="subscription-dialog-toggle-indicator" aria-hidden="true" />
                <span>{t("subscriptions.dialog.enabled")}</span>
              </button>
              <button
                type="button"
                className="subscription-dialog-toggle"
                data-checked={draft.isPreset}
                aria-pressed={draft.isPreset}
                disabled={!connectionId || actionsDisabled}
                onClick={() =>
                  setDraft((current) => ({
                    ...current,
                    isPreset: !current.isPreset,
                  }))
                }
              >
                <span className="subscription-dialog-toggle-indicator" aria-hidden="true" />
                <span>{t("subscriptions.dialog.preset")}</span>
              </button>
            </div>
            <div className="subscription-dialog-field">
              <Label htmlFor="subscription-note">{t("subscriptions.dialog.note")}</Label>
              <Textarea
                id="subscription-note"
                name="note"
                className="subscription-dialog-textarea"
                defaultValue={draft.note}
                disabled={!connectionId || actionsDisabled}
              />
            </div>
          </section>

          <div className="subscription-dialog-actions">
            <Button type="button" variant="ghost" onClick={closeDialog}>
              {t("button.close")}
            </Button>
            <Button
              type="submit"
              variant="outline"
              disabled={!connectionId || actionsDisabled}
            >
              {draft.id ? t("button.save") : t("button.subscribe")}
            </Button>
          </div>
        </form>
      </OverlaySheet>
    </>
  );
}
