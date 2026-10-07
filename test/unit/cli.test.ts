import { invokeTool } from "@agntn/tools";
import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import pkg from "../../package.json" with { type: "json" };
import { syncedCommand } from "../../src/cli-commands.ts";
import { register } from "../../src/core/registry.ts";
import "../../src/providers/index.ts";
import { AttributedProvider, FAKE_SYNCED } from "../helpers.ts";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const CLI = fileURLToPath(new URL("../../src/cli.ts", import.meta.url));
const FOOTER = "Source: https://example.com/placeholder\nPlaceholder attribution";

/** Runs the CLI offline: nothing here may get as far as a request. */
function lyrics(...args: string[]) {
  const { status, stdout, stderr } = spawnSync(process.execPath, [CLI, ...args], {
    cwd: ROOT,
    encoding: "utf8",
    timeout: 10_000,
  });
  return { code: status, stdout, stderr };
}

/** Runs the CLI with stdout already gone. */
async function runWithClosedStdout(...args: readonly string[]) {
  const child = spawn(process.execPath, [CLI, ...args], {
    cwd: ROOT,
    stdio: ["ignore", "pipe", "pipe"],
    timeout: 10_000,
  });
  child.stdout.destroy();
  let stderr = "";
  child.stderr.setEncoding("utf8").on("data", (chunk: string) => (stderr += chunk));
  await once(child, "close");
  return { code: child.exitCode, stderr };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("cli", () => {
  it("lets the reader hang up mid song without a stack trace", async () => {
    await expect(runWithClosedStdout("providers")).resolves.toEqual({ code: 0, stderr: "" });
  });

  it("prints the version from package.json, not a stale copy", () => {
    expect(lyrics("--version").stdout.trim()).toBe(pkg.version);
  });

  it("keeps every command the hand written CLI had", () => {
    const { code, stdout } = lyrics("--help");

    expect(code).toBe(0);
    for (const command of ["get", "search", "synced", "providers", "mcp"]) {
      expect(stdout).toMatch(new RegExp(`^\\s+${command}\\s`, "m"));
    }
  });

  it("refuses an option the command does not have, before any request", () => {
    const { code, stderr } = lyrics(
      "get",
      "Placeholder Artist",
      "Placeholder Song",
      "--lang",
      "pl",
    );

    expect(code).toBe(1);
    expect(stderr).toContain('unknown option "--lang"');
  });

  it("refuses a search limit outside 1 through 50, before any request", () => {
    const { code, stderr } = lyrics("search", "placeholder", "--limit", "51");

    expect(code).toBe(1);
    expect(stderr).toContain("limit");
  });
});

describe("synced command", () => {
  it.each([
    { args: {}, text: FAKE_SYNCED },
    { args: { at: 25 }, text: "[0:20] Second placeholder line" },
    { args: { at: 0 }, text: "(nothing sung at 0s)" },
  ])("keeps provenance with output for $args", async ({ args, text }) => {
    register(AttributedProvider);
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);

    const result = await invokeTool(syncedCommand, {
      artist: "Placeholder Artist",
      track: "Placeholder Song",
      provider: "attributed",
      ...args,
    });

    expect(result.isError).toBeUndefined();
    expect(result.content).toEqual([{ type: "text", text: `${text}\n\n${FOOTER}` }]);
    expect(fetch).not.toHaveBeenCalled();
  });
});
