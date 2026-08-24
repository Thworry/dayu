export interface PublicScanLimits {
  maxRequests: number;
  maxPagesPerCollection: number;
  maxFiles: number;
  maxFileBytes: number;
  maxTotalBytes: number;
  timeoutMs: number;
}

export const PUBLIC_SCAN_LIMITS: Readonly<PublicScanLimits> = {
  maxRequests: 20,
  maxPagesPerCollection: 4,
  maxFiles: 20,
  maxFileBytes: 128_000,
  maxTotalBytes: 2_000_000,
  timeoutMs: 15_000,
};
