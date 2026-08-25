export interface CopilotRunHandle {
  readonly signal: AbortSignal;
  bind(completion: Promise<unknown>): void;
  finish(): void;
}

export interface CopilotRunRegistry {
  cancelAll(): Promise<void>;
  cancelUser(githubUserId: number): Promise<void>;
  start(githubUserId: number): CopilotRunHandle;
}

interface ActiveRun {
  completion?: Promise<unknown>;
  controller: AbortController;
}

export function createCopilotRunRegistry(): CopilotRunRegistry {
  const active = new Map<number, Set<ActiveRun>>();

  async function cancel(runs: ActiveRun[]): Promise<void> {
    for (const run of runs) run.controller.abort();
    await Promise.allSettled(runs.flatMap((run) => run.completion === undefined ? [] : [run.completion]));
  }

  return {
    async cancelAll() {
      const runs = [...active.values()].flatMap((entries) => [...entries]);
      await cancel(runs);
    },
    async cancelUser(githubUserId) {
      await cancel([...(active.get(githubUserId) ?? [])]);
    },
    start(githubUserId) {
      const run: ActiveRun = { controller: new AbortController() };
      const runs = active.get(githubUserId) ?? new Set<ActiveRun>();
      runs.add(run);
      active.set(githubUserId, runs);
      let finished = false;
      return {
        bind(completion) {
          run.completion = completion;
        },
        finish() {
          if (finished) return;
          finished = true;
          runs.delete(run);
          if (runs.size === 0) active.delete(githubUserId);
        },
        signal: run.controller.signal,
      };
    },
  };
}
