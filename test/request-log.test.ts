import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  Client,
  StreamableHTTPClientTransport,
} from "@modelcontextprotocol/client";

import { listen } from "../src/http.ts";
import type { Logger } from "../src/log.ts";
import { TEST_TOKEN, testConfig } from "./helpers.ts";

const WRONG_TOKEN = "wrong-token-should-not-appear";

function captureLogger(): { logger: Logger; lines: string[] } {
  const lines: string[] = [];
  const logger: Logger = {
    info: (line) => lines.push(line),
    warn: (line) => lines.push(line),
    error: (line) => lines.push(line),
  };
  return { logger, lines };
}

function parsedLines(lines: string[]): Array<Record<string, unknown>> {
  return lines.map((line) => JSON.parse(line) as Record<string, unknown>);
}

async function closeServer(server: { close: (cb: (error?: Error) => void) => void }): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}

describe("http request logs", () => {
  it("records auth result and never the bearer token", async () => {
    const { logger, lines } = captureLogger();
    const { server, url } = await listen(testConfig(), { logger });
    try {
      const missing = await fetch(`${url}/mcp`, { method: "POST" });
      assert.equal(missing.status, 401);

      const invalid = await fetch(`${url}/mcp`, {
        method: "POST",
        headers: { authorization: `Bearer ${WRONG_TOKEN}` },
      });
      assert.equal(invalid.status, 401);

      const ok = await fetch(`${url}/mcp`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${TEST_TOKEN}`,
          "content-type": "application/json",
          accept: "application/json, text/event-stream",
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "tools/call",
          params: { name: "get_server_time", arguments: { secret: TEST_TOKEN } },
        }),
      });
      assert.ok(ok.status === 200 || ok.status === 400 || ok.status === 406);
      await ok.text();

      const joined = lines.join("\n");
      assert.equal(joined.includes(TEST_TOKEN), false);
      assert.equal(joined.includes(WRONG_TOKEN), false);
      assert.equal(joined.includes("Authorization"), false);

      const requests = parsedLines(lines).filter((line) => line.msg === "request");
      assert.deepEqual(
        requests.map((line) => line.auth),
        ["missing", "invalid", "ok"],
      );
      const toolCall = requests[2];
      assert.equal(toolCall?.method, "POST");
      assert.equal(toolCall?.path, "/mcp");
      assert.equal(toolCall?.mcpMethod, "tools/call");
      assert.equal(toolCall?.tool, "get_server_time");
      assert.equal(typeof toolCall?.status, "number");
      assert.equal(typeof toolCall?.durationMs, "number");
      assert.match(String(toolCall?.remoteAddress), /127\.0\.0\.1/);
      assert.match(String(toolCall?.ts), /^\d{4}-\d{2}-\d{2}T/);
      assert.equal(lines.every((line) => !line.includes("\n")), true);
    } finally {
      await closeServer(server);
    }
  });

  it("warns when a call exceeds the slow threshold", async () => {
    const { logger, lines } = captureLogger();
    let ticks = 0;
    const { server, url } = await listen(testConfig(), {
      logger,
      slowRequestMs: 2_000,
      monotonicNow: () => {
        ticks += 1;
        return ticks === 1 ? 0 : 2_500;
      },
    });
    try {
      const response = await fetch(`${url}/mcp`, {
        method: "POST",
        headers: { authorization: `Bearer ${TEST_TOKEN}` },
      });
      assert.ok(response.status >= 400);
      await response.text();
      const records = parsedLines(lines);
      const warning = records.find((line) => line.msg === "slow_request");
      const request = records.find((line) => line.msg === "request");
      assert.equal(request?.status, response.status);
      assert.ok(warning);
      assert.equal(warning?.level, "warn");
      assert.equal(warning?.durationMs, 2500);
      assert.equal(warning?.thresholdMs, 2000);
      assert.equal(warning?.path, "/mcp");
      assert.equal(lines.join("\n").includes(TEST_TOKEN), false);
    } finally {
      await closeServer(server);
    }
  });

  it("reports unreadable mounts on /health and logs a warning", async () => {
    const { logger, lines } = captureLogger();
    const missing = "/definitely/not/a/nas-mcp-mount";
    const { server, url } = await listen(
      testConfig({ diskPaths: [missing] }),
      { logger },
    );
    try {
      const response = await fetch(`${url}/health`);
      assert.equal(response.status, 200);
      const body = (await response.json()) as {
        status: string;
        uptimeSeconds: number;
        mounts: Array<{ path: string; readable: boolean }>;
      };
      assert.equal(body.status, "degraded");
      assert.equal(body.mounts[0]?.path, missing);
      assert.equal(body.mounts[0]?.readable, false);
      assert.equal(typeof body.uptimeSeconds, "number");
      const warning = parsedLines(lines).find((line) => line.msg === "mount_unreadable");
      assert.equal(warning?.path, missing);
      assert.equal(lines.join("\n").includes(TEST_TOKEN), false);
    } finally {
      await closeServer(server);
    }
  });

  it("logs a tool failure stack and keeps it out of the client payload", async () => {
    const { logger, lines } = captureLogger();
    const missing = "/definitely/not/a/nas-mcp-mount";
    const { server, url } = await listen(
      testConfig({ diskPaths: [missing] }),
      { logger },
    );
    const client = new Client({ name: "nas-mcp-log-test", version: "0.0.0" });
    const transport = new StreamableHTTPClientTransport(new URL(`${url}/mcp`), {
      requestInit: {
        headers: { authorization: `Bearer ${TEST_TOKEN}` },
      },
    });
    try {
      await client.connect(transport);
      const result = await client.callTool({
        name: "get_disk_usage",
        arguments: {},
      });
      const serialized = JSON.stringify(result);
      assert.equal(serialized.includes(TEST_TOKEN), false);
      assert.equal(serialized.includes("stack"), false);
      assert.match(serialized, /not\/a\/nas-mcp-mount/);

      const failure = parsedLines(lines).find((line) => line.msg === "tool_error");
      assert.ok(failure);
      assert.equal(failure?.tool, "get_disk_usage");
      assert.equal(failure?.path, missing);
      assert.equal(typeof failure?.stack, "string");
      assert.match(String(failure?.stack), /Error/);
      assert.equal(lines.join("\n").includes(TEST_TOKEN), false);
    } finally {
      await client.close();
      await closeServer(server);
    }
  });
});
