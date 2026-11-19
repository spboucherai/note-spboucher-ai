# Model logos — provenance

Scope: the logos shown by the model selector (`src/components/ai/ModelPicker.tsx`) and returned by `GET /api/ai/models` (`logo`,
`routeLogo`). Files live in `public/model-logos/`; the registry is `src/lib/ai/creators.ts`; the machine-readable copy for the native
apps is `public/model-logos/registry.json` (served at `/model-logos/registry.json`).

## Rule

Only two kinds of file are shipped:

1. **Marks copied byte for byte from the `simple-icons` npm package**, version **16.38.0** (devDependency). The
   collection is published under **CC0-1.0**; the marks themselves remain trademarks of their owners and are used here only to identify
   who made a model. An icon that carries its own licence entry in simple-icons (not plain CC0) is **not** shipped (currently: MiniMax).
2. **`generic.svg`** — a neutral hexagon-and-spark mark drawn for this project (own work, CC0-1.0, no resemblance to any brand).

A creator that simple-icons does not contain at the installed version (OpenAI, xAI, Cohere, Microsoft, Amazon, …) uses `generic.svg`;
the UI then shows the creator's two-letter `monogram` in a neutral tile. **No trademark is redrawn from memory.** When a later
simple-icons release adds or removes a brand, nothing changes until the registry is regenerated on purpose.

All SVGs are single-colour, `viewBox="0 0 24 24"`, without a `fill` attribute: render them as **template images** (Apple: asset catalogue
"Template Image" / `.renderingMode(.template)`) or **CSS masks** tinted with the text colour, so they follow light and dark themes.
`hex` in the registry is the brand colour published by simple-icons, for information only.

## Regenerating

```bash
pnpm up -D simple-icons                      # optional: move to a newer release
# edit SIMPLE_ICONS_VERSION and the `simpleIcon` slugs in src/lib/ai/creators.ts, then:
node_modules/.bin/tsx scripts/build-model-logos.ts
pnpm test                                    # tests/unit/ai-providers.test.ts checks every file against the package, byte for byte
```

The script refuses a slug that is missing from the installed package or that carries a non-CC0 licence entry, and removes SVG files
that no registry entry references.

## Files (generated from `registry.json`)

