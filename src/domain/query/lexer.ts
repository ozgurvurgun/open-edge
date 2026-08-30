export type TokenKind =
  | "lbrace"
  | "rbrace"
  | "lparen"
  | "rparen"
  | "comma"
  | "eq"
  | "neq"
  | "re"
  | "nre"
  | "pipeEq"
  | "pipeRe"
  | "pipe"
  | "ident"
  | "string"
  | "duration"
  | "eof";

export interface Token {
  readonly kind: TokenKind;
  readonly value: string;
  readonly index: number;
}

export class LexerError extends Error {
  public readonly index: number;
  public constructor(message: string, index: number) {
    super(message);
    this.name = "LexerError";
    this.index = index;
  }
}

const IDENT = /[A-Za-z_][A-Za-z0-9_]*/y;
const DURATION = /[0-9]+(ms|s|m|h|d)/y;

export function tokenize(input: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  while (i < input.length) {
    const ch = input[i]!;
    if (ch === " " || ch === "\t" || ch === "\n" || ch === "\r") {
      i += 1;
      continue;
    }
    if (ch === "{") {
      tokens.push({ kind: "lbrace", value: ch, index: i });
      i += 1;
      continue;
    }
    if (ch === "}") {
      tokens.push({ kind: "rbrace", value: ch, index: i });
      i += 1;
      continue;
    }
    if (ch === "(") {
      tokens.push({ kind: "lparen", value: ch, index: i });
      i += 1;
      continue;
    }
    if (ch === ")") {
      tokens.push({ kind: "rparen", value: ch, index: i });
      i += 1;
      continue;
    }
    if (ch === ",") {
      tokens.push({ kind: "comma", value: ch, index: i });
      i += 1;
      continue;
    }
    if (ch === "[") {
      const close = input.indexOf("]", i);
      if (close < 0) {
        throw new LexerError("Unterminated duration range.", i);
      }
      const raw = input.slice(i + 1, close);
      DURATION.lastIndex = 0;
      if (!DURATION.test(raw) || DURATION.lastIndex !== raw.length) {
        throw new LexerError("Invalid duration.", i);
      }
      tokens.push({ kind: "duration", value: raw, index: i });
      i = close + 1;
      continue;
    }
    if (ch === '"') {
      let j = i + 1;
      let out = "";
      while (j < input.length) {
        const c = input[j]!;
        if (c === "\\") {
          const n = input[j + 1];
          if (n === undefined) {
            throw new LexerError("Unterminated string.", i);
          }
          out += n;
          j += 2;
          continue;
        }
        if (c === '"') {
          tokens.push({ kind: "string", value: out, index: i });
          i = j + 1;
          break;
        }
        out += c;
        j += 1;
      }
      if (j >= input.length && (tokens.at(-1)?.kind !== "string" || tokens.at(-1)?.index !== i)) {
        throw new LexerError("Unterminated string.", i);
      }
      continue;
    }
    if (ch === "!" && input[i + 1] === "=") {
      tokens.push({ kind: "neq", value: "!=", index: i });
      i += 2;
      continue;
    }
    if (ch === "!" && input[i + 1] === "~") {
      tokens.push({ kind: "nre", value: "!~", index: i });
      i += 2;
      continue;
    }
    if (ch === "=" && input[i + 1] === "~") {
      tokens.push({ kind: "re", value: "=~", index: i });
      i += 2;
      continue;
    }
    if (ch === "=") {
      tokens.push({ kind: "eq", value: "=", index: i });
      i += 1;
      continue;
    }
    if (ch === "|" && input[i + 1] === "=") {
      tokens.push({ kind: "pipeEq", value: "|=", index: i });
      i += 2;
      continue;
    }
    if (ch === "|" && input[i + 1] === "~") {
      tokens.push({ kind: "pipeRe", value: "|~", index: i });
      i += 2;
      continue;
    }
    if (ch === "|") {
      tokens.push({ kind: "pipe", value: "|", index: i });
      i += 1;
      continue;
    }
    IDENT.lastIndex = i;
    const ident = IDENT.exec(input);
    if (ident) {
      tokens.push({ kind: "ident", value: ident[0], index: i });
      i = IDENT.lastIndex;
      continue;
    }
    throw new LexerError(`Unexpected character "${ch}".`, i);
  }
  tokens.push({ kind: "eof", value: "", index: i });
  return tokens;
}
