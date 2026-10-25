# 0001. Self-host on Unraid

* Status: accepted
* Date: 2026-10-23

## Context

The goal of this repository is a small proof that a cloud-hosted AI assistant can call tools that see the owner's home NAS. The NAS already runs Unraid and Docker. A hosted MCP server would not have a trustworthy view of Unraid disks or the NAS clock.

## Decision

Run the MCP server on the Unraid host as a Docker Compose stack (Compose Manager plugin or `docker compose` on the box). Persist Tailscale state under the stack directory, typically `/mnt/user/appdata/nas-mcp`. Bind-mount array paths read-only.

## Consequences

* Deploy follows Unraid conventions: appdata for state, `/mnt/user` for user shares, `TZ` matching the Unraid UI.
* The array must be started before the stack can see `/mnt/user`.
* Image builds happen on the NAS unless pulling `ghcr.io/ferrisweil/nas-mcp` (see 0005).
* The Unraid Docker template is the GUI path; Compose with a sidecar remains supported.
* This is a home-lab PoC, not a multi-tenant service.
