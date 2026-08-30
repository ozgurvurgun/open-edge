export interface TailConnection {
  writer: WritableStreamDefaultWriter<Uint8Array>;
  filter: string | null;
}

const encoder = new TextEncoder();
const MAX_CONNECTIONS = 10;
const BUFFER = 100;

export class RealtimeHub {
  private readonly connections = new Map<string, TailConnection>();
  private readonly buffers = new Map<string, string[]>();

  public constructor(private readonly state: DurableObjectState) {}

  public async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === "/publish" && request.method === "POST") {
      const body = (await request.json()) as { streamId: string; line: string; timestamp: number };
      await this.fanout(body);
      return new Response("ok");
    }
    if (url.pathname === "/tail") {
      return this.tail(url.searchParams.get("filter"));
    }
    if (url.pathname === "/count") {
      return Response.json({ connections: this.connections.size });
    }
    return new Response("not found", { status: 404 });
  }

  private tail(filter: string | null): Response {
    if (this.connections.size >= MAX_CONNECTIONS) {
      return new Response("connection limit", { status: 429 });
    }
    const id = crypto.randomUUID();
    const { readable, writable } = new TransformStream<Uint8Array, Uint8Array>();
    const writer = writable.getWriter();
    this.connections.set(id, { writer, filter });
    this.buffers.set(id, []);
    const heartbeat = setInterval(() => {
      void writer.write(encoder.encode(`: heartbeat\n\n`)).catch(() => {
        this.close(id);
      });
    }, 15_000);
    void this.state.storage.setAlarm(Date.now() + 15_000);
    requestIdle(this.state, () => {
      clearInterval(heartbeat);
      this.close(id);
    });
    return new Response(readable, {
      headers: {
        "content-type": "text/event-stream",
        "cache-control": "no-store",
        connection: "keep-alive",
      },
    });
  }

  private async fanout(event: {
    streamId: string;
    line: string;
    timestamp: number;
  }): Promise<void> {
    const payload = `id: ${event.timestamp}\nevent: log\ndata: ${JSON.stringify(event)}\n\n`;
    for (const [id, conn] of this.connections) {
      if (conn.filter && !event.line.includes(conn.filter) && event.streamId !== conn.filter) {
        continue;
      }
      const buf = this.buffers.get(id) ?? [];
      if (buf.length >= BUFFER) {
        buf.shift();
        await conn.writer
          .write(encoder.encode(`event: overflow\ndata: {}\n\n`))
          .catch(() => this.close(id));
      }
      buf.push(payload);
      this.buffers.set(id, buf);
      await conn.writer.write(encoder.encode(payload)).catch(() => this.close(id));
    }
  }

  private close(id: string): void {
    const conn = this.connections.get(id);
    this.connections.delete(id);
    this.buffers.delete(id);
    void conn?.writer.close().catch(() => undefined);
  }

  public async alarm(): Promise<void> {
    await this.state.storage.setAlarm(Date.now() + 15_000);
  }
}

function requestIdle(_state: DurableObjectState, _onClose: () => void): void {}

export class AlertCoordinator {
  public constructor(private readonly state: DurableObjectState) {}

  public async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === "/lock" && request.method === "POST") {
      const body = (await request.json()) as { alertId: string; until: number };
      const current = await this.state.storage.get<number>(`lock:${body.alertId}`);
      const now = Date.now();
      if (current && current > now) {
        return Response.json({ acquired: false });
      }
      await this.state.storage.put(`lock:${body.alertId}`, body.until);
      return Response.json({ acquired: true });
    }
    return new Response("not found", { status: 404 });
  }
}
