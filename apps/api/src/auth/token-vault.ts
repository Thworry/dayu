import { createCipheriv, createDecipheriv, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

export const MAX_TOKEN_TTL_MS = 8 * 60 * 60 * 1000;

export interface TokenRecord {
  githubUserId: number;
  encryptedAccessToken: string;
  encryptedCsrfToken: string;
  tokenExpiresAt: string;
  createdAt: string;
}

export interface TokenVault {
  put(rawSessionId: string, record: TokenRecord): Promise<void>;
  get(rawSessionId: string): Promise<TokenRecord | null>;
  delete(rawSessionId: string): Promise<void>;
  close?(): Promise<void>;
}

export interface PlatformEncryptionAdapter {
  encrypt(plaintext: string): Promise<string>;
  decrypt(ciphertext: string): Promise<string>;
}

export function assertKey(secret: Uint8Array, code: string): void {
  if (secret.byteLength < 32) throw new Error(code);
}

export function vaultKey(rawSessionId: string, hmacSecret: Uint8Array): string {
  assertKey(hmacSecret, "invalid_vault_hmac_secret");
  return createHmac("sha256", hmacSecret).update(rawSessionId, "utf8").digest("hex");
}

export function safeEqual(left: string, right: string): boolean {
  const leftBytes = Buffer.from(left, "utf8");
  const rightBytes = Buffer.from(right, "utf8");
  return leftBytes.byteLength === rightBytes.byteLength && timingSafeEqual(leftBytes, rightBytes);
}

export function recordExpiry(record: TokenRecord, now: Date): number {
  const tokenExpiry = Date.parse(record.tokenExpiresAt);
  const createdAt = Date.parse(record.createdAt);
  if (!Number.isFinite(tokenExpiry) || !Number.isFinite(createdAt)) throw new Error("invalid_token_record");
  const expiresAt = Math.min(tokenExpiry, createdAt + MAX_TOKEN_TTL_MS);
  if (expiresAt <= now.valueOf()) throw new Error("expired_token_record");
  return expiresAt;
}

export function parseTokenRecord(value: string): TokenRecord {
  const parsed: unknown = JSON.parse(value);
  if (parsed === null || typeof parsed !== "object") throw new Error("invalid_token_record");
  const candidate = parsed as Record<string, unknown>;
  if (
    !Number.isSafeInteger(candidate.githubUserId)
    || Number(candidate.githubUserId) <= 0
    || typeof candidate.encryptedAccessToken !== "string"
    || typeof candidate.encryptedCsrfToken !== "string"
    || typeof candidate.tokenExpiresAt !== "string"
    || typeof candidate.createdAt !== "string"
  ) throw new Error("invalid_token_record");
  return {
    createdAt: candidate.createdAt,
    encryptedAccessToken: candidate.encryptedAccessToken,
    encryptedCsrfToken: candidate.encryptedCsrfToken,
    githubUserId: Number(candidate.githubUserId),
    tokenExpiresAt: candidate.tokenExpiresAt,
  };
}

export function createAes256GcmEncryptionAdapter(key: Uint8Array): PlatformEncryptionAdapter {
  if (key.byteLength !== 32) throw new Error("invalid_encryption_key");
  const keyBytes = Buffer.from(key);
  return {
    decrypt(ciphertext) {
      try {
        const packed = Buffer.from(ciphertext, "base64url");
        if (packed.byteLength < 12 + 16 + 1) throw new Error("invalid_ciphertext");
        const nonce = packed.subarray(0, 12);
        const tag = packed.subarray(12, 28);
        const body = packed.subarray(28);
        const decipher = createDecipheriv("aes-256-gcm", keyBytes, nonce);
        decipher.setAuthTag(tag);
        return Promise.resolve(Buffer.concat([decipher.update(body), decipher.final()]).toString("utf8"));
      } catch {
        return Promise.reject(new Error("decryption_failed"));
      }
    },
    encrypt(plaintext) {
      const nonce = randomBytes(12);
      const cipher = createCipheriv("aes-256-gcm", keyBytes, nonce);
      const body = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
      return Promise.resolve(Buffer.concat([nonce, cipher.getAuthTag(), body]).toString("base64url"));
    },
  };
}
