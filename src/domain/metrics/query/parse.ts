export type MatcherOp = "=" | "!=" | "=~" | "!~";

export type LabelMatcher = { label: string; op: MatcherOp; value: string };

export type MetricAst =
  | { type: "selector"; name: string; matchers: LabelMatcher[] }
  | {
      type: "func";
      fn: "rate" | "increase" | "avg_over_time" | "sum_over_time" | "max_over_time";
      rangeMs: number;
      inner: MetricAst;
    }
  | { type: "agg"; op: "sum" | "avg"; by: string[]; inner: MetricAst }
  | { type: "topk"; k: number; bottom: boolean; inner: MetricAst }
  | { type: "histogram_quantile"; q: number; inner: MetricAst };

export class MetricParseError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "MetricParseError";
  }
}

function parseDurationMs(raw: string): number {
  const m = /^(\d+)(ms|s|m|h)$/.exec(raw);
  if (!m) throw new MetricParseError(`Invalid duration: ${raw}`);
  const n = Number(m[1]);
  switch (m[2]) {
    case "ms":
      return n;
    case "s":
      return n * 1000;
    case "m":
      return n * 60_000;
    case "h":
      return n * 3_600_000;
    default:
      throw new MetricParseError(`Invalid duration: ${raw}`);
  }
}

function parseMatchers(body: string): LabelMatcher[] {
  if (!body.trim()) return [];
  const matchers: LabelMatcher[] = [];
  const re = /([a-zA-Z_][a-zA-Z0-9_]*)\s*(=~|!~|=|!=)\s*"((?:\\.|[^"\\])*)"/g;
  let m: RegExpExecArray | null;
  let last = 0;
  while ((m = re.exec(body))) {
    const between = body.slice(last, m.index).replace(/[,\s]/g, "");
    if (between) throw new MetricParseError("Invalid matcher list");
    matchers.push({
      label: m[1]!,
      op: m[2] as MatcherOp,
      value: m[3]!.replace(/\\"/g, '"'),
    });
    last = m.index + m[0].length;
  }
  if (body.slice(last).replace(/[,\s]/g, "")) {
    throw new MetricParseError("Invalid matcher list");
  }
  return matchers;
}

function parseSelector(input: string): MetricAst {
  const m = /^([a-zA-Z_:][a-zA-Z0-9_:]*)\s*(?:\{([^}]*)\})?\s*$/.exec(input.trim());
  if (!m) throw new MetricParseError("Expected metric selector");
  return {
    type: "selector",
    name: m[1]!,
    matchers: parseMatchers(m[2] ?? ""),
  };
}

function splitArgs(inner: string): string[] {
  const args: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < inner.length; i += 1) {
    const ch = inner[i]!;
    if (ch === "(") depth += 1;
    else if (ch === ")") depth -= 1;
    else if (ch === "," && depth === 0) {
      args.push(inner.slice(start, i).trim());
      start = i + 1;
    }
  }
  args.push(inner.slice(start).trim());
  return args.filter(Boolean);
}

export function parseMetricQuery(input: string): MetricAst {
  const q = input.trim();
  if (!q || q.length > 4096) throw new MetricParseError("Query length invalid");

  const top = /^(topk|bottomk)\s*\((.+)\)$/s.exec(q);
  if (top) {
    const args = splitArgs(top[2]!);
    if (args.length !== 2) throw new MetricParseError("topk/bottomk expects (k, expr)");
    const k = Number(args[0]);
    if (!Number.isInteger(k) || k < 1 || k > 100) {
      throw new MetricParseError("topk/bottomk k must be integer 1..100");
    }
    return {
      type: "topk",
      k,
      bottom: top[1] === "bottomk",
      inner: parseMetricQuery(args[1]!),
    };
  }

  const hq = /^histogram_quantile\s*\((.+)\)$/s.exec(q);
  if (hq) {
    const args = splitArgs(hq[1]!);
    if (args.length !== 2) throw new MetricParseError("histogram_quantile expects (phi, expr)");
    const phi = Number(args[0]);
    if (!Number.isFinite(phi) || phi <= 0 || phi >= 1) {
      throw new MetricParseError("histogram_quantile phi must be in (0,1)");
    }
    return {
      type: "histogram_quantile",
      q: phi,
      inner: parseMetricQuery(args[1]!),
    };
  }

  const agg = /^(sum|avg)\s+by\s*\(([^)]*)\)\s*\((.+)\)$/s.exec(q);
  if (agg) {
    const by = agg[2]!
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    return {
      type: "agg",
      op: agg[1] as "sum" | "avg",
      by,
      inner: parseMetricQuery(agg[3]!),
    };
  }

  const fn =
    /^(rate|increase|avg_over_time|sum_over_time|max_over_time)\s*\((.+)\[([^\]]+)\]\s*\)$/s.exec(
      q,
    );
  if (fn) {
    return {
      type: "func",
      fn: fn[1] as "rate" | "increase" | "avg_over_time" | "sum_over_time" | "max_over_time",
      rangeMs: parseDurationMs(fn[3]!),
      inner: parseMetricQuery(fn[2]!),
    };
  }

  return parseSelector(q);
}

export function leafSelector(ast: MetricAst): { name: string; matchers: LabelMatcher[] } {
  if (ast.type === "selector") return ast;
  if (ast.type === "func") return leafSelector(ast.inner);
  if (ast.type === "agg") return leafSelector(ast.inner);
  if (ast.type === "topk") return leafSelector(ast.inner);
  return leafSelector(ast.inner);
}
