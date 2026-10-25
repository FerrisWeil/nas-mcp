#!/bin/sh
# Two modes:
# - No TS_AUTHKEY: run only the MCP server (Compose sidecar; Tailscale is the other container).
# - TS_AUTHKEY set: start tailscaled in this process tree, then the MCP server (Unraid template).
set -eu

PORT="${PORT:-8787}"
STATE_DIR="${TS_STATE_DIR:-/var/lib/tailscale}"
TS_HOSTNAME="${TS_HOSTNAME:-nas-mcp}"
TS_USERSPACE="${TS_USERSPACE:-false}"
TS_SERVE="${TS_SERVE:-true}"
TS_SOCKET="${TS_SOCKET:-/var/run/tailscale/tailscaled.sock}"

TS_PID=""
MCP_PID=""

cleanup() {
  if [ -n "$MCP_PID" ]; then
    kill "$MCP_PID" 2>/dev/null || true
    wait "$MCP_PID" 2>/dev/null || true
  fi
  if [ -n "$TS_PID" ]; then
    kill "$TS_PID" 2>/dev/null || true
    wait "$TS_PID" 2>/dev/null || true
  fi
}

trap cleanup TERM INT EXIT

start_mcp() {
  echo "nas-mcp starting (bind ${BIND_HOST:-127.0.0.1}:${PORT})"
  if [ "$(id -u)" = "0" ]; then
    su-exec node node dist/index.js &
  else
    node dist/index.js &
  fi
  MCP_PID=$!
}

wait_for_mcp() {
  wait "$MCP_PID"
  status=$?
  MCP_PID=""
  exit "$status"
}

trim() {
  printf '%s' "$1" | tr -d '\r\n'
}

AUTHKEY="$(trim "${TS_AUTHKEY:-}")"

if [ -z "$AUTHKEY" ]; then
  trap - EXIT
  start_mcp
  wait_for_mcp
fi

echo "TS_AUTHKEY is set; starting tailscaled in this container"
mkdir -p "$STATE_DIR" /var/run/tailscale /tmp

TUN_ARGS=""
if [ "$TS_USERSPACE" = "true" ]; then
  echo "tailscaled: userspace networking (no /dev/net/tun)"
  TUN_ARGS="--tun=userspace-networking"
fi

# shellcheck disable=SC2086
tailscaled $TUN_ARGS --statedir="$STATE_DIR" --socket="$TS_SOCKET" &
TS_PID=$!

i=0
while [ "$i" -lt 40 ]; do
  if [ -S "$TS_SOCKET" ]; then
    break
  fi
  i=$((i + 1))
  sleep 0.25
done

if [ ! -S "$TS_SOCKET" ]; then
  echo "tailscaled did not create $TS_SOCKET" >&2
  exit 1
fi

echo "bringing tailnet up as ${TS_HOSTNAME}"
# shellcheck disable=SC2086
tailscale --socket="$TS_SOCKET" up \
  --auth-key="$AUTHKEY" \
  --hostname="$TS_HOSTNAME" \
  --accept-dns=false \
  ${TS_EXTRA_ARGS:-}

if [ "$TS_SERVE" = "true" ]; then
  echo "Tailscale Serve: HTTPS :443 -> 127.0.0.1:${PORT} (tailnet only, not Funnel)"
  tailscale --socket="$TS_SOCKET" serve --bg --yes "$PORT" || \
    echo "warning: tailscale serve failed; enable HTTPS certificates on the tailnet, or set TS_SERVE=false"
fi

start_mcp
wait_for_mcp
