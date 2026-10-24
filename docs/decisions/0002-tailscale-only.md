# 0002. No public exposure; Tailscale-only with limited-access ACLs

* Status: accepted
* Date: 2026-10-23

## Context

The server holds a window onto NAS storage metadata. It must never be reachable from the public internet, Unraid's LAN publish ports, or an unauthenticated tailnet peer.

## Decision

* Do not publish host ports. Compose uses `network_mode: service:tailscale` with the official Tailscale sidecar. The Unraid template runs `tailscaled` in the same container (see 0005).
* Authenticate the sidecar with `TS_AUTHKEY`, persist `/var/lib/tailscale`, and name the node `nas-mcp`.
* Advertise `tag:nas-mcp`. A sample ACL grants `tag:bot` access only to this node's MCP ports (8787 and 443).
* Optionally terminate HTTPS with Tailscale Serve (tailnet-only). Do not enable Funnel. `AllowFunnel` is omitted so the node is not marked as a Funnel endpoint.

## Consequences

* Clients must be on the tailnet. A cloud assistant needs a Tailscale identity (tagged device, sidecar, or self-hosted worker), not a public URL.
* MagicDNS + HTTPS certificates are required for `https://nas-mcp.<tailnet>.ts.net`. Plain `http://nas-mcp:8787` works without certificates.
* Binding `0.0.0.0:8787` inside the sidecar makes HTTP reachable on the tailnet IP. Set `BIND_HOST=127.0.0.1` to leave only Serve on 443.
* Tailscale ACLs are the network boundary; they are not a substitute for the bearer token (see 0003).
