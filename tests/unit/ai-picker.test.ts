/**
 * =============================================================================
 *                  SP BOUCHER | SOFTWARE & RESEARCH
 *             ARTIFICIAL INTELLIGENCE • FINANCE • ENGINEERING
 * =============================================================================
 *
 * Project          : Note SPBoucher AI
 * File             : tests/unit/ai-picker.test.ts
 * Module           : tests
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
 * Model selector logic (SPEC §4.11): search, grouping by creator, ordering, labels, keyboard navigation — the pure functions behind
 * src/components/ai/ModelPicker.tsx. No database, no provider.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { groupModels, selectableIds, moveActive, matches, formatContext, formatPrice, capabilityChips, modelName, type PickerModel } from "../../src/lib/ai/picker";

const m = (o: Partial<PickerModel> & { id: string }): PickerModel => ({ displayName: null, provider: "openai", creator: "openai", creatorName: "OpenAI", logo: "/model-logos/generic.svg", monogram: "OA", route: "openai", routeLabel: "OpenAI API", context: null, priceIn: null, priceOut: null, capabilities: {}, available: true, unavailableReason: null, autoRoutable: true, ...o });
const MODELS: PickerModel[] = [
  m({ id: "gpt-6-sol", benchmark: { mean_score: 0.9 } }), m({ id: "gpt-5.4-mini", benchmark: { mean_score: 0.7 } }),
  m({ id: "claude-haiku-5-5", displayName: "Claude Haiku 5.5", provider: "anthropic", creator: "anthropic", creatorName: "Anthropic", logo: "/model-logos/anthropic.svg", route: "anthropic", routeLabel: "Anthropic API", context: 1_000_000, priceIn: 1, priceOut: 5, capabilities: { tools: true, vision: true, structuredOutput: true, reasoning: true } }),
  m({ id: "openrouter:anthropic/claude-sonnet-4.5", displayName: "Anthropic: Claude Sonnet 4.5", remoteId: "anthropic/claude-sonnet-4.5", provider: "openrouter", creator: "anthropic", creatorName: "Anthropic", route: "openrouter", routeLabel: "OpenRouter", available: false, unavailableReason: "no_key", autoRoutable: false }),
  m({ id: "maclustr:qwen3-30b", remoteId: "qwen3-30b", provider: "maclustr", creator: "qwen", creatorName: "Qwen", route: "maclustr", routeLabel: "MacLustr", autoRoutable: false }),
  m({ id: "text-embedding-3-small", category: "embedding" }),
];

test("picker: models are grouped by creator; unavailable ones are hidden unless asked; embeddings never appear", () => {
  const g = groupModels(MODELS);
  assert.deepEqual(g.map((x) => [x.creator, x.models.map((y) => y.id)]), [["anthropic", ["claude-haiku-5-5"]], ["openai", ["gpt-6-sol", "gpt-5.4-mini"]], ["qwen", ["maclustr:qwen3-30b"]]]);
  const all = groupModels(MODELS, "", { showUnavailable: true });
  assert.deepEqual(all.find((x) => x.creator === "anthropic")!.models.map((y) => [y.id, y.route]), [["claude-haiku-5-5", "anthropic"], ["openrouter:anthropic/claude-sonnet-4.5", "openrouter"]], "one creator, two API routes — available first");
  assert.ok(!all.some((x) => x.models.some((y) => y.category === "embedding")));
  assert.deepEqual(groupModels([m({ id: "b", benchmark: { mean_score: 0.2 } }), m({ id: "a", autoRoutable: false }), m({ id: "c", benchmark: { mean_score: 0.8 } })])[0].models.map((x) => x.id), ["c", "b", "a"], "benchmarked first, best score first");
});
test("picker: search matches name, id, creator and route, every word, without accents or case", () => {
  assert.deepEqual(groupModels(MODELS, "haiku").flatMap((g) => g.models.map((x) => x.id)), ["claude-haiku-5-5"]);
  assert.deepEqual(groupModels(MODELS, "ANTHROPIC openrouter", { showUnavailable: true }).flatMap((g) => g.models.map((x) => x.id)), ["openrouter:anthropic/claude-sonnet-4.5"]);
  assert.deepEqual(groupModels(MODELS, "maclustr").flatMap((g) => g.models.map((x) => x.id)), ["maclustr:qwen3-30b"]); assert.deepEqual(groupModels(MODELS, "zzz"), []);
  assert.ok(matches(MODELS[2], "  ")); assert.ok(matches(MODELS[2], "Claudé")); assert.ok(!matches(MODELS[0], "claude"));
});
test("picker: the selectable list starts with Auto, skips unavailable models, and keyboard navigation wraps", () => {
  const ids = selectableIds(groupModels(MODELS, "", { showUnavailable: true }));
  assert.deepEqual(ids, [null, "claude-haiku-5-5", "gpt-6-sol", "gpt-5.4-mini", "maclustr:qwen3-30b"], "the greyed OpenRouter model is not selectable");
  assert.deepEqual(selectableIds(groupModels(MODELS, "haiku"), "haiku"), ["claude-haiku-5-5"]); assert.deepEqual(selectableIds(groupModels(MODELS, "auto"), "auto"), [null]);
  const n = ids.length;
  assert.equal(moveActive(0, "ArrowDown", n), 1); assert.equal(moveActive(n - 1, "ArrowDown", n), 0); assert.equal(moveActive(0, "ArrowUp", n), n - 1); assert.equal(moveActive(-1, "ArrowDown", n), 0);
  assert.equal(moveActive(3, "Home", n), 0); assert.equal(moveActive(1, "End", n), n - 1); assert.equal(moveActive(0, "PageDown", 20), 8); assert.equal(moveActive(3, "PageUp", 20), 0); assert.equal(moveActive(9, "x", 4), 3); assert.equal(moveActive(0, "ArrowDown", 0), -1);
});
test("picker: labels — context, price per 1M tokens, capabilities, model name", () => {
  assert.deepEqual([formatContext(200_000), formatContext(1_000_000), formatContext(1_048_576), formatContext(128_000), formatContext(2_500_000), formatContext(8192), formatContext(512), formatContext(null), formatContext(0)], ["200K", "1M", "1M", "128K", "2.5M", "8K", "512", null, null]);
  assert.deepEqual([formatPrice(3, 15), formatPrice(0.075, 0.3), formatPrice(1.25, 10), formatPrice(0, 0), formatPrice(150, 600), formatPrice(null, 5), formatPrice(0.0605, 0.4)], ["$3 / $15", "$0.075 / $0.3", "$1.25 / $10", "free", "$150 / $600", null, "$0.0605 / $0.4"]);
  assert.deepEqual(capabilityChips(MODELS[2]), ["vision", "tools", "JSON", "reasoning"]); assert.deepEqual(capabilityChips(MODELS[0]), []);
  assert.equal(modelName(MODELS[2]), "Claude Haiku 5.5"); assert.equal(modelName(MODELS[4]), "qwen3-30b"); assert.equal(modelName(MODELS[0]), "gpt-6-sol");
});
