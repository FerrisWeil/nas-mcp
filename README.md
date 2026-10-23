# nas-mcp

A small, read-only [MCP](https://modelcontextprotocol.io) server for an Unraid NAS. It runs in Docker next to a Tailscale sidecar and is reachable **only on your tailnet**. Nothing is published to the LAN or the public internet.

The server speaks MCP Streamable HTTP and exposes two tools:

| Tool | What it returns |
| --- | --- |
| `get_server_time` | NAS clock (ISO-8601 UTC, Unix ms, timezone, UTC offset) |
| `get_disk_usage` | Total, used, and free bytes for configured mount paths |

There are no write tools. Mount paths are chosen in Compose, not by the caller.

## 15-minute Unraid setup

### 1. Prerequisites

* Unraid 6.12+ with Docker running and the array started.
* [Docker Compose Manager](https://forums.unraid.net/topic/114415-plugin-docker-compose-manager/) from Community Applications, or `docker compose` on the host.
* A Tailscale tailnet with **MagicDNS** on. Turn on **HTTPS certificates** if you want `https://nas-mcp.<tailnet>.ts.net` (Serve). Do **not** enable Funnel.
* ACL tags `tag:nas-mcp` and `tag:bot` defined (sample below).

### 2. Clone onto the NAS

SSH into Unraid (or use a file manager) and put the repo on a cache-backed appdata path:

```bash
mkdir -p /mnt/user/appdata
cd /mnt/user/appdata
git clone https://github.com/FerrisWeil/nas-mcp.git nas-mcp
cd nas-mcp
```

### 3. Create secrets

```bash
cp .env.example .env
openssl rand -hex 32
```

Paste the generated hex into `MCP_AUTH_TOKEN` in `.env`.

Create a Tailscale **auth key** at [https://login.tailscale.com/admin/settings/keys](https://login.tailscale.com/admin/settings/keys):

* Reusable: on
* Ephemeral: **off**
* Pre-authorized: on if your tailnet requires device approval
* Tags: `tag:nas-mcp`

Paste it into `TS_AUTHKEY`. Set `TZ` to the same zone as Unraid → Settings → Date and Time (for example `America/Chicago`).

### 4. Tailscale ACL fragment

In the [access controls](https://login.tailscale.com/admin/acls) editor, **merge** this with your existing policy. Do not replace a working ACL file with only these rules or you may lock yourself out.

```json
{
  "tagOwners": {
    "tag:nas-mcp": ["autogroup:admin"],
    "tag:bot": ["autogroup:admin"]
  },
  "grants": [
    {
      "src": ["tag:bot"],
      "dst": ["tag:nas-mcp"],
      "ip": ["tcp:8787", "tcp:443"]
    }
  ]
}
```

Tag the client device the assistant uses as `tag:bot` (Machines → the device → Edit ACL tags). Keep your usual `autogroup:admin` / owner access so you can still SSH and open the admin console.

### 5. Optional cache pool

Default bind-mount is `/mnt/user` → `/data/user` (read-only). To also report `/mnt/cache`, uncomment the cache volume in `docker-compose.yml` and set `DISK_PATHS: /data/user,/data/cache`.

### 6. Start the stack

**Compose Manager:** Docker → Compose → Add New Stack. Point the **project directory** at `/mnt/user/appdata/nas-mcp` so `build: .` and `./data` resolve. Do not leave Tailscale state on the Unraid USB boot flash (`/boot/config/plugins/...`). Compose and env files are already in that folder. Compose Up.

**CLI:**

```bash
cd /mnt/user/appdata/nas-mcp
docker compose up -d --build
docker compose ps
docker compose logs -f
```

The sidecar should appear on the Tailscale Machines page as `nas-mcp` with tag `tag:nas-mcp`. Disable key expiry on that node so it does not drop off after 180 days.

### 7. Test with curl (from a tailnet device)

Health has no token on purpose:

```bash
curl -sS http://nas-mcp:8787/health
```

MCP requires the bearer token. Initialize, then list tools:

```bash
TOKEN='paste-from-.env'

curl -sS http://nas-mcp:8787/mcp \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{
    "jsonrpc": "2.0",
    "id": 1,
    "method": "initialize",
    "params": {
      "protocolVersion": "2025-11-25",
      "capabilities": {},
      "clientInfo": { "name": "curl", "version": "0.0.1" }
    }
  }'
```

A missing or wrong token must return `401`. If Serve is up (MagicDNS + HTTPS certs):

```bash
curl -sS https://nas-mcp.<your-tailnet>.ts.net/health
```

### 8. MCP Inspector

On a machine already on the tailnet:

```bash
npx @modelcontextprotocol/inspector
```

Connect with:

* Transport: **Streamable HTTP**
* URL: `http://nas-mcp:8787/mcp` or `https://nas-mcp.<your-tailnet>.ts.net/mcp`
* Header: `Authorization` = `Bearer <MCP_AUTH_TOKEN>`

Call `get_server_time` and `get_disk_usage`. Both should succeed; there should be no other tools.

## Environment variables

| Variable | Required | Default | Purpose |
| --- | --- | --- | --- |
| `MCP_AUTH_TOKEN` | yes | — | Bearer token; process exits if unset or shorter than 16 chars |
| `TS_AUTHKEY` | yes (Compose) | — | Tailscale auth key for the sidecar |
| `TZ` | no | `UTC` | Timezone name reported by `get_server_time` |
| `BIND_HOST` | no | `127.0.0.1` in the app, `0.0.0.0` in Compose | Listen address |
| `PORT` | no | `8787` | MCP HTTP port |
| `DISK_PATHS` | no | `/data/user` | Comma-separated paths inside the container |
| `MCP_HOSTNAME` | no | `nas-mcp` | Allowed `Host` name |
| `MCP_ALLOWED_HOSTS` | no | — | Extra allowed `Host` names, comma-separated |

`Host` values that are `*.ts.net` or in Tailscale's `100.64.0.0/10` / `fd7a:115c:a1e0::/48` ranges are also accepted so MagicDNS and 100.x addresses work without listing them.

## Connect an assistant

From a Tailscale-tagged client (`tag:bot`), point an MCP Streamable HTTP client at:

* `http://nas-mcp:8787/mcp` or `https://nas-mcp.<your-tailnet>.ts.net/mcp`
* Header `Authorization: Bearer <MCP_AUTH_TOKEN>`

A cloud-hosted assistant must itself be on the tailnet (sidecar, always-on tagged device, or self-hosted worker). This stack does not create a public URL.

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
src/           TypeScript server (auth, health, two tools)
test/          Auth rejection + tool tests
tailscale/     Serve config (HTTPS on 443 → 127.0.0.1:8787, no Funnel)
docs/decisions ADR-style records for the PoC constraints
```

## Decisions the owner should confirm

Recorded in `docs/decisions/`. The ones that affect how you deploy:

1. Hostname `nas-mcp` and ACL tags `tag:nas-mcp` / `tag:bot`.
2. HTTP on tailnet port **8787** plus optional Serve on **443**. Set `BIND_HOST=127.0.0.1` if you want 8787 loopback-only.
3. `/health` is unauthenticated so Docker can probe it.
4. Default disk path is Unraid `/mnt/user` only; `/mnt/cache` is opt-in.
5. The cloud assistant still needs a Tailscale identity (`tag:bot`). This repo does not join Cursor Cloud to your tailnet by itself.

## License

MIT
