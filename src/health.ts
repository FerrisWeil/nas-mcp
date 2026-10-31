import { access, constants } from "node:fs/promises";

export type MountStatus = {
  path: string;
  readable: boolean;
};

export async function readMountStatus(
  paths: readonly string[],
): Promise<MountStatus[]> {
  return Promise.all(
    paths.map(async (path) => {
      try {
        await access(path, constants.R_OK);
        return { path, readable: true };
      } catch {
        return { path, readable: false };
      }
    }),
  );
}

export function healthStatus(mounts: readonly MountStatus[]): "ok" | "degraded" {
  return mounts.every((mount) => mount.readable) ? "ok" : "degraded";
}
