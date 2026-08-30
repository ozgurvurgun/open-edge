import type { Env } from "./env.js";
import { createApp } from "./presentation/http/app.js";
import { createContainer } from "./composition/container.js";
import { consumeIngestBatch } from "./application/ingestion/consume.js";
import { processDeletionJob, scheduleRetentionJobs } from "./application/deletion/process.js";
import { RealtimeHub, AlertCoordinator } from "./infrastructure/durable-objects/realtime-hub.js";
import { IngestBuffer } from "./infrastructure/durable-objects/ingest-buffer.js";
import type { DeletionQueueMessage, IngestQueueMessage } from "./application/ports.js";
import { evaluateAllAlerts } from "./application/alerting/evaluate.js";
import { asDeletionJobId, asTenantId } from "./shared/ids.js";

const app = createApp();

export { RealtimeHub, AlertCoordinator, IngestBuffer };

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    return app.fetch(request, env, ctx);
  },

  async queue(
    batch: MessageBatch<IngestQueueMessage | DeletionQueueMessage>,
    env: Env,
  ): Promise<void> {
    const container = createContainer(env);
    const queueName = batch.queue;
    if (queueName.includes("deletion")) {
      for (const message of batch.messages) {
        const body = message.body as DeletionQueueMessage;
        try {
          await processDeletionJob(container, body.jobId);
          message.ack();
        } catch {
          message.retry();
        }
      }
      return;
    }
    const ingest = batch.messages.map((m) => m.body as IngestQueueMessage);
    try {
      await consumeIngestBatch(container, ingest);
      for (const message of batch.messages) {
        message.ack();
      }
    } catch {
      for (const message of batch.messages) {
        message.retry();
      }
    }
  },

  async scheduled(_event: ScheduledEvent, env: Env, ctx: ExecutionContext): Promise<void> {
    const container = createContainer(env);
    ctx.waitUntil(
      (async () => {
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
        });
        await scheduleRetentionJobs(container);
        const pending = await container.jobs.listProcessable(10);
        for (const job of pending) {
          await env.DELETION_QUEUE.send({
            jobId: asDeletionJobId(job.id),
            tenantId: asTenantId(job.tenantId),
          });
        }
        const stale = await container.logChunks.listPending(container.clock.now() - 120_000, 20);
        for (const chunk of stale) {
          if (chunk.status === "pending") {
            await container.logChunks.save({ ...chunk, status: "failed" });
          }
        }
      })(),
    );
  },
};
