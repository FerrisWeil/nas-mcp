import { loadConfig, type Config } from "./config.js";
import { listen } from "./http.js";

let config: Config;
try {
  config = loadConfig();
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  process.exit(1);
}

const { server, url } = await listen(config);

console.log(
  `nas-mcp listening on ${config.bindHost}:${config.port} (${url}/mcp)`,
);

async function shutdown(signal: string): Promise<void> {
  console.log(`received ${signal}, shutting down`);
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
