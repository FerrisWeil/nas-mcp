import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { hostHeaderAllowed, originHeaderAllowed } from "../src/host.ts";

const allowed = ["localhost", "127.0.0.1", "nas-mcp"];

describe("host allowlist", () => {
  it("allows localhost, the node hostname, MagicDNS, and Tailscale IPs", () => {
    assert.equal(hostHeaderAllowed("localhost:8787", allowed), true);
    assert.equal(hostHeaderAllowed("nas-mcp", allowed), true);
    assert.equal(hostHeaderAllowed("nas-mcp.tail1234.ts.net", allowed), true);
    assert.equal(hostHeaderAllowed("100.64.1.20:8787", allowed), true);
    assert.equal(hostHeaderAllowed("[fd7a:115c:a1e0::1]:8787", allowed), true);
  });

  it("rejects missing or unrelated hosts", () => {
    assert.equal(hostHeaderAllowed(undefined, allowed), false);
    assert.equal(hostHeaderAllowed("evil.example", allowed), false);
    assert.equal(hostHeaderAllowed("192.168.1.1", allowed), false);
  });

  it("allows a missing Origin (non-browser clients) and rejects a bad one", () => {
    assert.equal(originHeaderAllowed(undefined, allowed), true);
    assert.equal(originHeaderAllowed("https://nas-mcp.tail1234.ts.net", allowed), true);
    assert.equal(originHeaderAllowed("https://evil.example", allowed), false);
  });
});
