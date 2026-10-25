const DEFAULT_PORT = 8787;
const DEFAULT_BIND_HOST = "127.0.0.1";
const DEFAULT_HOSTNAME = "nas-mcp";
const MIN_TOKEN_LENGTH = 16;

export type Config = {
  authToken: string;
  bindHost: string;
  port: number;
  hostname: string;
  diskPaths: string[];
  allowedHosts: string[];
};

function required(env: NodeJS.Dict<string>, name: string): string {
  const value = env[name]?.trim();
  if (!value) {
    throw new Error(
      `${name} is required. Generate one with: openssl rand -hex 32`,
    );
  }
  return value;
}

function parsePort(value: string | undefined): number {
  if (!value) {
    return DEFAULT_PORT;
  }
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`PORT must be an integer 1-65535, got ${value}`);
  }
  return port;
}

function parseList(value: string | undefined): string[] {
  if (!value) {
    return [];
  }
  return value
    .split(",")
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

export function loadConfig(env: NodeJS.Dict<string> = process.env): Config {
  const authToken = required(env, "MCP_AUTH_TOKEN");
  if (authToken.length < MIN_TOKEN_LENGTH) {
    throw new Error(
      `MCP_AUTH_TOKEN must be at least ${MIN_TOKEN_LENGTH} characters`,
    );
  }

  const hostname = env.MCP_HOSTNAME?.trim() || DEFAULT_HOSTNAME;
  const extraHosts = parseList(env.MCP_ALLOWED_HOSTS);
  const diskPaths = parseList(env.DISK_PATHS);
  if (diskPaths.length === 0) {
    diskPaths.push("/data/user");
  }

  return {
    authToken,
    bindHost: env.BIND_HOST?.trim() || DEFAULT_BIND_HOST,
    port: parsePort(env.PORT),
    hostname,
    diskPaths,
    allowedHosts: [
      "localhost",
      "127.0.0.1",
      "::1",
      hostname,
      ...extraHosts,
    ],
  };
}
