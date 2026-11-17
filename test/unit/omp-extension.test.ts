import { ToolInputError, wireSchema } from "@agntn/tools";
import type {
  ExtensionAPI,
  ExtensionContext,
  Theme,
  ToolDefinition,
} from "@oh-my-pi/pi-coding-agent";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

/** Compiled OMP gives an extension only the package root, so loading the TUI barrel has to fail. */
vi.mock("@oh-my-pi/pi-coding-agent/tui", () => {
  throw new Error("The OMP host does not inject the TUI barrel");
});

import lyricsOmpExtension from "../../extensions/omp/lyrics.ts";
import { register } from "../../src/core/registry.ts";
import "../../src/providers/index.ts";
import { lyricsTools } from "../../src/tools.ts";
import {
  AttributedProvider,
  LRCLIB_TRACK,
  NETWORKED_CALLS,
  requireTool,
  stubJSON,
  stubPendingFetch,
} from "../helpers.ts";

/** Stands in for the host `Text`, keeping the drawn line for the assertion. */
class CapturedText {
  readonly text: string;

  constructor(text: string) {
    this.text = text;
  }
}

/** The host build wraps the JSON Schema in `Type.Unsafe` and emits it verbatim. */
const hostTypebox = {
  Type: { Unsafe: (schema: unknown) => schema },
} as unknown as ExtensionAPI["typebox"];

/** A host double that throws on any member the extension was not expected to read. */
function strictDouble<T extends object>(name: string, stubs: Partial<T>): T {
  return new Proxy(stubs, {
    get(target, key, receiver) {
      if (typeof key === "symbol" || key === "then" || Reflect.has(target, key)) {
        return Reflect.get(target, key, receiver);
      }
      throw new Error(`${name}.${String(key)} is not stubbed in the OMP test host`);
    },
  }) as T;
}

interface RegisteredExtension {
  labels: string[];
  tools: Map<string, ToolDefinition>;
}

async function registerExtensionTools(): Promise<RegisteredExtension> {
  const tools = new Map<string, ToolDefinition>();
  const labels: string[] = [];
  await lyricsOmpExtension(
    strictDouble<ExtensionAPI>("ExtensionAPI", {
      typebox: hostTypebox,
      pi: strictDouble<ExtensionAPI["pi"]>("ExtensionAPI.pi", {
        Text: CapturedText as unknown as ExtensionAPI["pi"]["Text"],
      }),
      setLabel(label) {
        labels.push(label);
      },
      registerTool(tool) {
        tools.set(tool.name, tool as ToolDefinition);
      },
    }),
  );
  return { labels, tools };
}

/** Writes its styling calls into the output, so a test sees what went where. */
const theme = strictDouble<Theme>("Theme", {
  fg: (color, text) => `${color}(${text})`,
  styledSymbol: (symbol, color) => `${color}:${symbol}`,
  spinnerFrames: ["frame-0", "frame-1"],
  format: strictDouble<Theme["format"]>("Theme.format", { bracketLeft: "[", bracketRight: "]" }),
  sep: strictDouble<Theme["sep"]>("Theme.sep", { dot: " | " }),
});

/** SAFETY: the tested execute functions do not read ExtensionContext. */
const unusedContext = {} as ExtensionContext;

async function run(name: string, params: unknown, signal?: AbortSignal) {
  const tool = requireTool((await registerExtensionTools()).tools, name);
  return tool.execute("test", params as never, signal, undefined, unusedContext);
}

async function text(name: string, params: unknown): Promise<string> {
  return ((await run(name, params)).content[0] as { text: string }).text;
}

async function statusLine(name: string, args: Record<string, unknown>): Promise<string> {
  const tool = requireTool((await registerExtensionTools()).tools, name);
  const drawn = tool.renderCall?.(args as never, { expanded: false, isPartial: false }, theme);
  return (drawn as unknown as CapturedText).text;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("lyrics OMP extension", () => {
  it("registers the complete read-only tool set under an extension label", async () => {
    const { labels, tools } = await registerExtensionTools();

    expect(labels).toEqual(["Lyrics"]);
    expect([...tools.keys()]).toEqual([
      "lyrics_providers",
      "lyrics_search",
      "lyrics_get",
      "lyrics_line_at",
    ]);
    for (const definition of lyricsTools) {
      const tool = requireTool(tools, definition.name);
      expect(tool.approval).toBe("read");
      expect(tool.label).toBe(definition.title);
      expect(tool.parameters).toEqual(wireSchema(definition));
    }
  });

  it("enforces the same argument bounds as the Pi extension", async () => {
    await expect(run("lyrics_get", { artist: "", track: "b" })).rejects.toThrow(ToolInputError);
    await expect(run("lyrics_search", { query: "x", limit: 51 })).rejects.toThrow("/limit");
    await expect(run("lyrics_search", { query: "x", limit: 1.5 })).rejects.toThrow("/limit");
  });

  it("renders a status line for each call", async () => {
    expect(
      await statusLine("lyrics_get", { artist: "Placeholder Artist", track: "Placeholder Song" }),
    ).toContain("Placeholder Artist - Placeholder Song");
    expect(await statusLine("lyrics_line_at", { artist: "a", track: "b", seconds: 25 })).toContain(
      "a - b @ 25s",
    );
  });

  it("strips terminal control sequences from rendered arguments", async () => {
    const escape = String.fromCodePoint(27);
    const nul = String.fromCodePoint(0);

    const line = await statusLine("lyrics_search", { query: `${escape}[31mred${escape}[0m${nul}` });

    expect(line).toContain("red");
    expect(line).not.toContain(escape);
    expect(line).not.toContain(nul);
  });

  it("keeps line breaks in tool output while removing control bytes", async () => {
    const escape = String.fromCodePoint(27);
    stubJSON({ ...LRCLIB_TRACK, plainLyrics: `First ${escape}[2Jline\u0007\nSecond line` });

    const output = await text("lyrics_get", { artist: "a", track: "b" });

    expect(output).toContain("First line\nSecond line");
    expect(output).not.toContain(escape);
    expect(output).not.toContain("\u0007");
    expect(output).toContain("Source: https://lrclib.net/api/get/496");
  });

  it("keeps attribution with a fetched line", async () => {
    register(AttributedProvider);
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);

    const output = await text("lyrics_line_at", {
      artist: "Placeholder Artist",
      track: "Placeholder Song",
      seconds: 25,
      provider: "attributed",
    });

    expect(output).toBe(
      "[0:20] Second placeholder line\n\nSource: https://example.com/placeholder\nPlaceholder attribution",
    );
    expect(fetch).not.toHaveBeenCalled();
  });

  it("lists providers through the shared formatter", async () => {
    expect(await text("lyrics_providers", {})).toContain("lrclib: search, lyrics, synced");
  });

  it.each(NETWORKED_CALLS)(
    "cancels the requests of %s %j with the host signal",
    async (name, params) => {
      const signals = stubPendingFetch();
      const controller = new AbortController();

      const pending = run(name, params, controller.signal);
      await vi.waitFor(() => expect(signals.length).toBeGreaterThan(0));
      controller.abort();

      await pending.catch(() => undefined);
      expect(signals.every((signal) => signal.aborted)).toBe(true);
    },
  );
});
