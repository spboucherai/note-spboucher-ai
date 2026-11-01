"use client";
import * as React from "react";
import * as DialogP from "@radix-ui/react-dialog";
import * as PopoverP from "@radix-ui/react-popover";
import * as TooltipP from "@radix-ui/react-tooltip";
import * as DropdownP from "@radix-ui/react-dropdown-menu";
import * as SwitchP from "@radix-ui/react-switch";
import * as TabsP from "@radix-ui/react-tabs";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

export const Dialog = DialogP.Root; export const DialogTrigger = DialogP.Trigger; export const DialogClose = DialogP.Close;
export function DialogContent({ className, children, title, description, wide, ...p }: DialogP.DialogContentProps & { title?: React.ReactNode; description?: React.ReactNode; wide?: boolean }) {
  return (
    <DialogP.Portal>
      <DialogP.Overlay className="fixed inset-0 z-50 bg-black/40 backdrop-blur-[2px] data-[state=open]:animate-in" />
      <DialogP.Content className={cn("fixed left-1/2 top-1/2 z-50 w-[calc(100vw-2rem)] -translate-x-1/2 -translate-y-1/2 rounded-xl border border-line bg-bg-elev p-5 shadow-pop focus:outline-none fade-up max-h-[90vh] overflow-y-auto", wide ? "max-w-4xl" : "max-w-lg", className)} {...p}>
        {title && <DialogP.Title className="text-base font-semibold mb-1">{title}</DialogP.Title>}
        {description ? <DialogP.Description className="text-sm text-fg-muted mb-4">{description}</DialogP.Description> : <DialogP.Description className="sr-only">Dialog</DialogP.Description>}
        {children}
        <DialogP.Close className="absolute right-3 top-3 rounded p-1 text-fg-faint hover:bg-bg-sunk hover:text-fg"><X className="size-4" /></DialogP.Close>
      </DialogP.Content>
    </DialogP.Portal>
  );
}
export const Popover = PopoverP.Root; export const PopoverTrigger = PopoverP.Trigger; export const PopoverAnchor = PopoverP.Anchor;
export function PopoverContent({ className, align = "start", sideOffset = 6, ...p }: PopoverP.PopoverContentProps) {
  return <PopoverP.Portal><PopoverP.Content align={align} sideOffset={sideOffset} className={cn("z-50 w-72 rounded-lg border border-line bg-bg-elev p-3 shadow-pop outline-none fade-up", className)} {...p} /></PopoverP.Portal>;
}
export function Tip({ children, label, side = "bottom" }: { children: React.ReactNode; label: React.ReactNode; side?: "top" | "bottom" | "left" | "right" }) {
  return (
    <TooltipP.Provider delayDuration={400}><TooltipP.Root><TooltipP.Trigger asChild>{children}</TooltipP.Trigger>
      <TooltipP.Portal><TooltipP.Content side={side} sideOffset={6} className="z-50 rounded-md bg-fg px-2 py-1 text-xs text-bg shadow-pop fade-up">{label}</TooltipP.Content></TooltipP.Portal>
    </TooltipP.Root></TooltipP.Provider>
  );
}
export const Menu = DropdownP.Root; export const MenuTrigger = DropdownP.Trigger; export const MenuSeparator = (p: any) => <DropdownP.Separator className="my-1 h-px bg-line" {...p} />;
export function MenuContent({ className, align = "end", ...p }: DropdownP.DropdownMenuContentProps) {
  return <DropdownP.Portal><DropdownP.Content align={align} sideOffset={6} className={cn("z-50 min-w-[180px] rounded-lg border border-line bg-bg-elev p-1 shadow-pop fade-up", className)} {...p} /></DropdownP.Portal>;
}
export function MenuItem({ className, danger, ...p }: DropdownP.DropdownMenuItemProps & { danger?: boolean }) {
  return <DropdownP.Item className={cn("flex cursor-pointer select-none items-center gap-2 rounded-md px-2 py-1.5 text-[13px] outline-none data-[highlighted]:bg-bg-sunk [&_svg]:size-4 [&_svg]:text-fg-muted", danger && "text-danger", className)} {...p} />;
}
export function Switch(p: SwitchP.SwitchProps) {
  return <SwitchP.Root className="relative h-5 w-9 rounded-full bg-line-strong data-[state=checked]:bg-accent transition-colors" {...p}><SwitchP.Thumb className="block size-4 translate-x-0.5 rounded-full bg-white shadow transition-transform data-[state=checked]:translate-x-[18px]" /></SwitchP.Root>;
}
export const Tabs = TabsP.Root; export const TabsContent = TabsP.Content;
export function TabsList({ className, ...p }: TabsP.TabsListProps) { return <TabsP.List className={cn("inline-flex h-8 items-center rounded-lg bg-bg-sunk p-0.5 text-fg-muted", className)} {...p} />; }
export function TabsTrigger({ className, ...p }: TabsP.TabsTriggerProps) { return <TabsP.Trigger className={cn("inline-flex h-7 items-center rounded-md px-3 text-[13px] font-medium transition-all data-[state=active]:bg-bg-elev data-[state=active]:text-fg data-[state=active]:shadow-card", className)} {...p} />; }
export function Badge({ className, tone = "neutral", children }: { className?: string; tone?: "neutral" | "accent" | "ai" | "success" | "warning" | "danger"; children: React.ReactNode }) {
  const tones = { neutral: "bg-bg-sunk text-fg-muted border-line", accent: "bg-accent-soft text-accent border-accent/20", ai: "bg-ai-soft text-ai border-ai/20", success: "bg-success/10 text-success border-success/20", warning: "bg-warning/15 text-warning border-warning/30", danger: "bg-danger/10 text-danger border-danger/20" };
  return <span className={cn("inline-flex items-center rounded-md border px-1.5 py-0.5 text-[11px] font-medium leading-4", tones[tone], className)}>{children}</span>;
}
export function Kbd({ children }: { children: React.ReactNode }) { return <kbd className="inline-flex h-5 items-center rounded border border-line bg-bg-sunk px-1 font-mono text-[10px] text-fg-muted">{children}</kbd>; }
export function Spinner({ className }: { className?: string }) { return <span className={cn("inline-block size-4 animate-spin rounded-full border-2 border-line-strong border-t-accent", className)} />; }
export function Empty({ icon, title, hint, action }: { icon?: React.ReactNode; title: string; hint?: string; action?: React.ReactNode }) {
  return <div className="flex flex-col items-center justify-center gap-2 py-14 text-center"><div className="text-fg-faint [&_svg]:size-8">{icon}</div><div className="text-sm font-medium">{title}</div>{hint && <div className="text-[13px] text-fg-muted max-w-sm">{hint}</div>}{action && <div className="mt-2">{action}</div>}</div>;
}