| id | kind | name | file | source | licence | brand source recorded by simple-icons | note |
|---|---|---|---|---|---|---|---|
| `anthropic` | creator | Anthropic | `anthropic.svg` | simple-icons@16.38.0:anthropic | CC0-1.0 (simple-icons collection); trademark of its owner | https://www.anthropic.com |  |
| `openai` | creator | OpenAI | `generic.svg` | generic | own work, CC0-1.0 | — | not in simple-icons 16.38.0 |
| `google` | creator | Google | `google.svg` | simple-icons@16.38.0:google | CC0-1.0 (simple-icons collection); trademark of its owner | https://partnermarketinghub.withgoogle.com |  |
| `meta` | creator | Meta | `meta.svg` | simple-icons@16.38.0:meta | CC0-1.0 (simple-icons collection); trademark of its owner | https://www.meta.com |  |
| `mistral` | creator | Mistral AI | `mistral.svg` | simple-icons@16.38.0:mistralai | CC0-1.0 (simple-icons collection); trademark of its owner | https://chat.mistral.ai |  |
| `qwen` | creator | Qwen | `qwen.svg` | simple-icons@16.38.0:qwen | CC0-1.0 (simple-icons collection); trademark of its owner | https://qwen.ai |  |
| `alibaba` | creator | Alibaba Cloud | `alibaba.svg` | simple-icons@16.38.0:alibabacloud | CC0-1.0 (simple-icons collection); trademark of its owner | https://www.alibabagroup.com/en/ir/reports |  |
| `deepseek` | creator | DeepSeek | `deepseek.svg` | simple-icons@16.38.0:deepseek | CC0-1.0 (simple-icons collection); trademark of its owner | https://www.deepseek.com |  |
| `xai` | creator | xAI | `generic.svg` | generic | own work, CC0-1.0 | — | not in simple-icons 16.38.0 (the "X" icon is the social network, not xAI) |
| `cohere` | creator | Cohere | `generic.svg` | generic | own work, CC0-1.0 | — | not in simple-icons 16.38.0 |
| `microsoft` | creator | Microsoft | `generic.svg` | generic | own work, CC0-1.0 | — | not in simple-icons 16.38.0 |
| `amazon` | creator | Amazon | `generic.svg` | generic | own work, CC0-1.0 | — | not in simple-icons 16.38.0 |
| `nvidia` | creator | NVIDIA | `nvidia.svg` | simple-icons@16.38.0:nvidia | CC0-1.0 (simple-icons collection); trademark of its owner | https://www.nvidia.com/en-us |  |
| `perplexity` | creator | Perplexity | `perplexity.svg` | simple-icons@16.38.0:perplexity | CC0-1.0 (simple-icons collection); trademark of its owner | https://www.perplexity.ai |  |
| `moonshot` | creator | Moonshot AI | `moonshot.svg` | simple-icons@16.38.0:moonshotai | CC0-1.0 (simple-icons collection); trademark of its owner | https://www.moonshot.cn |  |
| `baidu` | creator | Baidu | `baidu.svg` | simple-icons@16.38.0:baidu | CC0-1.0 (simple-icons collection); trademark of its owner | https://www.baidu.com |  |
| `bytedance` | creator | ByteDance | `bytedance.svg` | simple-icons@16.38.0:bytedance | CC0-1.0 (simple-icons collection); trademark of its owner | https://www.bytedance.com |  |
| `minimax` | creator | MiniMax | `generic.svg` | generic | own work, CC0-1.0 | — | present in simple-icons but under a custom licence — not shipped |
| `zhipu` | creator | Zhipu AI | `generic.svg` | generic | own work, CC0-1.0 | — | not in simple-icons 16.38.0 |
| `tencent` | creator | Tencent | `generic.svg` | generic | own work, CC0-1.0 | — | not in simple-icons 16.38.0 |
| `ai21` | creator | AI21 Labs | `generic.svg` | generic | own work, CC0-1.0 | — | not in simple-icons 16.38.0 |
| `nous` | creator | Nous Research | `generic.svg` | generic | own work, CC0-1.0 | — | not in simple-icons 16.38.0 |
| `ibm` | creator | IBM | `generic.svg` | generic | own work, CC0-1.0 | — | not in simple-icons 16.38.0 |
| `liquid` | creator | Liquid AI | `generic.svg` | generic | own work, CC0-1.0 | — | not in simple-icons 16.38.0 |
| `inception` | creator | Inception | `generic.svg` | generic | own work, CC0-1.0 | — | not in simple-icons 16.38.0 |
| `unknown` | creator | Autre | `generic.svg` | generic | own work, CC0-1.0 | — | creator not recognised |
| `openrouter` | route | OpenRouter | `openrouter.svg` | simple-icons@16.38.0:openrouter | CC0-1.0 (simple-icons collection); trademark of its owner | https://openrouter.ai |  |
| `maclustr` | route | MacLustr | `generic.svg` | generic | own work, CC0-1.0 | — | no authorised logo: generic mark |

`kind = creator` → who made the model (`ai_models.creator`); `kind = route` → an API route that is not a creator (provider badge).
Creators not listed here (an unknown vendor prefix returned by a provider catalogue) get `generic.svg` and a monogram derived from
their id — see `creatorInfo()`.

## registry.json — shape

```json
{
  "version": 1,
  "generatedFrom": "simple-icons@16.38.0",
  "fallback": "generic.svg",
  "template": true,
  "entries": [
    {"id": "anthropic", "kind": "creator", "name": "Anthropic", "file": "anthropic.svg", "logo": "/model-logos/anthropic.svg", "generic": false, "monogram": "AN", "hex": "191919", "source": "simple-icons@16.38.0:anthropic", "licence": "CC0-1.0 (simple-icons collection); trademark of its owner", "sourceUrl": "https://www.anthropic.com", "guidelines": null, "note": null},
    {"id": "openai", "kind": "creator", "name": "OpenAI", "file": "generic.svg", "logo": "/model-logos/generic.svg", "generic": true, "monogram": "OA", "hex": null, "source": "generic", "licence": "own work, CC0-1.0", "sourceUrl": null, "guidelines": null, "note": "not in simple-icons 16.38.0"}
  ]
}
```

Native apps: download `registry.json` and the files it names at build time to generate the asset catalogue; at run time use the
`logo` path returned with each model (`/model-logos/<creator>.svg`, or `/model-logos/generic.svg` + `monogram`).
