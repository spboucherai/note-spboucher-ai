/**
 * File: src/lib/meta.ts
 * Description: API level and feature flags announced by GET /api/meta (SPEC §1). A feature is listed only when its routes are
 *   implemented and tested in this build; each workstream appends its own flags to FEATURES when it merges.
 * Author: Simon-Pierre Boucher · contact@spboucher.ai
 */
export const API_LEVEL = 3;
/** Backend foundation (this workstream). AI-WORKSTREAM flags (ask-scope, models-v2, inbox-suggestions, transcription, research-export, zoom-synopsis) are appended by `next-ai`. */
export const FEATURES = [
  "entities", // GET /api/sync?kinds=
  "tasks-v2", // client ids, block anchor, PATCH/DELETE /api/tasks/<id>
  "events", // GET /api/events
  "timemachine", // GET /api/timemachine
  "graph-v2", // typed relations, graph views, concepts
  "insights", // GET /api/graph/insights (deterministic) + POST …/run (AI job)
  "canvas", // GET/PUT /api/canvases/<pageId>
  "health", // GET /api/health/knowledge
  "brief", // GET /api/brief
  "query", // POST /api/query
  "zoom", // GET /api/pages/<id>/zoom?level=2|3
  "nodes-v3", // 3.0 document nodes understood by export, search and validation
  "files-range", // Range on /api/files/<id>
  "zoom-synopsis", // GET /api/pages/<id>/zoom?level=1 (AI, cached, marked)
  "ask-scope", // POST /api/ai/chat scope all|page|project|selection, verified block citations
  "actions-v2", // coherence, questions, links, synthesis, structure
  "models-v2", // GET /api/ai/models with creator, route, logo, availability
  "inbox-suggestions", // GET /api/inbox/<id>/suggestions, POST …/apply
  "transcription", // POST /api/audio/<attachmentId>/transcribe
  "research-export", // GET /api/research/export.tex
  "smart-properties", // database AI property config + runs
  "constellation", // GET /api/graph/constellation (2-D projection of the page embeddings)
] as const;
/** "3.0.0" for a 3.x build; a scratch build keeps its suffix ("3.0.0-dev"). */
export const serverVersion = () => { const v = process.env.APP_VERSION ?? ""; return /^3\./.test(v) ? v : `3.0.0${v.includes("-") ? v.slice(v.indexOf("-")) : ""}`; };
