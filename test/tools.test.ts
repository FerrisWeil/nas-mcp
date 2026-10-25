import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";

import {
  Client,
  StreamableHTTPClientTransport,
} from "@modelcontextprotocol/client";

import { getDiskUsage } from "../src/disk.ts";
import { listen } from "../src/http.ts";
import { getServerTime } from "../src/time.ts";
import { TEST_TOKEN, testConfig, withTempDir } from "./helpers.ts";

async function connectClient(url: string): Promise<Client> {
  const client = new Client({ name: "nas-mcp-test", version: "0.0.0" });
  const transport = new StreamableHTTPClientTransport(new URL(`${url}/mcp`), {
    requestInit: {
      headers: {
        authorization: `Bearer ${TEST_TOKEN}`,
      },
    },
  });
  await client.connect(transport);
  return client;
}

describe("get_server_time", () => {
  it("returns timezone and a timestamp near now", () => {
    const frozen = new Date("2026-10-23T23:00:00.000Z");
    const time = getServerTime(frozen);
    assert.equal(time.iso, "2026-10-23T23:00:00.000Z");
    assert.equal(time.unixMs, frozen.getTime());
    assert.ok(time.timeZone.length > 0);
    assert.match(time.utcOffset, /^[+-]\d{2}:\d{2}$/);
  });
});

describe("get_disk_usage", () => {
  it("reports total, used, and free bytes for a real path", async () => {
    await withTempDir(async (dir) => {
      const usage = await getDiskUsage(dir);
      assert.equal(usage.path, dir);
      assert.equal("error" in usage, false);
      if ("error" in usage) {
        return;
      }
      assert.ok(usage.totalBytes > 0);
      assert.ok(usage.freeBytes >= 0);
      assert.ok(usage.usedBytes >= 0);
      assert.ok(usage.usedBytes + usage.freeBytes <= usage.totalBytes);
    });
  });

  it("returns an error object for a missing path instead of throwing", async () => {
    const usage = await getDiskUsage("/definitely/not/a/nas-mcp-mount");
    assert.equal(usage.path, "/definitely/not/a/nas-mcp-mount");
    assert.equal("error" in usage, true);
  });
});

describe("mcp tools over streamable HTTP", () => {
  let baseUrl = "";
  let diskPath = "";
  let close: () => Promise<void> = async () => {};

  before(async () => {
    diskPath = await mkdtemp(join(tmpdir(), "nas-mcp-"));
    const { server, url } = await listen(testConfig({ diskPaths: [diskPath] }));
    baseUrl = url;
    close = () =>
      new Promise((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
  });

  after(async () => {
    await close();
    await rm(diskPath, { recursive: true, force: true });
  });

  it("exposes only the two read-only tools", async () => {
    const client = await connectClient(baseUrl);
    try {
      const listed = await client.listTools();
      assert.deepEqual(
        listed.tools.map((tool) => tool.name).sort(),
        ["get_disk_usage", "get_server_time"],
      );
      for (const tool of listed.tools) {
        assert.equal(tool.annotations?.readOnlyHint, true);
        assert.equal(tool.annotations?.destructiveHint, false);
      }
    } finally {
      await client.close();
    }
  });

  it("calls get_server_time", async () => {
    const client = await connectClient(baseUrl);
    try {
      const result = await client.callTool({
        name: "get_server_time",
        arguments: {},
      });
      assert.equal(result.isError, undefined);
      const structured = result.structuredContent as {
        iso: string;
        unixMs: number;
        timeZone: string;
      };
      assert.match(structured.iso, /^\d{4}-\d{2}-\d{2}T/);
      assert.ok(Math.abs(Date.now() - structured.unixMs) < 10_000);
      assert.ok(structured.timeZone.length > 0);
    } finally {
      await client.close();
    }
  });

  it("calls get_disk_usage for configured mounts only", async () => {
    const client = await connectClient(baseUrl);
    try {
      const result = await client.callTool({
        name: "get_disk_usage",
        arguments: {},
      });
      assert.equal(result.isError, undefined);
      const structured = result.structuredContent as {
        mounts: Array<{ path: string; totalBytes?: number; error?: string }>;
      };
      assert.equal(structured.mounts.length, 1);
      assert.equal(structured.mounts[0]?.path, diskPath);
      assert.ok((structured.mounts[0]?.totalBytes ?? 0) > 0);
    } finally {
      await client.close();
    }
  });
});
