import { spawn } from "node:child_process";
import { once } from "node:events";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const CLI = fileURLToPath(new URL("../../src/cli.ts", import.meta.url));

/** Runs the CLI with stdout already gone; `CONSOLA_LEVEL` stops consola going quiet under vitest. */
async function runWithClosedStdout(...args: readonly string[]) {
  const child = spawn(process.execPath, [CLI, ...args], {
    cwd: ROOT,
    env: { ...process.env, CONSOLA_LEVEL: "3" },
    stdio: ["ignore", "pipe", "pipe"],
    timeout: 10_000,
  });
  child.stdout.destroy();
  let stderr = "";
  child.stderr.setEncoding("utf8").on("data", (chunk: string) => (stderr += chunk));
  await once(child, "close");
  return { code: child.exitCode, stderr };
}

describe("cli", () => {
  it("lets the reader hang up mid song without a stack trace", async () => {
    await expect(runWithClosedStdout("providers")).resolves.toEqual({ code: 0, stderr: "" });
  });
});
