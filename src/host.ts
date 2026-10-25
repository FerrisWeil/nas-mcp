function hostnameFromHeader(header: string | undefined): string | null {
  if (!header) {
    return null;
  }
  try {
    return new URL(`http://${header}`).hostname.toLowerCase();
  } catch {
    return null;
  }
}

function isTailscaleIPv4(hostname: string): boolean {
  const parts = hostname.split(".");
  if (parts.length !== 4) {
    return false;
  }
  const octets = parts.map((part) => Number(part));
  if (octets.some((octet) => !Number.isInteger(octet) || octet < 0 || octet > 255)) {
    return false;
  }
  const [a, b] = octets;
  return a === 100 && b !== undefined && b >= 64 && b <= 127;
}

function isTailscaleIPv6(hostname: string): boolean {
  const normalized = hostname.replace(/^\[|\]$/g, "").toLowerCase();
  return normalized === "fd7a:115c:a1e0" || normalized.startsWith("fd7a:115c:a1e0:");
}

export function isAllowedHostname(
  hostname: string,
  allowedHosts: string[],
): boolean {
  const host = hostname.toLowerCase();
  if (allowedHosts.some((allowed) => allowed.toLowerCase() === host)) {
    return true;
  }
  if (host.endsWith(".ts.net")) {
    return true;
  }
  return isTailscaleIPv4(host) || isTailscaleIPv6(host);
}

export function hostHeaderAllowed(
  hostHeader: string | undefined,
  allowedHosts: string[],
): boolean {
  const hostname = hostnameFromHeader(hostHeader);
  if (!hostname) {
    return false;
  }
  return isAllowedHostname(hostname, allowedHosts);
}

export function originHeaderAllowed(
  originHeader: string | undefined,
  allowedHosts: string[],
): boolean {
  if (!originHeader) {
    return true;
  }
  try {
    const hostname = new URL(originHeader).hostname.toLowerCase();
    return isAllowedHostname(hostname, allowedHosts);
  } catch {
    return false;
  }
}
