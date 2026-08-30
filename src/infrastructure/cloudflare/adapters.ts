import type { CacheStore, ObjectStore, QueuePort, RealtimePort } from "../../application/ports.js";
import type { Env } from "../../env.js";
import type { DeletionQueueMessage, IngestQueueMessage } from "../../application/ports.js";

export function r2Store(bucket: R2Bucket): ObjectStore {
  return {
    async put(key, body) {
      await bucket.put(key, body);
    },
    async get(key) {
      const obj = await bucket.get(key);
      if (!obj) return null;
      return new Uint8Array(await obj.arrayBuffer());
    },
    async delete(key) {
      await bucket.delete(key);
    },
  };
}

export function kvCache(kv: KVNamespace): CacheStore {
  return {
    async get(key) {
      return kv.get(key);
    },
    async put(key, value, ttlSeconds) {
      await kv.put(key, value, { expirationTtl: Math.max(60, ttlSeconds) });
    },
    async delete(key) {
      await kv.delete(key);
    },
  };
}

export function queuePort(env: Env): QueuePort {
  return {
    async publishIngest(message: IngestQueueMessage) {
      await env.INGEST_QUEUE.send(message);
    },
    async publishDeletion(message: DeletionQueueMessage) {
      await env.DELETION_QUEUE.send(message);
    },
  };
}

export function realtimePort(env: Env): RealtimePort {
  return {
    async publish(tenantId, entry) {
      const id = env.REALTIME_HUB.idFromName(`tenant:${tenantId}`);
      const stub = env.REALTIME_HUB.get(id);
      await stub.fetch("https://realtime/publish", {
        method: "POST",
        body: JSON.stringify({ tenantId, ...entry }),
      });
    },
  };
}

export function silentMetrics() {
  return {
    record(_name: string, _value: number, _labels?: Record<string, string>) {},
  };
}
