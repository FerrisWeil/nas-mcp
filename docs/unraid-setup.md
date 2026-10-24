# Unraid setup (single container)

This is the GUI path: one Unraid Docker container, image from GitHub Container Registry, Tailscale running *inside* that container. No host ports. Compose remains supported if you prefer a sidecar; see the root README.

You need about 15 minutes, the Unraid web UI, a browser logged into GitHub and Tailscale, and SSH (or the Unraid terminal) for two `openssl` / `curl` commands.

## 0. What you will have at the end

* A container named `nas-mcp` on Unraid.
* A Tailscale machine named `nas-mcp` tagged `tag:nas-mcp`.
* Health check: `http://nas-mcp:8787/health` from another device on your tailnet.
* MCP: `http://nas-mcp:8787/mcp` with `Authorization: Bearer <token>`.
* Optional HTTPS: `https://nas-mcp.<your-tailnet>.ts.net` (Serve, not Funnel).

Nothing is published on your LAN ports or the public internet.

## 1. Make the GHCR package public

Unraid pulls `ghcr.io/ferrisweil/nas-mcp:latest`. GitHub creates that package as **private** the first time Actions publishes it. Private packages require a login; Unraid will fail with `unauthorized` or `denied` until the package is public.

1. Merge (or wait until) the Docker workflow on branch `main` has a green **Docker** run. That run pushes `latest` and `sha-…`.
2. Open the repo **[FerrisWeil/nas-mcp](https://github.com/FerrisWeil/nas-mcp)** → **Packages** (right sidebar) → **nas-mcp**. Direct link after the first publish: [https://github.com/FerrisWeil/nas-mcp/pkgs/container/nas-mcp](https://github.com/FerrisWeil/nas-mcp/pkgs/container/nas-mcp).
3. **Package settings** (right sidebar, gear) → **Change visibility** → **Public** → type the package name to confirm.
4. Confirm the page no longer says Private. You should be able to pull with no token:

   ```bash
   docker pull ghcr.io/ferrisweil/nas-mcp:latest
   ```

   You can run that pull on any machine, including the Unraid terminal.

If Packages is empty, the image has not been published yet. Check the **Actions** tab for a **Docker** workflow on `main`.

## 2. Tailscale: tags, ACL, auth key

### 2a. MagicDNS (and HTTPS if you want Serve)

In the [Tailscale DNS settings](https://login.tailscale.com/admin/dns):

* MagicDNS: **on**.
* HTTPS certificates: **on** if you want `https://nas-mcp.<tailnet>.ts.net`. Leave Funnel **off**.

### 2b. Merge the ACL fragment

Open [Access controls](https://login.tailscale.com/admin/acls). **Merge** this into the existing policy. Do not replace the whole file or you can lock yourself out of the admin console.

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

Keep whatever already lets you (`autogroup:admin` / your user) manage devices. Tag the laptop or always-on box the assistant uses as `tag:bot` (Machines → the device → Edit ACL tags).

Save the policy. If the editor rejects `tag:nas-mcp`, the `tagOwners` block did not apply; fix that first.

### 2c. Create a tagged auth key

[Auth keys](https://login.tailscale.com/admin/settings/keys) → **Generate auth key**:

| Option | Value |
| --- | --- |
| Reusable | **On** |
| Ephemeral | **Off** |
| Pre-authorized | **On** if your tailnet requires device approval |
| Tags | `tag:nas-mcp` |

Copy the key now (`tskey-auth-…`). You will not see it again. Treat it like a password.

## 3. Generate the MCP bearer token

On Unraid (SSH or **Terminal** in the web UI):

```bash
openssl rand -hex 32
```

Copy the hex string. That is `MCP_AUTH_TOKEN`. Store it in your password manager. Anyone on the tailnet who has this token can call the two read-only tools.

## 4. Add the Unraid template

Unraid 6.10+ no longer has a “Template Repositories” field. The reliable method is to put the XML on the USB flash drive as a **user template**.

### Option A — copy the file (recommended)

1. On a computer, download  
   `https://raw.githubusercontent.com/FerrisWeil/nas-mcp/main/unraid/nas-mcp.xml`  
   (after this file is on `main`; on the PR branch, use the same path with branch `cursor/nas-mcp-poc-8c7d`).
2. Copy it onto the Unraid flash share as:

   ```text
   /boot/config/plugins/dockerMan/templates-user/nas-mcp.xml
   ```

   From a machine that can SSH:

   ```bash
   scp unraid/nas-mcp.xml root@<unraid-ip>:/boot/config/plugins/dockerMan/templates-user/nas-mcp.xml
   ```

   Or from the Unraid terminal, once the repo is on `main`:

   ```bash
   mkdir -p /boot/config/plugins/dockerMan/templates-user
   curl -fsSL -o /boot/config/plugins/dockerMan/templates-user/nas-mcp.xml \
     https://raw.githubusercontent.com/FerrisWeil/nas-mcp/main/unraid/nas-mcp.xml
   ```

3. Unraid web UI → **Docker** → **Add Container**.
4. **Template** dropdown → select **nas-mcp** (user templates sit at the top of the list).

### Option B — Community Applications private folder

If you use CA and want it under the **Private** category:

```text
/boot/config/plugins/community.applications/private/nas-mcp/nas-mcp.xml
```

Same XML file. Then **Apps** → **Private**.

### Option C — fill Add Container by hand

**Docker** → **Add Container** → leave Template as blank / “Custom”. Set **Repository** to `ghcr.io/ferrisweil/nas-mcp:latest`, **Network Type** to `Bridge`, add the variables and paths from the table below, Extra Parameters `--cap-add=NET_ADMIN --init`, and a device `/dev/net/tun`. Do **not** add any port.

## 5. Fill in the fields

Leave **Network Type** = `bridge`. Scroll the port section: it must be **empty**. Do not click “Add another Port”.

| Field | What to enter |
| --- | --- |
| MCP Auth Token | The `openssl rand -hex 32` value (masked) |
| Tailscale Auth Key | The `tskey-auth-…` value (masked) |
| Tailscale Hostname | `nas-mcp` unless you chose another name (match the ACL) |
| Timezone | Same as Unraid → Settings → Date and Time, e.g. `America/Chicago` |
| Appdata (Tailscale state) | `/mnt/user/appdata/nas-mcp/tailscale-state` |
| User shares (read-only) | `/mnt/user` |

Show more settings only if you need them. Defaults already set `BIND_HOST=0.0.0.0`, `PORT=8787`, `TS_EXTRA_ARGS=--advertise-tags=tag:nas-mcp`, `TS_SERVE=true`, `TS_USERSPACE=false`, and the TUN device.

Apply. The first start pulls `:latest` (needs step 1) and may take a minute while Tailscale logs in and, if Serve is on, fetches a certificate.

## 6. Confirm the node is on the tailnet

1. Unraid **Docker** tab: `nas-mcp` should be started. Open **Logs**. You want `bringing tailnet up as nas-mcp` and `nas-mcp starting`.
2. [Tailscale Machines](https://login.tailscale.com/admin/machines): a device named **nas-mcp** with tag **tag:nas-mcp**. If it is stuck “needs signing”, approve it (or use a pre-authorized key).
3. Disable **key expiry** on that machine (machine menu) so it does not fall off the tailnet after 180 days.

If the container restarts in a loop, jump to [Troubleshooting](#troubleshooting).

## 7. Test with curl from another tailnet device

Use a laptop, phone, or VM that is already logged into the same tailnet (ideally tagged `tag:bot`). Not the Unraid web UI, and not a browser off-VPN.

Health (no token):

```bash
curl -sS http://nas-mcp:8787/health
```

Expect `{"status":"ok"}`.

Missing token must fail:

```bash
curl -sS -o /dev/null -w "%{http_code}\n" http://nas-mcp:8787/mcp
```

Expect `401`.

Initialize MCP (replace the token):

```bash
TOKEN='paste-the-hex-token'

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

Expect a JSON-RPC result, not `unauthorized`. If Serve and HTTPS certificates are on:

```bash
curl -sS https://nas-mcp.<your-tailnet>.ts.net/health
```

Your tailnet DNS name is on the DNS settings page (looks like `tailxxxxx.ts.net`).

MCP Inspector, from a tailnet machine:

```bash
npx @modelcontextprotocol/inspector
```

Transport **Streamable HTTP**, URL `http://nas-mcp:8787/mcp`, header `Authorization` = `Bearer <token>`. You should see only `get_server_time` and `get_disk_usage`.

## Troubleshooting

**`unauthorized` / `denied` pulling the image**  
The GHCR package is still private (step 1) or you typed the name wrong. It is `ghcr.io/ferrisweil/nas-mcp:latest` (all lowercase).

**Container exits: `MCP_AUTH_TOKEN is required`**  
The masked field is empty. Generate a token and Apply again.

**Container exits: `tailscaled did not create … sock` or tun errors**  
Unraid is not passing `/dev/net/tun` or `NET_ADMIN`. Edit the container: device `/dev/net/tun`, Extra Parameters include `--cap-add=NET_ADMIN`. Last resort: enable **Privileged** (worse, but works on some hosts). Or set **Tailscale userspace** to `true` and **Listen address** to `127.0.0.1`, then use only `https://nas-mcp.<tailnet>.ts.net` (Serve).

**Machine never appears in Tailscale**  
Auth key missing the `tag:nas-mcp` tag, key expired, or ACL `tagOwners` does not allow that tag. Create a new key. Check logs for `authkey` / `403`.

**`curl: could not resolve host: nas-mcp`**  
MagicDNS is off, or the client is not on Tailscale. Use the `100.x` address from the Machines page: `curl http://100.x.y.z:8787/health`.

**Health works, MCP returns `401`**  
Wrong token, extra whitespace, or you used `Basic` instead of `Bearer`.

**Health works on the Unraid host but not from your laptop**  
You may be hitting the Docker bridge IP on Unraid, not the tailnet. Test from a device that is only on Tailscale. Confirm the Machines page shows a `100.x` address and curl that.

**Serve / HTTPS fails, HTTP :8787 works**  
Enable HTTPS certificates on the DNS page, or set `TS_SERVE=false` and keep using port 8787.

**I accidentally added a host port**  
Edit the container, remove every port mapping, Apply. The point of this stack is that 8787 is *not* on the LAN.

**Updating the image**  
Docker tab → nas-mcp → **force update**. That pulls a new `latest`. Tailscale state in appdata must stay so the node does not get a new identity every time.

## Compose path (optional)

If you would rather run the official Tailscale sidecar instead of in-process tailscaled, clone the repo to `/mnt/user/appdata/nas-mcp`, copy `.env.example` to `.env`, and `docker compose up -d`. Do not also run the Unraid template — two nodes would fight over the hostname. Details are in the root README.
