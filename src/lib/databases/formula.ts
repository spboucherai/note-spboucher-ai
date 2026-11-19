/** Tiny safe formula language (no eval): arithmetic, comparisons, and/or/not, string concat with +, if(), prop("Name"), dates. Client-safe.
 * 3.0: dependency analysis (`formulaRefs`, `formulaCycle`), syntax check, and a guard on user regular expressions. */
export type FVal = number | string | boolean | Date | null | FVal[];
type Tok = { t: "num" | "str" | "id" | "op"; v: string };
type Node = { k: "lit"; v: FVal } | { k: "id"; name: string } | { k: "un"; op: string; a: Node } | { k: "bin"; op: string; a: Node; b: Node } | { k: "call"; name: string; args: Node[] } | { k: "cond"; c: Node; a: Node; b: Node };
export interface FormulaCtx { prop: (name: string) => FVal }

const OPS = ["==", "!=", "<=", ">=", "&&", "||", "+", "-", "*", "/", "%", "^", "<", ">", "=", "(", ")", ",", "!", "?", ":"];
function lex(src: string): Tok[] {
  const out: Tok[] = []; let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (/\s/.test(c)) { i++; continue; }
    if (/[0-9]/.test(c) || (c === "." && /[0-9]/.test(src[i + 1] ?? ""))) { const m = src.slice(i).match(/^\d*\.?\d+(e[+-]?\d+)?|^\d+/i)!; out.push({ t: "num", v: m[0] }); i += m[0].length; continue; }
    if (c === '"' || c === "'") { let j = i + 1, s = ""; while (j < src.length && src[j] !== c) { if (src[j] === "\\" && j + 1 < src.length) { j++; } s += src[j]; j++; } if (j >= src.length) throw new Error("Unterminated string"); out.push({ t: "str", v: s }); i = j + 1; continue; }
    if (/[A-Za-z_]/.test(c)) { const m = src.slice(i).match(/^[A-Za-z_][A-Za-z0-9_]*/)!; out.push({ t: "id", v: m[0] }); i += m[0].length; continue; }
    const op = OPS.find((o) => src.startsWith(o, i)); if (!op) throw new Error(`Unexpected character "${c}" at ${i + 1}`);
    out.push({ t: "op", v: op }); i += op.length;
  }
  return out;
}
export function parseFormula(src: string): Node {
  const toks = lex(src); let p = 0;
  const peek = () => toks[p]; const next = () => toks[p++];
  const isOp = (v: string) => peek()?.t === "op" && peek().v === v;
  const isKw = (v: string) => peek()?.t === "id" && peek().v === v;
  const expect = (v: string) => { if (!isOp(v)) throw new Error(`Expected "${v}"${peek() ? ` near "${peek().v}"` : " at end"}`); next(); };
  const ternary = (): Node => { const c = or(); if (isOp("?")) { next(); const a = ternary(); expect(":"); const b = ternary(); return { k: "cond", c, a, b }; } return c; };
  const or = (): Node => { let a = and(); while (isOp("||") || isKw("or")) { next(); a = { k: "bin", op: "||", a, b: and() }; } return a; };
  const and = (): Node => { let a = not(); while (isOp("&&") || isKw("and")) { next(); a = { k: "bin", op: "&&", a, b: not() }; } return a; };
  const not = (): Node => { if (isOp("!") || isKw("not")) { next(); return { k: "un", op: "!", a: not() }; } return cmp(); };
  const cmp = (): Node => { const a = add(); for (const o of ["==", "!=", "<=", ">=", "<", ">", "="]) if (isOp(o)) { next(); return { k: "bin", op: o === "=" ? "==" : o, a, b: add() }; } return a; };
  const add = (): Node => { let a = mul(); while (isOp("+") || isOp("-")) { const op = next().v; a = { k: "bin", op, a, b: mul() }; } return a; };
  const mul = (): Node => { let a = unary(); while (isOp("*") || isOp("/") || isOp("%")) { const op = next().v; a = { k: "bin", op, a, b: unary() }; } return a; };
  const unary = (): Node => { if (isOp("-")) { next(); return { k: "un", op: "-", a: unary() }; } if (isOp("+")) { next(); return unary(); } return pow(); };
  const pow = (): Node => { const a = primary(); if (isOp("^")) { next(); return { k: "bin", op: "^", a, b: unary() }; } return a; };
  const primary = (): Node => {
    const t = next(); if (!t) throw new Error("Unexpected end of formula");
    if (t.t === "num") return { k: "lit", v: Number(t.v) };
    if (t.t === "str") return { k: "lit", v: t.v };
    if (t.t === "op" && t.v === "(") { const e = ternary(); expect(")"); return e; }
    if (t.t === "id") {
      if (t.v === "true") return { k: "lit", v: true }; if (t.v === "false") return { k: "lit", v: false }; if (t.v === "null") return { k: "lit", v: null };
      if (isOp("(")) { next(); const args: Node[] = []; if (!isOp(")")) { args.push(ternary()); while (isOp(",")) { next(); args.push(ternary()); } } expect(")"); return { k: "call", name: t.v, args }; }
      return { k: "id", name: t.v };
    }
    throw new Error(`Unexpected "${t.v}"`);
  };
  const ast = ternary(); if (p < toks.length) throw new Error(`Unexpected "${toks[p].v}"`);
  return ast;
}

