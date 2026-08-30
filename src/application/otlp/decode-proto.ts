import protobuf from "protobufjs";

const root = protobuf.Root.fromJSON({
  nested: {
    AnyValue: {
      fields: {
        stringValue: { type: "string", id: 1 },
        boolValue: { type: "bool", id: 2 },
        intValue: { type: "int64", id: 3 },
        doubleValue: { type: "double", id: 4 },
      },
    },
    KeyValue: {
      fields: {
        key: { type: "string", id: 1 },
        value: { type: "AnyValue", id: 2 },
      },
    },
    Resource: {
      fields: {
        attributes: { rule: "repeated", type: "KeyValue", id: 1 },
      },
    },
    // Logs
    LogRecord: {
      fields: {
        timeUnixNano: { type: "fixed64", id: 1 },
        severityText: { type: "string", id: 3 },
        body: { type: "AnyValue", id: 5 },
        attributes: { rule: "repeated", type: "KeyValue", id: 6 },
        traceId: { type: "bytes", id: 9 },
        spanId: { type: "bytes", id: 10 },
      },
    },
    ScopeLogs: {
      fields: {
        logRecords: { rule: "repeated", type: "LogRecord", id: 2 },
      },
    },
    ResourceLogs: {
      fields: {
        resource: { type: "Resource", id: 1 },
        scopeLogs: { rule: "repeated", type: "ScopeLogs", id: 2 },
      },
    },
    ExportLogsServiceRequest: {
      fields: {
        resourceLogs: { rule: "repeated", type: "ResourceLogs", id: 1 },
      },
    },
    // Traces
    Status: {
      fields: {
        code: { type: "int32", id: 3 },
      },
    },
    Span: {
      fields: {
        traceId: { type: "bytes", id: 1 },
        spanId: { type: "bytes", id: 2 },
        parentSpanId: { type: "bytes", id: 4 },
        name: { type: "string", id: 5 },
        startTimeUnixNano: { type: "fixed64", id: 7 },
        endTimeUnixNano: { type: "fixed64", id: 8 },
        attributes: { rule: "repeated", type: "KeyValue", id: 9 },
        status: { type: "Status", id: 15 },
      },
    },
    ScopeSpans: {
      fields: {
        spans: { rule: "repeated", type: "Span", id: 2 },
      },
    },
    ResourceSpans: {
      fields: {
        resource: { type: "Resource", id: 1 },
        scopeSpans: { rule: "repeated", type: "ScopeSpans", id: 2 },
      },
    },
    ExportTraceServiceRequest: {
      fields: {
        resourceSpans: { rule: "repeated", type: "ResourceSpans", id: 1 },
      },
    },
    // Metrics
    NumberDataPoint: {
      fields: {
        attributes: { rule: "repeated", type: "KeyValue", id: 7 },
        timeUnixNano: { type: "fixed64", id: 3 },
        asDouble: { type: "double", id: 4 },
        asInt: { type: "sfixed64", id: 6 },
      },
    },
    Sum: {
      fields: {
        dataPoints: { rule: "repeated", type: "NumberDataPoint", id: 1 },
      },
    },
    Gauge: {
      fields: {
        dataPoints: { rule: "repeated", type: "NumberDataPoint", id: 1 },
      },
    },
    Metric: {
      fields: {
        name: { type: "string", id: 1 },
        gauge: { type: "Gauge", id: 5 },
        sum: { type: "Sum", id: 7 },
      },
    },
    ScopeMetrics: {
      fields: {
        metrics: { rule: "repeated", type: "Metric", id: 2 },
      },
    },
    ResourceMetrics: {
      fields: {
        resource: { type: "Resource", id: 1 },
        scopeMetrics: { rule: "repeated", type: "ScopeMetrics", id: 2 },
      },
    },
    ExportMetricsServiceRequest: {
      fields: {
        resourceMetrics: { rule: "repeated", type: "ResourceMetrics", id: 1 },
      },
    },
  },
});

