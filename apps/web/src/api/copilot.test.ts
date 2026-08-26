import { afterEach, describe, expect, it, vi } from "vitest";

import { createCopilotApi } from "./copilot.js";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Copilot session capability", () => {
  it("distinguishes an unconfigured OAuth service from a signed-out session", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: { code: "oauth_unavailable" } }), { status: 503 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: { code: "invalid_session" } }), { status: 401 }));
    vi.stubGlobal("fetch", fetchMock);
    const api = createCopilotApi();

    await expect(api.getSession()).resolves.toEqual({ kind: "unavailable" });
    await expect(api.getSession()).resolves.toEqual({ kind: "signed_out" });
  });

  it("returns a validated authenticated session without exposing a token", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({
      authenticated: true,
      csrfToken: "b".repeat(43),
      githubUserId: 101,
    }), { status: 200 })));

    await expect(createCopilotApi().getSession()).resolves.toEqual({
      kind: "authenticated",
      session: { authenticated: true, csrfToken: "b".repeat(43), githubUserId: 101 },
    });
  });
});
