import { useMemo, useState } from "react";
import { Save, SendHorizontal } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useI18n } from "@/lib/i18n";

interface PublishPanelProps {
  connectionId: string | null;
  onPublish: (request: {
    topic: string;
    payloadText: string;
    payloadType: "text" | "json";
    qos: 0 | 1 | 2;
    retain: boolean;
  }) => Promise<void>;
}

export function PublishPanel({ connectionId, onPublish }: PublishPanelProps) {
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

  return (
    <section className="flex h-full flex-col gap-4 p-4">
      <div className="space-y-1">
        <div className="desktop-title text-foreground">Publish Console</div>
        <div className="text-[12px] text-muted-foreground">
          Compose Topic, QoS and Payload here, like a real debugging console.
        </div>
      </div>

      <div className="space-y-2">
        <div className="desktop-title text-[11px] text-muted-foreground">Target</div>
        <div className="space-y-2">
          <Input
            placeholder="topic"
            className="mono"
            value={topic}
            onChange={(event) => setTopic(event.currentTarget.value)}
            disabled={!connectionId}
          />
          <div className="grid grid-cols-[120px_96px_minmax(0,1fr)] gap-2">
            <Select
              value={payloadType}
              onChange={(event) => setPayloadType(event.currentTarget.value as "text" | "json")}
              disabled={!connectionId}
            >
              <option value="json">JSON</option>
              <option value="text">Text</option>
            </Select>
            <Select
              value={String(qos)}
              onChange={(event) => setQos(Number(event.currentTarget.value) as 0 | 1 | 2)}
              disabled={!connectionId}
            >
              <option value="0">QoS 0</option>
              <option value="1">QoS 1</option>
              <option value="2">QoS 2</option>
            </Select>
            <Button
              variant={retain ? "default" : "outline"}
              onClick={() => setRetain((value) => !value)}
              disabled={!connectionId}
            >
              {retain ? "Retain On" : "Retain Off"}
            </Button>
          </div>
        </div>
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-2">
        <div className="desktop-title text-[11px] text-muted-foreground">Payload</div>
        <Textarea
          className="mono min-h-60 flex-1 resize-none"
          value={payloadText}
          onChange={(event) => setPayloadText(event.currentTarget.value)}
          disabled={!connectionId}
        />
        {payloadError ? (
          <div className="text-[11px] text-[color:var(--error-fg)]">{payloadError}</div>
        ) : null}
      </div>

      <div className="flex gap-2 border-t border-border/70 pt-3">
        <Button variant="outline" className="flex-1" disabled>
          <Save className="size-3.5" />
          Save Template
        </Button>
        <Button
          className="flex-1"
          disabled={!connectionId || !topic.trim() || Boolean(payloadError)}
          onClick={() =>
            onPublish({
              topic: topic.trim(),
              payloadText,
              payloadType,
              qos,
              retain,
            })
          }
        >
          <SendHorizontal className="size-3.5" />
          Publish
        </Button>
      </div>
    </section>
  );
}
