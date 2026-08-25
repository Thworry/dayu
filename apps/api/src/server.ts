import {
  collectPublicRepository,
  createGitHubTransport,
} from "@dayu/github-collector";
import rateLimit from "@fastify/rate-limit";
import cookie from "@fastify/cookie";
import type { NormalizerSnapshot } from "@dayu/scoring-core";
import Fastify, { type FastifyInstance } from "fastify";

import { readConfig } from "./config.js";
import { memoryJobStore } from "./jobs/store.js";
import type { ScanJobStore } from "./jobs/types.js";
import { registerHealthRoutes } from "./routes/health.js";
import { registerAuthRoutes, registerUnavailableAuthRoutes, type AuthRoutesDependencies } from "./routes/auth.js";
import { registerScanRoutes, type PublicCollector } from "./routes/scans.js";

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
  jobStore?: ScanJobStore;
  normalizer?: NormalizerSnapshot;
  onBackgroundError?: (reason: unknown) => void;
  trustedProxies?: string[];
}

export function buildServer(dependencies: ServerDependencies = {}): FastifyInstance {
  const trustedProxies = dependencies.trustedProxies ?? readConfig().trustedProxies;
  const app = Fastify({
    logger: false,
    trustProxy: trustedProxies.length > 0 ? trustedProxies : false,
  });
  const clock = dependencies.clock ?? (() => new Date());
  const collector = dependencies.collector ?? (async (ref) => collectPublicRepository(ref, createGitHubTransport()));
  const jobStore = dependencies.jobStore ?? memoryJobStore({ clock });

  registerHealthRoutes(app);
  app.addHook("onClose", async () => {
    await jobStore.close?.();
  });
  void app.register(async (scanApp) => {
    await scanApp.register(rateLimit, {
      errorResponseBuilder: () => ({ error: { code: "request_rate_limited" }, statusCode: 429 }),
      global: false,
      keyGenerator: (request) => request.ip,
    });
    registerScanRoutes(scanApp, {
      clock,
      collector,
      jobStore,
      normalizer: dependencies.normalizer ?? DEFAULT_NORMALIZER,
      onBackgroundError: dependencies.onBackgroundError ?? ((reason: unknown) => {
        app.log.error({ errorType: reason instanceof Error ? reason.name : "unknown" }, "background scan failed terminally");
      }),
    });
  });
  void app.register(async (authApp) => {
    await authApp.register(cookie);
    const auth = dependencies.auth;
    if (auth === undefined) {
      registerUnavailableAuthRoutes(authApp);
      return;
    }
    await authApp.register(rateLimit, {
      errorResponseBuilder: () => ({ error: { code: "request_rate_limited" }, statusCode: 429 }),
      global: false,
      keyGenerator: (request) => request.ip,
    });
    authApp.addHook("onClose", async () => {
      await auth.oauth.close();
    });
    registerAuthRoutes(authApp, auth);
  });
  return app;
}
