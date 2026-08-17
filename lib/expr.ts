/**
 * Safe expression evaluator for slider cards. The AI writes `expression` (a
 * formula in `x`); we tokenize + parse it into an AST and evaluate it. NO eval,
 * NO new Function — the AI can never run code in the browser.
 *
 * Grammar (precedence low → high):
 *   expr   := add
 *   add    := mul (("+" | "-") mul)*
 *   mul    := unary (("*" | "/" | "%") unary)*
 *   unary  := ("-" | "+") unary | pow
 *   pow    := primary ("^" unary)?           // right-assoc; 2^3^2 = 2^(3^2)
 *   primary:= number | "x" | "pi" | "e" | fn "(" expr ("," expr)* ")" | "(" expr ")"
 *
 * Functions: sqrt log ln exp abs min max pow floor ceil round sin cos
 * (`log` is base 10, `ln` natural; `log(x, b)` is also accepted.)
 */

export type OutputFormat = "number" | "int" | "percent" | "currency" | "ms" | "compact";

type Tok =
  | { k: "num"; v: number }
  | { k: "id"; v: string }
  | { k: "op"; v: "+" | "-" | "*" | "/" | "%" | "^" }
  | { k: "lp" }
  | { k: "rp" }
  | { k: "comma" };

type Node =
  | { t: "num"; v: number }
  | { t: "x" }
  | { t: "const"; v: number }
  | { t: "neg"; a: Node }
  | { t: "bin"; op: "+" | "-" | "*" | "/" | "%" | "^"; a: Node; b: Node }
  | { t: "call"; fn: string; args: Node[] };

const CONSTS: Record<string, number> = { pi: Math.PI, e: Math.E };

const FNS: Record<string, { min: number; max: number; f: (...a: number[]) => number }> = {
  sqrt: { min: 1, max: 1, f: Math.sqrt },
  log: { min: 1, max: 2, f: (a, b) => (b === undefined ? Math.log10(a) : Math.log(a) / Math.log(b)) },
  ln: { min: 1, max: 1, f: Math.log },
  exp: { min: 1, max: 1, f: Math.exp },
  abs: { min: 1, max: 1, f: Math.abs },
  min: { min: 1, max: 8, f: (...a) => Math.min(...a) },
  max: { min: 1, max: 8, f: (...a) => Math.max(...a) },
  pow: { min: 2, max: 2, f: Math.pow },
  floor: { min: 1, max: 1, f: Math.floor },
  ceil: { min: 1, max: 1, f: Math.ceil },
  round: { min: 1, max: 1, f: Math.round },
  sin: { min: 1, max: 1, f: Math.sin },
  cos: { min: 1, max: 1, f: Math.cos },
};

export class ExprError extends Error {}

export function tokenize(src: string): Tok[] {
  const out: Tok[] = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (c === " " || c === "\t" || c === "\n" || c === "\r") { i++; continue; }
    if ((c >= "0" && c <= "9") || (c === "." && src[i + 1] >= "0" && src[i + 1] <= "9")) {
      const m = /^(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/.exec(src.slice(i));
      if (!m) throw new ExprError(`bad number at ${i}`);
      out.push({ k: "num", v: Number(m[0]) });
      i += m[0].length;
      continue;
    }
    if (/[a-zA-Z_]/.test(c)) {
      const m = /^[a-zA-Z_][a-zA-Z0-9_]*/.exec(src.slice(i))!;
      out.push({ k: "id", v: m[0].toLowerCase() });
      i += m[0].length;
      continue;
    }
    if (c === "+" || c === "-" || c === "*" || c === "/" || c === "%" || c === "^") { out.push({ k: "op", v: c }); i++; continue; }
    if (c === "(") { out.push({ k: "lp" }); i++; continue; }
    if (c === ")") { out.push({ k: "rp" }); i++; continue; }
    if (c === ",") { out.push({ k: "comma" }); i++; continue; }
    // "**" is a common way to write pow; accept it as ^
    throw new ExprError(`unexpected "${c}" at ${i}`);
  }
  // fold "* *" → "^"
  const folded: Tok[] = [];
  for (let j = 0; j < out.length; j++) {
    const t = out[j];
    const n = out[j + 1];
    if (t.k === "op" && t.v === "*" && n && n.k === "op" && n.v === "*") { folded.push({ k: "op", v: "^" }); j++; }
    else folded.push(t);
  }
  return folded;
}

