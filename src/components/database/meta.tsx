"use client";
import * as React from "react";
import { Type, Hash, Calendar, CheckSquare, CircleDot, ChevronDownCircle, List, Link2, Paperclip, ArrowRightLeft, Sigma, FunctionSquare, Clock, History, Sparkles, Heading, Table2, Kanban, CalendarDays, LayoutGrid, GanttChart, Rows3 } from "lucide-react";
import type { PropertyType, ViewType } from "@/lib/databases/types";
import { cn } from "@/lib/utils";
export const TYPE_META: Record<PropertyType, { label: string; icon: React.ReactNode }> = {
  title: { label: "Title", icon: <Heading /> }, text: { label: "Text", icon: <Type /> }, number: { label: "Number", icon: <Hash /> }, date: { label: "Date", icon: <Calendar /> }, checkbox: { label: "Checkbox", icon: <CheckSquare /> },
  status: { label: "Status", icon: <CircleDot /> }, select: { label: "Select", icon: <ChevronDownCircle /> }, multi_select: { label: "Multi-select", icon: <List /> }, url: { label: "URL", icon: <Link2 /> }, file: { label: "Files", icon: <Paperclip /> },
  relation: { label: "Relation", icon: <ArrowRightLeft /> }, rollup: { label: "Rollup", icon: <Sigma /> }, formula: { label: "Formula", icon: <FunctionSquare /> }, created_time: { label: "Created time", icon: <Clock /> }, last_edited_time: { label: "Last edited", icon: <History /> }, ai: { label: "AI", icon: <Sparkles /> },
};
export const VIEW_META: Record<ViewType, { label: string; icon: React.ReactNode }> = { table: { label: "Table", icon: <Table2 /> }, board: { label: "Board", icon: <Kanban /> }, calendar: { label: "Calendar", icon: <CalendarDays /> }, gallery: { label: "Gallery", icon: <LayoutGrid /> }, timeline: { label: "Timeline", icon: <GanttChart /> }, list: { label: "List", icon: <Rows3 /> } };
export const TypeIcon = ({ type, className }: { type: PropertyType; className?: string }) => <span className={cn("inline-flex shrink-0 text-fg-faint [&_svg]:size-3.5", type === "ai" && "text-ai", className)}>{TYPE_META[type]?.icon}</span>;
export function Sel({ className, children, ...p }: React.SelectHTMLAttributes<HTMLSelectElement>) { return <select className={cn("h-8 max-w-full rounded-md border border-line bg-bg-elev px-2 text-[13px] outline-none focus:border-accent/50 max-md:h-11", className)} {...p}>{children}</select>; }
export const Field = ({ label, children, hint }: { label: string; children: React.ReactNode; hint?: string }) => <label className="block space-y-1"><span className="text-[12px] font-medium text-fg-muted">{label}</span>{children}{hint && <span className="block text-[11px] text-fg-faint">{hint}</span>}</label>;
/** Text input. 44 px tall on phones (callers that pass their own `h-*` keep it on desktop only). */
export const inputCls = "h-8 w-full rounded-md border border-line bg-bg-elev px-2 text-[13px] outline-none placeholder:text-fg-faint focus:border-accent/50 max-md:h-11";
