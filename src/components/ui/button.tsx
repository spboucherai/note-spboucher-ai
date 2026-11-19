/**
 * file: src/components/ui/button.tsx
 * description: Button primitive (variants × sizes). 3.0: Lumen tokens (rounded-control, duration-fast), solid focus ring, and label
 *   colours that keep AA contrast on the danger / AI fills in the dark theme.
 * author: Simon-Pierre Boucher — contact@spboucher.ai
 */
import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";
const button = cva("inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-control text-sm font-medium transition-colors duration-fast focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus disabled:pointer-events-none disabled:opacity-50 [&_svg]:size-4 [&_svg]:shrink-0", {
  variants: {
    variant: { default: "bg-accent text-accent-fg hover:bg-accent/90 shadow-card", secondary: "bg-bg-sunk text-fg hover:bg-line border border-line", ghost: "hover:bg-bg-sunk text-fg-muted hover:text-fg", outline: "border border-line bg-bg-elev hover:bg-bg-sunk", danger: "bg-danger text-bg-elev hover:bg-danger/90", ai: "bg-ai text-bg-elev hover:bg-ai/90", link: "text-accent underline-offset-4 hover:underline" },
    size: { default: "h-9 px-3.5", sm: "h-8 px-2.5 text-ui", xs: "h-7 px-2 text-xs rounded-chip", lg: "h-10 px-5", icon: "size-9", iconSm: "size-8", iconXs: "size-7 rounded-chip" },
  },
  defaultVariants: { variant: "default", size: "default" },
});
export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof button> { asChild?: boolean }
export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(({ className, variant, size, asChild, ...props }, ref) => {
  const Comp = asChild ? Slot : "button";
  return <Comp ref={ref} className={cn(button({ variant, size }), className)} {...props} />;
});
Button.displayName = "Button";
export { button as buttonVariants };
