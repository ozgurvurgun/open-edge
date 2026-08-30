import { compileSafeRegex } from "../../query/query-limits.js";
import type { MetricSample, MetricSeries } from "../metric.js";
import { leafSelector, type LabelMatcher, type MetricAst } from "./parse.js";

export type MatrixSeries = {
  metric: Record<string, string>;
  values: Array<[number, string]>;
};

export type VectorSeries = {
  metric: Record<string, string>;
  value: [number, string];
};

export type MetricQueryResult =
  | { resultType: "matrix"; result: MatrixSeries[] }
  | { resultType: "vector"; result: VectorSeries[] };

function matchLabels(labels: Record<string, string>, matchers: readonly LabelMatcher[]): boolean {
  for (const m of matchers) {
    const actual = labels[m.label] ?? "";
    if (m.op === "=" && actual !== m.value) return false;
    if (m.op === "!=" && actual === m.value) return false;
    if (m.op === "=~") {
      const re = compileSafeRegex(m.value);
      if (!re || !re.test(actual)) return false;
    }
    if (m.op === "!~") {
      const re = compileSafeRegex(m.value);
      if (!re || re.test(actual)) return false;
    }
  }
  return true;
}

export function filterSeries(
  series: readonly MetricSeries[],
  name: string,
  matchers: readonly LabelMatcher[],
): MetricSeries[] {
  return series.filter(
    (s) => s.name === name && matchLabels(s.labels.entries as Record<string, string>, matchers),
  );
}

function stepAlign(start: number, end: number, stepMs: number): number[] {
  const out: number[] = [];
  const step = Math.max(1000, stepMs);
  for (let t = start; t <= end; t += step) out.push(t);
  if (out.length === 0 || out[out.length - 1]! < end) out.push(end);
  return out.slice(0, 1100);
}

function sampleAt(samples: MetricSample[], t: number): MetricSample | null {
  let best: MetricSample | null = null;
  for (const s of samples) {
    if (s.timestamp <= t) best = s;
    else break;
  }
  return best;
}

function valueAt(samples: MetricSample[], t: number): number | null {
  const s = sampleAt(samples, t);
  return s ? s.value : null;
}

function samplesInWindow(samples: MetricSample[], end: number, rangeMs: number): MetricSample[] {
  const start = end - rangeMs;
  return samples.filter((s) => s.timestamp >= start && s.timestamp <= end);
}

function applyFuncAt(
  fn: "rate" | "increase" | "avg_over_time" | "sum_over_time" | "max_over_time",
  samples: MetricSample[],
  t: number,
  rangeMs: number,
): number | null {
  const window = samplesInWindow(samples, t, rangeMs);
  if (window.length === 0) return null;
  if (fn === "avg_over_time") {
    return window.reduce((a, s) => a + s.value, 0) / window.length;
  }
  if (fn === "sum_over_time") {
    return window.reduce((a, s) => a + s.value, 0);
  }
  if (fn === "max_over_time") {
    return Math.max(...window.map((s) => s.value));
  }
  if (window.length < 2) return 0;
  const first = window[0]!;
  const last = window[window.length - 1]!;
  const delta = last.value - first.value;
  const increase = delta < 0 ? last.value : delta;
  if (fn === "increase") return increase;
  const dt = Math.max(1, (last.timestamp - first.timestamp) / 1000);
  return increase / dt;
}

export function quantileFromBuckets(buckets: Record<string, number>, phi: number): number {
  const entries = Object.entries(buckets)
    .map(([k, count]) => ({
      le: k === "+Inf" || k === "Inf" ? Number.POSITIVE_INFINITY : Number(k),
      count,
    }))
    .filter((e) => Number.isFinite(e.count) && e.count >= 0)
    .sort((a, b) => a.le - b.le);
  if (entries.length === 0) return 0;

  let cumulative = true;
  for (let i = 1; i < entries.length; i += 1) {
    if (entries[i]!.count < entries[i - 1]!.count) {
      cumulative = false;
      break;
    }
  }
  const cum: Array<{ le: number; count: number }> = [];
  let running = 0;
  for (const e of entries) {
    running = cumulative ? e.count : running + e.count;
    cum.push({ le: e.le, count: running });
  }
  const total = cum[cum.length - 1]!.count;
  if (total <= 0) return 0;
  const target = phi * total;
  for (const e of cum) {
    if (e.count >= target) {
      return Number.isFinite(e.le) ? e.le : (cum[cum.length - 2]?.le ?? 0);
    }
  }
  return Number.isFinite(cum[cum.length - 1]!.le) ? cum[cum.length - 1]!.le : 0;
}

function evalSeries(
  ast: MetricAst,
  samples: MetricSample[],
  labels: Record<string, string>,
  timestamps: number[],
): MatrixSeries {
  const values: Array<[number, string]> = [];
  for (const t of timestamps) {
    let v: number | null = null;
    if (ast.type === "selector") {
      v = valueAt(samples, t);
    } else if (ast.type === "func") {
      v = applyFuncAt(ast.fn, samples, t, ast.rangeMs);
    } else {
      v = valueAt(samples, t);
    }
    if (v !== null && Number.isFinite(v)) {
      values.push([t, String(v)]);
    }
  }
  return { metric: { ...labels }, values };
}

function fingerprintAgg(metric: Record<string, string>, by: string[]): string {
  return by.map((k) => `${k}=${metric[k] ?? ""}`).join(",");
}

