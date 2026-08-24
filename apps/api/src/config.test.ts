import { describe, expect, it } from "vitest";

import { readConfig } from "./config.js";

describe("trusted proxy configuration", () => {
  it("accepts explicit IP and CIDR allowlists", () => {
    expect(readConfig({ API_TRUSTED_PROXIES: "127.0.0.1, 10.0.0.0/8" })).toMatchObject({
      trustedProxies: ["127.0.0.1", "10.0.0.0/8"],
    });
  });

  it("rejects hostnames and invalid CIDRs", () => {
    expect(() => readConfig({ API_TRUSTED_PROXIES: "proxy.internal" })).toThrow();
    expect(() => readConfig({ API_TRUSTED_PROXIES: "127.0.0.1/64" })).toThrow();
  });
});
