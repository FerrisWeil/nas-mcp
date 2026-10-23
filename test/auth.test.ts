import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import { loadConfig } from "../src/config.ts";
import { listen } from "../src/http.ts";
import { TEST_TOKEN, testConfig } from "./helpers.ts";

describe("config", () => {
  it("refuses to start without MCP_AUTH_TOKEN", () => {
    assert.throws(
      () => loadConfig({ PORT: "8787" }),
      /MCP_AUTH_TOKEN is required/,
    );
  });

  it("refuses a short token", () => {
    assert.throws(
      () => loadConfig({ MCP_AUTH_TOKEN: "short" }),
      /at least 16 characters/,
    );
  });
});

describe("http auth", () => {
  let baseUrl = "";
  let close: () => Promise<void> = async () => {};

  before(async () => {
    const { server, url } = await listen(testConfig());
    baseUrl = url;
    close = () =>
      new Promise((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
  });

  after(async () => {
    await close();
  });

  it("serves /health without a token", async () => {
    const response = await fetch(`${baseUrl}/health`);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { status: "ok" });
  });

  it("rejects /mcp when the token is missing", async () => {
    const response = await fetch(`${baseUrl}/mcp`, { method: "POST" });
    assert.equal(response.status, 401);
    assert.equal(response.headers.get("www-authenticate"), 'Bearer realm="nas-mcp"');
    assert.deepEqual(await response.json(), { error: "unauthorized" });
  });

  it("rejects /mcp when the token is wrong", async () => {
    const response = await fetch(`${baseUrl}/mcp`, {
      method: "POST",
      headers: { authorization: "Bearer totally-wrong-token" },
    });
    assert.equal(response.status, 401);
    assert.deepEqual(await response.json(), { error: "unauthorized" });
  });

  it("rejects a non-Bearer scheme even with the right secret", async () => {
    const response = await fetch(`${baseUrl}/mcp`, {
      method: "POST",
      headers: { authorization: `Basic ${TEST_TOKEN}` },
    });
    assert.equal(response.status, 401);
  });

  it("does not treat a correct token on /health as required", async () => {
    const response = await fetch(`${baseUrl}/health`, {
      headers: { authorization: `Bearer ${TEST_TOKEN}` },
    });
    assert.equal(response.status, 200);
  });
});
