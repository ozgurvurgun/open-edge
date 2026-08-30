export const FORBIDDEN_STREAM_LABELS = new Set(["user_id", "request_id", "trace_id", "session_id"]);

export const MAX_LABELS_PER_STREAM = 20;
export const MAX_LABEL_KEY_LENGTH = 64;
export const MAX_LABEL_VALUE_LENGTH = 256;
export const MAX_STREAMS_PER_TENANT = 10_000;

export interface LabelSet {
  readonly entries: Readonly<Record<string, string>>;
}

export function normalizeLabelKey(key: string): string {
  return key.trim().toLowerCase();
}

export function createLabelSet(raw: Record<string, string>): LabelSet {
  const entries: Record<string, string> = {};
  const keys = Object.keys(raw).sort();
  for (const key of keys) {
    entries[normalizeLabelKey(key)] = raw[key]!.trim();
  }
  return { entries };
}

export function fingerprintLabels(labels: LabelSet): string {
  return Object.entries(labels.entries)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}=${v}`)
    .join(",");
}

export function labelSetError(labels: LabelSet): string | null {
  const keys = Object.keys(labels.entries);
  if (keys.length === 0) {
    return "At least one stream label is required.";
  }
  if (keys.length > MAX_LABELS_PER_STREAM) {
    return `A stream may have at most ${MAX_LABELS_PER_STREAM} labels.`;
  }
  for (const key of keys) {
    if (FORBIDDEN_STREAM_LABELS.has(key)) {
      return `Label "${key}" is high-cardinality and cannot identify a stream.`;
    }
    if (!/^[a-z_][a-z0-9_]*$/.test(key) || key.length > MAX_LABEL_KEY_LENGTH) {
      return `Invalid label name "${key}".`;
    }
    const value = labels.entries[key] ?? "";
    if (value.length === 0 || value.length > MAX_LABEL_VALUE_LENGTH) {
      return `Invalid label value for "${key}".`;
    }
  }
  return null;
}
