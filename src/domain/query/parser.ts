import type {
  Aggregation,
  LabelMatcher,
  MatcherOp,
  PipelineStage,
  QueryAst,
  Selector,
} from "./ast.js";
import { LexerError, tokenize, type Token, type TokenKind } from "./lexer.js";

export class ParseError extends Error {
  public readonly index: number;
  public constructor(message: string, index: number) {
    super(message);
    this.name = "ParseError";
    this.index = index;
  }
}

class Cursor {
  private i = 0;
  public constructor(private readonly tokens: Token[]) {}

  public peek(): Token {
    return this.tokens[this.i] ?? this.tokens[this.tokens.length - 1]!;
  }

  public eat(kind: TokenKind, message: string): Token {
    const token = this.peek();
    if (token.kind !== kind) {
      throw new ParseError(message, token.index);
    }
    this.i += 1;
    return token;
  }

  public tryEat(kind: TokenKind): Token | null {
    if (this.peek().kind === kind) {
      const token = this.peek();
      this.i += 1;
      return token;
    }
    return null;
  }
}

function parseDurationMs(raw: string): number {
  const match = /^([0-9]+)(ms|s|m|h|d)$/.exec(raw);
  if (!match) {
    throw new ParseError("Invalid duration.", 0);
  }
  const n = Number(match[1]);
  switch (match[2]) {
    case "ms":
      return n;
    case "s":
      return n * 1000;
    case "m":
      return n * 60_000;
    case "h":
      return n * 3_600_000;
    case "d":
      return n * 86_400_000;
    default:
      throw new ParseError("Invalid duration unit.", 0);
  }
}

function parseMatcherOp(cur: Cursor): MatcherOp {
  const token = cur.peek();
  if (token.kind === "eq") {
    cur.eat("eq", "Expected matcher.");
    return "=";
  }
  if (token.kind === "neq") {
    cur.eat("neq", "Expected matcher.");
    return "!=";
  }
  if (token.kind === "re") {
    cur.eat("re", "Expected matcher.");
    return "=~";
  }
  if (token.kind === "nre") {
    cur.eat("nre", "Expected matcher.");
    return "!~";
  }
  throw new ParseError("Expected label matcher operator.", token.index);
}

function parseMatcher(cur: Cursor): LabelMatcher {
  const name = cur.eat("ident", "Expected label name.");
  const op = parseMatcherOp(cur);
  const value = cur.eat("string", "Expected label value string.");
  return { type: "matcher", name: name.value, op, value: value.value };
}

function parsePipeline(cur: Cursor): PipelineStage[] {
  const stages: PipelineStage[] = [];
  for (;;) {
    if (cur.tryEat("pipeEq")) {
      const value = cur.eat("string", "Expected string after |=.");
      stages.push({ type: "lineContains", value: value.value });
      continue;
    }
    if (cur.tryEat("pipeRe")) {
      const value = cur.eat("string", "Expected string after |~.");
      stages.push({ type: "lineRegex", value: value.value });
      continue;
    }
    if (cur.tryEat("pipe")) {
      const ident = cur.eat("ident", "Expected pipeline stage.");
      if (ident.value === "json") {
        stages.push({ type: "json" });
        continue;
      }
      const opToken = cur.peek();
      let op: "=" | "!=" = "=";
      if (opToken.kind === "eq") {
        cur.eat("eq", "Expected =.");
      } else if (opToken.kind === "neq") {
        cur.eat("neq", "Expected !=.");
        op = "!=";
      } else {
        throw new ParseError("Expected structured filter operator.", opToken.index);
      }
      const value = cur.eat("string", "Expected filter value.");
      stages.push({ type: "structured", field: ident.value, op, value: value.value });
      continue;
    }
    break;
  }
  return stages;
}

function parseSelector(cur: Cursor): Selector {
  cur.eat("lbrace", "Expected {selector}.");
  const matchers: LabelMatcher[] = [];
  if (cur.peek().kind !== "rbrace") {
    matchers.push(parseMatcher(cur));
    while (cur.tryEat("comma")) {
      matchers.push(parseMatcher(cur));
    }
  }
  cur.eat("rbrace", "Expected closing }.");
  return { type: "selector", matchers, pipeline: parsePipeline(cur) };
}

export function parseQuery(input: string): QueryAst {
  if (input.length === 0) {
    throw new ParseError("Query is empty.", 0);
  }
  let tokens: Token[];
  try {
    tokens = tokenize(input);
  } catch (error) {
    if (error instanceof LexerError) {
      throw new ParseError(error.message, error.index);
    }
    throw error;
  }
  const cur = new Cursor(tokens);
  if (cur.peek().kind === "ident") {
    const fn = cur.eat("ident", "Expected function.");
    if (fn.value !== "count_over_time" && fn.value !== "rate") {
      throw new ParseError("Unknown function.", fn.index);
    }
    cur.eat("lparen", "Expected (.");
    const selector = parseSelector(cur);
    const rangeTok = cur.eat("duration", "Expected [duration].");
    cur.eat("rparen", "Expected ).");
    cur.eat("eof", "Unexpected input after query.");
    const aggregation: Aggregation = {
      type: "aggregation",
      fn: fn.value,
      selector,
      range: { milliseconds: parseDurationMs(rangeTok.value), raw: rangeTok.value },
    };
    return aggregation;
  }
  const selector = parseSelector(cur);
  cur.eat("eof", "Unexpected input after query.");
  return selector;
}
