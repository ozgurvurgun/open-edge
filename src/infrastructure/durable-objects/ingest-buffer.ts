import type { Env } from "../../env.js";
import type { IngestQueueMessage } from "../../application/ports.js";
import { asEventId, asTenantId } from "../../shared/ids.js";
import type { TelemetryKind } from "../../domain/ingestion/event.js";

type BufferItem = {
  id: string;
  kind: TelemetryKind;
  tenantId: string;
  payload: unknown;
  receivedAt: number;
  eventId: string;
};

const MAX_ITEMS = 500;
const ALARM_MS = 2_000;

export class IngestBuffer {
  public constructor(
    private readonly state: DurableObjectState,
    private readonly env: Env,
  ) {}

  public async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === "/enqueue" && request.method === "POST") {
      const body = (await request.json()) as {
        items: Array<{
          kind: TelemetryKind;
          tenantId: string;
          payload: unknown;
          eventId: string;
          receivedAt: number;
        }>;
      };
      const items = (await this.state.storage.get<BufferItem[]>("items")) ?? [];
      for (const it of body.items ?? []) {
        items.push({
          id: crypto.randomUUID(),
          kind: it.kind,
          tenantId: it.tenantId,
          payload: it.payload,
          receivedAt: it.receivedAt,
          eventId: it.eventId,
        });
      }
      while (items.length > MAX_ITEMS) items.shift();
      await this.state.storage.put("items", items);
      const existing = await this.state.storage.getAlarm();
      if (existing == null) {
        await this.state.storage.setAlarm(Date.now() + ALARM_MS);
      }
      return Response.json({ queued: items.length });
    }
    if (url.pathname === "/pending" && request.method === "GET") {
      const items = (await this.state.storage.get<BufferItem[]>("items")) ?? [];
      return Response.json({ pending: items.length });
    }
    if (url.pathname === "/flush" && request.method === "POST") {
      await this.flush();
      return Response.json({ ok: true });
    }
    return new Response("not found", { status: 404 });
  }

  public async alarm(): Promise<void> {
    await this.flush();
    const items = (await this.state.storage.get<BufferItem[]>("items")) ?? [];
    if (items.length > 0) {
      await this.state.storage.setAlarm(Date.now() + ALARM_MS);
    }
  }

  private async flush(): Promise<void> {
    const items = (await this.state.storage.get<BufferItem[]>("items")) ?? [];
    if (items.length === 0) return;
    await this.state.storage.put("items", []);
    const messages: IngestQueueMessage[] = items.map((item) => ({
      kind: item.kind,
      tenantId: asTenantId(item.tenantId),
      payload: item.payload,
      receivedAt: item.receivedAt,
      eventId: asEventId(item.eventId),
    }));
    try {
      for (let i = 0; i < messages.length; i += 25) {
        const slice = messages.slice(i, i + 25);
        await this.env.INGEST_QUEUE.sendBatch(slice.map((body) => ({ body })));
      }
    } catch {
      const again = (await this.state.storage.get<BufferItem[]>("items")) ?? [];
      await this.state.storage.put("items", [...items, ...again].slice(0, MAX_ITEMS));
      throw new Error("ingest_buffer_flush_failed");
    }
  }
}
