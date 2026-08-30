export interface QueryLimits {
  readonly maxQueryLength: number;
  readonly maxTimeRangeMs: number;
  readonly maxResultRows: number;
  readonly maxStreams: number;
  readonly maxChunks: number;
  readonly maxDurationMs: number;
  readonly maxRegexLength: number;
}

export const DEFAULT_QUERY_LIMITS: QueryLimits = {
  maxQueryLength: 4096,
  maxTimeRangeMs: 30 * 24 * 60 * 60 * 1000,
  maxResultRows: 5000,
  maxStreams: 100,
  maxChunks: 200,
  maxDurationMs: 8000,
  maxRegexLength: 256,
};

export function isDangerousRegex(pattern: string): boolean {
  if (pattern.length > DEFAULT_QUERY_LIMITS.maxRegexLength) {
    return true;
  }
  if (/[+*]{2,}/.test(pattern)) {
    return true;
  }
  if (/(\.\*){3,}/.test(pattern) || /(\.\+){3,}/.test(pattern)) {
    return true;
  }
  if (/\([^)]*[+*]\)[+*]/.test(pattern)) {
    return true;
  }
  return false;
}

export function compileSafeRegex(pattern: string): RegExp | null {
  if (isDangerousRegex(pattern)) {
    return null;
  }
  try {
    return new RegExp(pattern);
  } catch {
    return null;
  }
}
