export const LATENCY_BUCKETS_MS = [
  1, 2, 5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000, 10_000, 30_000,
] as const;

export type LatencyHist = Record<string, number>;

export function emptyLatencyHist(): LatencyHist {
  const h: LatencyHist = {};
  for (const b of LATENCY_BUCKETS_MS) h[String(b)] = 0;
  h["+Inf"] = 0;
  return h;
}

export function observeLatency(hist: LatencyHist, durationMs: number): LatencyHist {
  const next = { ...hist };
  const d = Math.max(0, durationMs);
  let placed = false;
  for (const b of LATENCY_BUCKETS_MS) {
    if (d <= b) {
      next[String(b)] = (next[String(b)] ?? 0) + 1;
      placed = true;
      break;
    }
  }
  if (!placed) next["+Inf"] = (next["+Inf"] ?? 0) + 1;
  return next;
}

export function mergeLatencyHist(a: LatencyHist, b: LatencyHist): LatencyHist {
  const out = emptyLatencyHist();
  for (const key of Object.keys(out)) {
    out[key] = (a[key] ?? 0) + (b[key] ?? 0);
  }
  for (const key of Object.keys(a)) {
    if (!(key in out)) out[key] = a[key] ?? 0;
  }
  for (const key of Object.keys(b)) {
    if (!(key in out)) out[key] = (out[key] ?? 0) + (b[key] ?? 0);
  }
  return out;
}

export function quantileFromHist(hist: LatencyHist, q: number): number {
  const total = Object.values(hist).reduce((s, n) => s + n, 0);
  if (total === 0) return 0;
  const target = Math.max(1, Math.ceil(total * q));
  let cum = 0;
  const ordered = [...LATENCY_BUCKETS_MS.map(String), "+Inf"];
  for (const key of ordered) {
    cum += hist[key] ?? 0;
    if (cum >= target) {
      if (key === "+Inf") return LATENCY_BUCKETS_MS[LATENCY_BUCKETS_MS.length - 1]!;
      return Number(key);
    }
  }
  return 0;
}

export function parseHistJson(raw: string | null | undefined): LatencyHist {
  if (!raw) return emptyLatencyHist();
  try {
    const parsed = JSON.parse(raw) as LatencyHist;
    return mergeLatencyHist(emptyLatencyHist(), parsed);
  } catch {
    return emptyLatencyHist();
  }
}
