import { afterEach, describe, expect, it, vi } from "vitest";
import { lyricsTool, searchTool } from "../../src/ai.ts";
import { stubPendingFetch } from "../helpers.ts";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("AI SDK tools", () => {
  it.each([
    [lyricsTool, { artist: "a", track: "b" }],
    [lyricsTool, { artist: "a", track: "b", provider: "lrclib" }],
    [lyricsTool, { artist: "a", track: "b", provider: "all" }],
    [searchTool, { query: "placeholder", provider: "lrclib" }],
    [searchTool, { query: "placeholder", provider: "all" }],
  ] as const)("cancels the requests of call %# with the abort signal", async (tool, input) => {
    const signals = stubPendingFetch();
    const controller = new AbortController();

    const pending = (tool.execute as (input: unknown, options: unknown) => Promise<unknown>)(
      input,
      {
        toolCallId: "call-1",
        messages: [],
        abortSignal: controller.signal,
      },
    );
    await vi.waitFor(() => expect(signals.length).toBeGreaterThan(0));
    controller.abort();

    await pending.catch(() => undefined);
    expect(signals.every((signal) => signal.aborted)).toBe(true);
  });
});
