import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";

import { toNodeHandler } from "@modelcontextprotocol/node";

import {
  authorizationHeader,
  classifyAuthorization,
} from "./auth.js";
import type { Config } from "./config.js";
import { healthStatus, readMountStatus } from "./health.js";
import { hostHeaderAllowed, originHeaderAllowed } from "./host.js";
import {
  SLOW_REQUEST_MS,
  consoleLogger,
  createRedactingLogger,
  describeMcpBody,
  formatMountWarning,
  formatRequestLog,
  formatSlowCallLog,
  formatToolErrorLog,
  type Logger,
} from "./log.js";
import { createNasMcpHandler } from "./mcp.js";

const MAX_BODY_BYTES = 4 * 1024 * 1024;

export type HttpDeps = {
  logger?: Logger;
  monotonicNow?: () => number;
  now?: () => Date;
  slowRequestMs?: number;
};

function headerValue(
  value: string | string[] | undefined,
): string | undefined {
  if (Array.isArray(value)) {
    return value[0];
  }
  return value;
}

function sendJson(
  res: ServerResponse,
  status: number,
  body: unknown,
  extraHeaders: Record<string, string> = {},
): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    ...extraHeaders,
  });
  res.end(payload);
}

function requestPath(req: IncomingMessage): string {
  try {
    return new URL(req.url ?? "/", "http://127.0.0.1").pathname;
  } catch {
    return "/";
  }
}

function remoteAddress(req: IncomingMessage): string {
  return req.socket?.remoteAddress ?? "unknown";
}

async function readRequestBody(
  req: IncomingMessage,
  limit: number,
): Promise<{ bytes: Buffer; tooLarge: boolean }> {
  const chunks: Buffer[] = [];
  let received = 0;
  for await (const chunk of req) {
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    received += buf.length;
    if (received > limit) {
      return { bytes: Buffer.alloc(0), tooLarge: true };
    }
    chunks.push(buf);
  }
  return { bytes: Buffer.concat(chunks), tooLarge: false };
}

