import { describe, expect, it } from "vitest";
import protobuf from "protobufjs";
import {
  decodeOtlpLogsProto,
  decodeOtlpTracesProto,
} from "../../src/application/otlp/decode-proto.js";
import { mapOtlpLogs, mapOtlpTraces } from "../../src/application/otlp/map-otlp.js";
import { silenceIsActive } from "../../src/domain/alerting/silence.js";
import { asAlertId, asTenantId, asUserId } from "../../src/shared/ids.js";
import { createMemoryContainer } from "../../src/composition/memory-container.js";
import { createSilence } from "../../src/application/catalog/resources.js";
import type { Principal } from "../../src/application/authorization/policies.js";
import { asApiKeyId } from "../../src/shared/ids.js";

describe("silence", () => {
  it("matches alert id and window", () => {
    const s = {
      id: "1",
      tenantId: asTenantId("t"),
      alertId: asAlertId("a1"),
      startsAt: 100,
      endsAt: 200,
      comment: "",
      createdBy: asUserId("u"),
      createdAt: 100,
    };
    expect(silenceIsActive(s, 150, asAlertId("a1"))).toBe(true);
    expect(silenceIsActive(s, 150, asAlertId("a2"))).toBe(false);
    expect(silenceIsActive(s, 250, asAlertId("a1"))).toBe(false);
  });

  it("creates silence via use case", async () => {
    const { container } = createMemoryContainer(1_000);
    const principal: Principal = {
      kind: "apiKey",
      tenantId: asTenantId("t1"),
      apiKeyId: asApiKeyId("k1"),
      scopes: ["alerts:write", "alerts:read"],
    };
    await container.alerts.save({
      id: asAlertId("a1"),
      tenantId: asTenantId("t1"),
      name: "n",
      query: '{service="x"}',
      kind: "logs",
      threshold: 1,
      comparator: "gt",
      windowSeconds: 60,
      forSeconds: 0,
      webhookUrl: null,
      enabled: true,
      createdBy: asUserId("u"),
      createdAt: 1,
      updatedAt: 1,
    });
    const silence = await createSilence(container, principal, {
      alertId: "a1",
      startsAt: 1_000,
      endsAt: 1_000 + 3_600_000,
      comment: "maint",
    });
    expect(silence.alertId).toBe("a1");
    const active = await container.alerts.listActiveSilences(asTenantId("t1"), 2_000);
    expect(active).toHaveLength(1);
  });
});

describe("otlp protobuf", () => {
  it("round-trips logs through proto decode + map", () => {
    const root = protobuf.Root.fromJSON({
      nested: {
        AnyValue: { fields: { stringValue: { type: "string", id: 1 } } },
        KeyValue: {
          fields: {
            key: { type: "string", id: 1 },
            value: { type: "AnyValue", id: 2 },
          },
        },
        Resource: {
          fields: { attributes: { rule: "repeated", type: "KeyValue", id: 1 } },
        },
        LogRecord: {
          fields: {
            timeUnixNano: { type: "fixed64", id: 1 },
            severityText: { type: "string", id: 3 },
            body: { type: "AnyValue", id: 5 },
          },
        },
        ScopeLogs: {
          fields: { logRecords: { rule: "repeated", type: "LogRecord", id: 2 } },
        },
        ResourceLogs: {
          fields: {
            resource: { type: "Resource", id: 1 },
            scopeLogs: { rule: "repeated", type: "ScopeLogs", id: 2 },
          },
        },
        ExportLogsServiceRequest: {
          fields: { resourceLogs: { rule: "repeated", type: "ResourceLogs", id: 1 } },
        },
      },
    });
    const Type = root.lookupType("ExportLogsServiceRequest");
    const buf = Type.encode(
      Type.create({
        resourceLogs: [
          {
            resource: {
              attributes: [{ key: "service.name", value: { stringValue: "proto-svc" } }],
            },
            scopeLogs: [
              {
                logRecords: [
                  {
                    timeUnixNano: "1700000000000000000",
                    severityText: "INFO",
                    body: { stringValue: "hello proto" },
                  },
                ],
              },
            ],
          },
        ],
      }),
    ).finish();
    const decoded = decodeOtlpLogsProto(buf) as Parameters<typeof mapOtlpLogs>[0];
    const events = mapOtlpLogs(decoded);
    expect(events).toHaveLength(1);
    expect(events[0]!.line).toBe("hello proto");
    expect(events[0]!.labels.service).toBe("proto-svc");
  });

  it("decodes trace protobuf", () => {
    const root = protobuf.Root.fromJSON({
      nested: {
        Status: { fields: { code: { type: "int32", id: 3 } } },
        Span: {
          fields: {
            traceId: { type: "bytes", id: 1 },
            spanId: { type: "bytes", id: 2 },
            name: { type: "string", id: 5 },
            startTimeUnixNano: { type: "fixed64", id: 7 },
            endTimeUnixNano: { type: "fixed64", id: 8 },
            status: { type: "Status", id: 15 },
          },
        },
        ScopeSpans: { fields: { spans: { rule: "repeated", type: "Span", id: 2 } } },
        ResourceSpans: {
          fields: {
            scopeSpans: { rule: "repeated", type: "ScopeSpans", id: 2 },
          },
        },
        ExportTraceServiceRequest: {
          fields: { resourceSpans: { rule: "repeated", type: "ResourceSpans", id: 1 } },
        },
      },
    });
    const Type = root.lookupType("ExportTraceServiceRequest");
    const traceId = Uint8Array.from({ length: 16 }, (_, i) => i + 1);
    const spanId = Uint8Array.from({ length: 8 }, (_, i) => i + 1);
    const buf = Type.encode(
      Type.create({
        resourceSpans: [
          {
            scopeSpans: [
              {
                spans: [
                  {
                    traceId,
                    spanId,
                    name: "GET /",
                    startTimeUnixNano: "1000000000",
                    endTimeUnixNano: "2000000000",
                    status: { code: 1 },
                  },
                ],
              },
            ],
          },
        ],
      }),
    ).finish();
    const decoded = decodeOtlpTracesProto(buf) as Parameters<typeof mapOtlpTraces>[0];
    const events = mapOtlpTraces(decoded);
    expect(events).toHaveLength(1);
    expect(events[0]!.spans[0]!.operation).toBe("GET /");
  });
});
