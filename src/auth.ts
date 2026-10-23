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

export function requestHasValidBearer(
  req: IncomingMessage,
  expectedToken: string,
): boolean {
  const header = req.headers.authorization;
  const value = Array.isArray(header) ? header[0] : header;
  const token = bearerTokenFromHeader(value);
  if (!token) {
    return false;
  }
  return tokensEqual(token, expectedToken);
}
