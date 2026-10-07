import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import pkg from "../../package.json" with { type: "json" };
import { Provider } from "../../src/core/provider.ts";
import type { ProviderConstructor } from "../../src/core/provider.ts";
import { create, getDefaultURL, register } from "../../src/core/registry.ts";
import type { ProviderCapabilities } from "../../src/core/types.ts";
import { createMcpServer } from "../../src/mcp.ts";
import { lyricsTools } from "../../src/tools.ts";
import "../../src/providers/index.ts";
import {
  AttributedProvider,
  LRCLIB_TRACK,
  NETWORKED_CALLS,
  stubJSON,
  stubPendingFetch,
} from "../helpers.ts";

const openConnections: Array<{ close(): Promise<void> }> = [];

/** SAFETY: create() instantiates the ProviderConstructor registered for this key. */
const lrclibConstructor = create("lrclib").constructor as ProviderConstructor;
const lrclibDefaultURL = getDefaultURL("lrclib");

const TRACK = LRCLIB_TRACK;

afterEach(async () => {
  register(lrclibConstructor, lrclibDefaultURL);
  vi.unstubAllGlobals();
  await Promise.all(openConnections.splice(0).map((connection) => connection.close()));
});

async function connectTestClient(): Promise<Client> {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const server = createMcpServer();
  const client = new Client({ name: "lyrics-test", version: "1.0.0" });
  openConnections.push(client, server);
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  return client;
}

async function call(name: string, args: Record<string, unknown>) {
  return (await connectTestClient()).callTool({ name, arguments: args });
}

/** The text of a call that has to succeed. */
function answer(response: unknown): string {
  const { content, isError } = response as { content: Array<{ text: string }>; isError?: boolean };
  expect(isError).not.toBe(true);
  return content[0]?.text ?? "";
}

/** The text of a call that has to fail. */
function failure(response: unknown): string {
  const { content, isError } = response as { content: Array<{ text: string }>; isError?: boolean };
  expect(isError).toBe(true);
  return content[0]?.text ?? "";
}

/** Takes over the lrclib key while claiming operations it refuses to serve. */
class DisabledProvider extends Provider {
  static readonly key = "lrclib";

  get capabilities(): ProviderCapabilities {
    return { search: false, lyrics: false, synced: false, translation: false };
  }

  async lyrics(): Promise<never> {
    throw new Error("capability gate bypassed");
  }
}

describe("Lyrics MCP server", () => {
  it("discovers every lyrics tool and executes provider discovery", async () => {
    const client = await connectTestClient();

    const listed = await client.listTools();
    expect(listed.tools.map((tool) => tool.name)).toEqual([
      "lyrics_providers",
      "lyrics_search",
      "lyrics_get",
      "lyrics_line_at",
    ]);
    for (const tool of listed.tools) {
      const definition = lyricsTools.find((entry) => entry.name === tool.name);
      expect(tool.annotations?.title).toBe(definition?.title);
      expect(tool.annotations?.readOnlyHint).toBe(true);
    }

    const response = await client.callTool({ name: "lyrics_providers", arguments: {} });
    expect(answer(response)).toContain("lrclib: search, lyrics, synced");
  });

  it("introduces itself with the version that is actually installed", async () => {
    const client = await connectTestClient();

    expect(client.getServerVersion()).toMatchObject({ name: "lyrics", version: pkg.version });
  });

  it("fetches lyrics from an explicitly chosen provider", async () => {
    stubJSON(TRACK);

    const text = answer(
      await call("lyrics_get", {
        artist: "Placeholder Artist",
        track: "Placeholder Song",
        provider: "lrclib",
      }),
    );

    expect(text).toMatch(/^\[lrclib\] Placeholder Artist - Placeholder Song/);
    expect(text).toContain("First placeholder line");
    expect(text).toContain("Source: https://lrclib.net/api/get/496");
  });

  it("walks providers and names the one that had the song", async () => {
    stubJSON(TRACK);

    const text = answer(
      await call("lyrics_get", { artist: "Placeholder Artist", track: "Placeholder Song" }),
    );

    expect(text).toMatch(/^\[lrclib\]/);
    expect(text).not.toContain("skipped");
  });

  it("compares every provider when provider is 'all'", async () => {
    stubJSON(TRACK);

    const text = answer(await call("lyrics_get", { artist: "a", track: "b", provider: "all" }));

    expect(text).toMatch(/\[lrclib\][\s\S]*\[musixmatch\] error:/);
  });

  it("serves synced lyrics and translations it used to leave to Pi and OMP", async () => {
    register(AttributedProvider);
    vi.stubGlobal("fetch", vi.fn());
    const args = { artist: "a", track: "b", provider: "attributed" };

    expect(answer(await call("lyrics_get", { ...args, synced: true }))).toContain(
      "[00:20.50] Second placeholder line",
    );
    expect(answer(await call("lyrics_get", { ...args, translation: true }))).toContain(
      "Translated placeholder line",
    );
  });

  it("reads the line sung at a moment, with its source", async () => {
    stubJSON(TRACK);

    const text = answer(
      await call("lyrics_line_at", { artist: "a", track: "b", seconds: 25, provider: "lrclib" }),
    );

    expect(text).toBe("[0:20] Second placeholder line\n\nSource: https://lrclib.net/api/get/496");
  });

  it("rejects a negative offset at the schema boundary", async () => {
    const fetch = stubJSON(TRACK);

    expect(
      failure(await call("lyrics_line_at", { artist: "a", track: "b", seconds: -1 })),
    ).toContain("seconds");
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each(["", "   "])(
    "rejects an empty-like provider %j instead of guessing",
    async (provider) => {
      expect(failure(await call("lyrics_search", { query: "placeholder", provider }))).toContain(
        "provider",
      );
    },
  );

  it("rejects an empty artist at the schema boundary", async () => {
    expect(
      failure(await call("lyrics_get", { artist: "   ", track: "b", provider: "lrclib" })),
    ).toContain("artist");
  });

  it("names an argument the tool does not take", async () => {
    expect(
      failure(await call("lyrics_search", { query: "placeholder", providers: "lrclib" })),
    ).toContain("providers");
  });

  it("honors a disabled capability", async () => {
    register(DisabledProvider);

    expect(
      failure(await call("lyrics_get", { artist: "a", track: "b", provider: "lrclib" })),
    ).toContain('Operation "lyrics" not supported by lrclib');
  });

  it.each(NETWORKED_CALLS)("cancels the requests of %s %j with the call", async (name, args) => {
    const signals = stubPendingFetch();
    const client = await connectTestClient();
    const controller = new AbortController();

    const pending = client.callTool({ name, arguments: args }, { signal: controller.signal });
    await vi.waitFor(() => expect(signals.length).toBeGreaterThan(0));
    controller.abort();

    await expect(pending).rejects.toThrow();
    await vi.waitFor(() => expect(signals.every((signal) => signal.aborted)).toBe(true));
  });
});
