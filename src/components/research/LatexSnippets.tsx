"use client";
/** Palette of common equation templates; inserts a $$…$$ block into the page editor via the note:insert-markdown event. */
import { useState } from "react";
import { Copy, Search, Sigma } from "lucide-react";
import { Dialog, DialogTrigger, SheetContent } from "@/components/ui/primitives";
import { Input } from "@/components/ui/input";
import { toast } from "@/components/ui/toast";
import { FIELD, IconBtn, insertMarkdown, copy } from "./ui";
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
export function insertLatexBlock(latex: string) { insertMarkdown(`$$\n${latex}\n$$`); toast("Equation inserted at the end of the page"); }

/** Opens in a sheet (bottom sheet on phones): search, 48 px rows, "copy" always visible (no hover-only action). */
export function LatexSnippets({ compact }: { compact?: boolean }) {
  const [q, setQ] = useState(""); const [open, setOpen] = useState(false);
  const list = LATEX_SNIPPETS.filter((s) => !q || `${s.group} ${s.label} ${s.latex}`.toLowerCase().includes(q.toLowerCase()));
  const groups = [...new Set(list.map((s) => s.group))];
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild><button type="button" className={cn("flex h-11 items-center gap-1 rounded-md border border-line bg-bg-elev px-3 text-[13px] font-medium hover:bg-bg-sunk md:h-8 md:px-2 md:text-[12px]", compact && "md:h-7")} aria-label="LaTeX equation templates"><Sigma className="size-4 md:size-3.5" /><span>LaTeX</span></button></DialogTrigger>
      <SheetContent title="LaTeX templates" description="Tap a template to insert it as a $$…$$ block at the end of the page; tap the equation in the editor to edit it.">
        <div className="relative mb-2"><Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-fg-faint" aria-hidden /><Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search templates" aria-label="Search templates" type="search" enterKeyHint="search" className={cn(FIELD, "pl-9")} /></div>
        <div className="space-y-3">
          {groups.map((g) => <div key={g}><div className="mb-1 text-[11px] font-medium uppercase tracking-wide text-fg-faint">{g}</div><ul className="divide-y divide-line rounded-lg border border-line">{list.filter((s) => s.group === g).map((s) => <li key={s.id} className="flex items-center">
            <button type="button" onClick={() => { insertLatexBlock(s.latex); setOpen(false); }} className="flex min-h-12 min-w-0 flex-1 flex-col items-start justify-center px-3 py-1.5 text-left hover:bg-bg-sunk"><span className="text-[14px]">{s.label}</span><span className="w-full truncate font-mono text-[11.5px] text-fg-faint">{s.latex}</span></button>
            <IconBtn label={`Copy the LaTeX of ${s.label}`} onClick={() => copy(s.latex, "LaTeX copied")}><Copy /></IconBtn>
          </li>)}</ul></div>)}
          {!list.length && <div className="p-4 text-center text-[13px] text-fg-muted">No template matches “{q}”. <button type="button" className="text-accent underline-offset-2 hover:underline" onClick={() => setQ("")}>Clear the search</button></div>}
        </div>
      </SheetContent>
    </Dialog>
  );
}
