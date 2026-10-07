import { invokeTool } from "@agntn/tools";
import { createCli } from "@agntn/tools/cli";
import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import pkg from "../../package.json" with { type: "json" };
import { syncedCommand } from "../../src/cli-commands.ts";
import { Provider } from "../../src/core/provider.ts";
import { register } from "../../src/core/registry.ts";
import type { Lyrics, SearchOptions, TrackMatch } from "../../src/core/types.ts";
import "../../src/providers/index.ts";
import { lyricsTools } from "../../src/tools.ts";
import { AttributedProvider, FAKE_PLAIN, FAKE_SYNCED } from "../helpers.ts";

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

/** Hands the query and limit straight back, so a test sees what the CLI parsed. */
class EchoProvider extends Provider {
  static readonly key = "echo";

  get capabilities() {
    return { search: true, lyrics: false, synced: false, translation: false };
  }

  override async search(query: string, options?: SearchOptions): Promise<TrackMatch[]> {
    return [{ artist: `limit ${options?.limit}`, track: query }];
  }

  async lyrics(): Promise<Lyrics> {
    throw new Error("echo has no lyrics");
  }
}

/** Runs the lyrics commands in process and collects what they print. */
async function cli(...argv: string[]) {
  let stdout = "";
  let stderr = "";
  vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
    stdout += String(chunk);
    return true;
  });
  vi.spyOn(process.stderr, "write").mockImplementation((chunk) => {
    stderr += String(chunk);
    return true;
  });
  try {
    await createCli({
      name: "lyrics",
      version: pkg.version,
      description: "Unified song lyrics CLI",
      tools: lyricsTools,
      commands: [syncedCommand],
    }).run(argv);
    return { code: process.exitCode, stdout, stderr };
  } finally {
    process.exitCode = undefined;
    vi.restoreAllMocks();
  }
}

describe("short flags", () => {
  it("searches every word left over, with -p and -n anywhere", async () => {
    register(EchoProvider);

    const { stdout, stderr } = await cli("search", "radiohead", "-n", "3", "creep", "-p", "echo");

    expect(stderr).toBe("");
    expect(stdout).toContain("limit 3 - radiohead creep");
  });

  it("reads -p, -d, -s and -t on get", async () => {
    register(AttributedProvider);
    const args = ["get", "Placeholder Artist", "Placeholder Song", "-p", "attributed", "-d", "239"];

    expect((await cli(...args)).stdout).toContain(FAKE_PLAIN);
    expect((await cli(...args, "-s")).stdout).toContain(FAKE_SYNCED);
    expect((await cli(...args, "-t")).stdout).toContain("Translated placeholder line");
  });

  it("reads -p and -d on synced, and -p on line-at", async () => {
    register(AttributedProvider);
    const song = ["Placeholder Artist", "Placeholder Song"];

    expect((await cli("synced", ...song, "-p", "attributed", "-d", "239")).stdout).toContain(
      FAKE_SYNCED,
    );
    expect((await cli("line-at", ...song, "25", "-p", "attributed")).stdout).toContain(
      "[0:20] Second placeholder line",
    );
  });

  it("refuses -n past 50 from the real binary, before any request", () => {
    const { code, stderr } = lyrics("search", "placeholder", "words", "-n", "51");

    expect(code).toBe(1);
    expect(stderr).toBe("Invalid arguments at /limit: must be <= 50\n");
  });
});
