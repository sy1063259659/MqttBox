import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex items-center rounded-[999px] border px-1.5 py-0.5 text-[9.5px] font-semibold uppercase tracking-[0.04em]",
  {
    variants: {
      variant: {
        default: "border-transparent bg-primary/10 text-primary",
        success:
          "border-[color:var(--success-border)] bg-[color:var(--success-bg)] text-[color:var(--success-fg)]",
        warning:
          "border-[color:var(--warning-border)] bg-[color:var(--warning-bg)] text-[color:var(--warning-fg)]",
        error:
          "border-[color:var(--error-border)] bg-[color:var(--error-bg)] text-[color:var(--error-fg)]",
        outline: "border-border/70 bg-[color:var(--background-elevated)] text-card-foreground",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  },
);

export function Badge({
  className,
  variant,
  ...props
}: React.HTMLAttributes<HTMLDivElement> & VariantProps<typeof badgeVariants>) {
  return <div className={cn(badgeVariants({ variant }), className)} {...props} />;
}
