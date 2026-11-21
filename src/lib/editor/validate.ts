/**
 * =============================================================================
 *                  SP BOUCHER | SOFTWARE & RESEARCH
 *             ARTIFICIAL INTELLIGENCE • FINANCE • ENGINEERING
 * =============================================================================
 *
 * Project          : Note SPBoucher AI
 * File             : src/lib/editor/validate.ts
 * Module           : lib
 * Repository       : https://git.spboucher.ai/note-spboucher-ai
 * Project Website  : https://note.spboucher.ai
 * Created          : 2026-11-17
 * Last Modified    : 2026-11-19
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

import { HttpError } from "@/lib/errors";
import { nextNodeProblem } from "./next-nodes";
/**
 * Server-side sanity check of an editor document before it is stored: it must be a ProseMirror `doc`, bounded in size and depth, and every
 * node must have a string type. (Rendering is done by Tiptap from JSON — never as HTML — so this is about integrity, not sanitising markup.)
 */
const MAX_BYTES = 8 * 1024 * 1024, MAX_DEPTH = 60, MAX_NODES = 200_000;
export function assertDoc(doc: unknown): void {
  if (!doc || typeof doc !== "object" || (doc as any).type !== "doc" || !Array.isArray((doc as any).content ?? [])) throw new HttpError(400, "Invalid document", "bad_document");
  let nodes = 0;
  const walk = (n: any, depth: number) => {
    if (++nodes > MAX_NODES) throw new HttpError(413, "Document has too many blocks", "bad_document");
    if (depth > MAX_DEPTH) throw new HttpError(400, "Document is nested too deeply", "bad_document");
    if (!n || typeof n !== "object" || typeof n.type !== "string" || n.type.length > 64) throw new HttpError(400, "Invalid document node", "bad_document");
    if (n.text !== undefined && typeof n.text !== "string") throw new HttpError(400, "Invalid text node", "bad_document");
    if (n.content !== undefined) { if (!Array.isArray(n.content)) throw new HttpError(400, "Invalid document node", "bad_document"); for (const c of n.content) walk(c, depth + 1); }
    if (n.marks !== undefined && (!Array.isArray(n.marks) || n.marks.some((m: any) => !m || typeof m.type !== "string"))) throw new HttpError(400, "Invalid marks", "bad_document");
    // 3.0 nodes: bounded attrs (rows, annotations, transcript, attachment-id shape). Unknown node types and unknown attrs stay accepted.
    const problem = nextNodeProblem(n); if (problem) throw new HttpError(400, `Invalid document: ${problem}`, "bad_document");
    // javascript: and data: URLs are never valid link or media targets
    const href = n.attrs?.href ?? n.attrs?.src; if (typeof href === "string" && /^\s*(javascript|vbscript|data:text\/html)/i.test(href)) throw new HttpError(400, "Unsafe URL in document", "bad_document");
    for (const m of n.marks ?? []) { const h = m.attrs?.href; if (typeof h === "string" && /^\s*(javascript|vbscript|data:text\/html)/i.test(h)) throw new HttpError(400, "Unsafe URL in document", "bad_document"); }
  };
  walk(doc, 0);
  if (JSON.stringify(doc).length > MAX_BYTES) throw new HttpError(413, "Document is too large (8 MB max)", "bad_document");
}
