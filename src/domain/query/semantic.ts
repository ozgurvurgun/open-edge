import type { QueryAst, Selector } from "./ast.js";
import { compileSafeRegex } from "./query-limits.js";
import { DEFAULT_QUERY_LIMITS, type QueryLimits } from "./query-limits.js";

export class SemanticError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "SemanticError";
  }
}

function validateSelector(selector: Selector, limits: QueryLimits): void {
  if (selector.matchers.length === 0) {
    throw new SemanticError("Selector must include at least one label matcher.");
  }
  for (const matcher of selector.matchers) {
    if (matcher.op === "=~" || matcher.op === "!~") {
      if (!compileSafeRegex(matcher.value)) {
        throw new SemanticError("Unsafe or invalid regular expression in matcher.");
      }
    }
  }
  for (const stage of selector.pipeline) {
    if (stage.type === "lineRegex" && !compileSafeRegex(stage.value)) {
      throw new SemanticError("Unsafe or invalid regular expression in line filter.");
    }
  }
  if (selector.matchers.length > limits.maxStreams) {
    throw new SemanticError("Too many matchers.");
  }
}

export function validateSemantics(ast: QueryAst, limits: QueryLimits = DEFAULT_QUERY_LIMITS): void {
  if (ast.type === "selector") {
    validateSelector(ast, limits);
    return;
  }
  validateSelector(ast.selector, limits);
  if (ast.range.milliseconds <= 0 || ast.range.milliseconds > limits.maxTimeRangeMs) {
    throw new SemanticError("Aggregation range is outside allowed limits.");
  }
}
