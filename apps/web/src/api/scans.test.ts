import { afterEach, describe, expect, it, vi } from "vitest";

import { createScanApi, pollScan, waitForPollDelay, type PublicScanJob, type ScanApi, type ScanFailure } from "./scans.js";
import { reportFixture } from "../test/reportFixture.js";

const futureJob: PublicScanJob = {
  createdAt: "2026-08-25T00:00:00.000Z",
  expiresAt: "2099-08-25T00:30:00.000Z",
  id: "f4082d03-6bea-4d90-a901-e15c3f899a3e",
  reportAvailable: false,
  repository: "facebook/react",
  stage: "validated",
};

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("scan API", () => {
  it("polls with exact exponential waits capped at two seconds", async () => {
    let calls = 0;
    const waits: number[] = [];
    const api: ScanApi = {
      createScan: vi.fn(),
      getReport: vi.fn().mockResolvedValue(reportFixture),
      getScan: vi.fn().mockImplementation(() => {
        calls += 1;
        return Promise.resolve({ ...futureJob, stage: calls < 6 ? "validated" : "rendered" });
      }),
    };

    await pollScan(api, futureJob.id, {
      clock: () => Date.parse("2026-08-25T00:01:00.000Z"),
      onStage: vi.fn(),
      wait(milliseconds) {
        waits.push(milliseconds);
        return Promise.resolve();
      },
    });

    expect(waits).toEqual([250, 500, 1000, 2000, 2000]);
  });

  it("stops an expired job before publishing a stage", async () => {
    const onStage = vi.fn();
    const wait = vi.fn().mockResolvedValue(undefined);
    const getReport = vi.fn().mockResolvedValue(reportFixture);
    const api: ScanApi = {
      createScan: vi.fn(),
      getReport,
      getScan: vi.fn().mockResolvedValue({ ...futureJob, expiresAt: "2026-08-25T00:00:00.000Z" }),
    };

    await expect(pollScan(api, futureJob.id, {
      clock: () => Date.parse("2026-08-25T00:00:00.000Z"),
      onStage,
      wait,
    })).rejects.toMatchObject({ code: "scan_not_found", status: 404 } satisfies Partial<ScanFailure>);
    expect(onStage).not.toHaveBeenCalled();
    expect(wait).not.toHaveBeenCalled();
    expect(getReport).not.toHaveBeenCalled();
  });

  it("stops at the known expiry without making another status request", async () => {
    let now = 0;
    const waits: number[] = [];
    const getScan = vi.fn().mockResolvedValue({ ...futureJob, expiresAt: "1970-01-01T00:00:01.000Z" });
    const api: ScanApi = { createScan: vi.fn(), getReport: vi.fn(), getScan };

    await expect(pollScan(api, futureJob.id, {
      clock: () => now,
      onStage: vi.fn(),
      wait(milliseconds) {
        waits.push(milliseconds);
        now += milliseconds;
        return Promise.resolve();
      },
    })).rejects.toMatchObject({ code: "scan_not_found" });
    expect(waits).toEqual([250, 500, 1000]);
    expect(getScan).toHaveBeenCalledTimes(3);
  });

  it("does not publish a stage after an awaited request is aborted", async () => {
    const controller = new AbortController();
    const onStage = vi.fn();
    const getReport = vi.fn().mockResolvedValue(reportFixture);
    const api: ScanApi = {
      createScan: vi.fn(),
      getReport,
      getScan: vi.fn().mockImplementation(() => {
        controller.abort();
        return Promise.resolve(futureJob);
      }),
    };

    await expect(pollScan(api, futureJob.id, { onStage, signal: controller.signal })).rejects.toMatchObject({ name: "AbortError" });
    expect(onStage).not.toHaveBeenCalled();
    expect(getReport).not.toHaveBeenCalled();
  });

  it("passes the abort signal through every fetch", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ jobId: futureJob.id, stage: "validated" }), { status: 202 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ ...futureJob, stage: "rendered", reportAvailable: true }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(reportFixture), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const controller = new AbortController();
    const api = createScanApi();
    const created = await api.createScan({ locale: "en", repository: "facebook/react" }, controller.signal);
    await pollScan(api, created.jobId, { onStage: vi.fn(), signal: controller.signal });

    for (const call of fetchMock.mock.calls) {
      expect((call[1] as RequestInit | undefined)?.signal).toBe(controller.signal);
    }
  });

  it("rejects a malformed successful report response", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({
      evidence: [],
      evidenceIndex: {},
      reportVersion: "1",
      repository: { defaultBranch: "main", fullName: "facebook/react", id: 1024 },
      sourceCommit: "abcdef1234567",
    }), { status: 200 })));

    await expect(createScanApi().getReport(futureJob.id)).rejects.toMatchObject({
      code: "internal_failure",
      status: 502,
    } satisfies Partial<ScanFailure>);
  });

  it("removes the abort listener when a poll delay resolves normally", async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    const remove = vi.spyOn(controller.signal, "removeEventListener");
    const delayed = waitForPollDelay(250, controller.signal);

    await vi.advanceTimersByTimeAsync(250);
    await delayed;

    expect(remove).toHaveBeenCalledWith("abort", expect.any(Function));
    expect(vi.getTimerCount()).toBe(0);
  });

  it("removes the abort listener and timer when a poll delay is cancelled", async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    const remove = vi.spyOn(controller.signal, "removeEventListener");
    const delayed = waitForPollDelay(250, controller.signal);

    controller.abort();

    await expect(delayed).rejects.toMatchObject({ name: "AbortError" });
    expect(remove).toHaveBeenCalledWith("abort", expect.any(Function));
    expect(vi.getTimerCount()).toBe(0);
  });
});
