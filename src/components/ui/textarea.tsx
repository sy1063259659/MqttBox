import * as React from "react";

import { cn } from "@/lib/utils";

export const Textarea = React.forwardRef<
  HTMLTextAreaElement,
  React.TextareaHTMLAttributes<HTMLTextAreaElement>
>(({ className, ...props }, ref) => (
  <textarea
    className={cn(
      "no-drag min-h-28 w-full rounded-md border border-input bg-card px-2.5 py-2 text-[12px] transition-colors outline-none placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring",
      className,
    )}
    ref={ref}
    {...props}
  />
));

Textarea.displayName = "Textarea";
