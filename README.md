# Note SPBoucher AI

Private, AI-native personal knowledge operating system — https://note.spboucher.ai (owner access only).

Pages with a block editor (Tiptap/ProseMirror JSON), Notion-style databases (6 views, relations, rollups, formulas, AI properties), hybrid search (pgvector + full-text) with grounded AI answers and citations, a knowledge graph with AI-suggested links, a research workspace (BibTeX/DOI, PDFs, experiments), controlled AI agents with approvals, a configurable dashboard, import/export (Markdown, Notion, DOCX, PDF, CSV, BibTeX, ZIP, JSON) and encrypted backups. Runs on the MacLustr cluster (M4M64c) behind the MacLustr Tunnel.

## Documentation
- `docs/architecture.md` — stack, topology, data model, performance budgets
- `docs/ai-provider-discovery.md`, `docs/openai-model-benchmarks.md`, `docs/anthropic-model-benchmarks.md`, `docs/ai-model-comparison.md` — Phase Zero (real measurements, reproducible with `pnpm bench:*`)
- `docs/ai-routing-strategy.md` — measured routing policy
- `docs/deployment.md`, `docs/operations.md`, `docs/security.md`, `docs/dev-conventions.md`

## Commands
```bash
pnpm install
cp .env.example .env            # fill secrets (never commit)
pnpm db:migrate && pnpm seed:ai # schema + AI model catalogue from benchmarks/results
pnpm bootstrap                  # interactive owner password (hash only)
pnpm dev                        # http://localhost:8480
pnpm worker                     # background jobs (indexing, imports, backups, agents)
pnpm build && pnpm start        # production
pnpm bench:discover && pnpm bench:run && pnpm bench:report && pnpm seed:ai   # re-run Phase Zero
bash scripts/smoke.sh           # post-deploy smoke test (NOTE_URL, NOTE_PASSWORD)
```
