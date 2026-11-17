import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * Newest ctime under `directory`. Unlike mtime, nobody backdates it.
 * @param directory - Root of the tree.
 * @returns {number} The newest ctime in milliseconds.
 */
export function lastSourceChange(directory: string): number {
  let newest = statSync(directory).ctimeMs;
  for (const entry of readdirSync(directory, { encoding: "utf8", recursive: true })) {
    const stats = statSync(join(directory, entry), { throwIfNoEntry: false });
    if (stats && stats.ctimeMs > newest) newest = stats.ctimeMs;
  }
  return newest;
}

/**
 * Tells whether `directory` changed after `since`. A tree gone during the scan counts too.
 * @param directory - The source tree the server loads from.
 * @param since - Epoch milliseconds from before the tree's first module loaded.
 * @returns {() => boolean} Whether the tree changed since then.
 */
export function sourceChangeCheck(directory: string, since: number): () => boolean {
  return () => {
    try {
      return lastSourceChange(directory) > since;
    } catch {
      return true;
    }
  };
}
