# Note Visual System 2.0 — « Graphite & Ultramarine · Lumen »

Web implementation: `src/app/globals.css` (tokens, chrome, editor, blocks) + `src/lib/client/motion.ts` (motion layer).
Shared contract: `SPEC.md` §5. Native counterpart: module `SPNotesDesign` in SPNotesCore.
Every token name of 1.x / 2.x still works; 2.0 only adds.

## 1. Colour

The web sources of truth are the **oklch** values in `:root` / `.dark`. The table gives their **measured sRGB conversion**
(`node scripts/contrast.mjs`, out-of-gamut channels clipped as browsers do; the same values are read back from a browser canvas in `tests/e2e/next-web.spec.ts`, tolerance 2/255).
**They differ from the approximations of SPEC §5 by more than a rounding error** (column Δ = largest channel difference, 0–255):
the SPEC values are bluer/lighter in the dark neutrals and more violet in the accent. Native teams should use the *measured* columns
to be pixel-aligned with the web.

| CSS token | Swift name | light (measured) | light (SPEC) | Δ | dark (measured) | dark (SPEC) | Δ |
|---|---|---|---|---|---|---|---|
| `--bg` | `bg` | `#F9FBFD` | #F9FAFC | 1 | `#0D1016` | #12141C | 6 |
| `--bg-elev` | `bgElevated` | `#FFFFFF` | #FFFFFF | 0 | `#15181F` | #1A1D27 | 8 |
| `--bg-sunk` | `bgSunken` | `#F0F3F6` | #F1F3F7 | 1 | `#080A0F` | #0D0F15 | 6 |
| `--bg-side` | `bgSidebar` | `#F3F6F9` | #F4F6F9 | 1 | `#0A0C12` | #0F1118 | 6 |
| `--bg-hover` | `bgHover` | `#EAEDF2` | #EBEEF4 | 2 | `#1D2028` | #222633 | 11 |
| `--fg` | `fg` | `#151922` | #161A26 | 4 | `#E8EBEF` | #EBEEF4 | 5 |
| `--fg-muted` | `fgMuted` | `#535862` | #535B6E | 12 | `#A0A5AE` | #A6AEC0 | 18 |
| `--fg-faint` | `fgFaint` | `#848992` | #8A91A3 | 17 | `#6A6F77` | #707889 | 18 |
| `--line` | `line` | `#E1E4E8` | #E3E6EC | 4 | `#22252D` | #262A36 | 9 |
| `--line-strong` | `lineStrong` | `#CCD0D5` | #CFD4DE | 9 | `#333640` | #363B4A | 10 |
| `--accent` | `accent` | `#2F5DDB` | #3157D5 | 6 | `#7CA5FF` | #8AA2FF | 14 |
| `--accent-fg` | `accentFg` | `#FBFCFE` | #FBFCFF | 1 | `#090F1C` | #0B1230 | 20 |
| `--accent-soft` | `accentSoft` | `#E5F0FF` | #E9EEFF | 4 | `#1B2A4C` | #1F2C5C | 16 |
| `--ai` | `ai` | `#7E41D2` | #7A3FD6 | 4 | `#B999FB` | #B699FF | 4 |
| `--ai-soft` | `aiSoft` | `#F3ECFF` | #F1EAFF | 2 | `#302249` | #33205E | 21 |
| `--success` | `success` | `#008B4E` | #2E8B57 | 46 | `#5BC083` | #6CCB93 | 17 |
| `--warning` | `warning` | `#D98B09` | #C98A1A | 17 | `#F2AF48` | #F0BC5E | 22 |
| `--danger` | `danger` | `#CC272E` | #D14343 | 28 | `#F26A64` | #F08A80 | 32 |

Also: `--focus` (= accent, solid focus ring), `--ring` (accent at 35–40 % alpha, halos only), `--glass` (surface at 66–68 % alpha),
`--glass-line` (hairline of glass surfaces), `--lumen`, `--lumen-soft`. Tailwind utilities: `bg-bg`, `text-fg-muted`,
`border-line`, `bg-accent-soft`, `text-ai`, `outline-focus`, `bg-glass`…

### Contrast (WCAG 2.2), both themes — `pnpm contrast` (exit code 1 on a failure; also a unit test)

