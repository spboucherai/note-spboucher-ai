/**
 * =============================================================================
 *                  SP BOUCHER | SOFTWARE & RESEARCH
 *             ARTIFICIAL INTELLIGENCE • FINANCE • ENGINEERING
 * =============================================================================
 *
 * Project          : Note SPBoucher AI
 * File             : src/components/database/dates.ts
 * Description      : date helpers of the calendar and timeline drags: move a
 *                    stored date value by whole days, or onto a given day,
 *                    keeping its shape (a plain `YYYY-MM-DD` stays plain; a
 *                    date-time keeps its time of day).
 * Module           : components
 * Repository       : https://git.spboucher.ai/note-spboucher-ai
 * Project Website  : https://note.spboucher.ai
 * Created          : 2026-11-19
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

import { dateOf } from "@/lib/databases/values";
export const isoDay = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const plain = (v: unknown) => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v);
/** The value moved by `days` (negative = earlier). Null when the value is not a date. */
export function shiftDate(v: unknown, days: number): string | null { const d = dateOf(v); if (!d) return null; const n = new Date(d); n.setDate(n.getDate() + days); return plain(v) ? isoDay(n) : n.toISOString(); }
/** The value moved onto `day` (YYYY-MM-DD); an empty value becomes that plain day. */
export function onDay(v: unknown, day: string): string { const d = dateOf(v); if (!d || plain(v)) return day; const [y, m, dd] = day.split("-").map(Number); const n = new Date(d); n.setFullYear(y, m - 1, dd); return n.toISOString(); }
export const dayDiff = (a: Date, b: Date) => Math.round((new Date(a.getFullYear(), a.getMonth(), a.getDate()).getTime() - new Date(b.getFullYear(), b.getMonth(), b.getDate()).getTime()) / 864e5);
