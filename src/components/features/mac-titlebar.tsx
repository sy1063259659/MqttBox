import { Bot, MoonStar, PenSquare, Plus, RefreshCcw, SunMedium, Unplug, Wifi } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { ConnectionProfileDto } from "@/features/connections/types";
import { getStatusBadgeVariant, getStatusLabel } from "@/lib/status";
import type { AppTheme } from "@/stores/ui-store";

interface MacTitlebarProps {
  activeConnection?: ConnectionProfileDto;
  activeStatus: string;
  theme: AppTheme;
  onAddConnection: () => void;
  onConnect: () => void;
  onDisconnect: () => void;
  onOpenPublish: () => void;
  onOpenAgent: () => void;
  onReload: () => void;
  onToggleTheme: () => void;
}

export function MacTitlebar({
  activeConnection,
  activeStatus,
  theme,
  onAddConnection,
  onConnect,
  onDisconnect,
  onOpenPublish,
  onOpenAgent,
  onReload,
  onToggleTheme,
}: MacTitlebarProps) {
  return (
    <header className="mac-titlebar drag-region">
      <div className="mac-titlebar-leading">
        <div className="mac-traffic-lights no-drag" aria-hidden="true">
          <span className="mac-traffic-light mac-close" />
          <span className="mac-traffic-light mac-minimize" />
          <span className="mac-traffic-light mac-zoom" />
        </div>
        <div className="min-w-0">
          <div className="truncate text-[12px] font-medium text-foreground">MqttBox</div>
          <div className="truncate text-[11px] text-muted-foreground">
            MQTT Utility for macOS-style desktop workflows
          </div>
        </div>
      </div>

      <div className="mac-titlebar-center">
        <div className="truncate text-[12px] font-medium text-foreground">
          {activeConnection ? activeConnection.name : "No Active Broker"}
        </div>
        <div className="truncate text-[11px] text-muted-foreground">
          {activeConnection
            ? `${activeConnection.host}:${activeConnection.port}  ${activeConnection.clientId}`
            : "Choose a connection profile to start monitoring traffic"}
        </div>
      </div>

      <div className="no-drag flex items-center gap-2">
        <div className="mac-segmented-control">
          <button
            className="mac-segment"
            onClick={onConnect}
            disabled={!activeConnection}
            type="button"
          >
            <Wifi className="size-3.5" />
            Connect
          </button>
          <button
            className="mac-segment"
            onClick={onDisconnect}
            disabled={!activeConnection}
            type="button"
          >
            <Unplug className="size-3.5" />
            Disconnect
          </button>
        </div>

        <Badge variant={getStatusBadgeVariant(activeStatus as never)} className="mac-status-badge">
          {getStatusLabel(activeStatus as never)}
        </Badge>

        <div className="mac-titlebar-actions">
          <Button size="sm" variant="ghost" onClick={onReload} aria-label="Refresh" title="Refresh">
            <RefreshCcw className="size-3.5" />
          </Button>
          <Button size="sm" variant="ghost" onClick={onAddConnection} title="New Profile">
            <Plus className="size-3.5" />
          </Button>
          <Button size="sm" variant="ghost" onClick={onOpenPublish} title="Open Publish Drawer">
            <PenSquare className="size-3.5" />
          </Button>
          <Button size="sm" variant="ghost" onClick={onOpenAgent} title="Open Agent Drawer">
            <Bot className="size-3.5" />
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={onToggleTheme}
            aria-label="Toggle Theme"
            title="Toggle Theme"
          >
            {theme === "graphite" ? (
              <MoonStar className="size-3.5" />
            ) : (
              <SunMedium className="size-3.5" />
            )}
          </Button>
        </div>
      </div>
    </header>
  );
}
