"use client";
/** Palette of common equation templates; inserts a $$…$$ block into the page editor via the note:insert-markdown event. */
import { useState } from "react";
import { Sigma, Search } from "lucide-react";
import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/primitives";
import { Input } from "@/components/ui/input";
import { toast } from "@/components/ui/toast";
import { insertMarkdown, copy } from "./ui";
import { cn } from "@/lib/utils";

export const LATEX_SNIPPETS: { id: string; group: string; label: string; latex: string }[] = [
  { id: "ols", group: "Regression", label: "Linear regression", latex: "y_i = \\beta_0 + \\beta_1 x_i + \\varepsilon_i, \\qquad \\varepsilon_i \\sim \\mathcal{N}(0, \\sigma^2)" },
  { id: "panel", group: "Regression", label: "Panel with fixed effects", latex: "y_{it} = \\alpha_i + \\gamma_t + \\beta' x_{it} + \\varepsilon_{it}" },
  { id: "hedonic", group: "Regression", label: "Hedonic price equation", latex: "\\ln P_{it} = \\sum_{k} \\beta_k z_{kit} + \\delta_t + \\lambda_{j(i)} + \\varepsilon_{it}" },
  { id: "did", group: "Regression", label: "Difference-in-differences", latex: "y_{it} = \\alpha_i + \\gamma_t + \\tau\\, D_i \\times \\mathbb{1}\\{t \\ge t_0\\} + \\varepsilon_{it}" },
  { id: "logit", group: "Regression", label: "Logit", latex: "\\Pr(y_i = 1 \\mid x_i) = \\frac{\\exp(x_i'\\beta)}{1 + \\exp(x_i'\\beta)}" },
  { id: "olsest", group: "Regression", label: "OLS estimator", latex: "\\hat{\\beta} = (X'X)^{-1} X'y, \\qquad \\widehat{\\operatorname{Var}}(\\hat\\beta) = \\hat\\sigma^2 (X'X)^{-1}" },
  { id: "ss", group: "State space", label: "State-space model", latex: "\\begin{aligned} y_t &= Z_t \\alpha_t + \\varepsilon_t, & \\varepsilon_t &\\sim \\mathcal{N}(0, H_t) \\\\ \\alpha_{t+1} &= T_t \\alpha_t + R_t \\eta_t, & \\eta_t &\\sim \\mathcal{N}(0, Q_t) \\end{aligned}" },
  { id: "kalman", group: "State space", label: "Kalman update", latex: "\\begin{aligned} v_t &= y_t - Z_t a_t, & F_t &= Z_t P_t Z_t' + H_t \\\\ a_{t|t} &= a_t + P_t Z_t' F_t^{-1} v_t, & P_{t|t} &= P_t - P_t Z_t' F_t^{-1} Z_t P_t \\end{aligned}" },
  { id: "ar1", group: "State space", label: "AR(1)", latex: "x_t = \\phi x_{t-1} + \\epsilon_t, \\qquad |\\phi| < 1" },
  { id: "garch", group: "State space", label: "GARCH(1,1)", latex: "\\sigma_t^2 = \\omega + \\alpha\\, \\varepsilon_{t-1}^2 + \\beta\\, \\sigma_{t-1}^2" },
  { id: "exp", group: "Expectations", label: "Conditional expectation", latex: "\\mathbb{E}\\left[ y_{t+1} \\mid \\mathcal{F}_t \\right] = \\int y\\, f(y \\mid \\mathcal{F}_t)\\, dy" },
  { id: "euler", group: "Expectations", label: "Euler equation", latex: "u'(c_t) = \\beta\\, \\mathbb{E}_t\\left[ u'(c_{t+1})\\, R_{t+1} \\right]" },
  { id: "sdf", group: "Expectations", label: "Pricing with SDF", latex: "P_t = \\mathbb{E}_t\\left[ M_{t+1} \\left( P_{t+1} + D_{t+1} \\right) \\right]" },
  { id: "bellman", group: "Expectations", label: "Bellman equation", latex: "V(s) = \\max_{a \\in \\mathcal{A}(s)} \\left\\{ u(s, a) + \\beta\\, \\mathbb{E}\\left[ V(s') \\mid s, a \\right] \\right\\}" },
  { id: "var", group: "Expectations", label: "Variance decomposition", latex: "\\operatorname{Var}(y) = \\mathbb{E}\\left[\\operatorname{Var}(y \\mid x)\\right] + \\operatorname{Var}\\left(\\mathbb{E}[y \\mid x]\\right)" },
  { id: "sum", group: "Sums & integrals", label: "Sum", latex: "S_n = \\sum_{i=1}^{n} w_i\\, x_i, \\qquad \\sum_{i=1}^{n} w_i = 1" },
  { id: "pv", group: "Sums & integrals", label: "Present value", latex: "PV = \\sum_{t=1}^{T} \\frac{CF_t}{(1 + r)^t} + \\frac{TV_T}{(1 + r)^T}" },
  { id: "int", group: "Sums & integrals", label: "Integral", latex: "\\int_{a}^{b} f(x)\\, dx = F(b) - F(a)" },
  { id: "lik", group: "Sums & integrals", label: "Log-likelihood", latex: "\\ell(\\theta) = \\sum_{i=1}^{n} \\log f(y_i \\mid x_i; \\theta), \\qquad \\hat\\theta = \\arg\\max_{\\theta} \\ell(\\theta)" },
  { id: "lim", group: "Sums & integrals", label: "Asymptotic normality", latex: "\\sqrt{n}\\left(\\hat\\theta - \\theta_0\\right) \\xrightarrow{d} \\mathcal{N}\\left(0, \\Sigma\\right)" },
  { id: "matrix", group: "Sums & integrals", label: "Matrix", latex: "\\Sigma = \\begin{pmatrix} \\sigma_{11} & \\sigma_{12} \\\\ \\sigma_{21} & \\sigma_{22} \\end{pmatrix}" },
];
export function insertLatexBlock(latex: string) { insertMarkdown(`$$\n${latex}\n$$`); toast("Equation inserted"); }

