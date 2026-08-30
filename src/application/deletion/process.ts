import { DeletionAuditActions, type DeletionJob } from "../../domain/deletion/job.js";
import { TenantAuditActions } from "../../domain/tenant/tenant.js";
import { asDeletionJobId, asTenantId } from "../../shared/ids.js";
import type {
  AuditRepository,
  CacheStore,
  Clock,
  DeletionJobRepository,
  IdGenerator,
  LogChunkRepository,
  MetricChunkRepository,
  ObjectStore,
  QueuePort,
  RetentionRepository,
  TenantRepository,
  TraceRepository,
} from "../ports.js";

const PAGE = 50;

export interface DeletionDeps {
  readonly clock: Clock;
  readonly ids: IdGenerator;
  readonly jobs: DeletionJobRepository;
  readonly logChunks: LogChunkRepository;
  readonly metricChunks: MetricChunkRepository;
  readonly traces: TraceRepository;
  readonly objects: ObjectStore;
  readonly tenants: TenantRepository;
  readonly audit: AuditRepository;
  readonly cache: CacheStore;
}

export async function processDeletionJob(deps: DeletionDeps, jobId: string): Promise<void> {
  const job = await deps.jobs.findByIdGlobal(asDeletionJobId(jobId));
  if (!job || job.status === "completed") {
    return;
  }
  const now = deps.clock.now();
  const current: DeletionJob = { ...job, status: "processing", updatedAt: now };
  await deps.jobs.save(current);
  try {
    const done = await deletePage(deps, current);
    if (done) {
      const completed = {
        ...current,
        status: "completed" as const,
        updatedAt: deps.clock.now(),
        completedAt: deps.clock.now(),
        errorMessage: null,
      };
      await deps.jobs.save(completed);
      await deps.audit.append({
        id: deps.ids.id(),
        tenantId: current.tenantId,
        actorUserId: current.requestedBy,
        action: DeletionAuditActions.DELETION_COMPLETED,
        resourceType: "deletion_job",
        resourceId: current.id,
        metadata: { target: current.target },
        ipHash: null,
        createdAt: deps.clock.now(),
      });
      if (current.kind === "tenant_deletion") {
        const tenant = await deps.tenants.findById(current.tenantId);
        if (tenant) {
          await deps.tenants.save({ ...tenant, status: "deleted", updatedAt: deps.clock.now() });
          await deps.audit.append({
            id: deps.ids.id(),
            tenantId: tenant.id,
            actorUserId: current.requestedBy,
            action: TenantAuditActions.TENANT_DELETED,
            resourceType: "tenant",
            resourceId: tenant.id,
            metadata: {},
            ipHash: null,
            createdAt: deps.clock.now(),
          });
        }
      }
    }
  } catch (error) {
    await deps.jobs.save({
      ...current,
      status: "failed",
      errorMessage: "Deletion page failed and will be retried.",
      updatedAt: deps.clock.now(),
    });
    throw error;
  }
}

async function deletePage(deps: DeletionDeps, job: DeletionJob): Promise<boolean> {
  const tenantId = asTenantId(job.tenantId);
  const cursor = job.cursor;
  if (job.target === "logs" || job.target === "all") {
    const rows = await deps.logChunks.listExpired(tenantId, deps.clock.now(), cursor, PAGE);
    for (const chunk of rows) {
      await deps.logChunks.save({ ...chunk, status: "deleting" });
      await deps.objects.delete(chunk.objectKey);
      await deps.logChunks.delete(tenantId, chunk.id);
    }
    if (rows.length > 0) {
      await deps.jobs.save({
        ...job,
        cursor: rows[rows.length - 1]!.id,
        updatedAt: deps.clock.now(),
      });
      return false;
    }
  }
  if (job.target === "metrics" || job.target === "all") {
    const rows = await deps.metricChunks.listExpired(tenantId, deps.clock.now(), cursor, PAGE);
    for (const chunk of rows) {
      await deps.objects.delete(chunk.objectKey);
      await deps.metricChunks.delete(tenantId, chunk.id);
    }
    if (rows.length > 0) {
      await deps.jobs.save({
        ...job,
        cursor: rows[rows.length - 1]!.id,
        updatedAt: deps.clock.now(),
      });
      return false;
    }
  }
  if (job.target === "traces" || job.target === "all") {
    const rows = await deps.traces.listExpired(tenantId, deps.clock.now(), cursor, PAGE);
    for (const trace of rows) {
      if (trace.objectKey) {
        await deps.objects.delete(trace.objectKey);
      }
      await deps.traces.delete(tenantId, trace.id);
    }
    if (rows.length > 0) {
      await deps.jobs.save({
        ...job,
        cursor: rows[rows.length - 1]!.id,
        updatedAt: deps.clock.now(),
      });
      return false;
    }
  }
  await deps.cache.delete(`tenant:${tenantId}:flags`);
  return true;
}

export async function scheduleRetentionJobs(
  deps: DeletionDeps & { retention: RetentionRepository; queue: QueuePort },
): Promise<number> {
  const policies = await deps.retention.listAll();
  let created = 0;
  const now = deps.clock.now();
  for (const policy of policies) {
    const targets: Array<{ target: "logs" | "metrics" | "traces"; days: number }> = [
      { target: "logs", days: policy.logsDays },
      { target: "metrics", days: policy.metricsDays },
      { target: "traces", days: policy.tracesDays },
    ];
    for (const item of targets) {
      const active = await deps.jobs.listActiveByKind(policy.tenantId, "retention", item.target);
      if (active.length > 0) {
        continue;
      }
      const cutoff = now - item.days * 86_400_000;
      const sample =
        item.target === "logs"
          ? await deps.logChunks.listExpired(policy.tenantId, cutoff, null, 1)
          : item.target === "metrics"
            ? await deps.metricChunks.listExpired(policy.tenantId, cutoff, null, 1)
            : await deps.traces.listExpired(policy.tenantId, cutoff, null, 1);
      if (sample.length === 0) {
        continue;
      }
      const job = {
        id: asDeletionJobId(deps.ids.id()),
        tenantId: policy.tenantId,
        kind: "retention" as const,
        target: item.target,
        status: "scheduled" as const,
        cursor: null,
        requestedBy: null,
        errorMessage: null,
        createdAt: now,
        updatedAt: now,
        completedAt: null,
      };
      await deps.jobs.save(job);
      await deps.queue.publishDeletion({ jobId: job.id, tenantId: job.tenantId });
      created += 1;
    }
  }
  return created;
}