const isDate = (v: FVal): v is Date => v instanceof Date;
const num = (v: FVal): number => { if (typeof v === "number") return v; if (typeof v === "boolean") return v ? 1 : 0; if (isDate(v)) return v.getTime(); if (v == null || v === "") return 0; if (Array.isArray(v)) return v.length; const n = Number(v); if (Number.isNaN(n)) throw new Error(`Not a number: "${v}"`); return n; };
export const str = (v: FVal): string => v == null ? "" : isDate(v) ? fmtDate(v) : Array.isArray(v) ? v.map(str).join(", ") : typeof v === "number" ? (Number.isInteger(v) ? String(v) : String(Math.round(v * 1e6) / 1e6)) : String(v);
const bool = (v: FVal): boolean => Array.isArray(v) ? v.length > 0 : isDate(v) ? true : v === "" ? false : Boolean(v);
const fmtDate = (d: Date) => (d.getHours() || d.getMinutes() ? d.toISOString().slice(0, 16).replace("T", " ") : d.toISOString().slice(0, 10));
export function toDate(v: FVal): Date | null { if (isDate(v)) return v; if (typeof v === "number") return new Date(v); if (typeof v !== "string" || !v) return null; const d = new Date(/^\d{4}-\d{2}-\d{2}$/.test(v) ? v + "T00:00:00" : v); return Number.isNaN(d.getTime()) ? null : d; }
const UNIT: Record<string, number> = { ms: 1, seconds: 1e3, minutes: 6e4, hours: 36e5, days: 864e5, weeks: 6048e5 };
const eqv = (a: FVal, b: FVal): boolean => (isDate(a) || isDate(b)) ? toDate(a)?.getTime() === toDate(b)?.getTime() : typeof a === "number" || typeof b === "number" ? num(a) === num(b) : str(a) === str(b);
const cmpv = (a: FVal, b: FVal): number => (isDate(a) || isDate(b)) ? (toDate(a)?.getTime() ?? 0) - (toDate(b)?.getTime() ?? 0) : typeof a === "number" && typeof b === "number" ? a - b : typeof a === "string" && typeof b === "string" ? a.localeCompare(b) : num(a) - num(b);
const argn = (name: string, args: FVal[], n: number) => { if (args.length < n) throw new Error(`${name}() expects ${n} argument${n > 1 ? "s" : ""}`); };