export function LatexSnippets({ compact }: { compact?: boolean }) {
  const [q, setQ] = useState("");
  const list = LATEX_SNIPPETS.filter((s) => !q || `${s.group} ${s.label} ${s.latex}`.toLowerCase().includes(q.toLowerCase()));
  const groups = [...new Set(list.map((s) => s.group))];
  return (
    <Popover>
      <PopoverTrigger asChild><button className={cn("flex h-8 items-center gap-1 rounded-md border border-line bg-bg-elev px-2 text-[12px] font-medium hover:bg-bg-sunk", compact && "h-7")} title="Insert a LaTeX equation template"><Sigma className="size-3.5" /><span className={compact ? "hidden sm:inline" : ""}>LaTeX</span></button></PopoverTrigger>
      <PopoverContent className="w-[min(92vw,26rem)] p-2" align="end">
        <div className="relative mb-2"><Search className="absolute left-2 top-2 size-3.5 text-fg-faint" /><Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search templates…" className="h-8 pl-7 text-[13px]" autoFocus /></div>
        <div className="max-h-[50vh] space-y-2 overflow-y-auto pr-1">
          {groups.map((g) => <div key={g}><div className="mb-1 text-[11px] font-medium uppercase tracking-wide text-fg-faint">{g}</div><div className="space-y-0.5">{list.filter((s) => s.group === g).map((s) => <div key={s.id} className="group flex items-center gap-1"><button onClick={() => insertLatexBlock(s.latex)} className="flex min-h-10 min-w-0 flex-1 flex-col items-start rounded-md px-2 py-1 text-left hover:bg-bg-sunk"><span className="text-[13px]">{s.label}</span><span className="w-full truncate font-mono text-[11px] text-fg-faint">{s.latex}</span></button><button className="shrink-0 rounded px-1.5 py-1 text-[11px] text-fg-faint opacity-0 hover:bg-bg-sunk hover:text-fg group-hover:opacity-100 focus:opacity-100" onClick={() => copy(s.latex, "LaTeX copied")}>copy</button></div>)}</div></div>)}
          {!list.length && <div className="p-3 text-center text-[13px] text-fg-muted">No template matches.</div>}
        </div>
        <div className="mt-2 border-t border-line pt-2 text-[11px] text-fg-faint">Inserts a $$…$$ block at the end of the page; click the equation in the editor to edit its LaTeX.</div>
      </PopoverContent>
    </Popover>
  );
}
