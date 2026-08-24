import { randomUUID } from "node:crypto";

import type { CreateScanJobInput, ScanJob, ScanJobStore } from "./types.js";

const DEFAULT_TTL_MS = 30 * 60 * 1000;

export interface MemoryJobStoreOptions {
  clock?: () => Date;
  cleanupIntervalMs?: number;
  createId?: () => string;
  scheduler?: JobCleanupScheduler;
  ttlMs?: number;
}

export interface JobCleanupScheduler {
  cancel(handle: unknown): void;
  repeat(callback: () => void, intervalMs: number): unknown;
}

export interface MemoryScanJobStore extends ScanJobStore {
  close(): Promise<void>;
  entryCount(): number;
}

const defaultScheduler: JobCleanupScheduler = {
  cancel(handle: unknown): void {
    clearInterval(handle as ReturnType<typeof setInterval>);
  },
  repeat(callback: () => void, intervalMs: number): unknown {
    const handle = setInterval(callback, intervalMs);
    handle.unref();
    return handle;
  },
};

function clone(job: ScanJob): ScanJob {
  return structuredClone(job);
}

export function memoryJobStore(options: MemoryJobStoreOptions = {}): MemoryScanJobStore {
  const clock = options.clock ?? (() => new Date());
  const createId = options.createId ?? randomUUID;
  const ttlMs = options.ttlMs ?? DEFAULT_TTL_MS;
  const scheduler = options.scheduler ?? defaultScheduler;
  const jobs = new Map<string, ScanJob>();

  function expired(job: ScanJob): boolean {
    return Date.parse(job.expiresAt) <= clock().valueOf();
  }

  function purgeExpired(): void {
    for (const [id, job] of jobs) {
      if (expired(job)) jobs.delete(id);
    }
  }

  const cleanupHandle = scheduler.repeat(purgeExpired, options.cleanupIntervalMs ?? Math.min(ttlMs, 60_000));

  return {
    close(): Promise<void> {
      scheduler.cancel(cleanupHandle);
      jobs.clear();
      return Promise.resolve();
    },
    create(input: CreateScanJobInput): Promise<ScanJob> {
      purgeExpired();
      const createdAt = input.createdAt;
      const job: ScanJob = {
        ...input,
        expiresAt: input.expiresAt ?? new Date(Date.parse(createdAt) + ttlMs).toISOString(),
        id: createId(),
      };
      jobs.set(job.id, clone(job));
      return Promise.resolve(clone(job));
    },

    delete(id: string): Promise<void> {
      jobs.delete(id);
      return Promise.resolve();
    },

    entryCount(): number {
      return jobs.size;
    },

    get(id: string): Promise<ScanJob | null> {
      const job = jobs.get(id);
      if (job === undefined) return Promise.resolve(null);
      if (expired(job)) {
        jobs.delete(id);
        return Promise.resolve(null);
      }
      return Promise.resolve(clone(job));
    },

    update(id: string, patch: Partial<Omit<ScanJob, "id">>): Promise<void> {
      const current = jobs.get(id);
      if (current === undefined) return Promise.resolve();
      if (expired(current)) {
        jobs.delete(id);
        return Promise.resolve();
      }
      jobs.set(id, clone({ ...current, ...patch, id }));
      return Promise.resolve();
    },
  };
}