const FNS: Record<string, (args: FVal[], ctx: FormulaCtx) => FVal> = {
  prop: (a, ctx) => { argn("prop", a, 1); return ctx.prop(str(a[0])); },
  if: (a) => { argn("if", a, 3); return bool(a[0]) ? a[1] : a[2]; },
  ifs: (a) => { for (let i = 0; i + 1 < a.length; i += 2) if (bool(a[i])) return a[i + 1]; return a.length % 2 ? a[a.length - 1] : null; },
  empty: (a) => a[0] == null || a[0] === "" || (Array.isArray(a[0]) && a[0].length === 0),
  not: (a) => !bool(a[0]), and: (a) => a.every(bool), or: (a) => a.some(bool),
  concat: (a) => a.map(str).join(""), join: (a) => (Array.isArray(a[0]) ? a[0] : [a[0]]).map(str).join(str(a[1] ?? ", ")),
  length: (a) => Array.isArray(a[0]) ? a[0].length : str(a[0]).length, upper: (a) => str(a[0]).toUpperCase(), lower: (a) => str(a[0]).toLowerCase(), trim: (a) => str(a[0]).trim(),
  contains: (a) => Array.isArray(a[0]) ? a[0].some((x) => eqv(x, a[1])) : str(a[0]).includes(str(a[1])), replace: (a) => str(a[0]).replace(str(a[1]), str(a[2])), replaceAll: (a) => str(a[0]).split(str(a[1])).join(str(a[2])),
  slice: (a) => str(a[0]).slice(num(a[1]), a[2] == null ? undefined : num(a[2])), format: (a) => str(a[0]), toNumber: (a) => { const n = Number(str(a[0]).replace(/[^0-9.eE+-]/g, "")); return Number.isNaN(n) ? null : n; },
  test: (a) => safeRegex(str(a[1])).test(str(a[0]).slice(0, 20_000)),
  round: (a) => { const d = a[1] == null ? 0 : num(a[1]); const f = 10 ** d; return Math.round(num(a[0]) * f) / f; }, floor: (a) => Math.floor(num(a[0])), ceil: (a) => Math.ceil(num(a[0])), abs: (a) => Math.abs(num(a[0])), sqrt: (a) => Math.sqrt(num(a[0])), pow: (a) => num(a[0]) ** num(a[1]), mod: (a) => num(a[0]) % num(a[1]),
  min: (a) => Math.min(...a.flat().map(num)), max: (a) => Math.max(...a.flat().map(num)), sum: (a) => a.flat().reduce<number>((s, x) => s + num(x), 0), avg: (a) => { const xs = a.flat(); return xs.length ? xs.reduce<number>((s, x) => s + num(x), 0) / xs.length : null; },
  count: (a) => Array.isArray(a[0]) ? a[0].filter((x) => x != null && x !== "").length : a[0] == null || a[0] === "" ? 0 : 1,
  now: () => new Date(), today: () => { const d = new Date(); d.setHours(0, 0, 0, 0); return d; }, date: (a) => toDate(a[0]),
  year: (a) => toDate(a[0])?.getFullYear() ?? null, month: (a) => { const d = toDate(a[0]); return d ? d.getMonth() + 1 : null; }, day: (a) => toDate(a[0])?.getDate() ?? null, weekday: (a) => toDate(a[0])?.getDay() ?? null,
  dateDiff: (a) => { const x = toDate(a[0]), y = toDate(a[1]); if (!x || !y) return null; const u = str(a[2] ?? "days"); if (u === "months" || u === "years") { const m = (x.getFullYear() - y.getFullYear()) * 12 + x.getMonth() - y.getMonth(); return u === "years" ? Math.trunc(m / 12) : m; } return Math.trunc((x.getTime() - y.getTime()) / (UNIT[u] ?? UNIT.days)); },
  dateAdd: (a) => { const d = toDate(a[0]); if (!d) return null; const n = num(a[1]); const u = str(a[2] ?? "days"); const r = new Date(d); if (u === "months") r.setMonth(r.getMonth() + n); else if (u === "years") r.setFullYear(r.getFullYear() + n); else r.setTime(r.getTime() + n * (UNIT[u] ?? UNIT.days)); return r; },
  formatDate: (a) => { const d = toDate(a[0]); return d ? fmtDate(d) : ""; },
};
FNS.dateBetween = FNS.dateDiff; FNS.dateSubtract = (a) => FNS.dateAdd([a[0], -num(a[1]), a[2] ?? "days"], undefined as any);

export function evalNode(n: Node, ctx: FormulaCtx, depth = 0): FVal {
  if (depth > 200) throw new Error("Formula too deep");
  switch (n.k) {
    case "lit": return n.v;
    case "id": return ctx.prop(n.name);
    case "cond": return bool(evalNode(n.c, ctx, depth + 1)) ? evalNode(n.a, ctx, depth + 1) : evalNode(n.b, ctx, depth + 1);
    case "un": { const v = evalNode(n.a, ctx, depth + 1); return n.op === "!" ? !bool(v) : -num(v); }
    case "call": { const f = FNS[n.name]; if (!f) throw new Error(`Unknown function ${n.name}()`); return f(n.args.map((x) => evalNode(x, ctx, depth + 1)), ctx); }
    case "bin": {
      if (n.op === "&&") return bool(evalNode(n.a, ctx, depth + 1)) && bool(evalNode(n.b, ctx, depth + 1));
      if (n.op === "||") return bool(evalNode(n.a, ctx, depth + 1)) || bool(evalNode(n.b, ctx, depth + 1));
      const a = evalNode(n.a, ctx, depth + 1), b = evalNode(n.b, ctx, depth + 1);
      switch (n.op) {
        case "+": if (typeof a === "string" || typeof b === "string") return str(a) + str(b); if (isDate(a) && typeof b === "number") return new Date(a.getTime() + b * 864e5); return num(a) + num(b);
        case "-": if (isDate(a) && isDate(b)) return (a.getTime() - b.getTime()) / 864e5; if (isDate(a)) return new Date(a.getTime() - num(b) * 864e5); return num(a) - num(b);
        case "*": return num(a) * num(b); case "/": { const d = num(b); if (d === 0) throw new Error("Division by zero"); return num(a) / d; } case "%": return num(a) % num(b); case "^": return num(a) ** num(b);
        case "==": return eqv(a, b); case "!=": return !eqv(a, b); case "<": return cmpv(a, b) < 0; case "<=": return cmpv(a, b) <= 0; case ">": return cmpv(a, b) > 0; case ">=": return cmpv(a, b) >= 0;
      }
    }
  }
  throw new Error("Bad node");
}
/**
 * 3.0 (audit D24): `test(s, regex)` runs for every row on every read. Patterns that can backtrack catastrophically — a quantified group
 * that itself ends with a quantifier, e.g. `(a+)+` — and very long patterns are refused; the tested string is capped at 20 000 characters.
 */