function aggregate(op: "sum" | "avg", by: string[], series: MatrixSeries[]): MatrixSeries[] {
  const groups = new Map<
    string,
    { metric: Record<string, string>; points: Map<number, number[]> }
  >();
  for (const s of series) {
    const metric: Record<string, string> = {};
    for (const k of by) metric[k] = s.metric[k] ?? "";
    const key = fingerprintAgg(metric, by);
    let g = groups.get(key);
    if (!g) {
      g = { metric, points: new Map() };
      groups.set(key, g);
    }
    for (const [t, v] of s.values) {
      const arr = g.points.get(t) ?? [];
      arr.push(Number(v));
      g.points.set(t, arr);
    }
  }
  const out: MatrixSeries[] = [];
  for (const g of groups.values()) {
    const values: Array<[number, string]> = [];
    for (const [t, nums] of [...g.points.entries()].sort((a, b) => a[0] - b[0])) {
      const val =
        op === "sum"
          ? nums.reduce((a, b) => a + b, 0)
          : nums.reduce((a, b) => a + b, 0) / nums.length;
      values.push([t, String(val)]);
    }
    out.push({ metric: g.metric, values });
  }
  return out;
}

function lastValue(s: MatrixSeries): number {
  if (s.values.length === 0) return Number.NEGATIVE_INFINITY;
  return Number(s.values[s.values.length - 1]![1]);
}

function applyTopK(series: MatrixSeries[], k: number, bottom: boolean): MatrixSeries[] {
  const ranked = [...series].sort((a, b) =>
    bottom ? lastValue(a) - lastValue(b) : lastValue(b) - lastValue(a),
  );
  return ranked.slice(0, k);
}

function applyHistogramQuantile(
  phi: number,
  seriesList: Array<{ labels: Record<string, string>; samples: MetricSample[] }>,
  leafName: string,
  timestamps: number[],
): MatrixSeries[] {
  const withLe = seriesList.filter((s) => "le" in s.labels);
  if (withLe.length > 0) {
    const groups = new Map<string, Array<{ le: number; samples: MetricSample[] }>>();
    for (const s of withLe) {
      const leRaw = s.labels.le;
      const le = leRaw === "+Inf" ? Number.POSITIVE_INFINITY : Number(leRaw);
      const key = Object.keys(s.labels)
        .filter((k) => k !== "le")
        .sort()
        .map((k) => `${k}=${s.labels[k]}`)
        .join(",");
      const list = groups.get(key) ?? [];
      list.push({ le, samples: s.samples });
      groups.set(key, list);
    }
    const out: MatrixSeries[] = [];
    for (const [key, buckets] of groups) {
      const metric: Record<string, string> = { __name__: leafName };
      if (key) {
        for (const part of key.split(",")) {
          const [k, ...rest] = part.split("=");
          if (k) metric[k] = rest.join("=");
        }
      }
      const values: Array<[number, string]> = [];
      for (const t of timestamps) {
        const map: Record<string, number> = {};
        for (const b of buckets) {
          const v = valueAt(b.samples, t);
          if (v == null) continue;
          map[Number.isFinite(b.le) ? String(b.le) : "+Inf"] = v;
        }
        if (Object.keys(map).length === 0) continue;
        values.push([t, String(quantileFromBuckets(map, phi))]);
      }
      out.push({ metric, values });
    }
    return out;
  }

  return seriesList.map(({ labels, samples }) => {
    const values: Array<[number, string]> = [];
    for (const t of timestamps) {
      const s = sampleAt(samples, t);
      if (!s?.buckets || Object.keys(s.buckets).length === 0) continue;
      values.push([t, String(quantileFromBuckets(s.buckets as Record<string, number>, phi))]);
    }
    return { metric: { __name__: leafName, ...labels }, values };
  });
}

function evalInnerMatrices(
  ast: MetricAst,
  seriesList: Array<{ labels: Record<string, string>; samples: MetricSample[] }>,
  timestamps: number[],
  leafName: string,
): MatrixSeries[] {
  if (ast.type === "topk") {
    const inner = evalInnerMatrices(ast.inner, seriesList, timestamps, leafName);
    return applyTopK(inner, ast.k, ast.bottom);
  }
  if (ast.type === "histogram_quantile") {
    return applyHistogramQuantile(ast.q, seriesList, leafName, timestamps);
  }
  if (ast.type === "agg") {
    const inner = seriesList.map(({ labels, samples }) =>
      evalSeries(ast.inner, samples, { __name__: leafName, ...labels }, timestamps),
    );
    return aggregate(ast.op, ast.by, inner);
  }
  return seriesList.map(({ labels, samples }) =>
    evalSeries(ast, samples, { __name__: leafName, ...labels }, timestamps),
  );
}

export function executeMetricAst(
  ast: MetricAst,
  seriesList: Array<{ labels: Record<string, string>; samples: MetricSample[] }>,
  start: number,
  end: number,
  stepMs: number,
): MetricQueryResult {
  const timestamps = stepAlign(start, end, stepMs);
  const leaf = leafSelector(ast);
  const matrices = evalInnerMatrices(ast, seriesList, timestamps, leaf.name);
  return { resultType: "matrix", result: matrices };
}

export function matrixToScalar(result: MetricQueryResult): number {
  if (result.result.length === 0) return 0;
  let sum = 0;
  let n = 0;
  if (result.resultType === "matrix") {
    for (const s of result.result) {
      if (s.values.length === 0) continue;
      sum += Number(s.values[s.values.length - 1]![1]);
      n += 1;
    }
  } else {
    for (const s of result.result) {
      sum += Number(s.value[1]);
      n += 1;
    }
  }
  return n === 0 ? 0 : sum / n;
}
