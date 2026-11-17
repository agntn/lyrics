import { wireSchema } from "@agntn/tools";
import type {
  ExtensionAPI,
  ExtensionToolContext,
  ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import lyricsExtension from "../../extensions/pi/lyrics.ts";
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

/** SAFETY: the adapter only calls registerTool; reading any other member fails by name. */
async function registerExtensionTools(): Promise<Map<string, ToolDefinition>> {
  const tools = new Map<string, ToolDefinition>();
  const api = new Proxy(
    {
      registerTool(tool: ToolDefinition) {
        tools.set(tool.name, tool);
      },
    },
    {
      get(target, key, receiver) {
        if (typeof key === "symbol" || key === "then" || Reflect.has(target, key)) {
          const member: unknown = Reflect.get(target, key, receiver);
          return member;
        }
        throw new Error(`ExtensionAPI.${String(key)} is not stubbed`);
      },
    },
  );

  await lyricsExtension(api as unknown as ExtensionAPI);
  return tools;
}

/** SAFETY: the tested execute functions do not read ExtensionContext. */
const unusedContext = {} as ExtensionToolContext;

async function run(name: string, params: unknown, signal?: AbortSignal) {
  const tool = requireTool(await registerExtensionTools(), name);
  return tool.execute("test", params as never, signal, undefined, unusedContext);
}

async function text(name: string, params: unknown): Promise<string> {
  return ((await run(name, params)).content[0] as { text: string }).text;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("lyrics Pi extension", () => {
  it("registers the complete tool set with the shared schemas", async () => {
    const tools = await registerExtensionTools();

    expect([...tools.keys()]).toEqual([
      "lyrics_providers",
      "lyrics_search",
      "lyrics_get",
      "lyrics_line_at",
    ]);
    for (const definition of lyricsTools) {
      expect(requireTool(tools, definition.name).parameters).toEqual(wireSchema(definition));
    }
  });

  it("names each tool in every prompt guideline", async () => {
    for (const tool of (await registerExtensionTools()).values()) {
      expect(tool.promptGuidelines).not.toHaveLength(0);
      for (const guideline of tool.promptGuidelines ?? []) {
        expect(guideline).toContain(tool.name);
      }
    }
  });

  it("tells the model that lyrics are copyrighted", async () => {
    const tool = requireTool(await registerExtensionTools(), "lyrics_get");

    expect(tool.promptGuidelines?.join(" ")).toMatch(/copyright/i);
  });

  it.each([{ artist: "", track: "b" }, { artist: "   ", track: "b" }, { artist: "a" }])(
    "requires a non-empty artist and title: %j",
    async (params) => {
      const fetch = stubJSON(LRCLIB_TRACK);

      await expect(run("lyrics_get", params)).rejects.toThrow();
      expect(fetch).not.toHaveBeenCalled();
    },
  );

  it.each([0, 51, 1.5])("refuses search limit %s before any request", async (limit) => {
    const fetch = stubJSON([]);

    await expect(run("lyrics_search", { query: "x", limit })).rejects.toThrow("/limit");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("rejects a negative offset for the line lookup", async () => {
    await expect(run("lyrics_line_at", { artist: "a", track: "b", seconds: -1 })).rejects.toThrow(
      "/seconds",
    );
  });

  it("renders lyrics with their source line", async () => {
    stubJSON(LRCLIB_TRACK);

    expect(await text("lyrics_get", { artist: "a", track: "b" })).toContain(
      "Source: https://lrclib.net/api/get/496",
    );
  });

  it("returns the line playing at a moment", async () => {
    stubJSON(LRCLIB_TRACK);

    expect(await text("lyrics_line_at", { artist: "a", track: "b", seconds: 25 })).toContain(
      "[0:20] Second placeholder line",
    );
  });

  it("keeps attribution with a fetched line", async () => {
    register(AttributedProvider);
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);

    const result = await run("lyrics_line_at", {
      artist: "Placeholder Artist",
      track: "Placeholder Song",
      seconds: 25,
      provider: "attributed",
    });

    expect(result.content).toEqual([
      {
        type: "text",
        text: "[0:20] Second placeholder line\n\nSource: https://example.com/placeholder\nPlaceholder attribution",
      },
    ]);
    expect(result.details).toMatchObject({ provider: "attributed", seconds: 25, totalLines: 3 });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("lists providers with the credentials they still need", async () => {
    expect(await text("lyrics_providers", {})).toContain("needs GENIUS_ACCESS_TOKEN");
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
