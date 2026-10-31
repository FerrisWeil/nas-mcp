import { createHash, timingSafeEqual } from "node:crypto";
import type { IncomingMessage } from "node:http";

function sha256(value: string): Buffer {
  return createHash("sha256").update(value).digest();
}

export function tokensEqual(provided: string, expected: string): boolean {
  return timingSafeEqual(sha256(provided), sha256(expected));
}

export function bearerTokenFromHeader(
  authorization: string | undefined,
): string | null {
  if (!authorization) {
    return null;
  }
  const match = /^Bearer[ \t]+(\S+)$/i.exec(authorization.trim());
  return match?.[1] ?? null;
}

export function authorizationHeader(
  req: IncomingMessage,
): string | undefined {
  const header = req.headers.authorization;
  return Array.isArray(header) ? header[0] : header;
}

export function classifyAuthorization(
  authorization: string | undefined,
  expectedToken: string,
): "ok" | "missing" | "invalid" {
  if (!authorization?.trim()) {
    return "missing";
  }
  const token = bearerTokenFromHeader(authorization);
  if (!token) {
    return "invalid";
  }
  return tokensEqual(token, expectedToken) ? "ok" : "invalid";
}

export function requestHasValidBearer(
  req: IncomingMessage,
  expectedToken: string,
): boolean {
  return classifyAuthorization(authorizationHeader(req), expectedToken) === "ok";
}
