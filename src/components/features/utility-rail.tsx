import { Bot, Braces, type LucideIcon } from "lucide-react";

import { useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import type { OverlayView } from "@/stores/ui-store";

type RailItemId = "parsers" | "agent";

interface UtilityRailProps {
  activeOverlay: OverlayView;
  agentPanelCollapsed: boolean;
  onOpenParsers: () => void;
  onToggleAgentPanel: () => void;
}

export function UtilityRail({
  activeOverlay,
  agentPanelCollapsed,
  onOpenParsers,
  onToggleAgentPanel,
}: UtilityRailProps) {
  const { t } = useI18n();
  const items: Array<{
    id: RailItemId;
    icon: LucideIcon;
    label: string;
    onClick: () => void;
  }> = [
    { id: "parsers", icon: Braces, label: t("rail.parsers"), onClick: onOpenParsers },
    { id: "agent", icon: Bot, label: t("rail.agent"), onClick: onToggleAgentPanel },
  ];

  return (
    <aside className="utility-rail">
      {items.map((item) => {
        const selected = item.id === "agent" ? !agentPanelCollapsed : activeOverlay === item.id;
        const label =
          item.id === "agent"
            ? agentPanelCollapsed
              ? t("agent.showPanel")
              : t("agent.hidePanel")
            : item.label;

        return (
          <button
            key={item.id}
            className={cn("utility-rail-button", selected && "is-active")}
            aria-label={label}
            aria-pressed={selected}
            onClick={item.onClick}
            title={label}
            type="button"
          >
            <item.icon className="size-4" />
          </button>
        );
      })}
    </aside>
  );
}