| theme | pair | sRGB | ratio | required | use |
|---|---|---|---|---|---|
| light | fg on bg | #151922 / #F9FBFD | **16.89** | ≥ 4.5 | body text |
| light | fg on bg-elev | #151922 / #FFFFFF | **17.53** | ≥ 4.5 | text on cards |
| light | fg on bg-sunk | #151922 / #F0F3F6 | **15.75** | ≥ 4.5 | text on sunken surfaces |
| light | fg on bg-side | #151922 / #F3F6F9 | **16.17** | ≥ 4.5 | sidebar text (active) |
| light | fg on bg-hover | #151922 / #EAEDF2 | **14.97** | ≥ 4.5 | hovered row |
| light | fg-muted on bg | #535862 / #F9FBFD | **6.87** | ≥ 4.5 | secondary text |
| light | fg-muted on bg-elev | #535862 / #FFFFFF | **7.13** | ≥ 4.5 | secondary text on cards |
| light | fg-muted on bg-side | #535862 / #F3F6F9 | **6.57** | ≥ 4.5 | sidebar items |
| light | fg-muted on bg-sunk | #535862 / #F0F3F6 | **6.4** | ≥ 4.5 | secondary text on sunken |
| light | fg-muted on bg-hover | #535862 / #EAEDF2 | **6.09** | ≥ 4.5 | secondary text on hover |
| light | fg-faint on bg | #848992 / #F9FBFD | **3.37** | ≥ 3 | placeholders / decorative labels (large or non-essential: AA 3:1) |
| light | fg-faint on bg-side | #848992 / #F3F6F9 | **3.23** | ≥ 3 | sidebar section labels |
| light | accent on bg | #2F5DDB / #F9FBFD | **5.44** | ≥ 4.5 | links |
| light | accent on bg-elev | #2F5DDB / #FFFFFF | **5.65** | ≥ 4.5 | links on cards |
| light | accent on accent-soft | #2F5DDB / #E5F0FF | **4.91** | ≥ 4.5 | accent text on its soft chip |
| light | accent-fg on accent | #FBFCFE / #2F5DDB | **5.49** | ≥ 4.5 | primary button label |
| light | ai on bg | #7E41D2 / #F9FBFD | **5.64** | ≥ 4.5 | AI text |
| light | ai on ai-soft | #7E41D2 / #F3ECFF | **5.07** | ≥ 4.5 | AI text on its soft surface |
| light | ai on bg-elev | #7E41D2 / #FFFFFF | **5.85** | ≥ 4.5 | AI text on cards |
| light | danger on bg | #CC272E / #F9FBFD | **5.18** | ≥ 4.5 | error text |
| light | success on bg | #008B4E / #F9FBFD | **4.19** | ≥ 3 | success icons / large text |
| light | warning on bg | #D98B09 / #F9FBFD | **2.65** | info | warning hue — informational: paired with a text label in fg, never used alone as text |
| light | focus on bg | #2F5DDB / #F9FBFD | **5.44** | ≥ 3 | focus ring (non-text: 3:1) |
| light | focus on bg-elev | #2F5DDB / #FFFFFF | **5.65** | ≥ 3 | focus ring on cards |
| light | focus on bg-side | #2F5DDB / #F3F6F9 | **5.21** | ≥ 3 | focus ring in the sidebar |
| light | line-strong on bg | #CCD0D5 / #F9FBFD | **1.5** | info | decorative separators — informational |
| dark | fg on bg | #E8EBEF / #0D1016 | **16** | ≥ 4.5 | body text |
| dark | fg on bg-elev | #E8EBEF / #15181F | **14.87** | ≥ 4.5 | text on cards |
| dark | fg on bg-sunk | #E8EBEF / #080A0F | **16.59** | ≥ 4.5 | text on sunken surfaces |
| dark | fg on bg-side | #E8EBEF / #0A0C12 | **16.38** | ≥ 4.5 | sidebar text (active) |
| dark | fg on bg-hover | #E8EBEF / #1D2028 | **13.62** | ≥ 4.5 | hovered row |
| dark | fg-muted on bg | #A0A5AE / #0D1016 | **7.69** | ≥ 4.5 | secondary text |
| dark | fg-muted on bg-elev | #A0A5AE / #15181F | **7.15** | ≥ 4.5 | secondary text on cards |
| dark | fg-muted on bg-side | #A0A5AE / #0A0C12 | **7.87** | ≥ 4.5 | sidebar items |
| dark | fg-muted on bg-sunk | #A0A5AE / #080A0F | **7.97** | ≥ 4.5 | secondary text on sunken |
| dark | fg-muted on bg-hover | #A0A5AE / #1D2028 | **6.55** | ≥ 4.5 | secondary text on hover |
| dark | fg-faint on bg | #6A6F77 / #0D1016 | **3.77** | ≥ 3 | placeholders / decorative labels (large or non-essential: AA 3:1) |
| dark | fg-faint on bg-side | #6A6F77 / #0A0C12 | **3.86** | ≥ 3 | sidebar section labels |
| dark | accent on bg | #7CA5FF / #0D1016 | **7.86** | ≥ 4.5 | links |
| dark | accent on bg-elev | #7CA5FF / #15181F | **7.31** | ≥ 4.5 | links on cards |
| dark | accent on accent-soft | #7CA5FF / #1B2A4C | **5.86** | ≥ 4.5 | accent text on its soft chip |
| dark | accent-fg on accent | #090F1C / #7CA5FF | **7.89** | ≥ 4.5 | primary button label |
| dark | ai on bg | #B999FB / #0D1016 | **8.19** | ≥ 4.5 | AI text |
| dark | ai on ai-soft | #B999FB / #302249 | **6.2** | ≥ 4.5 | AI text on its soft surface |
| dark | ai on bg-elev | #B999FB / #15181F | **7.62** | ≥ 4.5 | AI text on cards |
| dark | danger on bg | #F26A64 / #0D1016 | **6.37** | ≥ 4.5 | error text |
| dark | success on bg | #5BC083 / #0D1016 | **8.42** | ≥ 3 | success icons / large text |
| dark | warning on bg | #F2AF48 / #0D1016 | **10.02** | info | warning hue — informational: paired with a text label in fg, never used alone as text |
| dark | focus on bg | #7CA5FF / #0D1016 | **7.86** | ≥ 3 | focus ring (non-text: 3:1) |
| dark | focus on bg-elev | #7CA5FF / #15181F | **7.31** | ≥ 3 | focus ring on cards |
| dark | focus on bg-side | #7CA5FF / #0A0C12 | **8.05** | ≥ 3 | focus ring in the sidebar |
| dark | line-strong on bg | #333640 / #0D1016 | **1.59** | info | decorative separators — informational |

