import { describe, expect, it } from "vitest";

import { createMemoryVault } from "./memory-vault.js";
import { createRedisVault, type RedisVaultClient } from "./redis-vault.js";
import { createAes256GcmEncryptionAdapter, type TokenRecord } from "./token-vault.js";

const START = new Date("2026-08-25T00:00:00.000Z");
const HMAC_KEY = new Uint8Array(32).fill(7);

const cipher = createAes256GcmEncryptionAdapter(new Uint8Array(32).fill(8));

function record(expiresAt = new Date(START.valueOf() + 60_000).toISOString()): TokenRecord {
  return {
    createdAt: START.toISOString(),
    encryptedAccessToken: "sealed:ghu_sensitive",
    encryptedCsrfToken: "sealed:csrf-sensitive",
    githubUserId: 42,
    tokenExpiresAt: expiresAt,
  };
}

describe("encrypted short-term token vault", () => {
  it("stores only an HMAC of the browser session id and an encrypted envelope", async () => {
    const vault = createMemoryVault({ cipher, clock: () => START, hmacSecret: HMAC_KEY });
    await vault.put("raw-session-id", record());

    expect(vault.debugKeys()).not.toContain("raw-session-id");
    expect(vault.debugValues().join(" ")).not.toContain("ghu_sensitive");
    expect(await vault.get("raw-session-id")).toEqual(record());
    await vault.close();
  });

  it("expires records at token expiry and deletes them", async () => {
    let now = START;
    const vault = createMemoryVault({ cipher, clock: () => now, hmacSecret: HMAC_KEY });
    await vault.put("session", record(new Date(START.valueOf() + 1_000).toISOString()));
    now = new Date(START.valueOf() + 1_001);

    expect(await vault.get("session")).toBeNull();
    expect(vault.debugKeys()).toHaveLength(0);
    await vault.close();
  });

  it("rejects expired inserts and HMAC secrets shorter than 32 bytes", async () => {
    expect(() => createMemoryVault({ cipher, clock: () => START, hmacSecret: new Uint8Array(31) })).toThrow("invalid_vault_hmac_secret");
    const vault = createMemoryVault({ cipher, clock: () => START, hmacSecret: HMAC_KEY });
    await expect(vault.put("session", record(START.toISOString()))).rejects.toThrow("expired_token_record");
    await vault.close();
  });

  it("uses a hashed Redis key, an encrypted value, and a bounded Redis TTL", async () => {
    const writes: { key: string; options: { PX: number }; value: string }[] = [];
    const values = new Map<string, string>();
    const client: RedisVaultClient = {
      del: (key) => Promise.resolve(values.delete(key) ? 1 : 0),
      get: (key) => Promise.resolve(values.get(key) ?? null),
      set: (key, value, options) => {
        writes.push({ key, options, value });
        values.set(key, value);
        return Promise.resolve("OK");
      },
    };
    const vault = createRedisVault({ cipher, client, clock: () => START, hmacSecret: HMAC_KEY });
    await vault.put("raw-session-id", record(new Date(START.valueOf() + 12 * 60 * 60_000).toISOString()));

    expect(writes[0]?.key).not.toContain("raw-session-id");
    expect(writes[0]?.value).not.toContain("ghu_sensitive");
    expect(writes[0]?.options.PX).toBe(8 * 60 * 60_000);
    expect(await vault.get("raw-session-id")).toEqual(record(new Date(START.valueOf() + 12 * 60 * 60_000).toISOString()));
  });
});
