import { createMcpHandler, McpServer } from "@modelcontextprotocol/server";
import * as z from "zod/v4";

import type { Config } from "./config.js";
import { getDiskUsageForPaths } from "./disk.js";
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

export function createNasMcpServer(config: Config): McpServer {
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
      const mounts = await getDiskUsageForPaths(config.diskPaths);
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(mounts, null, 2),
          },
        ],
        structuredContent: { mounts },
      };
    },
  );

  return server;
}

export function createNasMcpHandler(config: Config) {
  return createMcpHandler(() => createNasMcpServer(config));
}