`fg-faint` is for placeholders, section labels and decorative text only (≥ 3:1, not AA body text). The `warning` hue is never used
alone as text. Under `prefers-contrast: more`, muted text becomes `fg`, hairlines become `line-strong`, glass becomes opaque and the
focus ring is 3 px. Under `forced-colors` the ring uses the system `Highlight` colour.

## 2. Signature gradient « Lumen »

`--lumen: linear-gradient(135deg, var(--accent), var(--ai))`. Utilities `bg-lumen`, `text-lumen`; classes `.lumen-hairline`
(1 px gradient rule under a header — command center), `.lumen-dot` (save indicator), `.lumen-pulse` (capture), `--lumen-soft`
(tinted surface: canvas card). Use it for hero surfaces, the capture pulse, graph links and the AI shimmer — never as a text background.

## 3. Typography (self-hosted, CSP `font-src 'self'`)

| Role | Web | Apple | Token |
|---|---|---|---|
| UI | Inter Variable (`@fontsource-variable/inter`, roman + italic) | SF Pro | `--font-sans` / `font-sans` |
| Reading titles, quotes, optional body | Source Serif 4 Variable (roman + italic, optical size auto) | New York (`Font.Design.serif`) | `--font-serif` / `font-serif`, class `.page-title` |
| Code | JetBrains Mono Variable (ligatures off) | SF Mono | `--font-mono` / `font-mono` |

Scale (px): micro 11 (`text-micro`), ui 13 (`text-ui`), body 16 (`text-body`; 17 on phones in the editor), h3 20, h2 24, h1 30,
display 40. Reading measure `--measure: 46rem` (`.measure`). Page titles are serif 600 with −0.018 em tracking.
Fonts are split by unicode-range: only the scripts on screen are downloaded.

## 4. Spacing, radius, elevation

| Scale | Tokens |
|---|---|
| Spacing (px) | `--space-1…9` = 2, 4, 8, 12, 16, 24, 32, 48, 64 (Tailwind `0.5, 1, 2, 3, 4, 6, 8, 12, 16`) |
| Radius (px) | `--r-xs` 4, `--r-sm` 6, `--r-md` 10, `--r-lg` 14, `--r-xl` 20, `--r-pill` 999 → semantic utilities `rounded-chip` (xs), `rounded-control` (sm), `rounded-pop` (md), `rounded-card` (lg), `rounded-sheet` (xl), `rounded-pill`. Tailwind's own `rounded-*` scale is unchanged. |
| Elevation | **card** `shadow-card` (hairline + 1 px shadow) · **pop** `shadow-pop` (16/40 blur) · **glass** utility `glass` / class `.chrome-glass` (backdrop blur 20 px, surface 66–68 %, hairline `--glass-line`); opaque fallback without `backdrop-filter`, under `prefers-reduced-transparency` and `prefers-contrast: more`. |
| Density | `html[data-density="compact"]` sets `--density: .72` (block spacing, sidebar rows 24 px, tighter headings). |

