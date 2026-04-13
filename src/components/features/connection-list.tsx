import { AlertTriangle, Plug, Settings2, Trash2 } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { ConnectionProfileDto, ConnectionRuntimeState } from "@/features/connections/types";
import { useI18n } from "@/lib/i18n";
import { getStatusBadgeVariant, getStatusLabel } from "@/lib/status";
import { cn } from "@/lib/utils";

interface ConnectionListProps {
  profiles: ConnectionProfileDto[];
  activeConnectionId: string | null;
  runtime: Record<string, ConnectionRuntimeState>;
  onSelect: (connectionId: string) => void;
  onEdit: () => void;
  onRemove: (connectionId: string) => void;
}

export function ConnectionList({
  profiles,
  activeConnectionId,
  runtime,
  onSelect,
  onEdit,
  onRemove,
}: ConnectionListProps) {
  const { t } = useI18n();

  return (
    <section className="desktop-section">
      <div className="desktop-section-label">
        <span>{t("connections.sectionTitle")}</span>
        <span>{profiles.length}</span>
      </div>
      <div className="scrollbar-thin flex-1 overflow-auto p-2">
        <div className="space-y-1">
          {profiles.map((profile) => {
            const state = runtime[profile.id];
            const active = profile.id === activeConnectionId;
            const tone =
              state?.status === "connected"
                ? "connected"
                : state?.status === "connecting" || state?.status === "reconnecting"
                  ? "warning"
                  : state?.status === "error"
                    ? "error"
                    : "idle";

            return (
              <button
                key={profile.id}
                className={cn(
                  "desktop-row desktop-tree-row desktop-focus w-full rounded-md px-3 py-1.5 text-left",
                )}
                data-active={active}
                onClick={() => onSelect(profile.id)}
                type="button"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 space-y-0.5">
                    <div className="flex items-center gap-2">
                      <span className="desktop-dot" data-tone={tone} />
                      <Plug className="size-3.5 text-primary" />
                      <span className="truncate text-[12px] font-medium">{profile.name}</span>
                    </div>
                    <div className="mono truncate text-[11px] text-muted-foreground">
                      {profile.host}:{profile.port}
                    </div>
                    <div className="flex flex-wrap items-center gap-1.5">
                      <Badge
                        variant={getStatusBadgeVariant((state?.status ?? "idle") as never)}
                      >
                        {getStatusLabel((state?.status ?? "idle") as never, t)}
                      </Badge>
                      {profile.useTls ? <Badge variant="outline">TLS</Badge> : null}
                      {profile.autoReconnect ? (
                        <Badge variant="outline">{t("connections.badge.auto")}</Badge>
                      ) : null}
                    </div>
                    {state?.lastError ? (
                      <div className="flex items-center gap-1 truncate pt-0.5 text-[11px] text-[color:var(--error-fg)]">
                        <AlertTriangle className="size-3.5" />
                        <span className="truncate">{state.lastError}</span>
                      </div>
                    ) : null}
                  </div>
                  {active ? (
                    <div className="flex items-center gap-1 self-center">
                      <Button
                        size="icon"
                        variant="ghost"
                        onClick={(event) => {
                          event.stopPropagation();
                          onEdit();
                        }}
                        title={t("button.editConnection")}
                      >
                        <Settings2 className="size-4" />
                      </Button>
                      <Button
                        size="icon"
                        variant="ghost"
                        onClick={(event) => {
                          event.stopPropagation();
                          onRemove(profile.id);
                        }}
                        title={t("button.deleteConnection")}
                      >
                        <Trash2 className="size-4" />
                      </Button>
                    </div>
                  ) : null}
                </div>
              </button>
            );
          })}
          {profiles.length === 0 ? (
            <div className="desktop-empty rounded-md border border-dashed border-border bg-[color:var(--panel-subtle)] p-3">
              {t("connections.noSaved")}
            </div>
          ) : null}
        </div>
      </div>
    </section>
  );
}
