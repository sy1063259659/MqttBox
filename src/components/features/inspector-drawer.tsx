import type { ReactNode } from "react";
import { ChevronRight, Download, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type InspectorTab = "publish" | "message" | "agent" | "connection";

const tabLabels: Record<InspectorTab, string> = {
  publish: "Publish",
  message: "Message",
  agent: "Agent",
  connection: "Connection",
};

interface InspectorDrawerProps {
  open: boolean;
  activeTab: InspectorTab;
  onClose: () => void;
  onSelectTab: (tab: InspectorTab) => void;
  onExport: () => void;
  exportDisabled?: boolean;
  children: ReactNode;
}

export function InspectorDrawer({
  open,
  activeTab,
  onClose,
  onSelectTab,
  onExport,
  exportDisabled,
  children,
}: InspectorDrawerProps) {
  return (
    <>
      <button
        aria-label="Close inspector"
        className="inspector-backdrop"
        data-open={open}
        onClick={onClose}
        type="button"
      />
      <aside className="inspector-drawer" data-open={open}>
        <div className="inspector-drawer-grabber" aria-hidden="true" />
        <div className="inspector-drawer-header">
          <div className="flex min-w-0 items-center gap-2">
            <ChevronRight className="size-4 text-muted-foreground" />
            <div className="min-w-0">
              <div className="truncate text-[12px] font-medium text-foreground">
                {tabLabels[activeTab]} Inspector
              </div>
              <div className="truncate text-[11px] text-muted-foreground">
                Context-preserving utility drawer
              </div>
            </div>
          </div>
          <div className="flex items-center gap-1">
            <Button
              size="sm"
              variant="ghost"
              onClick={onExport}
              disabled={exportDisabled}
              aria-label="Export messages"
            >
              <Download className="size-3.5" />
            </Button>
            <Button size="sm" variant="ghost" onClick={onClose} aria-label="Close inspector">
              <X className="size-3.5" />
            </Button>
          </div>
        </div>

        <div className="inspector-drawer-tabs">
          {(["publish", "message", "agent", "connection"] as const).map((tab) => (
            <button
              key={tab}
              className={cn("inspector-tab", activeTab === tab && "is-active")}
              onClick={() => onSelectTab(tab)}
              type="button"
            >
              {tabLabels[tab]}
            </button>
          ))}
        </div>

        <div className="scrollbar-thin min-h-0 flex-1 overflow-auto">{children}</div>
      </aside>
    </>
  );
}
