const GITHUB_TOKEN = /\b(?:gh[oprsu](?:_|%5[fF])[A-Za-z0-9_%.-]{20,}|github_pat(?:_|%5[fF])[A-Za-z0-9_%.-]{20,})\b/gi;
const COMMON_SECRET = /\b(?:AKIA[0-9A-Z]{16}|(?:sk|rk)_(?:live|test)_[A-Za-z0-9]{16,}|xox[baprs]-[A-Za-z0-9-]{10,})\b/g;
const JWT = /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}(?:\.[A-Za-z0-9_-]{8,})?\b/g;
const PRIVATE_KEY = /-----BEGIN(?: [A-Z0-9]+)? PRIVATE KEY-----[\s\S]*?-----END(?: [A-Z0-9]+)? PRIVATE KEY-----/g;
const CREDENTIAL_URL = /\b([a-z][a-z0-9+.-]*:\/\/)[^\s/@:]+:[^\s/@]+@/gi;
const ASSIGNED_SECRET = /\b(password|passwd|secret|api[_-]?key|apiKey|access[_-]?token|accessToken|client[_-]?secret|clientSecret|authorization)\b\s*["']?\s*[:=]\s*["']?([^\s"',;}\\]{8,})["']?/gi;
const ENTROPY_CANDIDATE = /\b[A-Za-z0-9+/=_-]{32,}\b/g;

function shannonEntropy(value: string): number {
  const counts = new Map<string, number>();
  for (const character of value) counts.set(character, (counts.get(character) ?? 0) + 1);
  let entropy = 0;
  for (const count of counts.values()) {
    const probability = count / value.length;
    entropy -= probability * Math.log2(probability);
  }
  return entropy;
}

function redactHighEntropy(value: string): string {
  return value.replace(ENTROPY_CANDIDATE, (candidate) => {
    if (/^[a-f0-9]{40}$/i.test(candidate)) return candidate;
    return shannonEntropy(candidate) >= 4.25 ? "[REDACTED]" : candidate;
  });
}

export function redactSecrets(value: string): string {
  const recognized = value
    .replace(PRIVATE_KEY, "[REDACTED]")
    .replace(CREDENTIAL_URL, "$1[REDACTED]@")
    .replace(GITHUB_TOKEN, "[REDACTED]")
    .replace(COMMON_SECRET, "[REDACTED]")
    .replace(JWT, "[REDACTED]")
    .replace(ASSIGNED_SECRET, (_match, name: string) => `${name}=[REDACTED]`);
  return redactHighEntropy(recognized);
}

export function truncateUtf8(value: string, maxBytes: number): string {
  if (Buffer.byteLength(value, "utf8") <= maxBytes) return value;
  const segmenter = new Intl.Segmenter("en", { granularity: "grapheme" });
  let result = "";
  for (const { segment } of segmenter.segment(value)) {
    if (Buffer.byteLength(result + segment, "utf8") > maxBytes) break;
    result += segment;
  }
  return result;
}
