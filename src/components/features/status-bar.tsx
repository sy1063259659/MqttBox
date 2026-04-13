import { Activity, AlertCircle, RadioTower } from "lucide-react";

import { useI18n } from "@/lib/i18n";
import { getStatusLabel } from "@/lib/status";

interface StatusBarProps {
  activeConnectionName?: string;
  status: string;
  subscriptions: number;
  messageCount: number;
  error?: string | null;
}

export function StatusBar({
  activeConnectionName,
  status,
  subscriptions,
  messageCount,
  error,
}: StatusBarProps) {
  const { t } = useI18n();

  return (
    <footer className="desktop-statusbar flex h-8 items-center justify-between px-3 text-[11px] text-muted-foreground">
      <div className="flex items-center gap-4">
        <div className="flex items-center gap-1">
          <RadioTower className="size-3.5" />
          {activeConnectionName ?? t("titlebar.noBroker")}
        </div>
        <div className="flex items-center gap-1">
          <Activity className="size-3.5" />
          {getStatusLabel(status as never, t)}
        </div>
        <div>{t("subscriptions.sectionTitle")} {subscriptions}</div>
        <div>{t("message.title")} {messageCount}</div>
      </div>
      {error ? (
        <div className="flex items-center gap-1 text-[color:var(--error-fg)]">
          <AlertCircle className="size-3.5" />
          {error}
        </div>
      ) : (
        <div>Ready</div>
      )}
    </footer>
  );
}
