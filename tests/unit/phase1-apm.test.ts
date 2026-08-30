import { describe, expect, it } from "vitest";
import { parseMetricQuery } from "../../src/domain/metrics/query/parse.js";
import { executeMetricAst, matrixToScalar } from "../../src/domain/metrics/query/execute.js";
import {
  observeLatency,
  emptyLatencyHist,
  quantileFromHist,
} from "../../src/domain/apm/histogram.js";
import { compareThreshold } from "../../src/domain/alerting/alert.js";
import { evaluateAllAlerts } from "../../src/application/alerting/evaluate.js";
import { createMemoryContainer } from "../../src/composition/memory-container.js";
import { asAlertId, asTenantId, asUserId } from "../../src/shared/ids.js";

describe("metric query parse", () => {
  it("parses rate and sum by", () => {
    const ast = parseMetricQuery('sum by (service) (rate(http_requests_total{env="prod"}[5m]))');
    expect(ast.type).toBe("agg");
  });
});

describe("metric execute", () => {
  it("computes rate matrix and scalar", () => {
    const ast = parseMetricQuery("rate(http_requests_total[2m])");
    const start = 1_000_000;
    const end = 1_120_000;
    const result = executeMetricAst(
      ast,
      [
        {
          labels: { service: "api" },
          samples: [
            { timestamp: end - 90_000, value: 10 },
            { timestamp: end - 30_000, value: 70 },
          ],
        },
      ],
      start,
      end,
      30_000,
    );
    expect(result.resultType).toBe("matrix");
    expect(result.result.length).toBe(1);
    expect(matrixToScalar(result)).toBeGreaterThan(0);
  });
});

describe("latency histogram", () => {
  it("estimates percentiles", () => {
    let h = emptyLatencyHist();
    for (let i = 0; i < 100; i += 1) h = observeLatency(h, 40);
    for (let i = 0; i < 5; i += 1) h = observeLatency(h, 900);
    expect(quantileFromHist(h, 0.5)).toBeLessThanOrEqual(50);
    expect(quantileFromHist(h, 0.99)).toBeGreaterThanOrEqual(500);
  });
});

describe("alert evaluation", () => {
  it("fires and posts webhook on threshold breach", async () => {
    const { container } = createMemoryContainer();
    const tenantId = asTenantId("t1");
    const alertId = asAlertId("a1");
    const webhooks: unknown[] = [];
    await container.alerts.save({
      id: alertId,
      tenantId,
      name: "always",
      query: "http_requests_total",
      kind: "metrics",
      threshold: -1,
      comparator: "gt",
      windowSeconds: 60,
      forSeconds: 0,
      webhookUrl: "https://example.test/hook",
      enabled: true,
      createdBy: asUserId("u1"),
      createdAt: 1,
      updatedAt: 1,
    });

    const env = {
      ALERT_COORDINATOR: {
        idFromName: () => "id",
        get: () => ({
          fetch: async () => Response.json({ acquired: true }),
        }),
      },
    } as never;

    await evaluateAllAlerts({
      alerts: container.alerts,
      clock: container.clock,
      ids: container.ids,
      streams: container.streams,
      chunks: container.chunks,
      objects: container.objects,
      compressor: container.compressor,
      cache: container.cache,
      usage: container.usage,
      metrics: container.metrics,
      series: container.series,
      metricChunks: container.metricChunks,
      env,
      fetchImpl: (async (_url, init) => {
        webhooks.push(JSON.parse(String(init?.body)));
        return new Response("ok");
      }) as typeof fetch,
    });

    const state = await container.alerts.getState(alertId);
    expect(state?.status).toBe("firing");
    expect(compareThreshold(state!.lastValue ?? 0, "gt", -1)).toBe(true);
    expect(webhooks.length).toBe(1);
  });
});
