import { useEffect, useMemo, useRef, useState } from "react";
import {
  AlertCircle,
  ChevronDown,
  ChevronUp,
  Copy,
  Download,
  Pause,
  Play,
  Search,
  Trash2,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { useI18n } from "@/lib/i18n";
import { formatTimestamp } from "@/lib/time";
import { cn } from "@/lib/utils";
import {
  getPayloadDisplayContent,
  getMessagePayloadViewMode,
  getPayloadViewContent,
  isParsedIncomingMessage,
  type PayloadViewMode,
} from "@/features/messages/payload";
import type { MessageFilter, MessageRecordDto } from "@/features/messages/types";

interface MessageTableProps {
  items: MessageRecordDto[];
  filter: MessageFilter;
  isPaused: boolean;
  payloadViewMode: PayloadViewMode;
  isLoading?: boolean;
  hasMore?: boolean;
  actionsDisabled?: boolean;
  showToolbar?: boolean;
  onFilterChange: (filter: Partial<MessageFilter>) => void;
  onPayloadViewModeChange: (mode: PayloadViewMode) => void;
  onTogglePause: () => void;
  onClear: () => void;
  onExport?: () => void;
  onLoadMore?: () => void;
}

export function MessageTable({
  items,
  filter,
  isPaused,
  payloadViewMode,
  isLoading = false,
  hasMore = false,
  actionsDisabled = false,
  showToolbar = true,
  onFilterChange,
  onPayloadViewModeChange,
  onTogglePause,
  onClear,
  onExport,
  onLoadMore,
}: MessageTableProps) {
  const { t } = useI18n();
  const hasMessages = items.length > 0;
  const timeline = useMemo(() => [...items].reverse(), [items]);
  const feedRef = useRef<HTMLDivElement | null>(null);
  const newestMessageId = items[0]?.id ?? null;
  const newestMessageIdRef = useRef<string | null>(newestMessageId);
  const previousItemCountRef = useRef(items.length);
  const [isPinnedToBottom, setIsPinnedToBottom] = useState(true);
  const [hasPendingNewest, setHasPendingNewest] = useState(false);

  useEffect(() => {
    const feed = feedRef.current;
    if (!feed) {
      return;
    }

    const onScroll = () => {
      const distanceToBottom = feed.scrollHeight - feed.scrollTop - feed.clientHeight;
      const nearBottom = distanceToBottom <= 40;
      setIsPinnedToBottom(nearBottom);
      if (nearBottom) {
        setHasPendingNewest(false);
      }
    };

    onScroll();
    feed.addEventListener("scroll", onScroll);
    return () => feed.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => {
    const feed = feedRef.current;
    if (!feed || !newestMessageId) {
      newestMessageIdRef.current = newestMessageId;
      previousItemCountRef.current = items.length;
      return;
    }

    const previousNewestId = newestMessageIdRef.current;
    const previousItemCount = previousItemCountRef.current;
    const newestChanged = previousNewestId !== newestMessageId;
    newestMessageIdRef.current = newestMessageId;
    previousItemCountRef.current = items.length;

    const isInitialFill = previousItemCount === 0 && items.length > 0;
    const shouldRestoreBottom = isInitialFill || previousNewestId == null;

    if (shouldRestoreBottom) {
      requestAnimationFrame(() => {
        feed.scrollTop = feed.scrollHeight;
      });
      setIsPinnedToBottom(true);
      setHasPendingNewest(false);
      return;
    }

    if (!newestChanged) {
      return;
    }

    if (!isPaused && isPinnedToBottom) {
      requestAnimationFrame(() => {
        feed.scrollTop = feed.scrollHeight;
      });
      setHasPendingNewest(false);
      return;
    }

    if (isPaused || !isPinnedToBottom) {
      setHasPendingNewest(true);
    }
  }, [isPaused, isPinnedToBottom, items.length, newestMessageId]);

  useEffect(() => {
    const feed = feedRef.current;
    if (!feed) {
      return;
    }

    requestAnimationFrame(() => {
      feed.scrollTop = feed.scrollHeight;
    });
  }, []);

  const jumpToLatest = () => {
    const feed = feedRef.current;
    if (!feed) {
      return;
    }

    feed.scrollTop = feed.scrollHeight;
    setHasPendingNewest(false);
  };

  return (
    <section className="message-workspace">
      {showToolbar ? (
        <MessageWorkspaceToolbar
          filter={filter}
          isPaused={isPaused}
          payloadViewMode={payloadViewMode}
          onFilterChange={onFilterChange}
          onPayloadViewModeChange={onPayloadViewModeChange}
          actionsDisabled={actionsDisabled}
          onTogglePause={onTogglePause}
          onClear={onClear}
          onExport={onExport}
        />
      ) : null}

      <div ref={feedRef} className="scrollbar-thin message-workspace-feed">
        {hasMessages && onLoadMore && (hasMore || isLoading) ? (
          <div className="message-workspace-load-more">
            <Button variant="ghost" onClick={onLoadMore} disabled={!hasMore || isLoading}>
              {isLoading ? t("message.loading") : t("message.loadMore")}
            </Button>
          </div>
        ) : null}

        {timeline.map((item) => {
          return (
            <MessageBubbleItem
              key={item.id}
              item={item}
              payloadViewMode={payloadViewMode}
            />
          );
        })}

        {!hasMessages ? (
          <div className="desktop-empty message-workspace-empty">{t("message.none")}</div>
        ) : null}

        {hasPendingNewest ? (
          <button type="button" className="message-workspace-jump" onClick={jumpToLatest}>
            {t("message.jumpToLatest")}
          </button>
        ) : null}
      </div>
    </section>
  );
}

function MessageBubbleItem({
  item,
  payloadViewMode,
}: {
  item: MessageRecordDto;
  payloadViewMode: PayloadViewMode;
}) {
  const { t } = useI18n();
  const isIncoming = item.direction === "incoming";
  const [propertiesExpanded, setPropertiesExpanded] = useState(false);
  const [rawHexExpanded, setRawHexExpanded] = useState(false);
  const isParsedIncoming = isParsedIncomingMessage(item);
  const hasParsedPayload = isParsedIncoming && Boolean(item.parsedPayloadJson);
  const hasParseError = isParsedIncoming && Boolean(item.parseError);
  const effectivePayloadViewMode = getMessagePayloadViewMode(item, payloadViewMode);
  const payloadContent = getPayloadDisplayContent(
    item,
    effectivePayloadViewMode,
    t("message.emptyPayload"),
    t("message.binaryPreview"),
  );
  const mainPayloadContent = hasParsedPayload
    ? item.parsedPayloadJson ?? t("message.emptyPayload")
    : payloadContent;
  const propertiesContent = useMemo(() => {
    if (!item.propertiesJson) {
      return null;
    }

    try {
      return JSON.stringify(JSON.parse(item.propertiesJson), null, 2);
    } catch {
      return item.propertiesJson;
    }
  }, [item.propertiesJson]);

  const copyPayload = async () => {
    const payload = hasParsedPayload
      ? item.parsedPayloadJson ?? t("message.emptyPayload")
      : hasParseError
        ? item.rawPayloadHex || t("message.emptyPayload")
        : getPayloadViewContent(item, effectivePayloadViewMode);
    await navigator.clipboard.writeText(payload || t("message.emptyPayload"));
  };

  return (
    <article
      className={cn(
        "message-bubble-row",
        isIncoming ? "is-incoming" : "is-outgoing",
        effectivePayloadViewMode === "hex" && !isParsedIncoming && "is-hex-mode",
        isParsedIncoming && "is-parsed-message",
      )}
      data-direction={item.direction}
    >
      <div className="message-bubble-meta">
        <span className="message-bubble-topic mono truncate">{item.topic}</span>
        <span className="message-bubble-time mono">{formatTimestamp(item.receivedAt)}</span>
      </div>

      <div className="message-bubble">
        {hasParseError ? (
          <div className="message-bubble-parse-state" data-state="error">
            <div className="message-bubble-parse-title">
              <AlertCircle className="size-3.5" />
              {t("message.parseFailed")}
            </div>
            <div className="message-bubble-parse-summary">{item.parseError}</div>
          </div>
        ) : (
          <div
            className={cn(
              "message-bubble-payload mono",
              effectivePayloadViewMode === "hex" && !isParsedIncoming && "is-hex",
              isParsedIncoming && "is-parsed-json",
            )}
          >
            {mainPayloadContent}
          </div>
        )}
      </div>

      <div className="message-bubble-footer">
        <span>QoS {item.qos}</span>
        <span>{item.payloadSize} B</span>
        {item.retain ? <span>{t("publish.retain")}</span> : null}
        {item.dup ? <span>DUP</span> : null}
        {item.payloadType !== "text" ? <span>{item.payloadType}</span> : null}
        {isParsedIncoming ? (
          <button
            type="button"
            className="message-bubble-inline-action"
            aria-expanded={rawHexExpanded}
            onClick={() => setRawHexExpanded((value) => !value)}
          >
            {rawHexExpanded ? <ChevronUp className="size-3.5" /> : <ChevronDown className="size-3.5" />}
            {t("message.rawHex")}
          </button>
        ) : null}
        {propertiesContent ? (
          <button
            type="button"
            className="message-bubble-inline-action"
            aria-expanded={propertiesExpanded}
            onClick={() => setPropertiesExpanded((value) => !value)}
          >
            {propertiesExpanded ? <ChevronUp className="size-3.5" /> : <ChevronDown className="size-3.5" />}
            {t("message.properties")}
          </button>
        ) : null}
        <button
          type="button"
          className="message-bubble-inline-action"
          onClick={() => void copyPayload()}
        >
          <Copy className="size-3.5" />
          {t("button.copyPayload")}
        </button>
      </div>

      {propertiesExpanded && propertiesContent ? (
        <div className="message-bubble-properties">
          <div className="message-bubble-properties-label">{t("message.properties")}</div>
          <pre className="message-bubble-properties-body mono scrollbar-thin">
            {propertiesContent}
          </pre>
        </div>
      ) : null}

      {rawHexExpanded && isParsedIncoming ? (
        <div className="message-bubble-properties message-bubble-raw">
          <div className="message-bubble-properties-label">{t("message.rawHex")}</div>
          <pre className="message-bubble-properties-body message-bubble-raw-body mono">
            {item.rawPayloadHex || t("message.emptyPayload")}
          </pre>
        </div>
      ) : null}
    </article>
  );
}

interface MessageWorkspaceToolbarProps {
  filter: MessageFilter;
  isPaused: boolean;
  payloadViewMode: PayloadViewMode;
  actionsDisabled?: boolean;
  onFilterChange: (filter: Partial<MessageFilter>) => void;
  onPayloadViewModeChange: (mode: PayloadViewMode) => void;
  onTogglePause: () => void;
  onClear: () => void;
  onExport?: () => void;
}

export function MessageWorkspaceToolbar({
  filter,
  isPaused,
  payloadViewMode,
  actionsDisabled = false,
  onFilterChange,
  onPayloadViewModeChange,
  onTogglePause,
  onClear,
  onExport,
}: MessageWorkspaceToolbarProps) {
  const { t } = useI18n();

  return (
    <div className="message-workspace-header message-workspace-header--topbar">
      <div className="message-workspace-toolbar">
        <div className="message-workspace-filters">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-2.5 size-3.5 text-muted-foreground" />
            <Input
              className="pl-8"
              placeholder={t("message.searchPlaceholder")}
              value={filter.keyword}
              onChange={(event) => onFilterChange({ keyword: event.currentTarget.value })}
            />
          </div>
          <Input
            placeholder={t("message.topicFilter")}
            value={filter.topic}
            onChange={(event) => onFilterChange({ topic: event.currentTarget.value })}
          />
          <Select
            value={filter.direction}
            onChange={(event) =>
              onFilterChange({
                direction: event.currentTarget.value as MessageFilter["direction"],
              })
            }
          >
            <option value="all">{t("message.direction.all")}</option>
            <option value="incoming">{t("message.direction.incoming")}</option>
            <option value="outgoing">{t("message.direction.outgoing")}</option>
          </Select>
          <Select
            value={payloadViewMode}
            onChange={(event) =>
              onPayloadViewModeChange(event.currentTarget.value as PayloadViewMode)
            }
          >
            <option value="text">{t("messageDetail.format.text")}</option>
            <option value="json">{t("messageDetail.format.json")}</option>
            <option value="hex">{t("messageDetail.format.hex")}</option>
            <option value="base64">{t("messageDetail.format.base64")}</option>
          </Select>
        </div>
      </div>
      <div className="message-workspace-actions">
        {onExport ? (
        <Button
          size="icon"
          variant="ghost"
          onClick={onExport}
          disabled={actionsDisabled}
          title={t("button.export")}
          aria-label={t("button.export")}
          >
            <Download className="size-3.5" />
          </Button>
        ) : null}
        <Button
          size="icon"
          variant="ghost"
          onClick={onTogglePause}
          disabled={actionsDisabled}
          title={isPaused ? t("button.resume") : t("button.pause")}
          aria-label={isPaused ? t("button.resume") : t("button.pause")}
        >
          {isPaused ? <Play className="size-3.5" /> : <Pause className="size-3.5" />}
        </Button>
        <Button
          size="icon"
          variant="ghost"
          onClick={onClear}
          disabled={actionsDisabled}
          title={t("button.clear")}
          aria-label={t("button.clear")}
        >
          <Trash2 className="size-3.5" />
        </Button>
      </div>
    </div>
  );
}
