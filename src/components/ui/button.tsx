import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";
const button = cva("inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-md text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 disabled:pointer-events-none disabled:opacity-50 [&_svg]:size-4 [&_svg]:shrink-0", {
  variants: {
    variant: { default: "bg-accent text-accent-fg hover:bg-accent/90 shadow-card", secondary: "bg-bg-sunk text-fg hover:bg-line border border-line", ghost: "hover:bg-bg-sunk text-fg-muted hover:text-fg", outline: "border border-line bg-bg-elev hover:bg-bg-sunk", danger: "bg-danger text-white hover:bg-danger/90", ai: "bg-ai text-white hover:bg-ai/90", link: "text-accent underline-offset-4 hover:underline" },
    size: { default: "h-9 px-3.5", sm: "h-8 px-2.5 text-[13px]", xs: "h-7 px-2 text-xs rounded", lg: "h-10 px-5", icon: "size-9", iconSm: "size-8", iconXs: "size-7 rounded" },
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
