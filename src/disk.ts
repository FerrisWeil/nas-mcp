import { statfs } from "node:fs/promises";

export type DiskUsage = {
  path: string;
  totalBytes: number;
  usedBytes: number;
  freeBytes: number;
  usedPercent: number;
};

export type DiskUsageResult =
  | DiskUsage
  | { path: string; error: string; stack?: string };

function roundPercent(used: number, total: number): number {
  if (total <= 0) {
    return 0;
  }
  return Math.round((used / total) * 1000) / 10;
}

export async function getDiskUsage(path: string): Promise<DiskUsageResult> {
  try {
    const stats = await statfs(path);
    const totalBytes = Number(stats.blocks) * Number(stats.bsize);
    const freeBytes = Number(stats.bavail) * Number(stats.bsize);
    const usedBytes = Math.max(0, totalBytes - Number(stats.bfree) * Number(stats.bsize));
    return {
      path,
      totalBytes,
      usedBytes,
      freeBytes,
      usedPercent: roundPercent(usedBytes, totalBytes),
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const stack = error instanceof Error ? error.stack : undefined;
    return stack ? { path, error: message, stack } : { path, error: message };
  }
}

export async function getDiskUsageForPaths(
  paths: string[],
): Promise<DiskUsageResult[]> {
  return Promise.all(paths.map((path) => getDiskUsage(path)));
}
