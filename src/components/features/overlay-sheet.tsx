import { X } from "lucide-react";
import type { ReactNode } from "react";
import { createPortal } from "react-dom";

import { Button } from "@/components/ui/button";
import { useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils";

interface OverlaySheetProps {
  open: boolean;
  title: string;
  description?: string;
  position?: "center" | "right";
  width?: "xs" | "sm" | "md" | "lg" | "xl";
  variant?: "default" | "command" | "popover";
  backdropClosable?: boolean;
  className?: string;
  onClose: () => void;
  children: ReactNode;
}

export function OverlaySheet({
  open,
  title,
  description,
  position = "center",
  width = "md",
  variant = "default",
  backdropClosable = true,
  className,
  onClose,
  children,
}: OverlaySheetProps) {
  const { t } = useI18n();

  if (typeof document === "undefined") {
    return null;
  }

  return createPortal(
    <>
      <button
        aria-hidden={!open}
        className="overlay-backdrop"
        data-open={open}
        onClick={backdropClosable ? onClose : undefined}
        tabIndex={open ? 0 : -1}
        type="button"
      />
      <section
        className={cn(
          "overlay-sheet",
          `is-${position}`,
          `is-${width}`,
          `variant-${variant}`,
          className,
        )}
        data-open={open}
      >
        <header className="overlay-sheet-header">
          <div className="min-w-0">
            <div className="overlay-sheet-title">{title}</div>
            {description ? <div className="overlay-sheet-description">{description}</div> : null}
          </div>
          <Button
            size="icon"
            variant="ghost"
            onClick={onClose}
            aria-label={t("overlay.close")}
            title={t("overlay.close")}
          >
            <X className="size-4" />
          </Button>
        </header>
        <div className="overlay-sheet-body">{children}</div>
      </section>
    </>,
    document.body,
  );
}
