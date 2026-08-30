import { describe, expect, it } from "vitest";
import { tokenize } from "../../src/domain/query/lexer.js";
import { parseQuery } from "../../src/domain/query/parser.js";
import { validateSemantics } from "../../src/domain/query/semantic.js";
import { buildPlan, streamMatchesSelector } from "../../src/domain/query/planner.js";
import { executeEntries } from "../../src/domain/query/executor.js";
import { DEFAULT_QUERY_LIMITS } from "../../src/domain/query/query-limits.js";
import { createLabelSet } from "../../src/domain/logs/labels.js";
import type { LogStream } from "../../src/domain/logs/log-stream.js";
import { asStreamId, asTenantId } from "../../src/shared/ids.js";

const stream = (labels: Record<string, string>, id = "s1"): LogStream => ({
  id: asStreamId(id),
  tenantId: asTenantId("t"),
  fingerprint: "fp",
  labels: createLabelSet(labels),
  createdAt: 0,
  lastSeenAt: 0,
});

describe("lexer", () => {
  it("tokenizes a selector", () => {
    const kinds = tokenize('{service="api"}').map((t) => t.kind);
    expect(kinds).toEqual(["lbrace", "ident", "eq", "string", "rbrace", "eof"]);
  });
});

describe("parser", () => {
  it("parses matchers, filters, json, and aggregation", () => {
    const ast = parseQuery(
      'count_over_time({service="api"} |= "error" | json | level="error" [5m])',
    );
    expect(ast.type).toBe("aggregation");
    if (ast.type === "aggregation") {
      expect(ast.fn).toBe("count_over_time");
      expect(ast.range.milliseconds).toBe(300_000);
      expect(ast.selector.pipeline).toHaveLength(3);
    }
  });
  it("rejects unknown functions", () => {
    expect(() => parseQuery('sum({service="api"})')).toThrow();
  });
});

describe("semantic", () => {
  it("rejects empty selectors and dangerous regex", () => {
    expect(() => validateSemantics(parseQuery("{}"))).toThrow();
    expect(() => validateSemantics(parseQuery('{service=~"(a+)+"}'))).toThrow();
  });
  it("accepts a valid selector", () => {
    expect(() => validateSemantics(parseQuery('{service="api"}'))).not.toThrow();
  });
});

describe("planner + executor", () => {
  it("filters streams and lines", () => {
    const ast = parseQuery('{service="api"} |= "boom"');
    validateSemantics(ast);
    const streams = [stream({ service: "api" }, "a"), stream({ service: "web" }, "w")];
    const plan = buildPlan(
      ast,
      streams,
      [
        {
          id: "c1",
          tenantId: asTenantId("t"),
          streamId: asStreamId("a"),
          startTime: 100,
          endTime: 200,
          entryCount: 1,
          compressedSize: 10,
          checksum: "x",
          objectKey: "k",
          status: "ready",
          createdAt: 0,
        },
      ],
      { start: 0, end: 1000 },
      DEFAULT_QUERY_LIMITS,
    );
    expect(plan.streamIds).toEqual(["a"]);
    const result = executeEntries(
      plan,
      new Map([
        [
          "a",
          {
            labels: { service: "api" },
            entries: [
              { timestamp: 150, line: "boom happened", fields: {}, traceId: "tr", spanId: null },
              { timestamp: 160, line: "ok", fields: {}, traceId: null, spanId: null },
            ],
          },
        ],
      ]),
      100,
    );
    expect(result.hits).toHaveLength(1);
    expect(result.hits[0]?.traceId).toBe("tr");
  });

  it("matches inequality", () => {
    const ast = parseQuery('{service!="api"}');
    expect(
      streamMatchesSelector(
        stream({ service: "web" }),
        ast.type === "selector" ? ast : ast.selector,
      ),
    ).toBe(true);
  });
});
