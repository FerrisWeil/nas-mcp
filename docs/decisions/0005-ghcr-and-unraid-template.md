# 0005. GHCR image and a single-container Unraid template

* Status: accepted
* Date: 2026-10-24

## Context

Unraid's Docker template XML cannot describe a Compose sidecar. The spike's first deploy path (`tailscale/tailscale` + `network_mode: service:tailscale`) still works, but the owner wants to add the container from the Unraid Docker UI, pull `ghcr.io/ferrisweil/nas-mcp:latest` without registry credentials, and keep the service off the LAN and the public internet.

## Decision

1. **Publish a multi-arch image to GHCR.** GitHub Actions builds `linux/amd64` and `linux/arm64` on pushes to `main`, tags `latest` and `sha-<short>`, and authenticates with `GITHUB_TOKEN` (`packages: write`). Pull requests build `linux/amd64` only and do not push. The owner makes the package **public** in the GitHub UI after the first publish so Unraid can pull without a login.
2. **Ship Tailscale *inside* the same image, started only when `TS_AUTHKEY` is set.** The MCP process still drops to user `node`. Compose does not pass `TS_AUTHKEY` to the app container, so it keeps using the official Tailscale sidecar. The Unraid template passes `TS_AUTHKEY`, maps `/dev/net/tun`, adds `NET_ADMIN`, uses bridge networking with **no port mappings**, and persists `/var/lib/tailscale` under `/mnt/user/appdata/nas-mcp`.
3. **Do not use `network: none`.** Tailscaled must reach Tailscale's control plane. Bridge + unpublished ports is the Unraid equivalent of the sidecar's "no host ports" rule. Residual reachability on `docker0` from the Unraid host is accepted for this PoC; Tailscale ACLs plus the bearer token remain the real controls.

## Why not userspace-only?

Userspace networking avoids `/dev/net/tun`, but inbound packets to `100.x:8787` never hit a kernel interface. Inbound then depends entirely on Tailscale Serve (HTTPS :443). Kernel TUN matches the already-approved ACL (`tcp:8787` and `tcp:443`) and the curl examples. Userspace remains an opt-in (`TS_USERSPACE=true`) if TUN is unavailable.

## Consequences

* First `latest` tag appears only after this change is on `main` and the Docker workflow succeeds.
* Package visibility is a manual GitHub click; Actions cannot flip it with `GITHUB_TOKEN`.
* The image is slightly larger (Tailscale binaries + iptables) even in Compose sidecar mode.
* Unraid template XML lives at `unraid/nas-mcp.xml` and is added by copying it to `templates-user` (Community Applications is not required).
