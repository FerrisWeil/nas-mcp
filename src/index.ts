import { loadConfig, type Config } from "./config.js";
import { listen } from "./http.js";
import { consoleLogger, createRedactingLogger, formatStartupLog } from "./log.js";
import { serverTimeZone } from "./time.js";
import { VERSION } from "./version.js";

let config: Config;
try {
  config = loadConfig();
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  process.exit(1);
}

const logger = createRedactingLogger(consoleLogger, [config.authToken]);
const { server } = await listen(config, { logger });

logger.info(
  formatStartupLog({
    ts: new Date().toISOString(),
    version: VERSION,
    listen: `${config.bindHost}:${config.port}`,
    mounts: config.diskPaths,
    timeZone: serverTimeZone(),
  }),
);

async function shutdown(signal: string): Promise<void> {
  logger.info(
    JSON.stringify({
      ts: new Date().toISOString(),
      level: "info",
      msg: "shutdown",
      signal,
    }),
  );
  await new Promise<void>((resolve) => {
    server.close(() => resolve());
  });
  process.exit(0);
}

process.on("SIGTERM", () => {
  void shutdown("SIGTERM");
});
process.on("SIGINT", () => {
  void shutdown("SIGINT");
});
