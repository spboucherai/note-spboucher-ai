/** Shared (server + client) types for the knowledge graph. Keep this file free of server imports. */
export type NodeKind = "page" | "database" | "research" | "row" | "attachment" | "tag";
export type EdgeKind = "link" | "relation" | "ai_suggested" | "attachment" | "tag";
export type EdgeStatus = "accepted" | "suggested";
export const NODE_KINDS: NodeKind[] = ["page", "database", "research", "row", "attachment", "tag"];
export const NODE_KIND_LABELS: Record<NodeKind, string> = { page: "Pages", database: "Databases", research: "Research", row: "Database rows", attachment: "Attachments", tag: "Tags" };

export interface GraphNode {
  id: string; kind: NodeKind; title: string; icon: string | null; section: string | null;
  updatedAt: string | null; databaseId: string | null; degree: number; in: number; out: number;
}
export interface GraphEdge {
  id: string; source: string; target: string; kind: EdgeKind; status: EdgeStatus;
  /** link: "link" | "ai" ; relation: property name ; ai_suggested: model id */
  sub: string | null; confidence: number | null; rationale: string | null;
}
export interface GraphFilters {
  types?: NodeKind[]; section?: string | null; since?: Date | null;
  /** restrict to the N-hop neighbourhood of a page */
  pageId?: string | null; depth?: number;
  hideOrphans?: boolean; suggestions?: boolean;
}
export interface GraphData { nodes: GraphNode[]; edges: GraphEdge[]; center?: string | null; stats: { pages: number; edges: number; suggested: number } }

export interface Suggestion {
  id: string; fromId: string; toId: string; status: string; confidence: number | null; rationale: string | null; model: string | null;
  createdAt: string; decidedAt: string | null; fromTitle: string; fromIcon: string | null; toTitle: string; toIcon: string | null;
}
export interface BacklinkRow { id: string; title: string; icon: string | null; type: string; section: string; updatedAt: string; incoming: number; outgoing: number; suggested: number }
export interface UnlinkedMention { fromId: string; fromTitle: string; fromIcon: string | null; toId: string; toTitle: string; toIcon: string | null; excerpt: string; key: string }