function bytesToHex(bytes: Uint8Array | undefined): string | undefined {
  if (!bytes || bytes.length === 0) return undefined;
  return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function normalizeAnyValue(
  v: Record<string, unknown> | undefined,
): Record<string, unknown> | undefined {
  if (!v) return v;
  if (
    v.intValue != null &&
    typeof v.intValue === "object" &&
    "toString" in (v.intValue as object)
  ) {
    return { ...v, intValue: String(v.intValue) };
  }
  if (v.asInt != null && typeof v.asInt === "object" && "toString" in (v.asInt as object)) {
    return { ...v, asInt: String(v.asInt) };
  }
  return v;
}

function normalizeKv(attrs: Array<{ key?: string; value?: Record<string, unknown> }> | undefined) {
  return (attrs ?? []).map((a) => ({
    key: a.key,
    value: normalizeAnyValue(a.value),
  }));
}

function fixed64ToString(v: unknown): string | number | undefined {
  if (v == null) return undefined;
  if (typeof v === "string" || typeof v === "number") return v;
  if (typeof v === "object" && v && "toString" in v) return String(v);
  return undefined;
}

export function decodeOtlpLogsProto(buf: Uint8Array): unknown {
  const Type = root.lookupType("ExportLogsServiceRequest");
  const msg = Type.decode(buf) as protobuf.Message & {
    resourceLogs?: Array<{
      resource?: { attributes?: Array<{ key?: string; value?: Record<string, unknown> }> };
      scopeLogs?: Array<{
        logRecords?: Array<{
          timeUnixNano?: unknown;
          severityText?: string;
          body?: Record<string, unknown>;
          attributes?: Array<{ key?: string; value?: Record<string, unknown> }>;
          traceId?: Uint8Array;
          spanId?: Uint8Array;
        }>;
      }>;
    }>;
  };
  return {
    resourceLogs: (msg.resourceLogs ?? []).map((rl) => ({
      resource: rl.resource ? { attributes: normalizeKv(rl.resource.attributes) } : undefined,
      scopeLogs: (rl.scopeLogs ?? []).map((sl) => ({
        logRecords: (sl.logRecords ?? []).map((lr) => ({
          timeUnixNano: fixed64ToString(lr.timeUnixNano),
          severityText: lr.severityText,
          body: normalizeAnyValue(lr.body),
          attributes: normalizeKv(lr.attributes),
          traceId: bytesToHex(lr.traceId),
          spanId: bytesToHex(lr.spanId),
        })),
      })),
    })),
  };
}

export function decodeOtlpTracesProto(buf: Uint8Array): unknown {
  const Type = root.lookupType("ExportTraceServiceRequest");
  const msg = Type.decode(buf) as protobuf.Message & {
    resourceSpans?: Array<{
      resource?: { attributes?: Array<{ key?: string; value?: Record<string, unknown> }> };
      scopeSpans?: Array<{
        spans?: Array<{
          traceId?: Uint8Array;
          spanId?: Uint8Array;
          parentSpanId?: Uint8Array;
          name?: string;
          startTimeUnixNano?: unknown;
          endTimeUnixNano?: unknown;
          attributes?: Array<{ key?: string; value?: Record<string, unknown> }>;
          status?: { code?: number };
        }>;
      }>;
    }>;
  };
  return {
    resourceSpans: (msg.resourceSpans ?? []).map((rs) => ({
      resource: rs.resource ? { attributes: normalizeKv(rs.resource.attributes) } : undefined,
      scopeSpans: (rs.scopeSpans ?? []).map((ss) => ({
        spans: (ss.spans ?? []).map((sp) => ({
          traceId: bytesToHex(sp.traceId),
          spanId: bytesToHex(sp.spanId),
          parentSpanId: bytesToHex(sp.parentSpanId),
          name: sp.name,
          startTimeUnixNano: fixed64ToString(sp.startTimeUnixNano),
          endTimeUnixNano: fixed64ToString(sp.endTimeUnixNano),
          attributes: normalizeKv(sp.attributes),
          status: sp.status,
        })),
      })),
    })),
  };
}

export function decodeOtlpMetricsProto(buf: Uint8Array): unknown {
  const Type = root.lookupType("ExportMetricsServiceRequest");
  const msg = Type.decode(buf) as protobuf.Message & {
    resourceMetrics?: Array<{
      resource?: { attributes?: Array<{ key?: string; value?: Record<string, unknown> }> };
      scopeMetrics?: Array<{
        metrics?: Array<{
          name?: string;
          sum?: {
            dataPoints?: Array<{
              asDouble?: number;
              asInt?: unknown;
              timeUnixNano?: unknown;
              attributes?: Array<{ key?: string; value?: Record<string, unknown> }>;
            }>;
          };
          gauge?: {
            dataPoints?: Array<{
              asDouble?: number;
              asInt?: unknown;
              timeUnixNano?: unknown;
              attributes?: Array<{ key?: string; value?: Record<string, unknown> }>;
            }>;
          };
        }>;
      }>;
    }>;
  };
  const mapDp = (
    dps:
      | Array<{
          asDouble?: number;
          asInt?: unknown;
          timeUnixNano?: unknown;
          attributes?: Array<{ key?: string; value?: Record<string, unknown> }>;
        }>
      | undefined,
  ) =>
    (dps ?? []).map((dp) => ({
      asDouble: dp.asDouble,
      asInt: fixed64ToString(dp.asInt),
      timeUnixNano: fixed64ToString(dp.timeUnixNano),
      attributes: normalizeKv(dp.attributes),
    }));

  return {
    resourceMetrics: (msg.resourceMetrics ?? []).map((rm) => ({
      resource: rm.resource ? { attributes: normalizeKv(rm.resource.attributes) } : undefined,
      scopeMetrics: (rm.scopeMetrics ?? []).map((sm) => ({
        metrics: (sm.metrics ?? []).map((m) => ({
          name: m.name,
          sum: m.sum ? { dataPoints: mapDp(m.sum.dataPoints) } : undefined,
          gauge: m.gauge ? { dataPoints: mapDp(m.gauge.dataPoints) } : undefined,
        })),
      })),
    })),
  };
}

export function isProtobufContentType(ct: string | undefined): boolean {
  if (!ct) return false;
  const base = ct.split(";")[0]?.trim().toLowerCase() ?? "";
  return base === "application/x-protobuf" || base === "application/protobuf";
}
