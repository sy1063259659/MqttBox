import { useMemo, useState } from "react";
import { SendHorizontal } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useI18n } from "@/lib/i18n";
interface PublishComposerProps {
  connectionId: string | null;
  height: number;
  disabled?: boolean;
  onBlockedSend?: (reason: string) => void;
  onPublish: (request: {
    topic: string;
    payloadText: string;
    payloadType: "text" | "json";
    qos: 0 | 1 | 2;
    retain: boolean;
  }) => Promise<void>;
}

export function PublishComposer({
  connectionId,
  height,
  disabled = false,
  onBlockedSend,
  onPublish,
}: PublishComposerProps) {
  const { t } = useI18n();
  const [topic, setTopic] = useState("");
  const [payloadText, setPayloadText] = useState("{\n  \"hello\": \"mqtt\"\n}");
  const [payloadType, setPayloadType] = useState<"text" | "json">("json");
  const [qos, setQos] = useState<0 | 1 | 2>(0);
  const [retain, setRetain] = useState(false);

  const payloadError = useMemo(() => {
    if (payloadType !== "json") {
      return null;
    }

    try {
      JSON.parse(payloadText);
      return null;
    } catch {
      return t("publish.invalidJson");
    }
  }, [payloadText, payloadType, t]);

  const sendValidationReason = useMemo(() => {
    if (!topic.trim()) {
      return t("publish.blocked.topicRequired");
    }

    if (payloadError) {
      return payloadError;
    }

    return null;
  }, [payloadError, t, topic]);

  return (
    <section className="publish-composer" style={{ height }}>
      <div className="publish-composer-row publish-composer-commandbar">
        <Input
          placeholder={t("publish.topicPlaceholder")}
          className="mono publish-composer-topic"
          value={topic}
          onChange={(event) => setTopic(event.currentTarget.value)}
          disabled={!connectionId || disabled}
        />
        <Select
          value={payloadType}
          onChange={(event) => setPayloadType(event.currentTarget.value as "text" | "json")}
          disabled={!connectionId || disabled}
        >
          <option value="json">{t("publish.type.json")}</option>
          <option value="text">{t("publish.type.text")}</option>
        </Select>
        <Select
          value={String(qos)}
          onChange={(event) => setQos(Number(event.currentTarget.value) as 0 | 1 | 2)}
          disabled={!connectionId || disabled}
        >
          <option value="0">QoS 0</option>
          <option value="1">QoS 1</option>
          <option value="2">QoS 2</option>
        </Select>
        <Button
          size="sm"
          variant={retain ? "subtle" : "outline"}
          onClick={() => setRetain((value) => !value)}
          disabled={!connectionId || disabled}
        >
          {t("publish.retain")}
        </Button>
        <Button
          size="sm"
          disabled={!connectionId || disabled}
          onClick={async () => {
            if (sendValidationReason) {
              onBlockedSend?.(sendValidationReason);
              return;
            }
            await onPublish({
              topic: topic.trim(),
              payloadText,
              payloadType,
              qos,
              retain,
            });
          }}
        >
          <SendHorizontal className="size-3.5" />
          {t("button.send")}
        </Button>
      </div>

      <Textarea
        className="mono publish-composer-editor"
        value={payloadText}
        onChange={(event) => setPayloadText(event.currentTarget.value)}
        disabled={!connectionId || disabled}
        />
    </section>
  );
}
