import { createMcpHandler, McpServer } from "@modelcontextprotocol/server";
import * as z from "zod/v4";

import type { Config } from "./config.js";
import type { DiskUsageResult } from "./disk.js";
import { getDiskUsageForPaths } from "./disk.js";
import { consoleLogger, formatToolErrorLog, type Logger } from "./log.js";
import { getServerTime } from "./time.js";

const serverTimeSchema = z.object({
  iso: z.string(),
  unixMs: z.number(),
  timeZone: z.string(),
  utcOffset: z.string(),
});

const diskUsageSchema = z.object({
  mounts: z.array(
    z.object({
      path: z.string(),
      totalBytes: z.number().optional(),
      usedBytes: z.number().optional(),
      freeBytes: z.number().optional(),
      usedPercent: z.number().optional(),
      error: z.string().optional(),
    }),
  ),
});

const readOnly = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
} as const;

function clientMount(mount: DiskUsageResult): DiskUsageResult {
  if ("error" in mount) {
    return { path: mount.path, error: mount.error };
  }
  return mount;
}

function logToolFailure(logger: Logger, tool: string, error: unknown, path?: string): void {
  logger.error(
    formatToolErrorLog({
      ts: new Date().toISOString(),
      tool,
      error,
      path,
    }),
  );
}

export function createNasMcpServer(config: Config, logger: Logger = consoleLogger): McpServer {
  const server = new McpServer(
    {
      name: "nas-mcp",
      version: "0.1.0",
      title: "Unraid NAS (read-only)",
    },
    {
      instructions:
        "Read-only NAS facts: current server time and disk usage for configured mount paths. This server cannot write, delete, or change anything.",
    },
  );

  server.registerTool(
    "get_server_time",
    {
      title: "Get server time",
      description:
        "Return the NAS clock as UTC ISO-8601, Unix milliseconds, timezone name, and UTC offset.",
      inputSchema: z.object({}),
      outputSchema: serverTimeSchema,
      annotations: readOnly,
    },
    async () => {
      try {
        const time = getServerTime();
        return {
          content: [
            {
              type: "text",
              text: `${time.iso} (${time.timeZone}, UTC${time.utcOffset})`,
            },
          ],
          structuredContent: time,
        };
      } catch (error) {
        logToolFailure(logger, "get_server_time", error);
        throw error;
      }
    },
  );

  server.registerTool(
    "get_disk_usage",
    {
      title: "Get disk usage",
      description:
        "Return total, used, and free bytes for the mount paths configured on the server. Paths are not caller-selectable.",
      inputSchema: z.object({}),
      outputSchema: diskUsageSchema,
      annotations: readOnly,
    },
    async () => {
      try {
        const mounts = await getDiskUsageForPaths(config.diskPaths);
        const reported = mounts.map((mount) => {
          if ("error" in mount) {
            const failure = new Error(mount.error);
            if (mount.stack) {
              failure.stack = mount.stack;
            }
            logToolFailure(logger, "get_disk_usage", failure, mount.path);
          }
          return clientMount(mount);
        });
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(reported, null, 2),
            },
          ],
          structuredContent: { mounts: reported },
        };
      } catch (error) {
        logToolFailure(logger, "get_disk_usage", error);
        throw error;
      }
    },
  );

  return server;
}

export function createNasMcpHandler(config: Config, logger: Logger = consoleLogger) {
  return createMcpHandler(() => createNasMcpServer(config, logger));
}
