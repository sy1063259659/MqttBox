import { Copy, FileJson2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  getDefaultPayloadViewMode,
  getPayloadViewContent,
  tryFormatJson,
  type PayloadViewMode,
} from "@/features/messages/payload";
import { useI18n, type TranslationKey } from "@/lib/i18n";
import { formatTimestamp } from "@/lib/time";
import type { MessageRecordDto } from "@/features/messages/types";

const payloadFormatLabelKey: Record<PayloadViewMode, TranslationKey> = {
  text: "messageDetail.format.text",
  json: "messageDetail.format.json",
  hex: "messageDetail.format.hex",
  base64: "messageDetail.format.base64",
};

export function MessageDetailPanel({ message }: { message?: MessageRecordDto }) {
  const { t } = useI18n();
  const [viewMode, setViewMode] = useState<PayloadViewMode>("text");
  const jsonContent = useMemo(() => (message ? tryFormatJson(message) : null), [message]);
  const availableModes: PayloadViewMode[] = useMemo(() => {
    if (!message) {
      return ["text", "hex", "base64"];
    }

    if (jsonContent) {
      return ["json", "text", "hex", "base64"];
    }

    return message.payloadType === "binary" || message.payloadType === "binary_base64"
      ? ["hex", "base64", "text"]
      : ["text", "hex", "base64"];
  }, [jsonContent, message]);

  useEffect(() => {
    if (!message) {
      return;
    }

    setViewMode(getDefaultPayloadViewMode(message));
  }, [message]);

  if (!message) {
    return (
      <section className="flex h-full flex-col gap-4 p-4">
        <div className="desktop-empty">{t("messageDetail.select")}</div>
      </section>
    );
  }

  const payloadContent = getPayloadViewContent(message, viewMode);

  return (
    <section className="message-detail-panel">
      <div className="message-detail-header">
        <div className="message-detail-topic mono">{message.topic}</div>
        <Button
          size="sm"
          variant="ghost"
          onClick={() => navigator.clipboard.writeText(payloadContent)}
        >
          <Copy className="size-3.5" />
          {t("button.copyPayload")}
        </Button>
      </div>

      <div className="message-detail-meta desktop-subtle-panel">
        <div>{t("messageDetail.timestamp")}</div>
        <div className="mono text-foreground">{formatTimestamp(message.receivedAt)}</div>
        <div>{t("messageDetail.direction")}</div>
        <div className="text-foreground">
          {message.direction === "incoming" ? t("direction.incoming") : t("direction.outgoing")}
        </div>
        <div>QoS</div>
        <div className="text-foreground">{message.qos}</div>
        <div>Retain</div>
        <div className="text-foreground">{String(message.retain)}</div>
        <div>{t("messageDetail.payloadSize")}</div>
        <div className="text-foreground">{message.payloadSize}</div>
      </div>

      <div className="message-detail-payload desktop-subtle-panel">
        <div className="message-detail-payload-header">
          <FileJson2 className="size-3.5 text-primary" />
          <span>{t("messageDetail.payload")}</span>
          <div className="message-detail-format-tabs">
            {(["text", "json", "hex", "base64"] as PayloadViewMode[]).map((mode) => {
              const disabled = !availableModes.includes(mode);
              return (
                <button
                  key={mode}
                  type="button"
                  className="message-detail-format-tab"
                  data-active={viewMode === mode}
                  disabled={disabled}
                  onClick={() => setViewMode(mode)}
                >
                  {t(payloadFormatLabelKey[mode])}
                </button>
              );
            })}
          </div>
        </div>
        <pre className="message-detail-payload-body mono scrollbar-thin">
          {payloadContent || t("message.emptyPayload")}
        </pre>
      </div>
    </section>
  );
}
