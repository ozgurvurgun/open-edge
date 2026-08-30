import { describe, expect, it } from "vitest";
import { parseQuery } from "../../src/domain/query/parser.js";
import { tokenize } from "../../src/domain/query/lexer.js";
import { createLabelSet, labelSetError } from "../../src/domain/logs/labels.js";

function randomString(seed: number, len: number): string {
  let x = seed;
  let out = "";
  for (let i = 0; i < len; i += 1) {
    x = (x * 1664525 + 1013904223) >>> 0;
    out += String.fromCharCode(32 + (x % 95));
  }
  return out;
}

describe("query fuzz", () => {
  it("never throws non-parse errors", () => {
    for (let i = 0; i < 200; i += 1) {
      const input = randomString(i + 1, 40);
      try {
        tokenize(input);
        parseQuery(input);
      } catch (error) {
        expect(error).toBeInstanceOf(Error);
        expect(
          (error as Error).name === "ParseError" || (error as Error).name === "LexerError",
        ).toBe(true);
      }
    }
  });
});

describe("label fuzz", () => {
  it("never throws", () => {
    for (let i = 0; i < 100; i += 1) {
      const raw = { [randomString(i, 8)]: randomString(i + 9, 12) };
      expect(() => labelSetError(createLabelSet(raw))).not.toThrow();
    }
  });
});