const rx = new Map<string, RegExp>();
export function safeRegex(src: string): RegExp {
  const hit = rx.get(src); if (hit) return hit;
  if (src.length > 300) throw new Error("Regular expression too long (300 characters at most)");
  if (/([+*]|\{\d+,?\d*\})\s*\)\s*([+*]|\{\d+,?\d*\})/.test(src)) throw new Error("Regular expression refused: nested quantifiers can freeze the server");
  let re: RegExp; try { re = new RegExp(src); } catch (e: any) { throw new Error(`Invalid regular expression: ${e?.message ?? e}`); }
  if (rx.size > 200) rx.clear(); rx.set(src, re); return re;
}
/** Names of the properties an expression reads (`prop("Name")` with a literal name, and bare identifiers). Throws on a syntax error. */
export function formulaRefs(expression: string): string[] {
  const out = new Set<string>();
  const walk = (n: Node) => { switch (n.k) { case "id": out.add(n.name); break; case "un": walk(n.a); break; case "bin": walk(n.a); walk(n.b); break; case "cond": walk(n.c); walk(n.a); walk(n.b); break; case "call": if (n.name === "prop" && n.args[0]?.k === "lit" && typeof n.args[0].v === "string") out.add(n.args[0].v); n.args.forEach(walk); break; } };
  walk(parseFormula(expression)); return [...out];
}
/** Syntax error of an expression, or null. */
export function formulaSyntaxError(expression: string): string | null { try { parseFormula(expression); return null; } catch (e: any) { return String(e?.message ?? e); } }
/**
 * Dependency cycle among formula properties: the path of names (`["A", "B", "A"]`) when the formula `name` (with `expression`, replacing
 * the stored one) ends up reading itself, else null. `props` = every property of the database ({name, type, config.expression}).
 */
export function formulaCycle(props: { name: string; type: string; config: { expression?: unknown } }[], name: string, expression: string): string[] | null {
  const exprOf = (n: string): string | null => { if (n === name) return expression; const p = props.find((x) => x.name === n); return p && p.type === "formula" ? String(p.config.expression ?? "") : null; };
  const refs = (n: string): string[] => { const e = exprOf(n); if (!e) return []; try { return formulaRefs(e); } catch { return []; } };
  const path: string[] = []; const done = new Set<string>();
  const visit = (n: string): string[] | null => {
    const at = path.indexOf(n); if (at >= 0) return [...path.slice(at), n]; if (done.has(n)) return null;
    path.push(n); for (const r of refs(n)) { const c = visit(r); if (c) return c; } path.pop(); done.add(n); return null;
  };
  const c = visit(name); return c && c.includes(name) ? c : null;
}
const cache = new Map<string, Node | Error>();
/** Evaluate an expression; returns a JSON-safe value or { error }. */
export function evaluate(expression: string, ctx: FormulaCtx): string | number | boolean | null | { error: string } {
  try {
    let ast = cache.get(expression); if (!ast) { try { ast = parseFormula(expression); } catch (e: any) { ast = e; } if (cache.size > 500) cache.clear(); cache.set(expression, ast!); }
    if (ast instanceof Error) throw ast;
    const v = evalNode(ast!, ctx);
    if (isDate(v)) return v.toISOString(); if (Array.isArray(v)) return str(v); if (typeof v === "number" && !Number.isFinite(v)) return null;
    return v as any;
  } catch (e: any) { return { error: String(e?.message ?? e) }; }
}
export const FORMULA_HELP = `prop("Name") · + - * / % ^ · == != < <= > >= · and or not · cond ? a : b
if(c,a,b) ifs(c1,v1,…,else) empty(x) concat(…) join(list,sep) length upper lower trim contains replace slice test(s,regex) format toNumber
round(n,d) floor ceil abs sqrt min max sum avg count · now() today() date(s) year month day weekday dateDiff(a,b,"days"|"weeks"|"months"|"years") dateAdd(d,n,unit) formatDate`;
