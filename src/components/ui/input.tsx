import * as React from "react";

import { cn } from "@/lib/utils";

export const Input = React.forwardRef<
  HTMLInputElement,
  React.InputHTMLAttributes<HTMLInputElement>
>(({ className, ...props }, ref) => (
  <input
    className={cn(
      "no-drag flex h-8 w-full rounded-[10px] border border-input bg-[color:var(--background-elevated)] px-2.5 py-1.5 text-[12px] transition-[background-color,border-color,box-shadow] outline-none placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring",
      className,
    )}
    ref={ref}
    {...props}
  />
));

Input.displayName = "Input";
