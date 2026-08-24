/** Argument parsing shared by the CLI commands. */

import consola from "consola";

/**
 * Read a numeric CLI argument, or exit with a message naming the flag.
 *
 * citty has no numeric argument type, so every command parsed and validated its own; four copies
 * of the same three lines, each with its own wording for the same mistake.
 */
export function parseNumericArg(
  raw: string | undefined,
  flag: string,
  options?: { integer?: boolean; min?: number },
): number | undefined {
  if (raw === undefined) return undefined;
  const value = options?.integer ? Number.parseInt(raw, 10) : Number.parseFloat(raw);
  const min = options?.min ?? 0;
  if (!Number.isFinite(value) || value < min) {
    consola.error(`Invalid ${flag}: ${raw}`);
    process.exit(1);
  }
  return value;
}
