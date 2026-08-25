import {
  parseTokenRecord,
  recordExpiry,
  vaultKey,
  type PlatformEncryptionAdapter,
  type TokenVault,
} from "./token-vault.js";

interface SealedRecord {
  expiresAt: number;
  value: string;
}

export interface MemoryVaultOptions {
  cipher: PlatformEncryptionAdapter;
  hmacSecret: Uint8Array;
  clock?: () => Date;
  evictionIntervalMs?: number;
}

export interface MemoryTokenVault extends TokenVault {
  close(): Promise<void>;
  debugKeys(): string[];
  debugValues(): string[];
}

export function createMemoryVault(options: MemoryVaultOptions): MemoryTokenVault {
  // Validate at construction, not on the first request.
  vaultKey("validation", options.hmacSecret);
  const hmacSecret = Buffer.from(options.hmacSecret);
  const clock = options.clock ?? (() => new Date());
  const records = new Map<string, SealedRecord>();
  let closed = false;

  function evictExpired(): void {
    const now = clock().valueOf();
    for (const [key, record] of records) {
      if (record.expiresAt <= now) records.delete(key);
    }
  }

  const interval = setInterval(evictExpired, options.evictionIntervalMs ?? 60_000);
  interval.unref();

  return {
    close() {
      if (closed) return Promise.resolve();
      closed = true;
      clearInterval(interval);
      records.clear();
      return Promise.resolve();
    },
    delete(rawSessionId) {
      records.delete(vaultKey(rawSessionId, hmacSecret));
      return Promise.resolve();
    },
    debugKeys: () => [...records.keys()],
    debugValues: () => [...records.values()].map((record) => record.value),
    async get(rawSessionId) {
      if (closed) return null;
      const key = vaultKey(rawSessionId, hmacSecret);
      const sealed = records.get(key);
      if (sealed === undefined) return null;
      if (sealed.expiresAt <= clock().valueOf()) {
        records.delete(key);
        return null;
      }
      try {
        return parseTokenRecord(await options.cipher.decrypt(sealed.value));
      } catch {
        records.delete(key);
        return null;
      }
    },
    async put(rawSessionId, record) {
      if (closed) throw new Error("vault_closed");
      const expiresAt = recordExpiry(record, clock());
      const value = await options.cipher.encrypt(JSON.stringify(record));
      records.set(vaultKey(rawSessionId, hmacSecret), { expiresAt, value });
    },
  };
}
