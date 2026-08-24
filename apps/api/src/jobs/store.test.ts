import { describe, expect, it, vi } from "vitest";

import { memoryJobStore, type JobCleanupScheduler } from "./store.js";

describe("memoryJobStore cleanup", () => {
  it("physically evicts untouched expired jobs and cancels cleanup on shutdown", async () => {
    let now = new Date("2026-08-25T00:00:00.000Z");
    let sweep: (() => void) | undefined;
    const handle = Symbol("cleanup");
    const cancel = vi.fn<(value: unknown) => void>();
    const scheduler: JobCleanupScheduler = {
      cancel,
      repeat(callback, intervalMs) {
        expect(intervalMs).toBe(1_000);
        sweep = callback;
        return handle;
      },
    };
    const store = memoryJobStore({
      cleanupIntervalMs: 1_000,
      clock: () => now,
      createId: () => "2c3da581-4bb8-4934-9714-8b25b5e4fc0c",
      scheduler,
      ttlMs: 30 * 60 * 1000,
    });
    await store.create({ createdAt: now.toISOString(), repository: "owner/repo", stage: "validated" });
    expect(store.entryCount()).toBe(1);

    now = new Date(now.valueOf() + 30 * 60 * 1000 + 1);
    expect(sweep).toBeDefined();
    sweep?.();
    expect(store.entryCount()).toBe(0);

    await store.close();
    expect(cancel).toHaveBeenCalledWith(handle);
  });
});