Component classes: `.surface-card`, `.surface-pop`, `.icon-btn` (32 px), `.kbd-hint`, `.side-item`, `.side-section`,
`.ai-surface`, `.ai-mark`, `.ai-shimmer`, `.resize-handle`.

## 5. Motion

Tokens (CSS custom properties and `DUR` / `EASE` in `motion.ts`): instant 90 ms, fast 160 ms, base 240 ms, slow 420 ms, ambient
900 ms; easing standard `cubic-bezier(.2,.8,.2,1)`, exit `cubic-bezier(.4,0,1,1)`, spring (response .38, damping .82) as a
`linear()` curve over 620 ms (`--ease-spring`). Utilities `duration-instant|fast|base|slow`, `ease-standard|exit|spring`.
Rules: only `opacity`, `transform`, `filter` are animated (compositor only); layout is read at most once per motion and never
while typing; ProseMirror nodes are animated with the Web Animations API or decorations (it strips foreign classes).

| # | Motion | Web implementation | Duration / easing | Reduce Motion |
|---|---|---|---|---|
| 1 | Living Pages | `revealBlocks()` on page open: the first 24 blocks rise 6 px + fade, 18 ms stagger (WAAPI on the block elements) | 240 ms, standard | one 120 ms cross-fade of the editor |
| 2 | Morphing Editor | `ContextBar`: tools follow the block type (table, code, callout, image, task); new content `.morph-in`, width tween `morphWidth()` | 160 ms, standard | 120 ms fade, no width tween |
| 3 | Knowledge Connections | **not in this wave** (graph 2.0 screens are built later on these tokens) | — | — |
| 4 | Fluid Navigation | `navigateWithTitle()`: View Transitions API, shared element `page-title` (sidebar row → page title); plain navigation where the API is missing | 240 ms group, 160 ms root | 120 ms cross-fade, shared element cancelled |
| 5 | Intelligent Panels | `.panel-in-right|left|bottom`: 18 px slide + 6 px blur → sharp (AI panel, right panel host, phone assistant) | 240 ms, standard | 120 ms fade |
| 6 | Quick Capture | sheet `.scale-in` (from .96); `lumenPulse()` gradient disc on save | 160 ms in; pulse 580 ms | fade; static 240 ms glow, no scale |
| 7 | Semantic Zoom | `semanticZoom()`: cross-dissolve around the level change, scroll anchor = first visible `[data-id]` block; used by the outline zoom (level 2 ↔ 3) | 80 ms out + 160 ms in | 60 ms out + 120 ms in |

Other classes: `.fade-up` (popovers, menus), `.sheet` (bottom sheets), `.drawer` (phone drawer slide-in — the class had no rule
before), `animate-in` (overlay fade — the utility did not exist before).

## 6. Shell

- **Sidebar**: collapsible sections (Pinned, Databases, Workspace, Intelligence; state in `localStorage["note-tree-open"]`), ⌥-click or
  "Open to the side" on a page row.
- **Right panel host** (`RightPanel.tsx`, ≥ 1024 px): resizable (pointer + ←/→ on the separator), tabs = registered panels.
  Register a panel: `registerPanel({ id, title, icon, available?, tone?, render })` from `src/lib/client/panels.ts`, open it with
  `useUI().openPanel(id, arg)`. Shipped: `outline`, `page` (second editable page with its own autosave).
- **Universal Command Center** (⌘K, phone: header button): `registerCommands([{ id, title, group, keywords?, shortcut?, icon?, when?, priority?, run }])`
  from `src/lib/client/commands.ts` (returns the unregister function — call it from an effect). Ranking: `fuzzyRank`; recents are device-local.

## 7. Do / Don't

- Do use the semantic radii and the type tokens in chrome; don't add new arbitrary `text-[13px]` / `rounded-[…]` where a token exists.
- Do keep violet (`--ai`) for model output only, always with a label ("AI", `.ai-mark`); don't use it for decoration.
- Do animate through `motion.ts` or the motion classes; don't animate `width/height/top/left` of document content, and never add a class to a ProseMirror node.
- Do keep wide content scrolling inside its block (`.nb-scroll`); don't let a block widen the page (phones: one scroll container, `--kb` inset).
- Don't put text on the Lumen gradient or use glass under long-form text; glass is for chrome that floats over content.
- Don't remove or rename a token: the native apps mirror these names.
