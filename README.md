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

## Test (either path)

From another tailnet device:

```bash
curl -sS http://nas-mcp:8787/health
```

MCP requires the bearer token (`401` without it). Inspector: `npx @modelcontextprotocol/inspector`, Streamable HTTP, `http://nas-mcp:8787/mcp`, header `Authorization: Bearer <token>`. Full curl examples are in [docs/unraid-setup.md](docs/unraid-setup.md).

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

## Layout

```
src/                 TypeScript server (auth, health, two tools)
test/                Auth rejection + tool tests
docker/entrypoint.sh Starts tailscaled only when TS_AUTHKEY is set
unraid/nas-mcp.xml   Unraid Docker template (single container)
tailscale/           Serve config for the Compose sidecar
docs/unraid-setup.md Step-by-step Unraid GUI guide
docs/decisions/      ADR-style records
```

## License

MIT
