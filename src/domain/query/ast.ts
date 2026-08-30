export type MatcherOp = "=" | "!=" | "=~" | "!~";

export interface LabelMatcher {
  readonly type: "matcher";
  readonly name: string;
  readonly op: MatcherOp;
  readonly value: string;
}

export interface LineFilter {
  readonly type: "lineContains" | "lineRegex";
  readonly value: string;
}

export interface StructuredFilter {
  readonly type: "structured";
  readonly field: string;
  readonly op: "=" | "!=";
  readonly value: string;
}

export interface JsonParser {
  readonly type: "json";
}

export type PipelineStage = LineFilter | StructuredFilter | JsonParser;

export interface Selector {
  readonly type: "selector";
  readonly matchers: readonly LabelMatcher[];
  readonly pipeline: readonly PipelineStage[];
}

export interface Range {
  readonly milliseconds: number;
  readonly raw: string;
}

export interface Aggregation {
  readonly type: "aggregation";
  readonly fn: "count_over_time" | "rate";
  readonly selector: Selector;
  readonly range: Range;
}

export type QueryAst = Selector | Aggregation;
