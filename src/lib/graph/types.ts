/**
 * =============================================================================
 *                  SP BOUCHER | SOFTWARE & RESEARCH
 *             ARTIFICIAL INTELLIGENCE • FINANCE • ENGINEERING
 * =============================================================================
 *
 * Project          : Note SPBoucher AI
 * File             : src/lib/graph/types.ts
 * Module           : lib
 * Repository       : https://git.spboucher.ai/note-spboucher-ai
 * Project Website  : https://note.spboucher.ai
 * Created          : 2026-11-01
 * Last Modified    : 2026-11-17
 *
 * Author           : Simon-Pierre Boucher
 * Position         : Professor of Finance
 * Institution      : Université du Québec en Outaouais (UQO)
 * Organization     : SP Boucher
 * Website          : https://spboucher.ai
 * Git              : https://git.spboucher.ai
 *
 * Preferred Contact: contact@spboucher.ai
 * Development      : dev@spboucher.ai
 * Support          : support@spboucher.ai
 * Security/Admin   : admin@spboucher.ai
 *
 * Copyright (c) 2026
 * Simon-Pierre Boucher
 * All rights reserved where applicable. This file is governed by the
 * applicable project license, copyright notices and relevant law.
 * Existing third-party rights and notices remain unaffected.
 *
 * License          : None specified (no license file in this repository)
 *
 * Do not embed credentials, private keys, access tokens,
 * certificates or confidential personal information.
 *
 * =============================================================================
 * END OF SP BOUCHER SOURCE HEADER
 * =============================================================================
 */

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
  /** Model that proposed the edge (AI suggestions, and accepted AI links mirrored as real links). Provenance: never dropped. */
  model?: string | null;
}
export interface GraphFilters {
  types?: NodeKind[]; section?: string | null; since?: Date | null;
  /** restrict to the N-hop neighbourhood of a page */
  pageId?: string | null; depth?: number;
  hideOrphans?: boolean; suggestions?: boolean;
}
export interface GraphData { nodes: GraphNode[]; edges: GraphEdge[]; center?: string | null; stats: { pages: number; edges: number; suggested: number } }

/**
 * AI suggestions below this confidence (or without a recorded confidence) are collapsed under "Low confidence" in the
 * review UI instead of being presented like the others.
 */
export const LOW_CONFIDENCE_THRESHOLD = 0.6;
export type SuggestionStatus = "suggested" | "accepted" | "rejected";

export interface Suggestion {
  id: string; fromId: string; toId: string; status: string; confidence: number | null; rationale: string | null; model: string | null;
  createdAt: string; decidedAt: string | null; fromTitle: string; fromIcon: string | null; toTitle: string; toIcon: string | null;
}
export interface BacklinkRow { id: string; title: string; icon: string | null; type: string; section: string; updatedAt: string; incoming: number; outgoing: number; suggested: number }
export interface UnlinkedMention { fromId: string; fromTitle: string; fromIcon: string | null; toId: string; toTitle: string; toIcon: string | null; excerpt: string; key: string }
