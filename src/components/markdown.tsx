/**
 * =============================================================================
 *                  SP BOUCHER | SOFTWARE & RESEARCH
 *             ARTIFICIAL INTELLIGENCE • FINANCE • ENGINEERING
 * =============================================================================
 *
 * Project          : Note SPBoucher AI
 * File             : src/components/markdown.tsx
 * Module           : components
 * Repository       : https://git.spboucher.ai/note-spboucher-ai
 * Project Website  : https://note.spboucher.ai
 * Created          : 2026-11-01
 * Last Modified    : 2026-11-01
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

"use client";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import { cn } from "@/lib/utils";
import { memo } from "react";
/** Markdown renderer for AI output (GFM + LaTeX). [n] citation markers become clickable chips when onCite is provided. */
export const Markdown = memo(function Markdown({ text, className, onCite }: { text: string; className?: string; onCite?: (n: number) => void }) {
  const processed = onCite ? text.replace(/\[(\d{1,2})\]/g, (_m, n) => `[${n}](#cite-${n})`) : text;
  return (
    <div className={cn("prose-md", className)}>
      <ReactMarkdown remarkPlugins={[remarkGfm, remarkMath]} rehypePlugins={[rehypeKatex]} components={{
        a: ({ href, children, ...p }) => { const m = href?.match(/^#cite-(\d+)$/); if (m && onCite) return <button type="button" className="source-ref" onClick={() => onCite(Number(m[1]))}>{children}</button>; return <a href={href} target={href?.startsWith("/") ? undefined : "_blank"} rel="noopener noreferrer" {...p}>{children}</a>; },
        code: ({ className, children, ...p }) => <code className={className} {...p}>{children}</code>,
      }}>{processed}</ReactMarkdown>
    </div>
  );
});
