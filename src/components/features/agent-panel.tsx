import { useEffect, useMemo, useRef, useState, type ClipboardEvent as ReactClipboardEvent } from "react";
import { ArrowUp, ChevronDown, ImagePlus, ShieldCheck, X } from "lucide-react";
import type { AgentArtifactDto, AgentAttachmentDto, ApprovalRequestDto } from "@agent-contracts";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import type { AgentThreadMessage } from "@/features/agent/types";
import { useI18n } from "@/lib/i18n";
import { useAgentStore } from "@/stores/agent-store";
import { useParserStore } from "@/stores/parser-store";
import { useUiStore } from "@/stores/ui-store";

const MODES = ["chat", "execute"] as const;
const SAFETY_LEVELS = ["observe", "draft", "confirm", "auto"] as const;

type FeedItem =
  | {
      kind: "message";
      key: string;
      createdAt: string;
      message: AgentThreadMessage;
    }
  | {
      kind: "approval";
      key: string;
      createdAt: string;
      request: ApprovalRequestDto;
    }
  | {
      kind: "artifact";
      key: string;
      createdAt: string;
      artifact: AgentArtifactDto;
    }
  | {
      kind: "pending";
      key: string;
      createdAt: string;
      pending: {
        phase: "sending" | "analyzing" | "planning" | "preparing" | "waiting_for_approval";
        detail: string | null;
      };
    };

function runStatusTone(status: string) {
  if (status === "failed" || status === "cancelled") {
    return "error";
  }
  if (status === "awaiting_approval" || status === "awaiting_tool") {
    return "warning";
  }
  if (status === "completed") {
    return "success";
  }
  if (status === "running" || status === "planning" || status === "producing_artifact") {
    return "active";
  }
  return "idle";
}

function humanFileSize(bytes?: number | null) {
  if (!bytes || bytes <= 0) {
    return null;
  }
  if (bytes < 1024 * 1024) {
    return `${Math.ceil(bytes / 1024)} KB`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatClock(value?: string | null) {
  if (!value) {
    return "";
  }
  return new Date(value).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function getArtifactEditorPayload(artifact: AgentArtifactDto) {
  return typeof artifact.payload.editorPayload === "object" && artifact.payload.editorPayload !== null
    ? (artifact.payload.editorPayload as Record<string, unknown>)
    : artifact.payload;
}

function getArtifactReviewPayload(artifact: AgentArtifactDto) {
  return typeof artifact.payload.reviewPayload === "object" && artifact.payload.reviewPayload !== null
    ? (artifact.payload.reviewPayload as {
        summary?: string;
        assumptions?: string[];
        risks?: string[];
        nextSteps?: string[];
      })
    : null;
}

function sortFeedItems(items: FeedItem[]) {
  return [...items].sort((left, right) => {
    const leftTime = Date.parse(left.createdAt);
    const rightTime = Date.parse(right.createdAt);
    if (Number.isNaN(leftTime) || Number.isNaN(rightTime)) {
      return left.createdAt.localeCompare(right.createdAt);
    }
    return leftTime - rightTime;
  });
}

interface ImageAttachmentRules {
  currentAttachmentCount: number;
  maxAttachmentCount: number;
  maxAttachmentBytes: number;
  acceptedImageMimeTypes: string[];
}

function isEditableTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) {
    return false;
  }

  if (target.isContentEditable) {
    return true;
  }

  const editableAncestor = target.closest("[contenteditable='true']");
  if (editableAncestor) {
    return true;
  }

  return target instanceof HTMLTextAreaElement || target instanceof HTMLInputElement;
}

function getClipboardImageFiles(data: DataTransfer | null) {
  if (!data) {
    return [];
  }

  const imageItems = Array.from(data.items ?? [])
    .filter((item) => item.kind === "file" && item.type.startsWith("image/"))
    .map((item) => item.getAsFile())
    .filter((file): file is File => Boolean(file));

  if (imageItems.length > 0) {
    return imageItems;
  }

  return Array.from(data.files ?? []).filter((file) => file.type.startsWith("image/"));
}

function validateImageFiles(files: File[], rules: ImageAttachmentRules) {
  const remainingSlots = Math.max(0, rules.maxAttachmentCount - rules.currentAttachmentCount);
  if (remainingSlots <= 0) {
    return {
      acceptedFiles: [] as File[],
      errorMessage: `Image limit reached (${rules.maxAttachmentCount}). Remove one before adding more.`,
    };
  }

  const acceptedFiles: File[] = [];
  let errorMessage: string | null = null;

  for (const file of files) {
    if (!file.type.startsWith("image/")) {
      continue;
    }

    if (acceptedFiles.length >= remainingSlots) {
      break;
    }

    if (
      rules.acceptedImageMimeTypes.length > 0 &&
      !rules.acceptedImageMimeTypes.includes(file.type)
    ) {
      errorMessage ??= `Unsupported image type: ${file.type}`;
      continue;
    }

    if (file.size > rules.maxAttachmentBytes) {
      errorMessage ??= `${file.name} exceeds the ${humanFileSize(rules.maxAttachmentBytes) ?? rules.maxAttachmentBytes} limit.`;
      continue;
    }

    acceptedFiles.push(file);
  }

  return { acceptedFiles, errorMessage };
}

function fileToImageAttachment(file: File) {
  return new Promise<AgentAttachmentDto>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      resolve({
        id: `attachment-${crypto.randomUUID()}`,
        kind: "image",
        source: "file",
        mimeType: file.type || "image/png",
        filename: file.name,
        dataUrl: typeof reader.result === "string" ? reader.result : "",
        byteSize: file.size,
      });
    };
    reader.onerror = () => reject(reader.error ?? new Error("Failed to read image"));
    reader.readAsDataURL(file);
  });
}

