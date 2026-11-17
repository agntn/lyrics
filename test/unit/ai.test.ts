import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { lineAtTool, lyricsTool, providersTool, searchTool } from "../../src/ai.ts";
import { register } from "../../src/core/registry.ts";
import "../../src/providers/index.ts";
import { AttributedProvider, NETWORKED_CALLS, stubPendingFetch } from "../helpers.ts";

const callOptions = { toolCallId: "call-1", messages: [], context: undefined };

const AI_TOOLS: Record<string, { execute?: unknown }> = {
  lyrics_get: lyricsTool,
  lyrics_search: searchTool,
  lyrics_line_at: lineAtTool,
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("AI SDK tools", () => {
  it("hands back the data next to the text every host prints", async () => {
    register(AttributedProvider);
    vi.stubGlobal("fetch", vi.fn());

    const result = await lyricsTool.execute?.(
      { artist: "a", track: "b", provider: "attributed" },
      callOptions,
    );

    expect(result).toMatchObject({
      provider: "attributed",
      lyrics: { url: "https://example.com/placeholder" },
    });
    expect(JSON.stringify(result)).toContain("Source: https://example.com/placeholder");
  });

  it("lists every provider with its capabilities", async () => {
    const result = await providersTool.execute?.({}, callOptions);

    expect(result).toHaveProperty("providers");
    expect(JSON.stringify(result)).toContain('"name":"lrclib"');
  });

  it.each(NETWORKED_CALLS)(
    "cancels the requests of %s %j with the abort signal",
    async (name, input) => {
      const signals = stubPendingFetch();
      const controller = new AbortController();
      const execute = AI_TOOLS[name]?.execute as (
        input: unknown,
        options: unknown,
      ) => Promise<unknown>;

      const pending = execute(input, { ...callOptions, abortSignal: controller.signal });
      await vi.waitFor(() => expect(signals.length).toBeGreaterThan(0));
      controller.abort();

      await pending.catch(() => undefined);
      expect(signals.every((signal) => signal.aborted)).toBe(true);
    },
  );
});
