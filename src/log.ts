export const SLOW_REQUEST_MS = 2_000;

export type AuthResult = "ok" | "missing" | "invalid";

export type Logger = {
  info(line: string): void;
  warn(line: string): void;
  error(line: string): void;
};

export const consoleLogger: Logger = {
  info: (line) => {
    console.log(line);
  },
  warn: (line) => {
    console.warn(line);
  },
  error: (line) => {
    console.error(line);
  },
};

export type RequestLogFields = {
  ts: string;
  method: string;
  path: string;
  mcpMethod?: string;
  tool?: string;
  status: number;
  durationMs: number;
  remoteAddress: string;
  auth: AuthResult;
};

export type StartupLogFields = {
  ts: string;
  version: string;
  listen: string;
  mounts: readonly string[];
  timeZone: string;
};

export type SlowCallFields = {
  ts: string;
  method: string;
  path: string;
  mcpMethod?: string;
  tool?: string;
  durationMs: number;
  thresholdMs: number;
};

export type ToolErrorFields = {
  ts: string;
  tool: string;
  error: unknown;
  path?: string;
  msg?: string;
};

const AUTH_HEADER =
  /((?:proxy-)?authorization\s*[:=]\s*)(?:"[^"]*"|'[^']*'|\S+(?:\s+\S+)?)/gi;
const BEARER_TOKEN = /\bBearer\s+(?!realm\b)(?!\[redacted\])[^\s"']+/gi;
const TS_AUTH_KEY = /\btskey-[A-Za-z0-9_-]+/g;

export function redactAuthHeaders(input: string): string {
  return input
    .replace(AUTH_HEADER, "$1[redacted]")
    .replace(BEARER_TOKEN, "Bearer [redacted]");
}

export function redactSecrets(text: string, secrets: readonly string[] = []): string {
  let out = redactAuthHeaders(text);
  for (const secret of secrets) {
    if (secret.length === 0) {
      continue;
    }
    out = out.split(secret).join("[redacted]");
  }
  return out.replace(TS_AUTH_KEY, "tskey-[redacted]");
}

export function createRedactingLogger(
  sink: Logger,
  secrets: readonly string[],
): Logger {
  const write = (level: keyof Logger, line: string) => {
    sink[level](redactSecrets(line, secrets));
  };
  return {
    info: (line) => write("info", line),
    warn: (line) => write("warn", line),
    error: (line) => write("error", line),
  };
}

function withOptional(
  record: Record<string, unknown>,
  fields: { mcpMethod?: string; tool?: string },
): Record<string, unknown> {
  if (fields.mcpMethod) {
    record.mcpMethod = fields.mcpMethod;
  }
  if (fields.tool) {
    record.tool = fields.tool;
  }
  return record;
}

export function formatRequestLog(fields: RequestLogFields): string {
  return JSON.stringify(
    withOptional(
      {
        ts: fields.ts,
        level: "info",
        msg: "request",
        method: fields.method,
        path: fields.path,
        status: fields.status,
        durationMs: fields.durationMs,
        remoteAddress: fields.remoteAddress,
        auth: fields.auth,
      },
      fields,
    ),
  );
}

export function formatStartupLog(fields: StartupLogFields): string {
  return JSON.stringify({
    ts: fields.ts,
    level: "info",
    msg: "startup",
    version: fields.version,
    listen: fields.listen,
    mounts: [...fields.mounts],
    timeZone: fields.timeZone,
  });
}

export function formatSlowCallLog(fields: SlowCallFields): string {
  return JSON.stringify(
    withOptional(
      {
        ts: fields.ts,
        level: "warn",
        msg: "slow_request",
        method: fields.method,
        path: fields.path,
        durationMs: fields.durationMs,
        thresholdMs: fields.thresholdMs,
      },
      fields,
    ),
  );
}

export function formatToolErrorLog(fields: ToolErrorFields): string {
  const error =
    fields.error instanceof Error ? fields.error : new Error(String(fields.error));
  const record: Record<string, unknown> = {
    ts: fields.ts,
    level: "error",
    msg: fields.msg ?? "tool_error",
    tool: fields.tool,
    error: error.message,
  };
  if (fields.path) {
    record.path = fields.path;
  }
  if (error.stack) {
    record.stack = error.stack;
  }
  return JSON.stringify(record);
}

export function formatMountWarning(fields: { ts: string; path: string }): string {
  return JSON.stringify({
    ts: fields.ts,
    level: "warn",
    msg: "mount_unreadable",
    path: fields.path,
  });
}

export function describeMcpBody(body: string): { mcpMethod?: string; tool?: string } {
  const trimmed = body.trim();
  if (!trimmed) {
    return {};
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed) as unknown;
  } catch {
    return {};
  }
  const messages = Array.isArray(parsed) ? parsed : [parsed];
  const methods: string[] = [];
  const tools: string[] = [];
  for (const message of messages) {
    if (!message || typeof message !== "object") {
      continue;
    }
    const record = message as { method?: unknown; params?: { name?: unknown } };
    if (typeof record.method !== "string") {
      continue;
    }
    methods.push(record.method);
    if (record.method === "tools/call" && typeof record.params?.name === "string") {
      tools.push(record.params.name);
    }
  }
  return {
    ...(methods.length > 0 ? { mcpMethod: methods.join(",") } : {}),
    ...(tools.length > 0 ? { tool: tools.join(",") } : {}),
  };
}
