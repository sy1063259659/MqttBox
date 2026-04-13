import { Minus, Square, X } from "lucide-react";

import type { DesktopChromePlatform } from "@/lib/platform";

interface WindowControlsProps {
  platform: DesktopChromePlatform;
  onMinimize: () => Promise<void>;
  onMaximize: () => Promise<void>;
  onClose: () => Promise<void>;
}

export function WindowControls({
  platform,
  onMinimize,
  onMaximize,
  onClose,
}: WindowControlsProps) {
  const isMac = platform === "mac";

  return (
    <div className="titlebar-window-controls no-drag" data-platform={platform}>
      <button
        className="titlebar-window-button"
        data-role="minimize"
        onClick={() => void onMinimize()}
        type="button"
      >
        {isMac ? null : <Minus className="size-3.5" />}
      </button>
      <button
        className="titlebar-window-button"
        data-role="maximize"
        onClick={() => void onMaximize()}
        type="button"
      >
        {isMac ? null : <Square className="size-3.5" />}
      </button>
      <button
        className="titlebar-window-button is-close"
        data-role="close"
        onClick={() => void onClose()}
        type="button"
      >
        {isMac ? null : <X className="size-3.5" />}
      </button>
    </div>
  );
}
