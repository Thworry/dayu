import process from "node:process";

import { readConfig } from "./config.js";
import { buildServer } from "./server.js";

const config = readConfig();
const app = buildServer({ trustedProxies: config.trustedProxies });
let closing = false;

async function close(): Promise<void> {
  if (closing) return;
  closing = true;
  await app.close();
}

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => {
    void close().catch(() => {
      process.exitCode = 1;
    });
  });
}

try {
  await app.listen({ host: config.host, port: config.port });
  process.stdout.write(`DAYU API listening on http://${config.host}:${String(config.port)}\n`);
} catch {
  process.stderr.write("DAYU API could not start. Check the configured host and port.\n");
  process.exitCode = 1;
  await close().catch(() => undefined);
}
