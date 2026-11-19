/**
 * Model creators (who MADE a model) — distinct from the route/provider (which API the call goes through).
 * A Claude model reached through OpenRouter has creator `anthropic` and route `openrouter`.
 *
 * Logos: only marks taken from the `simple-icons` npm package (collection licence CC0-1.0; the marks themselves remain trademarks of
 * their owners) are shipped, copied verbatim by `scripts/build-model-logos.ts` into `public/model-logos/<creator>.svg`. A creator that
 * simple-icons does not contain at the installed version uses the neutral `generic.svg` (own drawing, no trademark) and the UI shows its
 * `monogram` next to it. Provenance of every file: docs/next/MODEL-LOGOS.md. Machine-readable copy for the native apps:
 * `public/model-logos/registry.json` (generated — do not edit by hand).
 * Pure module (no DB, no Node API): shared by the server, the browser and the tests.
 */
export const LOGO_DIR = "/model-logos";
export const GENERIC_LOGO = `${LOGO_DIR}/generic.svg`;
export const SIMPLE_ICONS_VERSION = "16.38.0";

export interface Creator {
  id: string;
  /** Display name. */
  name: string;
  /** simple-icons slug the logo is copied from; null → generic.svg. */
  simpleIcon: string | null;
  /** Two-letter fallback shown with the generic mark. */
  monogram: string;
  /** Brand colour published by simple-icons (hex without #), informative only: the SVG itself is single-colour. */
  hex: string | null;
  /** Why there is no logo, when simpleIcon is null. */
  note?: string;
}

const NOT_IN_SI = `not in simple-icons ${SIMPLE_ICONS_VERSION}`;
export const CREATORS: Creator[] = [
  { id: "anthropic", name: "Anthropic", simpleIcon: "anthropic", monogram: "AN", hex: "191919" },
  { id: "openai", name: "OpenAI", simpleIcon: null, monogram: "OA", hex: null, note: NOT_IN_SI },
  { id: "google", name: "Google", simpleIcon: "google", monogram: "GO", hex: "4285F4" },
  { id: "meta", name: "Meta", simpleIcon: "meta", monogram: "ME", hex: "0467DF" },
  { id: "mistral", name: "Mistral AI", simpleIcon: "mistralai", monogram: "MI", hex: "FA520F" },
  { id: "qwen", name: "Qwen", simpleIcon: "qwen", monogram: "QW", hex: "6950EF" },
  { id: "alibaba", name: "Alibaba Cloud", simpleIcon: "alibabacloud", monogram: "AL", hex: "FF6A00" },
  { id: "deepseek", name: "DeepSeek", simpleIcon: "deepseek", monogram: "DS", hex: "5786FE" },
  { id: "xai", name: "xAI", simpleIcon: null, monogram: "XA", hex: null, note: `${NOT_IN_SI} (the "X" icon is the social network, not xAI)` },
  { id: "cohere", name: "Cohere", simpleIcon: null, monogram: "CO", hex: null, note: NOT_IN_SI },
  { id: "microsoft", name: "Microsoft", simpleIcon: null, monogram: "MS", hex: null, note: NOT_IN_SI },
  { id: "amazon", name: "Amazon", simpleIcon: null, monogram: "AM", hex: null, note: NOT_IN_SI },
  { id: "nvidia", name: "NVIDIA", simpleIcon: "nvidia", monogram: "NV", hex: "76B900" },
  { id: "perplexity", name: "Perplexity", simpleIcon: "perplexity", monogram: "PX", hex: "1FB8CD" },
  { id: "moonshot", name: "Moonshot AI", simpleIcon: "moonshotai", monogram: "MO", hex: null },
  { id: "baidu", name: "Baidu", simpleIcon: "baidu", monogram: "BA", hex: "2932E1" },
  { id: "bytedance", name: "ByteDance", simpleIcon: "bytedance", monogram: "BD", hex: "3C8CFF" },
  { id: "minimax", name: "MiniMax", simpleIcon: null, monogram: "MM", hex: null, note: "present in simple-icons but under a custom licence — not shipped" },
  { id: "zhipu", name: "Zhipu AI", simpleIcon: null, monogram: "ZP", hex: null, note: NOT_IN_SI },
  { id: "tencent", name: "Tencent", simpleIcon: null, monogram: "TE", hex: null, note: NOT_IN_SI },
  { id: "ai21", name: "AI21 Labs", simpleIcon: null, monogram: "A2", hex: null, note: NOT_IN_SI },
  { id: "nous", name: "Nous Research", simpleIcon: null, monogram: "NO", hex: null, note: NOT_IN_SI },
  { id: "ibm", name: "IBM", simpleIcon: null, monogram: "IB", hex: null, note: NOT_IN_SI },
  { id: "liquid", name: "Liquid AI", simpleIcon: null, monogram: "LI", hex: null, note: NOT_IN_SI },
  { id: "inception", name: "Inception", simpleIcon: null, monogram: "IN", hex: null, note: NOT_IN_SI },
  { id: "unknown", name: "Autre", simpleIcon: null, monogram: "AI", hex: null, note: "creator not recognised" },
];
/** Logos of ROUTES (API providers) that are not model creators — used by the provider badge only. */
export const ROUTE_LOGOS: { id: string; name: string; simpleIcon: string | null }[] = [
  { id: "openrouter", name: "OpenRouter", simpleIcon: "openrouter" },
  { id: "maclustr", name: "MacLustr", simpleIcon: null },
];

