import { describe, expect, it } from "vitest";
import { parseMetricQuery } from "../../src/domain/metrics/query/parse.js";
import { executeMetricAst, quantileFromBuckets } from "../../src/domain/metrics/query/execute.js";

describe("topk / bottomk / histogram_quantile parse", () => {
  it("parses topk", () => {
    const ast = parseMetricQuery("topk(5, rate(http_requests_total[5m]))");
    expect(ast.type).toBe("topk");
    if (ast.type === "topk") {
      expect(ast.k).toBe(5);
      expect(ast.bottom).toBe(false);
    }
  });

  it("parses bottomk and histogram_quantile", () => {
    expect(parseMetricQuery("bottomk(3, avg_over_time(x[1m]))").type).toBe("topk");
    const hq = parseMetricQuery("histogram_quantile(0.95, latency_ms)");
    expect(hq.type).toBe("histogram_quantile");
    if (hq.type === "histogram_quantile") expect(hq.q).toBe(0.95);
  });
});

describe("topk execute", () => {
  it("keeps highest last values", () => {
    const ast = parseMetricQuery("topk(2, http_requests_total)");
    const start = 1_000;
    const end = 2_000;
    const result = executeMetricAst(
      ast,
      [
        { labels: { route: "a" }, samples: [{ timestamp: end, value: 10 }] },
        { labels: { route: "b" }, samples: [{ timestamp: end, value: 50 }] },
        { labels: { route: "c" }, samples: [{ timestamp: end, value: 30 }] },
      ],
      start,
      end,
      1000,
    );
    expect(result.result).toHaveLength(2);
    const routes = result.result.map((r) => r.metric.route).sort();
    expect(routes).toEqual(["b", "c"]);
  });
});

describe("histogram_quantile", () => {
  it("computes from sample buckets", () => {
    expect(quantileFromBuckets({ "10": 50, "50": 40, "100": 10, "+Inf": 0 }, 0.5)).toBe(10);
    const ast = parseMetricQuery("histogram_quantile(0.95, latency_ms)");
    const end = 5_000;
    const result = executeMetricAst(
      ast,
      [
        {
          labels: { service: "api" },
          samples: [
            {
              timestamp: end,
              value: 0,
              buckets: { "25": 80, "50": 15, "100": 4, "+Inf": 1 },
            },
          ],
        },
      ],
      1_000,
      end,
      1000,
    );
    expect(result.resultType).toBe("matrix");
    if (result.resultType !== "matrix") throw new Error("expected matrix");
    expect(result.result[0]!.values.length).toBeGreaterThan(0);
    const last = Number(result.result[0]!.values.at(-1)![1]);
    expect(last).toBeGreaterThanOrEqual(25);
  });

  it("computes from le-labeled series", () => {
    const ast = parseMetricQuery("histogram_quantile(0.5, http_bucket)");
    const end = 5_000;
    const result = executeMetricAst(
      ast,
      [
        { labels: { le: "10", route: "/" }, samples: [{ timestamp: end, value: 50 }] },
        { labels: { le: "50", route: "/" }, samples: [{ timestamp: end, value: 90 }] },
        { labels: { le: "+Inf", route: "/" }, samples: [{ timestamp: end, value: 100 }] },
      ],
      1_000,
      end,
      1000,
    );
    expect(result.resultType).toBe("matrix");
    if (result.resultType !== "matrix") throw new Error("expected matrix");
    expect(result.result).toHaveLength(1);
    expect(Number(result.result[0]!.values.at(-1)![1])).toBe(10);
  });
});
