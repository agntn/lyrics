import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { lyricsAll, lyricsWithFallback, searchAll, serializeOutcomes } from "./core/all.ts";
import { requireOperation } from "./core/provider.ts";
import { listProviders } from "./core/registry.ts";
import { isAllProviders, selectProvider } from "./core/resolve.ts";
import {
  albumInput,
  artistInput,
  durationInput,
  limitInput,
  lrcInput,
  providerInput,
  queryInput,
  secondsInput,
  trackIdInput,
  trackInput,
} from "./core/schemas.ts";
import { lineAt, parseLrc } from "./core/text.ts";
import { version } from "./version.ts";
import "./providers/index.ts";

function result(value: unknown): CallToolResult {
  return {
    content: [{ type: "text", text: JSON.stringify(value, null, 2) }],
  };
}

function providerResult(provider: string, value: unknown): CallToolResult {
  return result({ provider, data: value });
}

/** Create an MCP server exposing the normalized lyrics operations. */
export function createMcpServer(): McpServer {
  const server = new McpServer({ name: "lyrics", version });

  server.registerTool(
    "lyrics_providers",
    {
      description: "List registered lyrics providers, their capabilities and credential state",
      annotations: { readOnlyHint: true },
    },
    () => result(listProviders()),
  );

  server.registerTool(
    "lyrics_search",
    {
      description: "Find tracks matching a free-form query, best match first",
      inputSchema: {
        query: queryInput,
        limit: limitInput,
        ...providerInput,
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async ({ query, limit, provider }) => {
      if (isAllProviders(provider)) {
        return result(serializeOutcomes(await searchAll(query, { limit })));
      }
      const selected = selectProvider(provider, "search");
      const search = requireOperation(selected.provider, "search");
      return providerResult(selected.name, await search(query, { limit }));
    },
  );

  server.registerTool(
    "lyrics_get",
    {
      description:
        "Fetch the lyrics of one track. Without a provider, providers are tried in order until one has the song; the result carries the source URL and attribution, which belong with any quotation of the text.",
      inputSchema: {
        artist: artistInput,
        track: trackInput,
        album: albumInput,
        duration: durationInput,
        id: trackIdInput,
        ...providerInput,
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async ({ artist, track, album, duration, id, provider }) => {
      const query = { artist, track, album, duration, id };
      if (isAllProviders(provider)) {
        return result(serializeOutcomes(await lyricsAll(query)));
      }
      if (!provider) {
        const fallback = await lyricsWithFallback(query);
        return result({
          provider: fallback.provider,
          skipped: fallback.skipped,
          data: fallback.lyrics,
        });
      }
      const selected = selectProvider(provider);
      const lyrics = requireOperation(selected.provider, "lyrics");
      return providerResult(selected.name, await lyrics(query));
    },
  );

  server.registerTool(
    "lyrics_line_at",
    {
      description:
        "Read the line playing at a given second out of synchronized LRC lyrics. Runs locally on text already fetched - no provider is contacted.",
      inputSchema: {
        lrc: lrcInput,
        seconds: secondsInput,
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    ({ lrc, seconds }) => {
      const line = lineAt(lrc, seconds);
      return result({ seconds, line: line ?? null, totalLines: parseLrc(lrc).length });
    },
  );

  return server;
}