function phaseTranslationKey(
  phase: "sending" | "analyzing" | "planning" | "preparing" | "waiting_for_approval",
) {
  if (phase === "sending") {
    return "agent.phaseSending" as const;
  }
  if (phase === "planning") {
    return "agent.phasePlanning" as const;
  }
  if (phase === "preparing") {
    return "agent.phasePreparing" as const;
  }
  if (phase === "waiting_for_approval") {
    return "agent.phaseWaitingApproval" as const;
  }
  return "agent.phaseAnalyzing" as const;
}

function runStatusTranslationKey(status?: string | null) {
  if (status === "queued") {
    return "agent.runStatusQueued" as const;
  }
  if (status === "planning") {
    return "agent.runStatusPlanning" as const;
  }
  if (status === "awaiting_tool") {
    return "agent.runStatusAwaitingTool" as const;
  }
  if (status === "awaiting_approval") {
    return "agent.runStatusAwaitingApproval" as const;
  }
  if (status === "running") {
    return "agent.runStatusRunning" as const;
  }
  if (status === "producing_artifact") {
    return "agent.runStatusProducingArtifact" as const;
  }
  if (status === "completed") {
    return "agent.runStatusCompleted" as const;
  }
  if (status === "failed") {
    return "agent.runStatusFailed" as const;
  }
  if (status === "cancelled") {
    return "agent.runStatusCancelled" as const;
  }
  return "agent.runStatusIdle" as const;
}

function isTerminalRunStatus(status?: string | null) {
  return !status || status === "idle" || status === "completed" || status === "failed" || status === "cancelled";
}

