import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { Config } from "../src/config.ts";

export const TEST_TOKEN = "test-token-not-for-production";

export function testConfig(overrides: Partial<Config> = {}): Config {
  return {
    authToken: TEST_TOKEN,
    bindHost: "127.0.0.1",
    port: 0,
    hostname: "nas-mcp",
    diskPaths: [process.cwd()],
    allowedHosts: ["localhost", "127.0.0.1", "::1", "nas-mcp"],
    ...overrides,
  };
}

export async function withTempDir<T>(
  fn: (dir: string) => Promise<T>,
): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), "nas-mcp-"));
  try {
    return await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
