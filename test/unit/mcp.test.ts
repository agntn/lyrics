import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Provider } from "../../src/core/provider.ts";
import type { ProviderConstructor } from "../../src/core/provider.ts";
import { create, getDefaultURL, register } from "../../src/core/registry.ts";
import type { ProviderCapabilities } from "../../src/core/types.ts";
import { createMcpServer } from "../../src/mcp.ts";
import { FAKE_PLAIN, FAKE_SYNCED, LRCLIB_TRACK, stubJSON, stubPendingFetch } from "../helpers.ts";

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

    const response = await client.callTool({ name: "lyrics_providers", arguments: {} });
    expect(response.isError).not.toBe(true);
    expect(response.content).toEqual([
      { type: "text", text: expect.stringContaining('"name": "lrclib"') },
    ]);
  });

  it("fetches lyrics from an explicitly chosen provider", async () => {
    stubJSON(TRACK);
    const client = await connectTestClient();

    const response = await client.callTool({
      name: "lyrics_get",
      arguments: { artist: "Placeholder Artist", track: "Placeholder Song", provider: "lrclib" },
    });

    expect(response.isError).not.toBe(true);
    expect(response.content).toEqual([
      { type: "text", text: expect.stringMatching(/"provider": "lrclib"[\s\S]*First placeholder/) },
    ]);
  });

  it("walks providers and reports the ones it passed over", async () => {
    stubJSON(TRACK);
    const client = await connectTestClient();

    const response = await client.callTool({
      name: "lyrics_get",
      arguments: { artist: "Placeholder Artist", track: "Placeholder Song" },
    });

    expect(response.isError).not.toBe(true);
    expect(response.content).toEqual([
      { type: "text", text: expect.stringMatching(/"provider": "lrclib"[\s\S]*"skipped": \[\]/) },
    ]);
  });

  it("compares every provider when provider is 'all'", async () => {
    stubJSON(TRACK);
    const client = await connectTestClient();

    const response = await client.callTool({
      name: "lyrics_get",
      arguments: { artist: "a", track: "b", provider: "all" },
    });

    expect(response.isError).not.toBe(true);
    expect(response.content).toEqual([
      {
        type: "text",
        text: expect.stringMatching(/"provider": "lrclib"[\s\S]*"provider": "musixmatch"/),
      },
    ]);
  });

  it("reads a synced line locally without contacting a provider", async () => {
    const fetch = stubJSON(TRACK);
    const client = await connectTestClient();

    const response = await client.callTool({
      name: "lyrics_line_at",
      arguments: { lrc: FAKE_SYNCED, seconds: 25 },
    });

    expect(response.isError).not.toBe(true);
    expect(response.content).toEqual([
      { type: "text", text: expect.stringMatching(/"time": 20.5[\s\S]*"totalLines": 3/) },
    ]);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("rejects a negative offset at the schema boundary", async () => {
    const client = await connectTestClient();

    const response = await client.callTool({
      name: "lyrics_line_at",
      arguments: { lrc: FAKE_SYNCED, seconds: -1 },
    });

    expect(response.isError).toBe(true);
  });

  it.each(["", "   "])("rejects an empty-like provider instead of guessing", async (provider) => {
    const client = await connectTestClient();

    const response = await client.callTool({
      name: "lyrics_search",
      arguments: { query: "placeholder", provider },
    });

    expect(response.isError).toBe(true);
  });

  it("rejects an empty artist at the schema boundary", async () => {
    const client = await connectTestClient();

    const response = await client.callTool({
      name: "lyrics_get",
      arguments: { artist: "   ", track: "b", provider: "lrclib" },
    });

    expect(response.isError).toBe(true);
  });

  it("honors a disabled capability", async () => {
    register(DisabledProvider);
    const client = await connectTestClient();

    const response = await client.callTool({
      name: "lyrics_get",
      arguments: { artist: "a", track: "b", provider: "lrclib" },
    });

    expect(response.isError).toBe(true);
    expect(response.content).toEqual([
      {
        type: "text",
        text: expect.stringContaining('Operation "lyrics" not supported by lrclib'),
      },
    ]);
  });

  it.each([
    ["lyrics_get", { artist: "a", track: "b" }],
    ["lyrics_get", { artist: "a", track: "b", provider: "lrclib" }],
    ["lyrics_get", { artist: "a", track: "b", provider: "all" }],
    ["lyrics_search", { query: "placeholder", provider: "lrclib" }],
    ["lyrics_search", { query: "placeholder", provider: "all" }],
  ])("cancels the requests of %s %j with the call", async (name, args) => {
    const signals = stubPendingFetch();
    const client = await connectTestClient();
    const controller = new AbortController();

    const pending = client.callTool({ name, arguments: args }, undefined, {
      signal: controller.signal,
    });
    await vi.waitFor(() => expect(signals.length).toBeGreaterThan(0));
    controller.abort();

    await expect(pending).rejects.toThrow();
    await vi.waitFor(() => expect(signals.every((signal) => signal.aborted)).toBe(true));
  });
});
