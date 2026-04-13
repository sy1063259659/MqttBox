import { Bot, Cable, MoonStar, Plus, PlugZap, RefreshCcw, SunMedium, Unplug } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { ConnectionProfileDto } from "@/features/connections/types";
import { getStatusBadgeVariant, getStatusLabel } from "@/lib/status";
import type { AppTheme } from "@/stores/ui-store";

interface ToolbarProps {
  activeConnection?: ConnectionProfileDto;
  activeStatus: string;
  theme: AppTheme;
  onAddConnection: () => void;
  onConnect: () => void;
  onDisconnect: () => void;
  onOpenAgent: () => void;
  onReload: () => void;
  onToggleTheme: () => void;
}

export function Toolbar({
  activeConnection,
  activeStatus,
  theme,
  onAddConnection,
  onConnect,
  onDisconnect,
  onOpenAgent,
  onReload,
  onToggleTheme,
}: ToolbarProps) {
  return (
    <header className="desktop-toolbar drag-region grid h-12 grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-3 px-3">
      <div className="flex min-w-0 items-center gap-3">
        <div className="no-drag flex size-7 items-center justify-center rounded-md border border-border bg-[color:var(--panel-strong)] text-primary">
          <Cable className="size-3.5" />
        </div>
        <div className="min-w-0 space-y-0.5">
          <div className="desktop-title text-foreground">MqttBox</div>
          <div className="truncate text-[11px] text-muted-foreground">
            {activeConnection
              ? `${activeConnection.name}  ${activeConnection.host}:${activeConnection.port}`
              : "No active broker selected"}
          </div>
        </div>
      </div>

      <div className="no-drag flex items-center gap-1.5">
        <Button size="sm" variant="ghost" onClick={onReload}>
          <RefreshCcw className="size-3.5" />
          Refresh
        </Button>
        <Button size="sm" variant="ghost" onClick={onAddConnection}>
          <Plus className="size-3.5" />
          Connection
        </Button>
        <Button size="sm" variant="ghost" onClick={onConnect} disabled={!activeConnection}>
          <PlugZap className="size-3.5" />
          Connect
        </Button>
        <Button size="sm" variant="ghost" onClick={onDisconnect} disabled={!activeConnection}>
          <Unplug className="size-3.5" />
          Disconnect
        </Button>
      </div>

      <div className="no-drag flex items-center gap-1.5">
        <Badge variant={getStatusBadgeVariant(activeStatus as never)}>
          {getStatusLabel(activeStatus as never)}
        </Badge>
        <Button size="sm" variant="subtle" onClick={onOpenAgent}>
          <Bot className="size-3.5" />
          Agent
        </Button>
        <Button size="sm" variant="outline" onClick={onToggleTheme}>
          {theme === "graphite" ? (
            <MoonStar className="size-3.5" />
          ) : (
            <SunMedium className="size-3.5" />
          )}
          {theme === "graphite" ? "Dark" : "Light"}
        </Button>
      </div>
    </header>
  );
}
