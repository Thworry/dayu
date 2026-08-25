import {
  collectPublicRepository,
  createGitHubTransport,
} from "@dayu/github-collector";
import cookie from "@fastify/cookie";
import type { NormalizerSnapshot } from "@dayu/scoring-core";
import Fastify, { type FastifyInstance } from "fastify";

import { readConfig } from "./config.js";
import { memoryJobStore } from "./jobs/store.js";
import { createCopilotRunRegistry } from "./jobs/copilot-runs.js";
import type { ScanJobStore } from "./jobs/types.js";
import { registerAbuseProtection } from "./plugins/rate-limit.js";
import { registerRedactedLogger, stdoutSafeLogSink, type SafeLogSink } from "./plugins/redacted-logger.js";
import { registerSecurityHeaders } from "./plugins/security.js";
import { registerHealthRoutes } from "./routes/health.js";
import { registerAuthRoutes, registerUnavailableAuthRoutes, type AuthRoutesDependencies } from "./routes/auth.js";
import { registerScanRoutes, type PublicCollector } from "./routes/scans.js";
import { registerCopilotRoutes, type CopilotRoutesDependencies } from "./routes/copilot.js";

const DEFAULT_NORMALIZER: NormalizerSnapshot = {
  bands: {
    "popularity.contributors": { p80Deficit: 3.5, p99Deficit: 7 },
    "popularity.forks": { p80Deficit: 3.5, p99Deficit: 7 },
    "popularity.human_activity": { p80Deficit: 3.5, p99Deficit: 7 },
    "popularity.subscribers": { p80Deficit: 3.5, p99Deficit: 7 },
  },
  confidence: 0.4,
  version: "embedded-beta-v1",
};

export interface ServerDependencies {
  auth?: AuthRoutesDependencies;
  clock?: () => Date;
  collector?: PublicCollector;
  copilot?: Pick<CopilotRoutesDependencies, "analyze" | "limits">;
  jobStore?: ScanJobStore;
  normalizer?: NormalizerSnapshot;
  onBackgroundError?: (reason: unknown) => void;
  logSink?: SafeLogSink;
  trustedProxies?: string[];
}

export function buildServer(dependencies: ServerDependencies = {}): FastifyInstance {
  const trustedProxies = dependencies.trustedProxies ?? readConfig().trustedProxies;
  const app = Fastify({
    bodyLimit: 64 * 1_024,
    logger: false,
    trustProxy: trustedProxies.length > 0 ? trustedProxies : false,
  });
  const clock = dependencies.clock ?? (() => new Date());
  const collector = dependencies.collector ?? (async (ref) => collectPublicRepository(ref, createGitHubTransport()));
  const jobStore = dependencies.jobStore ?? memoryJobStore({ clock });
  const copilotRuns = createCopilotRunRegistry();

  registerSecurityHeaders(app);
  registerAbuseProtection(app);
  registerRedactedLogger(app, dependencies.logSink ?? stdoutSafeLogSink);

  registerHealthRoutes(app);
  app.addHook("preClose", async () => {
    await copilotRuns.cancelAll();
  });
  app.addHook("onClose", async () => {
    await jobStore.close?.();
  });
  void app.register((scanApp) => {
    registerScanRoutes(scanApp, {
      clock,
      collector,
      jobStore,
      normalizer: dependencies.normalizer ?? DEFAULT_NORMALIZER,
      onBackgroundError: dependencies.onBackgroundError ?? (() => undefined),
    });
  });
  void app.register(async (authApp) => {
    await authApp.register(cookie);
    const auth = dependencies.auth;
    if (auth === undefined) {
      registerUnavailableAuthRoutes(authApp);
      return;
    }
    authApp.addHook("onClose", async () => { await auth.oauth.close(); });
    registerAuthRoutes(authApp, {
      ...auth,
      destroyCopilotSessions: async (githubUserId) => {
        await copilotRuns.cancelUser(githubUserId);
        await auth.destroyCopilotSessions?.(githubUserId);
      },
    });
    registerCopilotRoutes(authApp, {
      ...dependencies.copilot,
      appOrigin: auth.appOrigin,
      clock,
      jobStore,
      oauth: auth.oauth,
      runs: copilotRuns,
      secureCookie: auth.secureCookie,
    });
  });
  return app;
}
