import { isIP } from "node:net";

import { z } from "zod";

function validProxy(value: string): boolean {
  const [address, prefix, extra] = value.split("/");
  if (address === undefined || extra !== undefined) return false;
  const family = isIP(address);
  if (family === 0) return false;
  if (prefix === undefined) return true;
  if (!/^\d+$/.test(prefix)) return false;
  const bits = Number(prefix);
  return bits >= 0 && bits <= (family === 4 ? 32 : 128);
}

const configSchema = z.object({
  API_HOST: z.string().min(1).default("127.0.0.1"),
  API_JOB_TTL_MINUTES: z.coerce.number().int().min(1).max(120).default(30),
  API_PORT: z.coerce.number().int().min(1).max(65_535).default(3000),
  API_TRUSTED_PROXIES: z.string().default("").transform((value, context) => {
    const proxies = value.split(",").map((entry) => entry.trim()).filter((entry) => entry !== "");
    if (proxies.some((proxy) => !validProxy(proxy))) {
      context.addIssue({ code: "custom", message: "API_TRUSTED_PROXIES must contain only IP addresses or CIDRs" });
      return z.NEVER;
    }
    return proxies;
  }),
});

export interface ApiConfig {
  host: string;
  jobTtlMs: number;
  port: number;
  trustedProxies: string[];
}

export function readConfig(environment: NodeJS.ProcessEnv = process.env): ApiConfig {
  const parsed = configSchema.parse(environment);
  return {
    host: parsed.API_HOST,
    jobTtlMs: parsed.API_JOB_TTL_MINUTES * 60 * 1000,
    port: parsed.API_PORT,
    trustedProxies: parsed.API_TRUSTED_PROXIES,
  };
}
