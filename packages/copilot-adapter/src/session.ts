import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { CopilotClient, type CopilotClientOptions, type SessionConfig } from "@github/copilot-sdk";
import type { Evidence } from "@dayu/evidence-schema";

import { adjudicateCopilotAnalysis, indexEvidence } from "./adjudicate.js";
import { buildPromptFromSnippets, selectEvidence } from "./prompt.js";
import type { CopilotAnalysis } from "./schema.js";

export interface CopilotInput {
  githubToken: string;
  evidence: readonly Evidence[];
}

export interface CopilotTimeouts {
  sendMs: number;
  createSessionMs: number;
  cleanupMs: number;
}

export interface AdapterSession {
  sendAndWait(options: { prompt: string }, timeout?: number): Promise<{ data: { content: string } } | undefined>;
  disconnect(): Promise<void>;
}

export interface AdapterClient {
  createSession(options: SessionConfig): Promise<AdapterSession>;
  stop(): Promise<Error[]>;
  forceStop(): Promise<void>;
}

export type CopilotClientFactory = (options: CopilotClientOptions) => AdapterClient;

function runtimeEnvironment(): Record<string, string | undefined> {
  const allowed = ["PATH", "LANG", "LC_ALL", "TMPDIR", "SSL_CERT_FILE", "NODE_EXTRA_CA_CERTS", "HTTPS_PROXY", "HTTP_PROXY", "NO_PROXY"];
  const env: Record<string, string | undefined> = {};
  for (const name of allowed) env[name] = process.env[name];
  env.GH_TOKEN = undefined;
  env.GITHUB_TOKEN = undefined;
  env.COPILOT_GITHUB_TOKEN = undefined;
  return env;
}

const defaultClientFactory: CopilotClientFactory = (options) => new CopilotClient(options);

function parseResponse(content: string): unknown {
  if (Buffer.byteLength(content, "utf8") > MAX_COPILOT_RESPONSE_BYTES) throw new Error("copilot_response_too_large");
  try {
    return JSON.parse(content) as unknown;
  } catch {
    throw new Error("copilot_invalid_json");
  }
}

function stableError(code: string): Error {
  const error = new Error(code);
  error.stack = `${error.name}: ${code}`;
  return error;
}

const INTERNAL_ERROR_CODES = new Set([
  "absolute_claim_rejected",
  "complete_scope_required",
  "copilot_empty_response",
  "copilot_invalid_json",
  "copilot_response_too_large",
  "counterevidence_required",
  "duplicate_evidence_id",
  "duplicate_input_evidence_id",
  "duplicate_rubric_id",
  "evidence_envelope_too_large",
  "evidence_required",
  "evidence_snippet_too_large",
  "github_token_required",
  "inconsistent_bilingual_pair",
  "invalid_copilot_output",
  "unknown_evidence_id",
  "unsafe_output_content",
]);

export const MAX_COPILOT_RESPONSE_BYTES = 64_000;
export const DEFAULT_COPILOT_TIMEOUTS: Readonly<CopilotTimeouts> = {
  sendMs: 60_000,
  createSessionMs: 15_000,
  cleanupMs: 2_000,
};

function resolvedTimeouts(overrides: Partial<CopilotTimeouts>): CopilotTimeouts {
  const resolved = { ...DEFAULT_COPILOT_TIMEOUTS, ...overrides };
  if (Object.values(resolved).some((value) => !Number.isFinite(value) || value <= 0)) throw stableError("copilot_analysis_failed");
  return resolved;
}

