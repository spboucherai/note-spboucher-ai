/**
 * =============================================================================
 *                  SP BOUCHER | SOFTWARE & RESEARCH
 *             ARTIFICIAL INTELLIGENCE • FINANCE • ENGINEERING
 * =============================================================================
 *
 * Project          : Note SPBoucher AI
 * File             : src/lib/net-defaults.ts
 * Module           : lib
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

/**
 * file: src/lib/net-defaults.ts
 * description: Outbound connections of the server processes (web, worker, scripts): one process-wide default, set on import.
 *
 *   Node connects with "happy eyeballs" (`autoSelectFamily`): each address of a host gets `autoSelectFamilyAttemptTimeout` to finish its
 *   TCP handshake before the next address is tried — 500 ms by default on Node 26 (250 ms on Node 20–22). On the cluster LAN the first
 *   SYN of a new outbound flow is regularly lost and retransmitted by the kernel after 1 s (then 2 s): the IPv4 attempt is abandoned at
 *   500 ms, the IPv6 address of the provider is unreachable from here (EHOSTUNREACH), so `fetch` fails with ETIMEDOUT half a second after
 *   it started. The provider SDKs call that "Request timed out." and repeat it twice on new connections that meet the same fate: an AI
 *   call routed to Anthropic or OpenAI failed in about 3 s although its own budget was 60–240 s.
 *
 *   Measured on M4M64c, 2026-11-19, one short streamed call per new connection to api.anthropic.com: with the default 6 of 10 calls
 *   failed after 511–534 ms; with 2 500 ms 12 of 12 succeeded (several in ~1.0 s and one in 3.1 s: one and two retransmissions).
 *   5 s covers two retransmissions (1 s + 2 s). The cost: when the first address of a host is really dead, the next one is tried after
 *   5 s instead of 0.5 s — irrelevant next to the budgets above. See docs/next/AI-LIVE-VERIFICATION.md §1.
 * author: Simon-Pierre Boucher — contact@spboucher.ai
 */
import net from "node:net";

export const CONNECT_ATTEMPT_MS = 5000;
/** Idempotent; never lowers a larger value chosen with `--network-family-autoselection-attempt-timeout`. Returns the value in force. */
export function applyNetDefaults(): number {
  if (typeof net.setDefaultAutoSelectFamilyAttemptTimeout !== "function") return 0; // Node < 18.18: no happy eyeballs, nothing to tune
  if (net.getDefaultAutoSelectFamilyAttemptTimeout() < CONNECT_ATTEMPT_MS) net.setDefaultAutoSelectFamilyAttemptTimeout(CONNECT_ATTEMPT_MS);
  return net.getDefaultAutoSelectFamilyAttemptTimeout();
}
applyNetDefaults();
