# 0004. Read-only PoC scope

* Status: accepted
* Date: 2026-10-23

## Context

A general-purpose NAS MCP server could grow file reads, writes, docker control, or destructive tools. That is out of scope for proving connectivity.

## Decision

Expose exactly two tools:

* `get_server_time` — NAS clock and timezone.
* `get_disk_usage` — total / used / free bytes for mount paths set in `DISK_PATHS`.

The tools take no path or command arguments. Mounts are chosen by the NAS owner in Compose, bind-mounted `:ro`, and the container filesystem is `read_only: true`. Tool annotations set `readOnlyHint` and clear `destructiveHint`.

## Consequences

* A connected assistant can see clock and capacity, not file contents, and cannot write.
* Adding write tools, shell execution, or caller-chosen paths would be a new decision and a new threat model.
* A missing optional mount (for example `/mnt/cache`) is reported per path as an error object, not as a server crash.
