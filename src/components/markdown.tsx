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
