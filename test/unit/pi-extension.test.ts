import type {
  ExtensionAPI,
  ExtensionContext,
  ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Value } from "typebox/value";
import { FAKE_PLAIN, FAKE_SYNCED, requireTool, stubJSON } from "../helpers.ts";
import lyricsExtension from "../../packages/pi/extensions/lyrics.ts";

/** SAFETY: the extension only calls registerTool during registration; the fake implements that seam. */
function registerExtensionTools(): Map<string, ToolDefinition> {
  const tools = new Map<string, ToolDefinition>();
  const api = {
    registerTool(tool: ToolDefinition) {
      tools.set(tool.name, tool);
    },
  };

  lyricsExtension(api as unknown as ExtensionAPI);
  return tools;
}

/** SAFETY: the tested execute functions do not read ExtensionContext. */
const unusedContext = {} as ExtensionContext;

const TRACK = {
  id: 496,
  trackName: "Placeholder Song",
  artistName: "Placeholder Artist",
  duration: 239,
  instrumental: false,
  plainLyrics: FAKE_PLAIN,
  syncedLyrics: FAKE_SYNCED,
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("lyrics Pi extension", () => {
  it("registers the complete tool set", () => {
    expect([...registerExtensionTools().keys()]).toEqual([
      "lyrics_get",
      "lyrics_search",
      "lyrics_line_at",
      "lyrics_providers",
    ]);
  });

  it("names each tool in every prompt guideline", () => {
    for (const tool of registerExtensionTools().values()) {
      expect(tool.promptGuidelines).not.toHaveLength(0);
      for (const guideline of tool.promptGuidelines ?? []) {
        expect(guideline).toContain(tool.name);
      }
    }
  });

  it("tells the model that lyrics are copyrighted", () => {
    const tool = requireTool(registerExtensionTools(), "lyrics_get");

    expect(tool.promptGuidelines?.join(" ")).toMatch(/copyright/i);
  });

  it("requires a non-empty artist and title", () => {
    const tool = requireTool(registerExtensionTools(), "lyrics_get");

    expect(Value.Check(tool.parameters, { artist: "a", track: "b" })).toBe(true);
    expect(Value.Check(tool.parameters, { artist: "", track: "b" })).toBe(false);
    expect(Value.Check(tool.parameters, { artist: "a" })).toBe(false);
  });

  it("bounds the search limit from 1 through 50", () => {
    const tool = requireTool(registerExtensionTools(), "lyrics_search");

    expect(Value.Check(tool.parameters, { query: "x", limit: 1 })).toBe(true);
    expect(Value.Check(tool.parameters, { query: "x", limit: 50 })).toBe(true);
    expect(Value.Check(tool.parameters, { query: "x", limit: 0 })).toBe(false);
    expect(Value.Check(tool.parameters, { query: "x", limit: 51 })).toBe(false);
    expect(Value.Check(tool.parameters, { query: "x", limit: 1.5 })).toBe(false);
  });

  it("rejects a negative offset for the line lookup", () => {
    const tool = requireTool(registerExtensionTools(), "lyrics_line_at");

    expect(Value.Check(tool.parameters, { artist: "a", track: "b", seconds: 0 })).toBe(true);
    expect(Value.Check(tool.parameters, { artist: "a", track: "b", seconds: -1 })).toBe(false);
  });

  it("renders lyrics with their source line", async () => {
    stubJSON(TRACK);
    const tool = requireTool(registerExtensionTools(), "lyrics_get");

    const result = await tool.execute?.(
      "call-1",
      { artist: "a", track: "b" },
      undefined,
      undefined,
      unusedContext,
    );

    expect(result?.content?.[0]).toMatchObject({
      type: "text",
      text: expect.stringContaining("Source: https://lrclib.net/api/get/496"),
    });
  });

  it("returns the line playing at a moment", async () => {
    stubJSON(TRACK);
    const tool = requireTool(registerExtensionTools(), "lyrics_line_at");

    const result = await tool.execute?.(
      "call-2",
      { artist: "a", track: "b", seconds: 25 },
      undefined,
      undefined,
      unusedContext,
    );

    expect(result?.content?.[0]).toMatchObject({
      type: "text",
      text: expect.stringContaining("[0:20] Second placeholder line"),
    });
  });

  it("lists providers with the credentials they still need", async () => {
    const tool = requireTool(registerExtensionTools(), "lyrics_providers");

    const result = await tool.execute?.("call-3", {}, undefined, undefined, unusedContext);

    expect(result?.content?.[0]).toMatchObject({
      type: "text",
      text: expect.stringContaining("needs GENIUS_ACCESS_TOKEN"),
    });
  });
});
