import { Bot, Braces, type LucideIcon } from "lucide-react";

import { useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import type { OverlayView } from "@/stores/ui-store";

type RailItemId = "parsers" | "agent";

interface UtilityRailProps {
  activeOverlay: OverlayView;
  onOpenParsers: () => void;
  onOpenAgent: () => void;
}

export function UtilityRail({
  activeOverlay,
  onOpenParsers,
  onOpenAgent,
}: UtilityRailProps) {
  const { t } = useI18n();
  const items: Array<{
    id: RailItemId;
    icon: LucideIcon;
    label: string;
    onClick: () => void;
  }> = [
    { id: "parsers", icon: Braces, label: t("rail.parsers"), onClick: onOpenParsers },
    { id: "agent", icon: Bot, label: t("rail.agent"), onClick: onOpenAgent },
  ];

  return (
    <aside className="utility-rail">
      {items.map((item) => {
        const selected = activeOverlay === item.id;

        return (
          <button
            key={item.id}
            className={cn("utility-rail-button", selected && "is-active")}
            onClick={item.onClick}
            title={item.label}
            type="button"
          >
            <item.icon className="size-4" />
          </button>
        );
      })}
    </aside>
  );
}
