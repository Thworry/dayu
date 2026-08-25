import {
  parseTokenRecord,
  recordExpiry,
  vaultKey,
  type PlatformEncryptionAdapter,
  type TokenVault,
} from "./token-vault.js";

export interface RedisVaultClient {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, options: { PX: number }): Promise<unknown>;
  del(key: string): Promise<unknown>;
}

export interface RedisVaultOptions {
  cipher: PlatformEncryptionAdapter;
  client: RedisVaultClient;
  hmacSecret: Uint8Array;
  clock?: () => Date;
  keyPrefix?: string;
}

export function createRedisVault(options: RedisVaultOptions): TokenVault {
  vaultKey("validation", options.hmacSecret);
  const hmacSecret = Buffer.from(options.hmacSecret);
  const clock = options.clock ?? (() => new Date());
  const keyPrefix = options.keyPrefix ?? "dayu:oauth:";
  const keyFor = (rawSessionId: string): string => `${keyPrefix}${vaultKey(rawSessionId, hmacSecret)}`;
  return {
    async delete(rawSessionId) {
      await options.client.del(keyFor(rawSessionId));
    },
    async get(rawSessionId) {
      const key = keyFor(rawSessionId);
      const sealed = await options.client.get(key);
      if (sealed === null) return null;
      try {
        const record = parseTokenRecord(await options.cipher.decrypt(sealed));
        if (recordExpiry(record, clock()) <= clock().valueOf()) {
          await options.client.del(key);
          return null;
        }
        return record;
      } catch {
        await options.client.del(key);
        return null;
      }
    },
    async put(rawSessionId, record) {
      const now = clock();
      const expiresAt = recordExpiry(record, now);
      const sealed = await options.cipher.encrypt(JSON.stringify(record));
      await options.client.set(keyFor(rawSessionId), sealed, { PX: Math.max(1, expiresAt - now.valueOf()) });
    },
  };
}
