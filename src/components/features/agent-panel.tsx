import { useRef } from "react";
import {
  Bot,
  CheckCircle2,
  ClipboardList,
  FileStack,
  ImagePlus,
  ShieldCheck,
  Wrench,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useI18n } from "@/lib/i18n";
import { useParserStore } from "@/stores/parser-store";
import { useAgentStore } from "@/stores/agent-store";
import { useUiStore } from "@/stores/ui-store";

const MODES = ["chat", "execute"] as const;
const SAFETY_LEVELS = ["observe", "draft", "confirm", "auto"] as const;

function runStatusVariant(status: string) {
  if (status === "failed" || status === "cancelled") {
    return "error" as const;
  }
  if (status === "awaiting_approval" || status === "awaiting_tool") {
    return "warning" as const;
  }
  if (status === "completed") {
    return "success" as const;
  }
  return "outline" as const;
}

export function AgentPanel() {
  const { t } = useI18n();
  const setParserDraft = useParserStore((state) => state.setDraft);
  const openOverlay = useUiStore((state) => state.openOverlay);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const {
    context,
    tools,
    capabilities,
    mode,
    safetyLevel,
    runStatus,
    transportFlavor,
    timeline,
    messages,
    approvals,
    approvalHistory,
    artifacts,
    draftPrompt,
    draftAttachments,
    statusMessage,
    setMode,
    setSafetyLevel,
    setDraftPrompt,
    submitDraftMessage,
    resolveApproval,
    addDraftAttachments,
    removeDraftAttachment,
  } = useAgentStore();

  const openParserArtifact = (artifact: { payload: Record<string, unknown> }) => {
    const name = typeof artifact.payload.name === "string" ? artifact.payload.name : "";
    const script = typeof artifact.payload.script === "string" ? artifact.payload.script : "";

    if (!name.trim() || !script.trim()) {
      return;
    }

    setParserDraft({
      name: name.trim(),
      script,
    });
    openOverlay("parsers");
  };

  const handleSelectImages = async (files: FileList | null) => {
    if (!files?.length) {
      return;
    }

    const images = Array.from(files).filter((file) => file.type.startsWith("image/"));
    const attachments = await Promise.all(
      images.map(
        (file) =>
          new Promise<{
            id: string;
            kind: "image";
            source: "file";
            mimeType: string;
            filename: string;
            dataUrl: string;
          }>((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => {
              resolve({
                id: `attachment-${crypto.randomUUID()}`,
                kind: "image",
                source: "file",
                mimeType: file.type || "image/png",
                filename: file.name,
                dataUrl: typeof reader.result === "string" ? reader.result : "",
              });
            };
            reader.onerror = () => reject(reader.error ?? new Error("Failed to read image"));
            reader.readAsDataURL(file);
          }),
      ),
    );

    addDraftAttachments(attachments.filter((item) => item.dataUrl));
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  return (
    <section className="flex h-full flex-col gap-3 overflow-y-auto p-4 text-sm">
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        multiple
        className="hidden"
        onChange={(event) => {
          void handleSelectImages(event.currentTarget.files);
        }}
      />
      <div className="desktop-subtle-panel rounded-md p-3">
        <div className="mb-2 flex items-center justify-between gap-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
          <div className="flex items-center gap-2">
            <Bot className="size-3.5 text-primary" />
            {t("agent.harness")}
          </div>
          <Badge variant={runStatusVariant(runStatus)}>{runStatus}</Badge>
        </div>
        <div className="mb-2 flex flex-wrap gap-1.5">
          {MODES.map((candidate) => (
            <Button
              key={candidate}
              variant={mode === candidate ? "default" : "outline"}
              size="sm"
              onClick={() => setMode(candidate)}
            >
              {candidate}
            </Button>
          ))}
        </div>
        <div className="mb-2 flex flex-wrap gap-1.5">
          {SAFETY_LEVELS.map((candidate) => (
            <Button
              key={candidate}
              variant={safetyLevel === candidate ? "subtle" : "ghost"}
              size="sm"
              onClick={() => setSafetyLevel(candidate)}
            >
              {candidate}
            </Button>
          ))}
        </div>
        <div className="flex flex-wrap gap-1.5">
          <Badge variant="outline">{t("agent.transport", { value: transportFlavor })}</Badge>
          {statusMessage ? <Badge variant="success">{statusMessage}</Badge> : null}
        </div>
        {capabilities.length > 0 ? (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {capabilities.map((capability) => (
              <Badge key={capability.id} variant="outline">
                {capability.name}
              </Badge>
            ))}
          </div>
        ) : null}
      </div>

      <div className="desktop-subtle-panel rounded-md p-3">
        <div className="mb-2 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
          <ShieldCheck className="size-3.5 text-primary" />
          {t("agent.messageShell")}
        </div>
        <Textarea
          value={draftPrompt}
          className="min-h-20"
          placeholder="Describe what the agent should do..."
          onChange={(event) => setDraftPrompt(event.target.value)}
        />
        <div className="mt-2 flex flex-wrap gap-1.5">
          <Button
            size="sm"
            onClick={() => {
              void submitDraftMessage();
            }}
            disabled={!draftPrompt.trim()}
          >
            <CheckCircle2 className="size-3.5" />
            {t("agent.send")}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              fileInputRef.current?.click();
            }}
          >
            <ImagePlus className="size-3.5" />
            {t("agent.addImage")}
          </Button>
        </div>
        <div className="mt-2 space-y-1">
          {draftAttachments.length > 0 ? (
            draftAttachments.map((attachment) => (
              <div
                key={attachment.id}
                className="desktop-inset flex items-center justify-between rounded-md p-2"
              >
                <span className="truncate text-[11px] text-muted-foreground">
                  {attachment.filename ?? attachment.id}
                </span>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => removeDraftAttachment(attachment.id)}
                >
                  Remove
                </Button>
              </div>
            ))
          ) : (
            <div className="text-[11px] text-muted-foreground">{t("agent.noDraftAttachments")}</div>
          )}
        </div>
      </div>

      <div className="desktop-subtle-panel rounded-md p-3">
        <div className="mb-2 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
          <Bot className="size-3.5 text-primary" />
          {t("agent.messages")}
        </div>
        <div className="space-y-1.5">
          {messages.length > 0 ? (
            messages.slice(-10).map((message) => (
              <div key={message.id} className="desktop-inset rounded-md p-2">
                <div className="mb-1 flex items-center justify-between text-[10px] uppercase tracking-[0.06em] text-muted-foreground">
                  <span>{message.role}</span>
                  <span>{new Date(message.createdAt).toLocaleTimeString()}</span>
                </div>
                <div className="text-[12px] text-foreground">{message.content || "(empty)"}</div>
                <div className="mt-1 text-[10px] text-muted-foreground">
                  {`${message.mode} · ${message.safetyLevel} · attachments ${message.attachments.length}`}
                </div>
              </div>
            ))
          ) : (
            <div className="text-[11px] text-muted-foreground">{t("agent.emptyMessages")}</div>
          )}
        </div>
      </div>

      <div className="desktop-subtle-panel rounded-md p-3">
        <div className="mb-2 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
          <ClipboardList className="size-3.5 text-primary" />
          {t("agent.runTimeline")}
        </div>
        <div className="space-y-2">
          {timeline.runs.length > 0 ? (
            timeline.runs.slice(0, 4).map((run) => (
              <div key={run.id} className="desktop-inset rounded-md p-2.5">
                <div className="mb-1 flex items-center justify-between">
                  <div className="text-[12px] font-medium text-foreground">{run.goal}</div>
                  <Badge variant={runStatusVariant(run.status)}>{run.status}</Badge>
                </div>
                <div className="mb-1 text-[10px] text-muted-foreground">{run.id}</div>
                <div className="space-y-1">
                  {run.steps.map((step) => (
                    <div
                      key={step.id}
                      className="flex items-center justify-between gap-2 rounded border border-border/60 px-2 py-1 text-[11px]"
                    >
                      <span className="truncate">{`${step.index + 1}. ${step.title}`}</span>
                      <Badge variant={runStatusVariant(step.status)}>{step.status}</Badge>
                    </div>
                  ))}
                </div>
              </div>
            ))
          ) : (
            <div className="text-[11px] text-muted-foreground">{t("agent.emptyRuns")}</div>
          )}
        </div>
      </div>

      <div className="desktop-subtle-panel rounded-md p-3">
        <div className="mb-2 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
          <ShieldCheck className="size-3.5 text-primary" />
          {t("agent.approvals")}
        </div>
        <div className="space-y-2">
          {approvals.length > 0 ? (
            approvals.map((request) => (
              <div key={request.id} className="desktop-inset rounded-md p-2.5">
                <div className="text-[12px] font-medium text-foreground">{request.title}</div>
                <div className="mb-2 text-[11px] text-muted-foreground">{request.actionSummary}</div>
                <div className="flex gap-1.5">
                  <Button size="sm" onClick={() => void resolveApproval(request.id, "approved")}>
                    {t("agent.approve")}
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => void resolveApproval(request.id, "rejected")}
                  >
                    {t("agent.reject")}
                  </Button>
                </div>
              </div>
            ))
          ) : (
            <div className="text-[11px] text-muted-foreground">{t("agent.noPendingApprovals")}</div>
          )}
          {approvalHistory.slice(0, 2).map((record) => (
            <div key={record.requestId} className="text-[11px] text-muted-foreground">
              {`${record.requestId} -> ${record.outcome}`}
            </div>
          ))}
        </div>
      </div>

      <div className="desktop-subtle-panel rounded-md p-3">
        <div className="mb-2 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
          <FileStack className="size-3.5 text-primary" />
          {t("agent.artifacts")}
        </div>
        <div className="space-y-1.5">
          {artifacts.length > 0 ? (
            artifacts.slice(0, 6).map((artifact) => (
              <div key={artifact.id} className="desktop-inset rounded-md p-2">
                <div className="text-[12px] font-medium text-foreground">{artifact.title}</div>
                <div className="text-[11px] text-muted-foreground">{artifact.summary}</div>
                {artifact.type === "parser-script" ? (
                  <div className="mt-2">
                    <Button size="sm" variant="outline" onClick={() => openParserArtifact(artifact)}>
                      {t("agent.openParserLibrary")}
                    </Button>
                  </div>
                ) : null}
              </div>
            ))
          ) : (
            <div className="text-[11px] text-muted-foreground">{t("agent.emptyArtifacts")}</div>
          )}
        </div>
      </div>

      <div className="desktop-subtle-panel rounded-md p-3">
        <div className="mb-2 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
          <Bot className="size-3.5 text-primary" />
          {t("agent.context")}
        </div>
        <div className="space-y-1 text-[12px] text-muted-foreground">
          <div>
            {t("agent.currentConnection", {
              value: context?.activeConnectionId ?? t("common.noneSelected"),
            })}
          </div>
          <div>
            {t("agent.selectedTopic", {
              value: context?.selectedTopic ?? t("common.noneSelected"),
            })}
          </div>
          <div>{t("agent.recentMessages", { value: context?.recentMessages ?? 0 })}</div>
          <div>
            {t("agent.connectionHealth", {
              value: context?.connectionHealth ?? t("status.idle"),
            })}
          </div>
        </div>
      </div>

      <div className="desktop-subtle-panel rounded-md p-3">
        <div className="mb-2 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
          <Wrench className="size-3.5 text-primary" />
          {t("agent.tools")}
        </div>
        <div className="space-y-2">
          {tools.map((tool) => (
            <div key={tool.id} className="desktop-inset rounded-md p-2.5">
              <div className="text-[12px] font-medium text-foreground">{tool.name}</div>
              <div className="text-[11px] text-muted-foreground">{tool.description}</div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