const BY_ID = new Map(CREATORS.map((c) => [c.id, c]));
export const logoOf = (c: Pick<Creator, "id" | "simpleIcon">) => (c.simpleIcon ? `${LOGO_DIR}/${c.id}.svg` : GENERIC_LOGO);
/** Registry entry for a creator id; an id that is not registered gets a neutral entry (generic logo, monogram from the id). */
export function creatorInfo(id: string | null | undefined): Creator & { logo: string } {
  const c = (id && BY_ID.get(id)) || null;
  if (c) return { ...c, logo: logoOf(c) };
  const raw = (id ?? "").trim();
  if (!raw) return { ...BY_ID.get("unknown")!, logo: GENERIC_LOGO };
  const name = raw.replace(/[-_]+/g, " ").replace(/\b\p{L}/gu, (x) => x.toUpperCase());
  return { id: raw, name, simpleIcon: null, monogram: raw.replace(/[^a-z0-9]/gi, "").slice(0, 2).toUpperCase() || "AI", hex: null, note: "creator without a registry entry", logo: GENERIC_LOGO };
}
export function routeLogo(providerId: string): string {
  const r = ROUTE_LOGOS.find((x) => x.id === providerId); if (r) return r.simpleIcon ? `${LOGO_DIR}/${r.id}.svg` : GENERIC_LOGO;
  return creatorInfo(providerId).logo;
}

// ---------- creator derivation
/** Vendor prefix (the part before "/" in ids such as `meta-llama/llama-4-70b`) → creator id. */
const VENDOR: Record<string, string> = {
  anthropic: "anthropic", openai: "openai", google: "google", "meta-llama": "meta", meta: "meta", facebook: "meta", mistralai: "mistral", mistral: "mistral",
  qwen: "qwen", alibaba: "alibaba", "alibaba-nlp": "alibaba", deepseek: "deepseek", "deepseek-ai": "deepseek", "x-ai": "xai", xai: "xai", cohere: "cohere", cohereforai: "cohere",
  microsoft: "microsoft", amazon: "amazon", nvidia: "nvidia", perplexity: "perplexity", moonshotai: "moonshot", moonshot: "moonshot", baidu: "baidu", bytedance: "bytedance",
  "bytedance-seed": "bytedance", minimax: "minimax", "z-ai": "zhipu", zhipuai: "zhipu", thudm: "zhipu", tencent: "tencent", ai21: "ai21", ai21labs: "ai21",
  nousresearch: "nous", ibm: "ibm", "ibm-granite": "ibm", liquid: "liquid", liquidai: "liquid", inception: "inception",
};
/** Re-packagers and hubs: their prefix says nothing about who made the weights, so the model name decides. */
const PACKAGERS = new Set(["mlx-community", "lmstudio-community", "bartowski", "unsloth", "thebloke", "huggingface", "hf", "ollama", "gguf", "local", "models"]);
/** Model-name patterns, tested on the last path segment, most specific first. */
const NAME_RULES: [RegExp, string][] = [
  [/^(claude)/, "anthropic"],
  [/^(gpt|chatgpt|o[1-9](-|$)|codex|text-embedding|whisper|dall-e|davinci|babbage|sora|tts-)/, "openai"],
  [/^(gemini|gemma|palm|learnlm|imagen|veo)/, "google"],
  [/^(llama|meta-llama|codellama)/, "meta"],
  [/^(mistral|mixtral|codestral|pixtral|ministral|magistral|devstral|voxtral|open-mistral|open-mixtral)/, "mistral"],
  [/^(qwen|qwq|qvq)/, "qwen"],
  [/^(deepseek)/, "deepseek"],
  [/^(grok)/, "xai"],
  [/^(command|c4ai|aya|embed-)/, "cohere"],
  [/^(phi-?\d|wizardlm|mai-)/, "microsoft"],
  [/^(nova-|titan-)/, "amazon"],
  [/^(nemotron)/, "nvidia"],
  [/^(sonar|pplx)/, "perplexity"],
  [/^(kimi|moonshot)/, "moonshot"],
  [/^(ernie)/, "baidu"],
  [/^(doubao|seed-|ui-tars)/, "bytedance"],
  [/^(minimax|abab)/, "minimax"],
  [/^(glm|chatglm|cogview)/, "zhipu"],
  [/^(hunyuan)/, "tencent"],
  [/^(jamba|j2-)/, "ai21"],
  [/^(hermes|nous-)/, "nous"],
  [/^(granite)/, "ibm"],
  [/^(lfm)/, "liquid"],
  [/^(mercury)/, "inception"],
];
const slug = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");

/**
 * Creator of a model from its id and the provider it is listed by.
 *  1. catalogue ids of OpenAI-compatible providers are namespaced `<provider>:<remote id>` — the namespace is removed first;
 *  2. a known vendor prefix wins (`anthropic/claude-…` → anthropic, `meta-llama/…` → meta);
 *  3. otherwise the model name decides (`mlx-community/Qwen3-30B-A3B-4bit` → qwen, `gpt-6-sol` → openai);
 *  4. an unknown vendor prefix that is not a re-packager is returned as its own slug (generic logo);
 *  5. the two native providers default to themselves; anything else is `unknown`.
 */
export function creatorOf(modelId: string, provider?: string | null): string {
  let id = (modelId ?? "").trim();
  if (provider && id.toLowerCase().startsWith(`${provider.toLowerCase()}:`)) id = id.slice(provider.length + 1);
  const parts = id.split("/").filter(Boolean);
  const vendor = parts.length > 1 ? parts[0].toLowerCase() : null;
  if (vendor && VENDOR[vendor]) return VENDOR[vendor];
  const base = (parts[parts.length - 1] ?? "").toLowerCase().replace(/^[~@]/, "");
  for (const [re, c] of NAME_RULES) if (re.test(base)) return c;
  if (vendor && !PACKAGERS.has(vendor)) return slug(vendor) || "unknown";
  if (provider === "openai" || provider === "anthropic") return provider;
  return "unknown";
}
