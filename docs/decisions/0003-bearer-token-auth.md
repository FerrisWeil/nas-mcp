# 0003. Bearer-token authentication

* Status: accepted
* Date: 2026-10-23

## Context

Tailscale ACLs limit which devices can open a TCP connection. A compromised or overly broad tailnet peer could still call tools if the HTTP server trusted the network alone. MCP Streamable HTTP has no built-in shared-secret check; the SDK expects the host to verify tokens in front of the handler.

## Decision

* Require `MCP_AUTH_TOKEN` at process start. Refuse to boot if it is missing or shorter than 16 characters.
* Require `Authorization: Bearer <token>` on every request except `GET /health`.
* Compare tokens with SHA-256 + `timingSafeEqual` so length differences do not leak via compare time.
* Return `401` with `WWW-Authenticate: Bearer` when the header is missing or wrong.
* Leave `/health` unauthenticated. It returns only `{ "status": "ok" }` so Docker and Unraid can probe liveness without embedding the secret in a healthcheck command.

## Consequences

* Network ACLs and the token are independent controls. Both are required for MCP calls.
* Callers (curl, MCP Inspector, a cloud assistant) must be configured with the token.
* `/health` is a deliberate exception to "auth on every request". Rotate the token if it is ever written into logs or compose files.
