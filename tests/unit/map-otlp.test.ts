import { describe, expect, it } from "vitest";
import { mapOtlpLogs, mapOtlpMetrics, mapOtlpTraces } from "../../src/application/otlp/map-otlp.js";

describe("mapOtlpLogs", () => {
  it("maps resource + log records", () => {
    const events = mapOtlpLogs({
      resourceLogs: [
        {
          resource: {
            attributes: [
              { key: "service.name", value: { stringValue: "checkout" } },
              { key: "deployment.environment", value: { stringValue: "prod" } },
            ],
          },
          scopeLogs: [
            {
              logRecords: [
                {
                  timeUnixNano: "1700000000000000000",
                  body: { stringValue: "hello" },
                  severityText: "INFO",
                  traceId: "aabbccddeeff00112233445566778899",
                },
              ],
            },
          ],
        },
      ],
    });
    expect(events).toHaveLength(1);
    expect(events[0]!.line).toBe("hello");
    expect(events[0]!.labels.service).toBe("checkout");
    expect(events[0]!.labels.level).toBe("info");
    expect(events[0]!.traceId).toBe("aabbccddeeff00112233445566778899");
  });
});

describe("mapOtlpTraces", () => {
  it("groups spans by trace id", () => {
    const events = mapOtlpTraces({
      resourceSpans: [
        {
          resource: {
            attributes: [{ key: "service.name", value: { stringValue: "api" } }],
          },
          scopeSpans: [
            {
              spans: [
                {
                  traceId: "t1",
                  spanId: "s1",
                  name: "GET /",
                  startTimeUnixNano: "1000000000",
                  endTimeUnixNano: "2000000000",
                  status: { code: 1 },
                },
                {
                  traceId: "t1",
                  spanId: "s2",
                  parentSpanId: "s1",
                  name: "db",
                  startTimeUnixNano: "1100000000",
                  endTimeUnixNano: "1500000000",
                  status: { code: 2 },
                },
              ],
            },
          ],
        },
      ],
    });
    expect(events).toHaveLength(1);
    expect(events[0]!.spans).toHaveLength(2);
    expect(events[0]!.spans[1]!.status).toBe("error");
  });
});

describe("mapOtlpMetrics", () => {
  it("maps sum data points as counters", () => {
    const events = mapOtlpMetrics({
      resourceMetrics: [
        {
          resource: {
            attributes: [{ key: "service.name", value: { stringValue: "api" } }],
          },
          scopeMetrics: [
            {
              metrics: [
                {
                  name: "http.server.duration",
                  sum: {
                    dataPoints: [
                      {
                        asDouble: 12.5,
                        timeUnixNano: "1700000000000000000",
                        attributes: [{ key: "route", value: { stringValue: "/" } }],
                      },
                    ],
                  },
                },
              ],
            },
          ],
        },
      ],
    });
    expect(events).toHaveLength(1);
    expect(events[0]!.name).toBe("http_server_duration");
    expect(events[0]!.type).toBe("counter");
    expect(events[0]!.value).toBe(12.5);
    expect(events[0]!.labels.route).toBe("/");
  });
});
