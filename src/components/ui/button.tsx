import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "no-drag inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-[10px] border text-[12px] font-medium transition-[background-color,border-color,color,box-shadow] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50",
  {
    variants: {
      variant: {
        default:
          "border-primary/20 bg-primary text-primary-foreground shadow-[inset_0_1px_0_rgba(255,255,255,0.12)] hover:brightness-[1.03]",
        outline:
          "border-border/75 bg-[color:var(--background-elevated)] text-card-foreground hover:bg-[color:var(--panel-subtle)] hover:border-border",
        ghost:
          "border-transparent bg-transparent text-muted-foreground hover:bg-[color:var(--panel-subtle)] hover:text-foreground",
        subtle:
          "border-border/55 bg-[color:var(--selection)] text-secondary-foreground hover:bg-[color:var(--selection-strong)]",
        destructive:
          "border-destructive/20 bg-destructive text-destructive-foreground shadow-[inset_0_1px_0_rgba(255,255,255,0.08)] hover:brightness-[1.03]",
      },
      size: {
        default: "h-8 px-3 py-1.5",
        sm: "h-7 px-2.5 text-[11px]",
        icon: "size-8",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, ...props }, ref) => (
    <button
      className={cn(buttonVariants({ variant, size }), className)}
      ref={ref}
      {...props}
    />
  ),
);

Button.displayName = "Button";
