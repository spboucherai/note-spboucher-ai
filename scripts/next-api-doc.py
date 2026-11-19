#!/usr/bin/env python3
"""Builds docs/next/API-NEXT.md from docs/next/API-NEXT.template.md and docs/next/examples.json (real responses recorded by
scripts/next-api-examples.ts). Placeholders: {{ex:name}} (request + status + body), {{body:name}} (body only), {{cat:key}} (catalogue).
Never edit API-NEXT.md by hand: edit the template, then  python3 scripts/next-api-doc.py"""
import json, re, pathlib
root = pathlib.Path(__file__).resolve().parent.parent / "docs" / "next"
ex = json.loads((root / "examples.json").read_text())
cat = ex["_catalogue"]
def dump(v): return json.dumps(v, ensure_ascii=False, indent=2)
def example(m):
    kind, name = m.group(1), m.group(2)
    if kind == "cat":
        v = cat[name]; return ", ".join(f"`{x}`" for x in v) if isinstance(v, list) else "```json\n" + dump(v) + "\n```"
    e = ex[name]
    if kind == "body": return "```json\n" + dump(e["body"]) + "\n```"
    r = e["request"]; head = f'{r["method"]} {r["path"]}'
    for k, v in (r.get("headers") or {}).items(): head += f"\n{k.title()}: {v}"
    if "body" in r: head += "\n\n" + (r["body"] if isinstance(r["body"], str) else dump(r["body"]))
    out = "```http\n" + head + "\n```\n\n```http\nHTTP " + str(e["status"])
    for k, v in (e.get("headers") or {}).items(): out += f"\n{k}: {v}"
    body = e["body"]
    return out + "\n```\n\n" + ("```json\n" + dump(body) + "\n```" if not isinstance(body, str) else f"`{body}`")
tpl = (root / "API-NEXT.template.md").read_text()
missing = [m.group(2) for m in re.finditer(r"\{\{(ex|body):([a-z0-9_]+)\}\}", tpl) if m.group(2) not in ex]
assert not missing, f"unknown examples: {missing}"
md = re.sub(r"\{\{(ex|body|cat):([A-Za-z0-9_]+)\}\}", example, tpl)
md = md.replace("{{generatedAt}}", cat["generatedAt"])
(root / "API-NEXT.md").write_text(md)
print("docs/next/API-NEXT.md", len(md.splitlines()), "lines")
