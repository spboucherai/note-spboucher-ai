/** Shared (server + client) dashboard layout types and defaults. */
export const WIDGET_TYPES = ["quick_capture", "recent_pages", "pinned", "tasks_due", "active_projects", "research_activity", "recently_modified", "ai_summary", "graph_highlights", "ai_chat", "usage"] as const;
export type WidgetType = (typeof WIDGET_TYPES)[number];
export type WidgetSize = "half" | "wide" | "third";
export type Widget = { id: string; type: WidgetType; size: WidgetSize; config?: Record<string, unknown> };
export const DEFAULT_WIDGETS: Widget[] = [
  { id: "w-capture", type: "quick_capture", size: "half" },
  { id: "w-tasks", type: "tasks_due", size: "half" },
  { id: "w-recent", type: "recent_pages", size: "third" },
  { id: "w-pinned", type: "pinned", size: "third" },
  { id: "w-projects", type: "active_projects", size: "third" },
  { id: "w-summary", type: "ai_summary", size: "half" },
  { id: "w-research", type: "research_activity", size: "half" },
  { id: "w-graph", type: "graph_highlights", size: "third" },
  { id: "w-usage", type: "usage", size: "third" },
  { id: "w-modified", type: "recently_modified", size: "third" },
];
export const WIDGET_META: Record<WidgetType, { label: string; description: string; defaultSize: WidgetSize }> = {
  quick_capture: { label: "Quick capture", description: "Jot a note into My Notes, or ask the AI instead.", defaultSize: "half" },
  recent_pages: { label: "Recent pages", description: "Pages you opened or edited last.", defaultSize: "third" },
  pinned: { label: "Pinned", description: "Your pinned pages.", defaultSize: "third" },
  tasks_due: { label: "Tasks due", description: "Overdue and next 7 days, check off inline.", defaultSize: "half" },
  active_projects: { label: "Active projects", description: "Projects and research in progress.", defaultSize: "third" },
  research_activity: { label: "Research activity", description: "Recent research pages, experiments and references.", defaultSize: "half" },
  recently_modified: { label: "Recently modified", description: "Last edited pages.", defaultSize: "third" },
  ai_summary: { label: "AI weekly summary", description: "Summarize what you worked on this week.", defaultSize: "half" },
  graph_highlights: { label: "Graph highlights", description: "Most connected pages and pending link suggestions.", defaultSize: "third" },
  ai_chat: { label: "AI chat", description: "An embedded assistant conversation.", defaultSize: "half" },
  usage: { label: "AI usage", description: "Today's AI spend and calls.", defaultSize: "third" },
};
