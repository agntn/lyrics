import * as TypeBox from "@oh-my-pi/omptype/typebox";
import type { ExtensionAPI, ExtensionContext, ToolDefinition } from "@oh-my-pi/pi-coding-agent";
import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * The host serves these modules to loaded extensions at runtime; under vitest the renderers are
 * exercised against capturing stand-ins instead of the OMP TUI.
 */
vi.mock("@oh-my-pi/pi-coding-agent", () => ({
  Text: class {
    constructor(
      readonly text: string,
      readonly paddingX?: number,
      readonly paddingY?: number,
    ) {}
  },
}));
vi.mock("@oh-my-pi/pi-coding-agent/tui", () => ({
  renderStatusLine: (options: unknown) => JSON.stringify(options),
}));

import { FAKE_PLAIN, FAKE_SYNCED, LRCLIB_TRACK, requireTool, stubJSON } from "../helpers.ts";
import lyricsOmpExtension, { sanitizeTerminalText } from "../../packages/omp/extensions/lyrics.ts";

interface RegisteredExtension {
  label: string | undefined;
  tools: Map<string, ToolDefinition>;
}

/** SAFETY: the test host implements the three registration-time capabilities the extension uses. */
function registerExtensionTools(): RegisteredExtension {
  const tools = new Map<string, ToolDefinition>();
  let label: string | undefined;
  const api = {
    typebox: TypeBox,
    setLabel(value: string) {
      label = value;
    },
    registerTool(tool: ToolDefinition) {
      tools.set(tool.name, tool);
    },
  };

  lyricsOmpExtension(api as unknown as ExtensionAPI);
  return { label, tools };
}

/** SAFETY: the test host injects OMP's TypeBox facade, which creates this schema. */
function accepts(tool: ToolDefinition, value: unknown): boolean {
  return (tool.parameters as unknown as TypeBox.TSchema).safeParse(value).success;
}

/** SAFETY: the tested execute functions do not read ExtensionContext. */
const unusedContext = {} as ExtensionContext;

const TRACK = LRCLIB_TRACK;

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("lyrics OMP extension", () => {
  it("registers the complete read-only tool set under an extension label", () => {
    const { label, tools } = registerExtensionTools();

    expect(label).toBe("Lyrics");
    expect([...tools.keys()]).toEqual([
      "lyrics_get",
      "lyrics_search",
      "lyrics_line_at",
      "lyrics_providers",
    ]);
    for (const tool of tools.values()) expect(tool.approval).toBe("read");
  });

  it("enforces the same argument bounds as the Pi extension", () => {
    const { tools } = registerExtensionTools();
    const get = requireTool(tools, "lyrics_get");
    const search = requireTool(tools, "lyrics_search");

    expect(accepts(get, { artist: "a", track: "b" })).toBe(true);
    expect(accepts(get, { artist: "", track: "b" })).toBe(false);
    expect(accepts(search, { query: "x", limit: 51 })).toBe(false);
    expect(accepts(search, { query: "x", limit: 1.5 })).toBe(false);
  });

  it("renders a status line for each call", () => {
    const { tools } = registerExtensionTools();
    const tool = requireTool(tools, "lyrics_get");

    const rendered = tool.renderCall?.(
      { artist: "Placeholder Artist", track: "Placeholder Song" },
      { expanded: false, isPartial: false },
      undefined as never,
    ) as unknown as { text: string };

    expect(rendered.text).toContain("Placeholder Artist - Placeholder Song");
  });

  it("strips terminal control sequences from rendered arguments", () => {
    const escape = String.fromCharCode(27);
    const nul = String.fromCharCode(0);

    expect(sanitizeTerminalText(`${escape}[31mred${escape}[0m`)).toBe("red");
    expect(sanitizeTerminalText(`a${nul}b`)).toBe("a b");
  });

  it("keeps line breaks in tool output while removing control bytes", async () => {
    stubJSON(TRACK);
    const { tools } = registerExtensionTools();
    const tool = requireTool(tools, "lyrics_get");

    const result = await tool.execute?.(
      "call-1",
      { artist: "a", track: "b" },
      undefined,
      undefined,
      unusedContext,
    );
    const text = String(
      result?.content?.[0] && "text" in result.content[0] ? result.content[0].text : "",
    );

    expect(text).toContain("First placeholder line\nSecond placeholder line");
    expect(text).toContain("Source: https://lrclib.net/api/get/496");
  });

  it("lists providers through the shared formatter", async () => {
    const { tools } = registerExtensionTools();
    const tool = requireTool(tools, "lyrics_providers");

    const result = await tool.execute?.("call-2", {}, undefined, undefined, unusedContext);

    expect(result?.content?.[0]).toMatchObject({
      type: "text",
      text: expect.stringContaining("lrclib: search, lyrics, synced"),
    });
  });
});