export function parse(src: string): Node {
  const toks = tokenize(src);
  let p = 0;
  const peek = () => toks[p];
  const next = () => toks[p++];
  const expect = (k: Tok["k"]) => {
    const t = next();
    if (!t || t.k !== k) throw new ExprError(`expected ${k}`);
    return t;
  };

  const primary = (): Node => {
    const t = next();
    if (!t) throw new ExprError("unexpected end");
    if (t.k === "num") return { t: "num", v: t.v };
    if (t.k === "lp") { const e = add(); expect("rp"); return e; }
    if (t.k === "id") {
      if (t.v === "x") return { t: "x" };
      if (t.v in CONSTS) return { t: "const", v: CONSTS[t.v] };
      const fn = FNS[t.v];
      if (!fn) throw new ExprError(`unknown identifier ${t.v}`);
      expect("lp");
      const args: Node[] = [];
      if (peek()?.k !== "rp") {
        args.push(add());
        while (peek()?.k === "comma") { next(); args.push(add()); }
      }
      expect("rp");
      if (args.length < fn.min || args.length > fn.max) throw new ExprError(`${t.v}: wrong arg count`);
      return { t: "call", fn: t.v, args };
    }
    throw new ExprError("unexpected token");
  };
  const pow = (): Node => {
    const base = primary();
    const t = peek();
    if (t && t.k === "op" && t.v === "^") { next(); return { t: "bin", op: "^", a: base, b: unary() }; }
    return base;
  };
  const unary = (): Node => {
    const t = peek();
    if (t && t.k === "op" && (t.v === "-" || t.v === "+")) {
      next();
      const a = unary();
      return t.v === "-" ? { t: "neg", a } : a;
    }
    return pow();
  };
  const mul = (): Node => {
    let a = unary();
    for (;;) {
      const t = peek();
      if (t && t.k === "op" && (t.v === "*" || t.v === "/" || t.v === "%")) { next(); a = { t: "bin", op: t.v, a, b: unary() }; }
      else return a;
    }
  };
  const add = (): Node => {
    let a = mul();
    for (;;) {
      const t = peek();
      if (t && t.k === "op" && (t.v === "+" || t.v === "-")) { next(); a = { t: "bin", op: t.v, a, b: mul() }; }
      else return a;
    }
  };

  const root = add();
  if (p !== toks.length) throw new ExprError("trailing input");
  return root;
}

function run(n: Node, x: number): number {
  switch (n.t) {
    case "num": return n.v;
    case "const": return n.v;
    case "x": return x;
    case "neg": return -run(n.a, x);
    case "bin": {
      const a = run(n.a, x);
      const b = run(n.b, x);
      switch (n.op) {
        case "+": return a + b;
        case "-": return a - b;
        case "*": return a * b;
        case "/": return a / b;
        case "%": return a % b;
        case "^": return Math.pow(a, b);
      }
      break;
    }
    case "call": return FNS[n.fn].f(...n.args.map((a) => run(a, x)));
  }
  return NaN;
}

type Fn = (x: number) => number;
const cache = new Map<string, Fn | null>();

/** Compile once; returns null if the expression is invalid. Cached per source string. */
export function compile(expr: string): Fn | null {
  const hit = cache.get(expr);
  if (hit !== undefined) return hit;
  let fn: Fn | null = null;
  try {
    const node = parse(expr);
    fn = (x: number) => {
      const v = run(node, x);
      return typeof v === "number" ? v : NaN;
    };
  } catch {
    fn = null;
  }
  if (cache.size > 200) cache.clear();
  cache.set(expr, fn);
  return fn;
}

/** Evaluate `expr` at `x`. Returns NaN on any error (parse or math) — the caller shows "—". */
export function evaluate(expr: string, x: number): number {
  const f = compile(expr);
  if (!f) return NaN;
  try { return f(x); } catch { return NaN; }
}

const fmtNum = (n: number, maxFrac: number) =>
  n.toLocaleString("en-US", { maximumFractionDigits: maxFrac });

const compact = (n: number, maxFrac = 1) =>
  new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: maxFrac }).format(n);

/** Whether a unit hugs the number ("90%", "12ms", "3/s") or takes a space ("12 req"). */
function joinUnit(s: string, unit?: string): string {
  if (!unit) return s;
  const tight = /^[^a-zA-Z]/.test(unit) || /^[a-z]{1,2}$/.test(unit);
  return tight ? `${s}${unit}` : `${s} ${unit}`;
}

/**
 * Format a slider output. `percent` expects the value already in percent units
 * (90 → "90%"). Non-finite → "—".
 */
export function formatOutput(n: number, format: OutputFormat = "number", unit?: string): string {
  if (!Number.isFinite(n)) return "—";
  const neg = n < 0 ? "-" : "";
  const abs = Math.abs(n);
  switch (format) {
    case "int":
      return joinUnit(`${neg}${fmtNum(Math.round(abs), 0)}`, unit);
    case "percent": {
      const s = `${neg}${fmtNum(abs, abs < 10 ? 1 : 0)}%`;
      return unit && unit !== "%" ? joinUnit(s, unit) : s;
    }
    case "currency": {
      const s = abs >= 1e6 ? compact(abs, 1) : Number.isInteger(abs) ? fmtNum(abs, 0) : abs.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
      return joinUnit(`${neg}$${s}`, unit && unit !== "$" ? unit : undefined);
    }
    case "ms": {
      let s: string;
      if (abs < 1) s = `${fmtNum(abs, 2)}ms`;
      else if (abs < 1000) s = `${fmtNum(abs, abs < 10 ? 1 : 0)}ms`;
      else if (abs < 60_000) s = `${fmtNum(abs / 1000, abs < 10_000 ? 1 : 0)}s`;
      else if (abs < 3_600_000) s = `${fmtNum(abs / 60_000, 1)}min`;
      else s = `${fmtNum(abs / 3_600_000, 1)}h`;
      return joinUnit(`${neg}${s}`, unit && unit !== "ms" ? unit : undefined);
    }
    case "compact":
      return joinUnit(`${neg}${abs < 1000 ? fmtNum(abs, abs < 10 ? 2 : abs < 100 ? 1 : 0) : compact(abs, 1)}`, unit);
    case "number":
    default: {
      const s = abs >= 1e15 ? compact(abs, 2) : fmtNum(abs, abs < 1 ? 3 : abs < 100 ? 2 : abs < 10_000 ? 1 : 0);
      return joinUnit(`${neg}${s}`, unit);
    }
  }
}
