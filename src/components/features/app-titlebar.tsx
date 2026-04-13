import { Cog } from "lucide-react";
import type { MouseEvent } from "react";

import { Button } from "@/components/ui/button";
import { WindowControls } from "@/components/features/window-controls";
import { useI18n } from "@/lib/i18n";
import { getDesktopChromePlatform } from "@/lib/platform";

interface AppTitlebarProps {
  onOpenSettings: () => Promise<unknown> | void;
  onMinimize: () => Promise<void>;
  onMaximize: () => Promise<void>;
  onClose: () => Promise<void>;
}

export function AppTitlebar({
  onOpenSettings,
  onMinimize,
  onMaximize,
  onClose,
}: AppTitlebarProps) {
  const { t } = useI18n();
  const chromePlatform = getDesktopChromePlatform();
  const handleTitlebarDoubleClick = (event: MouseEvent<HTMLElement>) => {
    const target = event.target as HTMLElement;
    if (target.closest(".no-drag")) {
      return;
    }
    void onMaximize();
  };

  return (
    <header
      className="app-titlebar"
      data-platform={chromePlatform}
      data-tauri-drag-region
      onDoubleClick={handleTitlebarDoubleClick}
    >
      {chromePlatform === "mac" ? (
        <WindowControls
          platform={chromePlatform}
          onMinimize={onMinimize}
          onMaximize={onMaximize}
          onClose={onClose}
        />
      ) : null}

      <div className="titlebar-brand" data-tauri-drag-region>
        <div className="titlebar-logo no-drag">M</div>
        <div className="titlebar-copy" data-tauri-drag-region>
          <div className="titlebar-name">MqttBox</div>
        </div>
      </div>

      <div className="titlebar-drag-area" data-tauri-drag-region />

      <div className="titlebar-utility no-drag">
        <Button
          className="titlebar-icon-button"
          size="icon"
          variant="ghost"
          onMouseDown={(event) => {
            event.stopPropagation();
          }}
          onClick={(event) => {
            event.stopPropagation();
            void onOpenSettings();
          }}
          onDoubleClick={(event) => {
            event.stopPropagation();
          }}
          title={t("titlebar.settings")}
          aria-label={t("titlebar.settings")}
        >
          <Cog className="size-4" />
        </Button>
      </div>

      {chromePlatform !== "mac" ? (
        <WindowControls
          platform={chromePlatform}
          onMinimize={onMinimize}
          onMaximize={onMaximize}
          onClose={onClose}
        />
      ) : null}
    </header>
  );
}
