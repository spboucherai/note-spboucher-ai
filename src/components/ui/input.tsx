import * as React from "react";
import { cn } from "@/lib/utils";
export const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(({ className, ...props }, ref) => (
  <input ref={ref} className={cn("flex h-9 w-full rounded-md border border-line bg-bg-elev px-3 py-1 text-sm shadow-card placeholder:text-fg-faint focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 focus-visible:border-accent/50 disabled:opacity-50", className)} {...props} />
));
Input.displayName = "Input";
export const Textarea = React.forwardRef<HTMLTextAreaElement, React.TextareaHTMLAttributes<HTMLTextAreaElement>>(({ className, ...props }, ref) => (
  <textarea ref={ref} className={cn("flex min-h-[80px] w-full rounded-md border border-line bg-bg-elev px-3 py-2 text-sm shadow-card placeholder:text-fg-faint focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 disabled:opacity-50", className)} {...props} />
));
Textarea.displayName = "Textarea";
export function Label({ className, ...p }: React.LabelHTMLAttributes<HTMLLabelElement>) { return <label className={cn("text-[13px] font-medium text-fg-muted", className)} {...p} />; }
