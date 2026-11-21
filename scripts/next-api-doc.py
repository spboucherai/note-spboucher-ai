#!/usr/bin/env python3
# =============================================================================
#                  SP BOUCHER | SOFTWARE & RESEARCH
#             ARTIFICIAL INTELLIGENCE • FINANCE • ENGINEERING
# =============================================================================
#
# PROJECT METADATA
# -----------------------------------------------------------------------------
# Project          : Note SPBoucher AI
# File             : scripts/next-api-doc.py
# Description      : Builds docs/next/API-NEXT.md from
#                    docs/next/API-NEXT.template.md and docs/next/examples.json
#                    (real responses recorded by scripts/next-api-examples.ts).
# Module           : scripts
# Repository       : https://git.spboucher.ai/note-spboucher-ai
# Project Website  : https://note.spboucher.ai
# Created          : 2026-11-19
# Last Modified    : 2026-11-19
#
# =============================================================================
# AUTHOR & PROFESSIONAL AFFILIATION
# =============================================================================
#
# Author           : Simon-Pierre Boucher
# Position         : Professor of Finance
# Institution      : Université du Québec en Outaouais (UQO)
# Department       : Département des sciences administratives
# Organization     : SP Boucher
#
# Website          : https://spboucher.ai
# Git              : https://git.spboucher.ai
#
# =============================================================================
# OFFICIAL CONTACT DIRECTORY
# =============================================================================
#
# General          : info@spboucher.ai
# Professional     : contact@spboucher.ai
# Direct           : simon@spboucher.ai
# Research         : research@spboucher.ai
# Development      : dev@spboucher.ai
# Support          : support@spboucher.ai
# Security/Admin   : admin@spboucher.ai
# Notifications    : notifications@spboucher.ai
#
# Preferred Contact: contact@spboucher.ai
#
# =============================================================================
# COPYRIGHT & INTELLECTUAL PROPERTY
# =============================================================================
#
# Copyright (c) 2026
# Simon-Pierre Boucher
#
# All rights reserved where applicable.
#
# This file is governed by the applicable project license,
# copyright notices, institutional agreements and relevant law.
#
# Unless expressly authorized by the applicable license or
# rights holder, copying, redistribution, sublicensing,
# publication and commercial exploitation are not permitted.
#
# Existing third-party rights and notices remain unaffected.
#
# =============================================================================
# CONFIDENTIALITY & SECURITY
# =============================================================================
#
# Classification   : Public
# Distribution     : Public repository; use is governed by the project license
# Security Contact : admin@spboucher.ai
#
# Access to this source does not independently grant permission
# to redistribute or disclose confidential materials.
#
# Do not embed credentials, private keys, access tokens,
# certificates or confidential personal information.
#
# =============================================================================
# LICENSE & MAINTENANCE
# =============================================================================
#
# License          : None specified (no license file in this repository)
# Maintainer       : Simon-Pierre Boucher
# Technical Contact: dev@spboucher.ai
#
# =============================================================================
# END OF SP BOUCHER SOURCE HEADER
# =============================================================================

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
