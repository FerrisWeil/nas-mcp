import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  describeMcpBody,
  formatRequestLog,
  formatSlowCallLog,
  formatStartupLog,
  formatToolErrorLog,
  redactAuthHeaders,
  redactSecrets,
} from "../src/log.ts";
import { TEST_TOKEN, testConfig } from "./helpers.ts";

const TS = "2026-10-31T16:36:00.000Z";

describe("request log formatter", () => {
  it("emits one JSON line with the diagnostic fields", () => {
    const line = formatRequestLog({
      ts: TS,
      method: "POST",
      path: "/mcp",
      mcpMethod: "tools/call",
      tool: "get_server_time",
      status: 200,
      durationMs: 12,
      remoteAddress: "100.64.0.8",
      auth: "ok",
    });

    assert.equal(line.includes("\n"), false);
    assert.deepEqual(JSON.parse(line), {
      ts: TS,
      level: "info",
      msg: "request",
      method: "POST",
      path: "/mcp",
      mcpMethod: "tools/call",
      tool: "get_server_time",
      status: 200,
      durationMs: 12,
      remoteAddress: "100.64.0.8",
      auth: "ok",
    });
  });

  it("omits MCP method and tool when the request has none", () => {
    const line = formatRequestLog({
      ts: TS,
      method: "GET",
      path: "/health",
      status: 200,
      durationMs: 1,
      remoteAddress: "127.0.0.1",
      auth: "missing",
    });
    const parsed = JSON.parse(line) as Record<string, unknown>;
    assert.equal(parsed.mcpMethod, undefined);
    assert.equal(parsed.tool, undefined);
    assert.equal(parsed.auth, "missing");
  });

  it("startup line lists version, listen address, mounts, and time zone only", () => {
    const token = "super-secret-token-value";
    const line = formatStartupLog({
      ts: TS,
      version: "0.1.0",
      listen: "0.0.0.0:8787",
      mounts: ["/data/user", "/data/cache"],
      timeZone: "America/Chicago",
    });
    assert.equal(line.includes("\n"), false);
    assert.equal(line.includes(token), false);
    assert.equal(line.includes("authToken"), false);
    assert.deepEqual(JSON.parse(line), {
      ts: TS,
      level: "info",
      msg: "startup",
      version: "0.1.0",
      listen: "0.0.0.0:8787",
      mounts: ["/data/user", "/data/cache"],
      timeZone: "America/Chicago",
    });

    const config = testConfig({ authToken: token, diskPaths: ["/data/user"] });
    const fromConfig = formatStartupLog({
      ts: TS,
      version: "0.1.0",
      listen: `${config.bindHost}:${config.port}`,
      mounts: config.diskPaths,
      timeZone: "UTC",
    });
    assert.equal(fromConfig.includes(token), false);
    assert.equal(JSON.parse(fromConfig).listen, "127.0.0.1:0");
  });
});

describe("auth header redaction", () => {
  it("strips bearer credentials from authorization headers", () => {
    const secret = "super-secret-token-value";
    const samples = [
      `Authorization: Bearer ${secret}`,
      `authorization: bearer ${secret}`,
      `{"authorization":"Bearer ${secret}"}`,
      `proxy-authorization: Basic ${secret}`,
    ];
    for (const sample of samples) {
      const redacted = redactAuthHeaders(sample);
      assert.equal(redacted.includes(secret), false, sample);
      assert.match(redacted, /\[redacted\]/);
    }
  });

  it("leaves a bearer challenge realm intact", () => {
    const header = 'WWW-Authenticate: Bearer realm="nas-mcp"';
    assert.equal(redactAuthHeaders(header), header);
  });

  it("removes the configured token even when it is not labeled as a header", () => {
    const line = redactSecrets(
      `path=/tmp/${TEST_TOKEN}/share authorization=Bearer ${TEST_TOKEN}`,
      [TEST_TOKEN],
    );
    assert.equal(line.includes(TEST_TOKEN), false);
    assert.match(line, /\[redacted\]/);
  });

  it("redacts tokens inside a tool error stack without breaking the single line", () => {
    const secret = "super-secret-token-value";
    const error = new Error(`Authorization: Bearer ${secret} rejected`);
    error.stack = `Error: Authorization: Bearer ${secret} rejected\n    at get_disk_usage (src/mcp.ts:10:5)`;
    const line = redactSecrets(
      formatToolErrorLog({
        ts: TS,
        tool: "get_disk_usage",
        path: "/data/user",
        error,
      }),
      [secret],
    );
    assert.equal(line.includes("\n"), false);
    assert.equal(line.includes(secret), false);
    const parsed = JSON.parse(line) as {
      level: string;
      msg: string;
      tool: string;
      path: string;
      error: string;
      stack: string;
    };
    assert.equal(parsed.level, "error");
    assert.equal(parsed.msg, "tool_error");
    assert.equal(parsed.tool, "get_disk_usage");
    assert.equal(parsed.path, "/data/user");
    assert.match(parsed.error, /\[redacted\]/);
    assert.match(parsed.stack, /get_disk_usage/);
    assert.equal(parsed.stack.includes(secret), false);
  });
});

describe("mcp body summary", () => {
  it("reads the JSON-RPC method and tools/call name", () => {
    const described = describeMcpBody(
      JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: { name: "get_disk_usage", arguments: { token: TEST_TOKEN } },
      }),
    );
    assert.deepEqual(described, {
      mcpMethod: "tools/call",
      tool: "get_disk_usage",
    });
    assert.equal(JSON.stringify(described).includes(TEST_TOKEN), false);
  });

  it("joins batched methods and ignores arguments", () => {
    const described = describeMcpBody(
      JSON.stringify([
        { jsonrpc: "2.0", method: "notifications/initialized" },
        {
          jsonrpc: "2.0",
          id: 2,
          method: "tools/call",
          params: { name: "get_server_time", arguments: {} },
        },
      ]),
    );
    assert.equal(described.mcpMethod, "notifications/initialized,tools/call");
    assert.equal(described.tool, "get_server_time");
  });

  it("returns an empty summary for non-JSON bodies", () => {
    assert.deepEqual(describeMcpBody("not-json"), {});
    assert.deepEqual(describeMcpBody(""), {});
  });
});

describe("slow call warning", () => {
  it("records duration and threshold without a stack", () => {
    const line = formatSlowCallLog({
      ts: TS,
      method: "POST",
      path: "/mcp",
      mcpMethod: "tools/call",
      tool: "get_disk_usage",
      durationMs: 2500,
      thresholdMs: 2000,
    });
    assert.equal(line.includes("\n"), false);
    assert.deepEqual(JSON.parse(line), {
      ts: TS,
      level: "warn",
      msg: "slow_request",
      method: "POST",
      path: "/mcp",
      mcpMethod: "tools/call",
      tool: "get_disk_usage",
      durationMs: 2500,
      thresholdMs: 2000,
    });
  });
});
