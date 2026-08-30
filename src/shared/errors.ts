export const ErrorCodes = {
  VALIDATION_FAILED: "VALIDATION_FAILED",
  UNAUTHENTICATED: "UNAUTHENTICATED",
  FORBIDDEN: "FORBIDDEN",
  NOT_FOUND: "NOT_FOUND",
  CONFLICT: "CONFLICT",
  AUTH_RATE_LIMITED: "AUTH_RATE_LIMITED",
  RATE_LIMITED: "RATE_LIMITED",
  INVALID_CREDENTIALS: "INVALID_CREDENTIALS",
  SESSION_EXPIRED: "SESSION_EXPIRED",
  TENANT_DISABLED: "TENANT_DISABLED",
  CARDINALITY_EXCEEDED: "CARDINALITY_EXCEEDED",
  QUERY_INVALID: "QUERY_INVALID",
  QUERY_LIMIT_EXCEEDED: "QUERY_LIMIT_EXCEEDED",
  QUERY_TIMEOUT: "QUERY_TIMEOUT",
  PAYLOAD_TOO_LARGE: "PAYLOAD_TOO_LARGE",
  CSRF_REJECTED: "CSRF_REJECTED",
  INTERNAL: "INTERNAL",
} as const;

export type ErrorCode = (typeof ErrorCodes)[keyof typeof ErrorCodes];

export class AppError extends Error {
  public readonly code: ErrorCode;
  public readonly httpStatus: number;

  public constructor(code: ErrorCode, message: string, httpStatus: number) {
    super(message);
    this.name = "AppError";
    this.code = code;
    this.httpStatus = httpStatus;
  }
}

export function publicErrorMessage(code: ErrorCode, fallback: string): string {
  return fallback;
}

export function toPublicError(error: unknown): {
  code: ErrorCode;
  message: string;
  httpStatus: number;
} {
  if (error instanceof AppError) {
    return { code: error.code, message: error.message, httpStatus: error.httpStatus };
  }
  return {
    code: ErrorCodes.INTERNAL,
    message: "An unexpected error occurred.",
    httpStatus: 500,
  };
}
