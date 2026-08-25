export type CopilotLimitCode = "copilot_account_daily_limit" | "copilot_busy" | "copilot_ip_daily_limit";

export interface CopilotLimitPermit {
  release(): void;
}

export interface CopilotLimits {
  acquire(input: { githubUserId: number; ip: string }): { code: CopilotLimitCode } | { permit: CopilotLimitPermit };
}

export interface CopilotLimitOptions {
  accountDaily?: number;
  clock?: () => Date;
  globalConcurrent?: number;
  ipDaily?: number;
}

interface DailyCount {
  day: string;
  value: number;
}

const MAX_COUNTER_ENTRIES = 50_000;

export function createCopilotLimits(options: CopilotLimitOptions = {}): CopilotLimits {
  const accountDaily = options.accountDaily ?? 10;
  const clock = options.clock ?? (() => new Date());
  const globalConcurrent = options.globalConcurrent ?? 4;
  const ipDaily = options.ipDaily ?? 30;
  const activeUsers = new Set<number>();
  const accounts = new Map<number, DailyCount>();
  const ips = new Map<string, DailyCount>();
  let activeGlobal = 0;
  let currentDay = clock().toISOString().slice(0, 10);

  function countFor<Key>(map: Map<Key, DailyCount>, key: Key, day: string): number {
    const current = map.get(key);
    return current?.day === day ? current.value : 0;
  }

  function record<Key>(map: Map<Key, DailyCount>, key: Key, value: DailyCount): void {
    if (!map.has(key) && map.size >= MAX_COUNTER_ENTRIES) {
      const oldest = map.keys().next().value;
      if (oldest !== undefined) map.delete(oldest);
    }
    map.set(key, value);
  }

  return {
    acquire({ githubUserId, ip }) {
      const day = clock().toISOString().slice(0, 10);
      if (day !== currentDay) {
        currentDay = day;
        accounts.clear();
        ips.clear();
      }
      if (activeUsers.has(githubUserId) || activeGlobal >= globalConcurrent) return { code: "copilot_busy" };
      const accountCount = countFor(accounts, githubUserId, day);
      if (accountCount >= accountDaily) return { code: "copilot_account_daily_limit" };
      const ipCount = countFor(ips, ip, day);
      if (ipCount >= ipDaily) return { code: "copilot_ip_daily_limit" };

      record(accounts, githubUserId, { day, value: accountCount + 1 });
      record(ips, ip, { day, value: ipCount + 1 });
      activeUsers.add(githubUserId);
      activeGlobal += 1;
      let released = false;
      return {
        permit: {
          release() {
            if (released) return;
            released = true;
            activeUsers.delete(githubUserId);
            activeGlobal -= 1;
          },
        },
      };
    },
  };
}
