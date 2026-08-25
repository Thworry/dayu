import { createHash, randomBytes as nodeRandomBytes } from "node:crypto";

export type RandomBytes = (size: number) => Uint8Array;

export const secureRandomBytes: RandomBytes = (size) => nodeRandomBytes(size);

export function randomSecret(randomBytes: RandomBytes = secureRandomBytes): string {
  const value = randomBytes(32);
  if (value.byteLength < 32) throw new Error("insufficient_randomness");
  return Buffer.from(value.subarray(0, 32)).toString("base64url");
}

export function isRandomSecret(value: string): boolean {
  return /^[A-Za-z0-9_-]{43}$/.test(value);
}

export function pkceChallenge(verifier: string): string {
  return createHash("sha256").update(verifier, "ascii").digest("base64url");
}