export function AgentPanel() {
  const { t } = useI18n();
  const setParserDraft = useParserStore((state) => state.setDraft);
  const openOverlay = useUiStore((state) => state.openOverlay);
  const panelRef = useRef<HTMLElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const feedEndRef = useRef<HTMLDivElement | null>(null);
  const composerRef = useRef<HTMLDivElement | null>(null);
  const [openMenu, setOpenMenu] = useState<"mode" | "safety" | null>(null);
  const {
    serviceConfig,
    mode,
    safetyLevel,
    runStatus,
    timeline,
    messages,
    approvals,
    artifacts,
    context,
    draftPrompt,
    draftAttachments,
    isSubmitting,
    pendingAssistantState,
    statusMessage,
    setMode,
    setSafetyLevel,
    setDraftPrompt,
    submitDraftMessage,
    resolveApproval,
    addDraftAttachments,
    removeDraftAttachment,
    setStatusMessage,
  } = useAgentStore();

  const activeRun = useMemo(() => {
    return timeline.activeRunId
      ? timeline.runs.find((item) => item.id === timeline.activeRunId) ?? timeline.runs[0] ?? null
      : timeline.runs[0] ?? null;
  }, [timeline.activeRunId, timeline.runs]);

  const activeStepLabel = useMemo(() => {
    if (!activeRun?.steps.length) {
      return null;
    }

    const pendingStep =
      activeRun.steps.find((step) => step.status === "running" || step.status === "pending") ??
      [...activeRun.steps].sort((left, right) => right.index - left.index)[0] ??
      null;

    return pendingStep ? pendingStep.title : null;
  }, [activeRun]);

  const statusLine = useMemo(() => {
    if ((runStatus === "failed" || runStatus === "cancelled") && statusMessage) {
      return statusMessage;
    }
    if (activeRun?.goal?.trim()) {
      return activeRun.goal;
    }
    if (pendingAssistantState) {
      return t(phaseTranslationKey(pendingAssistantState.phase));
    }
    return statusMessage;
  }, [activeRun?.goal, pendingAssistantState, runStatus, statusMessage, t]);

  const statusDetail = useMemo(() => {
    return [pendingAssistantState?.detail ?? null, activeRun?.capabilityId, activeStepLabel]
      .filter(Boolean)
      .join(" · ") || null;
  }, [activeRun?.capabilityId, activeStepLabel, pendingAssistantState?.detail]);

  const feedItems = useMemo(() => {
    return sortFeedItems([
      ...messages.map((message) => ({
        kind: "message" as const,
        key: `message-${message.id}`,
        createdAt: message.createdAt,
        message,
      })),
      ...approvals.map((request) => ({
        kind: "approval" as const,
        key: `approval-${request.id}`,
        createdAt: request.requestedAt,
        request,
      })),
      ...artifacts.map((artifact) => ({
        kind: "artifact" as const,
        key: `artifact-${artifact.id}`,
        createdAt: artifact.createdAt,
        artifact,
      })),
      ...(pendingAssistantState
        ? [
            {
              kind: "pending" as const,
              key: `pending-${pendingAssistantState.userMessageId}`,
              createdAt: pendingAssistantState.createdAt,
              pending: pendingAssistantState,
            },
          ]
        : []),
    ]);
  }, [approvals, artifacts, messages, pendingAssistantState]);

  const scrollSignature = useMemo(() => {
    const latestMessage = messages[messages.length - 1];
    return [
      latestMessage?.id ?? "",
      latestMessage?.content.length ?? 0,
      latestMessage?.isStreaming ? "streaming" : "final",
      approvals[0]?.id ?? "",
      artifacts[0]?.id ?? "",
      pendingAssistantState?.phase ?? "",
      pendingAssistantState?.detail ?? "",
      runStatus,
    ].join(":");
  }, [approvals, artifacts, messages, pendingAssistantState?.detail, pendingAssistantState?.phase, runStatus]);

  useEffect(() => {
    feedEndRef.current?.scrollIntoView?.({ block: "end" });
  }, [scrollSignature]);

  useEffect(() => {
    textareaRef.current?.focus();
  }, []);

  useEffect(() => {
    if (!openMenu) {
      return;
    }

    const handlePointerDown = (event: MouseEvent) => {
      if (!composerRef.current?.contains(event.target as Node)) {
        setOpenMenu(null);
      }
    };

    document.addEventListener("mousedown", handlePointerDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
    };
  }, [openMenu]);

  const openParserArtifact = (artifact: AgentArtifactDto) => {
    const editorPayload = getArtifactEditorPayload(artifact);
    const name = typeof editorPayload.name === "string" ? editorPayload.name : "";
    const script = typeof editorPayload.script === "string" ? editorPayload.script : "";
    const suggestedTestPayloadHex =
      typeof editorPayload.suggestedTestPayloadHex === "string"
        ? editorPayload.suggestedTestPayloadHex
        : undefined;

    if (!name.trim() || !script.trim()) {
      return;
    }

    setParserDraft({
      name: name.trim(),
      script,
      suggestedTestPayloadHex,
    });
    openOverlay("parsers");
  };

  const handleAddImages = async (files: FileList | File[] | null | undefined) => {
    const nextFiles = Array.from(files ?? []).filter((file) => file.type.startsWith("image/"));
    if (nextFiles.length === 0) {
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
      return;
    }

    const { acceptedFiles, errorMessage } = validateImageFiles(nextFiles, {
      currentAttachmentCount: draftAttachments.length,
      maxAttachmentCount: serviceConfig?.maxAttachmentCount ?? Number.POSITIVE_INFINITY,
      maxAttachmentBytes: serviceConfig?.maxAttachmentBytes ?? Number.POSITIVE_INFINITY,
      acceptedImageMimeTypes: serviceConfig?.acceptedImageMimeTypes ?? [],
    });

    const attachments = (await Promise.all(acceptedFiles.map((file) => fileToImageAttachment(file)))).filter(
      (item) => item.dataUrl,
    );

    if (attachments.length > 0) {
      addDraftAttachments(attachments);
    }

    if (errorMessage) {
      setStatusMessage(errorMessage);
    } else if (attachments.length > 0) {
      setStatusMessage(null);
    }

    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  const handlePanelPaste = (event: ReactClipboardEvent<HTMLElement>) => {
    const imageFiles = getClipboardImageFiles(event.clipboardData);
    if (imageFiles.length === 0) {
      return;
    }

    const plainText = event.clipboardData.getData("text/plain");
    const targetIsEditable = isEditableTarget(event.target);

    if (!targetIsEditable) {
      if (plainText) {
        setDraftPrompt(`${draftPrompt}${plainText}`);
      }
      event.preventDefault();
    } else if (!plainText) {
      event.preventDefault();
    }

    void handleAddImages(imageFiles);
  };

  const imageButtonTitle = serviceConfig
    ? t("agent.attachmentLimits", {
        count: serviceConfig.maxAttachmentCount,
        size:
          humanFileSize(serviceConfig.maxAttachmentBytes) ?? serviceConfig.maxAttachmentBytes,
      })
    : undefined;

  const formatControlLabel = (value: string) => {
    if (!value) {
      return value;
    }
    return `${value.slice(0, 1).toUpperCase()}${value.slice(1)}`;
  };

  const activeRunStatus = activeRun?.status ?? runStatus;
  const runActive = isSubmitting || pendingAssistantState != null || !isTerminalRunStatus(activeRunStatus);
  const sendDisabled = !draftPrompt.trim() || isSubmitting || !isTerminalRunStatus(activeRunStatus);
  const localizedRunStatus = t(runStatusTranslationKey(activeRunStatus));
  const composerStatus = pendingAssistantState
    ? t(phaseTranslationKey(pendingAssistantState.phase))
    : runActive
      ? localizedRunStatus
      : null;

  const submitComposer = () => {
    void submitDraftMessage();
    window.requestAnimationFrame(() => {
      textareaRef.current?.focus();
    });
  };

  return (
    <section
      ref={panelRef}
      className="agent-panel text-sm"
      tabIndex={-1}
      onPasteCapture={handlePanelPaste}
      onMouseDownCapture={(event) => {
        if (isEditableTarget(event.target) || (event.target instanceof HTMLElement && event.target.closest("button,a"))) {
          return;
        }
        panelRef.current?.focus({ preventScroll: true });
      }}
    >
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        multiple
        className="hidden"
        onChange={(event) => {
          void handleAddImages(event.currentTarget.files);
        }}
      />

      <header className="agent-panel-toolbar">
        <div className="agent-panel-toolbar-primary">
          <div className="agent-panel-toolbar-copy">
            <div className="agent-panel-toolbar-title">{t("agent.conversation")}</div>
            {statusLine ? <div className="agent-panel-toolbar-caption">{statusLine}</div> : null}
          </div>

          <div className="agent-panel-run-indicator" data-tone={runStatusTone(activeRunStatus)}>
            <span className="agent-panel-run-indicator-dot" />
            <span>{localizedRunStatus}</span>
          </div>
        </div>

        {statusDetail ? <div className="agent-panel-status-line">{statusDetail}</div> : null}
      </header>

      <div className="agent-panel-body">
        <div className="agent-panel-feed" data-empty={feedItems.length === 0 && !activeRun}>
          {feedItems.length === 0 && !activeRun ? (
            <div className="agent-panel-empty-state">
              <div className="agent-panel-empty-title">{t("agent.emptyStateTitle")}</div>
              <div className="agent-panel-empty-copy">{t("agent.emptyStateBody")}</div>
              <div className="agent-panel-empty-meta">
                {context?.selectedTopic ? (
                  <Badge variant="outline">{context.selectedTopic}</Badge>
                ) : null}
                {context?.connectionHealth ? (
                  <Badge variant="outline">{t("agent.connectionHealth", { value: context.connectionHealth })}</Badge>
                ) : null}
                {serviceConfig?.supportsImageInput ? (
                  <Badge variant="outline">{t("agent.shortcutPaste")}</Badge>
                ) : null}
              </div>
            </div>
          ) : null}
          {feedItems.map((item) => {
            if (item.kind === "message") {
              const isAssistant = item.message.role === "assistant";
              const isUser = item.message.role === "user";

              return (
                <article key={item.key} className="agent-panel-feed-item" data-role={item.message.role}>
                  <div
                    className={[
                      "agent-panel-bubble",
                      isUser
                        ? "agent-panel-bubble--user"
                        : isAssistant
                          ? "agent-panel-bubble--assistant"
                          : "agent-panel-bubble--system",
                    ].join(" ")}
                  >
                    <div className="agent-panel-message-meta">
                      <span>{isUser ? t("agent.roleUser") : isAssistant ? t("agent.roleAssistant") : t("agent.roleSystem")}</span>
                      <span>
                        {item.message.isOptimistic ? t("agent.phaseSending") : formatClock(item.message.createdAt)}
                      </span>
                    </div>
                    <div className="agent-panel-message-body" data-streaming={item.message.isStreaming}>
                      {item.message.content || "(empty)"}
                    </div>
                    {item.message.attachments.length > 0 ? (
                      <div className="agent-panel-message-attachments">
                        {item.message.attachments.map((attachment) => (
                          <div key={attachment.id} className="agent-panel-attachment">
                            <img
                              src={attachment.dataUrl}
                              alt={attachment.filename ?? attachment.id}
                              className="agent-panel-attachment-thumb"
                            />
                            <div className="min-w-0">
                              <div className="agent-panel-attachment-name">
                                {attachment.filename ?? attachment.id}
                              </div>
                              <div className="agent-panel-attachment-meta">
                                {humanFileSize(attachment.byteSize) ?? attachment.mimeType}
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : null}
                  </div>
                </article>
              );
            }

            if (item.kind === "pending") {
              return (
                <article key={item.key} className="agent-panel-feed-item" data-role="assistant">
                  <div className="agent-panel-pending-block">
                    <div className="agent-panel-inline-card-meta">
                      <span className="agent-panel-inline-card-label">{t("agent.roleAssistant")}</span>
                      <span>{t("agent.pendingLabel")}</span>
                    </div>
                    <div className="agent-panel-pending-summary">
                      <span className="agent-panel-pending-dot" />
                      {t(phaseTranslationKey(item.pending.phase))}
                    </div>
                    {item.pending.detail ? (
                      <div className="agent-panel-inline-card-copy">{item.pending.detail}</div>
                    ) : null}
                  </div>
                </article>
              );
            }

            if (item.kind === "approval") {
              return (
                <article key={item.key} className="agent-panel-feed-item" data-role="system">
                  <div className="agent-panel-inline-card agent-panel-inline-card--approval">
                    <div className="agent-panel-inline-card-meta">
                      <span className="agent-panel-inline-card-label">
                        <ShieldCheck className="size-3.5" />
                        {t("agent.approvals")}
                      </span>
                      <span>{formatClock(item.request.requestedAt)}</span>
                    </div>
                    <div className="agent-panel-inline-card-title">{item.request.title}</div>
                    <div className="agent-panel-inline-card-copy">{item.request.actionSummary}</div>
                    <div className="agent-panel-inline-card-copy">{item.request.reason}</div>
                    {item.request.inputPreview ? (
                      <pre className="agent-panel-code-preview">{item.request.inputPreview}</pre>
                    ) : null}
                    <div className="agent-panel-card-actions">
                      <Button size="sm" onClick={() => void resolveApproval(item.request.id, "approved")}>
                        {t("agent.approve")}
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => void resolveApproval(item.request.id, "rejected")}
                      >
                        {t("agent.reject")}
                      </Button>
                    </div>
                  </div>
                </article>
              );
            }

            const reviewPayload = getArtifactReviewPayload(item.artifact);
            const riskPreview = reviewPayload?.risks?.[0] ?? null;

            return (
              <article key={item.key} className="agent-panel-feed-item" data-role="assistant">
                <div className="agent-panel-result-block">
                  <div className="agent-panel-inline-card-meta">
                    <span className="agent-panel-inline-card-label">{t("agent.result")}</span>
                    <span>{formatClock(item.artifact.createdAt)}</span>
                  </div>
                  <div className="agent-panel-inline-card-title">{item.artifact.title}</div>
                  <div className="agent-panel-inline-card-copy">{item.artifact.summary}</div>
                  {reviewPayload?.summary ? (
                    <div className="agent-panel-inline-card-copy">{reviewPayload.summary}</div>
                  ) : null}
                  {riskPreview ? (
                    <div className="agent-panel-result-risk">{riskPreview}</div>
                  ) : null}
                  <div className="agent-panel-card-actions">
                    <Button size="sm" variant="outline" onClick={() => openParserArtifact(item.artifact)}>
                      {t("agent.openParserLibrary")}
                    </Button>
                  </div>
                </div>
              </article>
            );
          })}
          <div ref={feedEndRef} />
        </div>
      </div>

      <footer className="agent-panel-composer">
        <div className="agent-panel-composer-shell" ref={composerRef}>
          {draftAttachments.length > 0 ? (
            <div className="agent-panel-composer-preview-strip">
              {draftAttachments.map((attachment) => (
                <div key={attachment.id} className="agent-panel-composer-preview-chip">
                  <img
                    src={attachment.dataUrl}
                    alt={attachment.filename ?? attachment.id}
                    className="agent-panel-composer-preview-thumb"
                  />
                  <div className="agent-panel-composer-preview-name">
                    {attachment.filename ?? attachment.id}
                  </div>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="agent-panel-composer-preview-remove"
                    aria-label={`${t("button.remove")} ${attachment.filename ?? attachment.id}`}
                    onClick={() => removeDraftAttachment(attachment.id)}
                  >
                    <X className="size-3.5" />
                  </Button>
                </div>
              ))}
            </div>
          ) : null}

          <Textarea
            ref={textareaRef}
            value={draftPrompt}
            className="agent-panel-composer-textarea"
            placeholder={t("agent.composerPlaceholder")}
            onChange={(event) => setDraftPrompt(event.target.value)}
            onKeyDown={(event) => {
              if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing) {
                return;
              }

              if (sendDisabled) {
                return;
              }

              event.preventDefault();
              submitComposer();
            }}
          />

          <div className="agent-panel-composer-bar">
            <div className="agent-panel-composer-left">
              <Button
                size="sm"
                variant="ghost"
                className="agent-panel-composer-tool-button"
                aria-label={t("agent.addImage")}
                title={imageButtonTitle}
                onClick={() => {
                  fileInputRef.current?.click();
                }}
              >
                <ImagePlus className="size-3.5" />
              </Button>

              <span className="agent-panel-composer-divider" aria-hidden="true" />

              <div className="agent-panel-composer-menu">
                <Button
                  size="sm"
                  variant="ghost"
                  className="agent-panel-composer-meta-button"
                  aria-label={`${t("agent.mode")}: ${mode}`}
                  title={`${t("agent.mode")}: ${formatControlLabel(mode)}`}
                  disabled={runActive}
                  onClick={() => setOpenMenu((current) => (current === "mode" ? null : "mode"))}
                >
                  {formatControlLabel(mode)}
                  <ChevronDown className="size-3.5" />
                </Button>
                {openMenu === "mode" ? (
                  <div className="agent-panel-composer-menu-panel" data-kind="mode">
                    {MODES.map((candidate) => (
                      <Button
                        key={candidate}
                        variant={mode === candidate ? "subtle" : "ghost"}
                        size="sm"
                        className="agent-panel-composer-menu-item"
                        onClick={() => {
                          setMode(candidate);
                          setOpenMenu(null);
                        }}
                      >
                        {formatControlLabel(candidate)}
                      </Button>
                    ))}
                  </div>
                ) : null}
              </div>

              <div className="agent-panel-composer-menu">
                <Button
                  size="sm"
                  variant="ghost"
                  className="agent-panel-composer-meta-button"
                  aria-label={`${t("agent.safetyLevel")}: ${safetyLevel}`}
                  title={`${t("agent.safetyLevel")}: ${formatControlLabel(safetyLevel)}`}
                  disabled={runActive}
                  onClick={() => setOpenMenu((current) => (current === "safety" ? null : "safety"))}
                >
                  <ShieldCheck className="size-3.5" />
                  {formatControlLabel(safetyLevel)}
                </Button>
                {openMenu === "safety" ? (
                  <div className="agent-panel-composer-menu-panel" data-kind="safety">
                    {SAFETY_LEVELS.map((candidate) => (
                      <Button
                        key={candidate}
                        variant={safetyLevel === candidate ? "subtle" : "ghost"}
                        size="sm"
                        className="agent-panel-composer-menu-item"
                        onClick={() => {
                          setSafetyLevel(candidate);
                          setOpenMenu(null);
                        }}
                      >
                        {formatControlLabel(candidate)}
                      </Button>
                    ))}
                  </div>
                ) : null}
              </div>
            </div>

            <div className="agent-panel-composer-right">
              {composerStatus ? (
                <div className="agent-panel-composer-status" data-active={runActive}>
                  <span className="agent-panel-composer-status-dot" />
                  <span>{composerStatus}</span>
                </div>
              ) : null}

              <Button
                size="sm"
                className="agent-panel-send-button"
                aria-label={t("agent.send")}
                onClick={() => {
                  submitComposer();
                }}
                disabled={sendDisabled}
              >
                <ArrowUp className="size-3.5" />
              </Button>
            </div>
          </div>
        </div>
      </footer>
    </section>
  );
}