async function bounded<T>(operation: () => Promise<T>, timeoutMs: number): Promise<{ ok: true; value: T } | { ok: false }> {
  let timeout: NodeJS.Timeout | undefined;
  const deadline = new Promise<never>((_resolve, reject) => {
    timeout = setTimeout(() => {
      reject(new Error("operation_timeout"));
    }, timeoutMs);
  });
  try {
    return { ok: true, value: await Promise.race([operation(), deadline]) };
  } catch {
    return { ok: false };
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

function analysisErrorCode(error: unknown): string {
  return error instanceof Error && INTERNAL_ERROR_CODES.has(error.message) ? error.message : "copilot_analysis_failed";
}

export async function analyzeWithCopilot(
  input: CopilotInput,
  clientFactory: CopilotClientFactory = defaultClientFactory,
  timeoutOverrides: Partial<CopilotTimeouts> = {},
): Promise<CopilotAnalysis> {
  if (input.githubToken.length === 0) throw stableError("github_token_required");
  const timeouts = resolvedTimeouts(timeoutOverrides);

  let baseDirectory: string;
  try {
    baseDirectory = await mkdtemp(join(tmpdir(), "dayu-copilot-"));
  } catch {
    throw stableError("copilot_analysis_failed");
  }
  let client: AdapterClient | undefined;
  let session: AdapterSession | undefined;
  let primaryError: unknown;
  let result: CopilotAnalysis | undefined;

  try {
    const snippets = selectEvidence(input.evidence);
    const selectedIds = new Set(snippets.map((snippet) => snippet.evidenceId));
    const selectedEvidence = input.evidence.filter((item) => selectedIds.has(item.id));
    const prompt = buildPromptFromSnippets(snippets);
    const clientOptions: CopilotClientOptions = {
      baseDirectory,
      builtinPluginDirectories: [],
      enableRemoteSessions: false,
      env: runtimeEnvironment(),
      logLevel: "none",
      mode: "empty",
      sessionIdleTimeoutSeconds: 60,
      useLoggedInUser: false,
      workingDirectory: baseDirectory,
    };
    const createdClient = clientFactory(clientOptions);
    client = createdClient;
    const sessionOptions: SessionConfig = {
      availableTools: [],
      customAgents: [],
      customAgentsLocalOnly: true,
      disabledMcpServers: [],
      enableConfigDiscovery: false,
      enableExperimentalMode: false,
      enableFileChangeTracking: false,
      enableManagedSettings: false,
      enableMcpApps: false,
      gitHubToken: input.githubToken,
      infiniteSessions: { enabled: false },
      instructionDirectories: [],
      manageScheduleEnabled: false,
      mcpOAuthTokenStorage: "in-memory",
      mcpServers: {},
      pluginDirectories: [],
      requestCanvasRenderer: false,
      requestExtensions: false,
      sessionId: randomUUID(),
      skillDirectories: [],
      skipCustomInstructions: true,
      streaming: false,
      tools: [],
      workingDirectory: baseDirectory,
    };
    const createdSessionResult = await bounded(() => createdClient.createSession(sessionOptions), timeouts.createSessionMs);
    if (!createdSessionResult.ok) throw new Error("copilot_analysis_failed");
    const createdSession = createdSessionResult.value;
    session = createdSession;
    const responseResult = await bounded(() => createdSession.sendAndWait({ prompt }, timeouts.sendMs), timeouts.sendMs);
    if (!responseResult.ok) throw new Error("copilot_analysis_failed");
    if (!responseResult.value) throw new Error("copilot_empty_response");
    result = adjudicateCopilotAnalysis(parseResponse(responseResult.value.data.content), indexEvidence(selectedEvidence));
  } catch (error) {
    primaryError = error;
  }

  let cleanupFailed = false;
  let forceStopRequired = false;
  if (session) {
    const currentSession = session;
    const disconnected = await bounded(() => currentSession.disconnect(), timeouts.cleanupMs);
    if (!disconnected.ok) {
      cleanupFailed = true;
      forceStopRequired = true;
    }
  }
  if (client) {
    const stopped = await bounded(() => client.stop(), timeouts.cleanupMs);
    if (!stopped.ok || stopped.value.length > 0) {
      cleanupFailed = true;
      forceStopRequired = true;
    }
    if (forceStopRequired) {
      const forceStopped = await bounded(() => client.forceStop(), timeouts.cleanupMs);
      if (!forceStopped.ok) cleanupFailed = true;
    }
  }
  const removed = await bounded(() => rm(baseDirectory, { force: true, recursive: true }), timeouts.cleanupMs);
  if (!removed.ok) cleanupFailed = true;

  if (cleanupFailed) throw stableError("copilot_cleanup_failed");
  if (primaryError !== undefined) throw stableError(analysisErrorCode(primaryError));
  if (!result) throw stableError("copilot_empty_response");
  return result;
}