export function createRequestListener(
  config: Config,
  deps: HttpDeps = {},
): (req: IncomingMessage, res: ServerResponse) => void {
  const logger = createRedactingLogger(deps.logger ?? consoleLogger, [
    config.authToken,
  ]);
  const monotonic = deps.monotonicNow ?? (() => performance.now());
  const now = deps.now ?? (() => new Date());
  const slowRequestMs = deps.slowRequestMs ?? SLOW_REQUEST_MS;
  const mcp = createNasMcpHandler(config, logger);
  const handleMcp = toNodeHandler(mcp, {
    onerror(error) {
      logger.error(
        formatToolErrorLog({
          ts: now().toISOString(),
          tool: "mcp",
          error,
          msg: "server_error",
        }),
      );
    },
  });

  return (req, res) => {
    const started = monotonic();
    const path = requestPath(req);
    const method = req.method ?? "GET";
    const auth = classifyAuthorization(
      authorizationHeader(req),
      config.authToken,
    );
    let mcpMethod: string | undefined;
    let tool: string | undefined;
    let logged = false;
    let slowWarned = false;

    const slowTimer =
      method === "GET" || method === "HEAD"
        ? undefined
        : setTimeout(() => {
            if (logged) {
              return;
            }
            slowWarned = true;
            logger.warn(
              formatSlowCallLog({
                ts: now().toISOString(),
                method,
                path,
                mcpMethod,
                tool,
                durationMs: Math.max(0, Math.round(monotonic() - started)),
                thresholdMs: slowRequestMs,
              }),
            );
          }, slowRequestMs);
    slowTimer?.unref();

    const logRequest = () => {
      if (logged) {
        return;
      }
      logged = true;
      clearTimeout(slowTimer);
      const durationMs = Math.max(0, Math.round(monotonic() - started));
      const status = res.statusCode || 0;
      logger.info(
        formatRequestLog({
          ts: now().toISOString(),
          method,
          path,
          mcpMethod,
          tool,
          status,
          durationMs,
          remoteAddress: remoteAddress(req),
          auth,
        }),
      );
      if (
        !slowWarned &&
        durationMs >= slowRequestMs &&
        method !== "GET" &&
        method !== "HEAD"
      ) {
        logger.warn(
          formatSlowCallLog({
            ts: now().toISOString(),
            method,
            path,
            mcpMethod,
            tool,
            durationMs,
            thresholdMs: slowRequestMs,
          }),
        );
      }
    };

    res.on("finish", logRequest);
    res.on("close", () => {
      if (!res.writableEnded) {
        logRequest();
      }
    });

    void (async () => {
      try {
        if (method === "GET" && path === "/health") {
          const mounts = await readMountStatus(config.diskPaths);
          const status = healthStatus(mounts);
          if (status === "degraded") {
            const ts = now().toISOString();
            for (const mount of mounts) {
              if (!mount.readable) {
                logger.warn(formatMountWarning({ ts, path: mount.path }));
              }
            }
          }
          sendJson(res, 200, {
            status,
            uptimeSeconds: Math.floor(process.uptime()),
            mounts,
          });
          return;
        }

        if (auth !== "ok") {
          sendJson(
            res,
            401,
            { error: "unauthorized" },
            { "www-authenticate": 'Bearer realm="nas-mcp"' },
          );
          return;
        }

        if (!hostHeaderAllowed(headerValue(req.headers.host), config.allowedHosts)) {
          sendJson(res, 403, { error: "forbidden_host" });
          return;
        }

        if (!originHeaderAllowed(headerValue(req.headers.origin), config.allowedHosts)) {
          sendJson(res, 403, { error: "forbidden_origin" });
          return;
        }

        if (path === "/mcp") {
          if (method !== "GET" && method !== "HEAD" && method !== "DELETE") {
            const declared = Number(headerValue(req.headers["content-length"]));
            if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) {
              await handleMcp(req, res);
              return;
            }
            const buffered = await readRequestBody(req, MAX_BODY_BYTES);
            if (buffered.tooLarge) {
              sendJson(res, 413, { error: "payload_too_large" });
              req.destroy();
              return;
            }
            const text = buffered.bytes.toString("utf8");
            const described = describeMcpBody(text);
            mcpMethod = described.mcpMethod;
            tool = described.tool;
            if (text.trim().length === 0) {
              await handleMcp(req, res);
              return;
            }
            let parsed: unknown;
            try {
              parsed = JSON.parse(text) as unknown;
            } catch {
              sendJson(res, 400, {
                jsonrpc: "2.0",
                error: { code: -32700, message: "Parse error" },
                id: null,
              });
              return;
            }
            await handleMcp(req, res, parsed);
            return;
          }

          await handleMcp(req, res);
          return;
        }

        sendJson(res, 404, { error: "not_found" });
      } catch (error) {
        logger.error(
          formatToolErrorLog({
            ts: now().toISOString(),
            tool: tool ?? "mcp",
            error,
            msg: "server_error",
          }),
        );
        if (!res.headersSent) {
          sendJson(res, 500, { error: "internal_error" });
        }
      }
    })();
  };
}

export function createHttpServer(config: Config, deps: HttpDeps = {}): Server {
  return createServer(createRequestListener(config, deps));
}

export async function listen(
  config: Config,
  deps: HttpDeps = {},
  server: Server = createHttpServer(config, deps),
): Promise<{ server: Server; url: string }> {
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(config.port, config.bindHost, () => {
      server.off("error", reject);
      resolve();
    });
  });

  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("failed to determine listen address");
  }

  const host =
    address.address === "::" || address.address === "0.0.0.0"
      ? "127.0.0.1"
      : address.address.includes(":")
        ? `[${address.address}]`
        : address.address;

  return { server, url: `http://${host}:${address.port}` };
}
