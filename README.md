# nas-mcp

A small, read-only [MCP](https://modelcontextprotocol.io) server for an Unraid NAS. It is reachable **only on your Tailscale tailnet**. Nothing is published to the LAN or the public internet.

Image: `ghcr.io/ferrisweil/nas-mcp:latest` (make the GitHub package **public** so Unraid can pull it without credentials).

The server speaks MCP Streamable HTTP and exposes two tools:

| Tool | What it returns |
| --- | --- |
| `get_server_time` | NAS clock (ISO-8601 UTC, Unix ms, timezone, UTC offset) |
| `get_disk_usage` | Total, used, and free bytes for configured mount paths |

There are no write tools. Mount paths are chosen in the Unraid template or Compose file, not by the caller.

## Deploy on Unraid

**Recommended:** one container from the Unraid Docker UI, with Tailscale running inside the image.

Follow **[docs/unraid-setup.md](docs/unraid-setup.md)** — GHCR public visibility, tagged auth key, ACL fragment, where to put `unraid/nas-mcp.xml`, filling the fields, curl tests, and troubleshooting.

Compose with a Tailscale sidecar is still supported (below) if you already use Compose Manager. Do not run both.

## Compose sidecar (optional)

### Prerequisites

* Unraid 6.12+ with Docker running and the array started.
* [Docker Compose Manager](https://forums.unraid.net/topic/114415-plugin-docker-compose-manager/) or `docker compose` on the host.
* Tailscale MagicDNS on. HTTPS certificates if you want Serve. Do **not** enable Funnel.
* ACL tags `tag:nas-mcp` and `tag:bot` (see the setup guide).

### Clone, secrets, start

```bash
mkdir -p /mnt/user/appdata
cd /mnt/user/appdata
git clone https://github.com/FerrisWeil/nas-mcp.git nas-mcp
cd nas-mcp
cp .env.example .env
openssl rand -hex 32   # paste into MCP_AUTH_TOKEN
# paste a tagged TS_AUTHKEY; set TZ
```

Point Compose Manager at `/mnt/user/appdata/nas-mcp` (not the USB flash). Then:

```bash
docker compose up -d --build
docker compose ps
docker compose logs -f
```

`--build` uses the local Dockerfile if GHCR is still private. The sidecar appears on the Tailscale Machines page as `nas-mcp`. Disable key expiry on that node.

The MCP container waits until the sidecar's `/healthz` (port **41234**, not 8787) reports a tailnet IP. First login is allowed about four minutes. A bad `TS_AUTHKEY` leaves the sidecar restarting and MCP stopped. `tailscale/serve.json` already proxies tailnet HTTPS `:443` to `http://127.0.0.1:8787`. After the sidecar itself restarts, run `docker compose up -d` again so MCP reattaches to its network namespace. Container names are `nas-mcp-tailscale` and `nas-mcp`; do not run the Unraid template at the same time. `/mnt/user` is the right disk for this tool: it only calls `statfs` on that mount.

## Test (either path)

From another tailnet device:

```bash
curl -sS http://nas-mcp:8787/health
```

`/health` does not need the bearer token. The JSON body has `status` (`ok` when every configured mount is readable, otherwise `degraded`), `uptimeSeconds`, and `mounts` (`path` plus `readable`). HTTP status stays 200 so the container healthcheck means the process is serving. MCP requires the bearer token (`401` without it). Inspector: `npx @modelcontextprotocol/inspector`, Streamable HTTP, `http://nas-mcp:8787/mcp`, header `Authorization: Bearer <token>`. Full curl examples are in [docs/unraid-setup.md](docs/unraid-setup.md).

## Environment variables

| Variable | Required | Default | Purpose |
| --- | --- | --- | --- |
| `MCP_AUTH_TOKEN` | yes | — | Bearer token; process exits if unset or shorter than 16 chars |
| `TS_AUTHKEY` | Unraid template: yes. Compose: sidecar only | — | If set on the MCP image, that container starts `tailscaled` |
| `TS_HOSTNAME` | no | `nas-mcp` | Tailscale MagicDNS name (in-process tailscaled) |
| `TS_EXTRA_ARGS` | no | — | Extra `tailscale up` flags, e.g. `--advertise-tags=tag:nas-mcp` |
| `TS_SERVE` | no | `true` when tailscaled is in-process | Tailnet-only HTTPS on :443 (Serve, not Funnel) |
| `TS_USERSPACE` | no | `false` | Userspace networking if `/dev/net/tun` is unavailable |
| `TZ` | no | `UTC` | Timezone name reported by `get_server_time` |
| `BIND_HOST` | no | `127.0.0.1` in the app; `0.0.0.0` in template/Compose | Listen address |
| `PORT` | no | `8787` | MCP HTTP port |
| `DISK_PATHS` | no | `/data/user` | Comma-separated paths inside the container |
| `MCP_HOSTNAME` | no | `nas-mcp` | Allowed `Host` name |
| `MCP_ALLOWED_HOSTS` | no | — | Extra allowed `Host` names, comma-separated |

`Host` values that are `*.ts.net` or in Tailscale's `100.64.0.0/10` / `fd7a:115c:a1e0::/48` ranges are also accepted.

## Connect an assistant

From a Tailscale-tagged client (`tag:bot`):

* `http://nas-mcp:8787/mcp` or `https://nas-mcp.<your-tailnet>.ts.net/mcp`
* Header `Authorization: Bearer <MCP_AUTH_TOKEN>`

A cloud-hosted assistant must itself be on the tailnet. This stack does not create a public URL.

## Local development

```bash
cp .env.example .env   # set MCP_AUTH_TOKEN
npm install
npm run lint
npm test
MCP_AUTH_TOKEN=$(openssl rand -hex 32) npm run dev
```

The process listens on `127.0.0.1:8787` unless you set `BIND_HOST`. Do not expose that port on a public interface.

## Troubleshooting

When a client call fails, read the container logs before changing Tailscale or the token. Logs go to stdout. The MCP process does not write a log file (the root filesystem is read-only). Nothing in these lines is the bearer token or a Tailscale auth key: auth is only `ok`, `missing`, or `invalid`.

### Where to look

**Unraid template (one container).** Docker tab → row `nas-mcp` → log icon. That stream mixes MCP JSON lines and `tailscaled` (verbosity 1, its own timestamps). The template's extra parameters cap Docker's json log at 10MB × 3 files.

**Compose sidecar (two containers).** Docker tab shows `nas-mcp` and `nas-mcp-tailscale`. Open the log icon on each row. MCP lines are only on `nas-mcp`. Tailnet login, Serve, and netmap lines are only on `nas-mcp-tailscale` (`TS_TAILSCALED_EXTRA_ARGS=--verbose=1`). Compose rotates both logs at 10MB × 3 files.

From the Unraid terminal, the same streams with the Docker collector's timestamp on every line:

```bash
docker logs -t --tail 200 nas-mcp
docker logs -t --tail 200 nas-mcp-tailscale
```

### What each MCP line means

Every line is one JSON object.

| `msg` | When it appears |
| --- | --- |
| `startup` | Process is listening. `version`, `listen` (`BIND_HOST:PORT`), `mounts`, `timeZone`. |
| `request` | One per HTTP request, after the response finishes. |
| `slow_request` | A non-GET call took at least 2s, or was still open at 2s. `durationMs` is how long it had been running. |
| `tool_error` | A tool threw, or `get_disk_usage` could not `statfs` a mount. `error` and `stack` are for the operator; the client still gets the short error string, not the stack. |
| `mount_unreadable` | `/health` found a configured path that is not readable. |
| `server_error` | The HTTP adapter failed while handling `/mcp`. |
| `shutdown` | `SIGTERM` or `SIGINT`. |

`request` fields:

| Field | Meaning |
| --- | --- |
| `ts` | UTC ISO-8601 time |
| `method`, `path` | HTTP method and path (`/mcp` or `/health`) |
| `mcpMethod` | JSON-RPC method (`initialize`, `tools/list`, `tools/call`, …) when the body was JSON. Absent on `/health`, GET, and any request rejected before the body is read. |
| `tool` | `params.name` for `tools/call` only. Arguments are not logged. |
| `status` | HTTP status sent to the client |
| `durationMs` | Time until the response finished |
| `remoteAddress` | TCP peer. Direct `http://nas-mcp:8787` shows the tailnet address. Traffic through Tailscale Serve is proxied from `127.0.0.1`, so this field is `127.0.0.1` for `https://…ts.net`. |
| `auth` | `ok` (bearer matched), `missing` (no `Authorization` header), or `invalid` (header present but not the configured bearer). `/health` is unauthenticated, so the healthcheck line every 30s with `auth: missing` is expected. A wrong token is `invalid` and `status: 401`. |

No log line is written for a connection that never reaches the process. If the client times out and `nas-mcp` has no `request` line, the failure is in front of the server: Tailscale (sidecar or in-process `tailscaled`), Serve, DNS, or a firewall. Use the Tailscale log for that, then confirm `/health` from a tailnet device.

## Layout

```
src/                 TypeScript server (auth, health, request logs, two tools)
test/                Auth rejection, log redaction, and tool tests
docker/entrypoint.sh Starts tailscaled only when TS_AUTHKEY is set
unraid/nas-mcp.xml   Unraid Docker template (single container)
tailscale/           Serve config for the Compose sidecar
docs/unraid-setup.md Step-by-step Unraid GUI guide
docs/decisions/      ADR-style records
```

## License

MIT
