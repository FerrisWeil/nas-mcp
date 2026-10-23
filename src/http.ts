import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";

import { toNodeHandler } from "@modelcontextprotocol/node";

import { requestHasValidBearer } from "./auth.js";
import type { Config } from "./config.js";
import { hostHeaderAllowed, originHeaderAllowed } from "./host.js";
import { createNasMcpHandler } from "./mcp.js";

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

export function createRequestListener(
  config: Config,
): (req: IncomingMessage, res: ServerResponse) => void {
  const mcp = createNasMcpHandler(config);
  const handleMcp = toNodeHandler(mcp);

  return (req, res) => {
    const path = requestPath(req);

    if (req.method === "GET" && path === "/health") {
      sendJson(res, 200, { status: "ok" });
      return;
    }

    if (!requestHasValidBearer(req, config.authToken)) {
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
      void handleMcp(req, res);
      return;
    }

    sendJson(res, 404, { error: "not_found" });
  };
}

export function createHttpServer(config: Config): Server {
  return createServer(createRequestListener(config));
}

export async function listen(
  config: Config,
  server: Server = createHttpServer(config),
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
