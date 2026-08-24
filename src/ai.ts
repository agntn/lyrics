/** Vercel AI SDK tool surface over the normalized lyrics operations. */

import { tool, type Tool } from "ai";
import { z } from "zod";
import type { Lyrics, TrackMatch } from "./core/types.ts";
import type { SerializedOutcome } from "./core/all.ts";
import { lyricsAll, lyricsWithFallback, searchAll, serializeOutcomes } from "./core/all.ts";
import { requireOperation } from "./core/provider.ts";
import { providers } from "./core/registry.ts";
import { isAllProviders, providerArg, selectProvider } from "./core/resolve.ts";
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
import type { SyncedLine } from "./core/text.ts";
import "./providers/index.ts";

const searchInputSchema = z.object({
  query: queryInput,
  limit: limitInput,
  ...providerInput,
});

type SearchToolOutput =
  | { provider: string; matches: TrackMatch[] }
  | { comparison: SerializedOutcome<TrackMatch[]>[] };

export const searchTool: Tool<z.infer<typeof searchInputSchema>, SearchToolOutput> = tool({
  description:
    "Find tracks matching a free-form query, best match first. Pass provider 'all' to compare every provider.",
  inputSchema: searchInputSchema,
  execute: async ({ query, limit, provider }) => {
    if (isAllProviders(provider)) {
      return { comparison: serializeOutcomes(await searchAll(query, { limit })) };
    }
    const selected = selectProvider(provider, "search");
    const search = requireOperation(selected.provider, "search");
    return { provider: selected.name, matches: await search(query, { limit }) };
  },
});

const lyricsInputSchema = z.object({
  artist: artistInput,
  track: trackInput,
  album: albumInput,
  duration: durationInput,
  id: trackIdInput,
  ...providerInput,
});

type LyricsToolOutput =
  | { provider: string; lyrics: Lyrics; skipped?: { provider: string; error: string }[] }
  | { comparison: SerializedOutcome<Lyrics>[] };

export const lyricsTool: Tool<z.infer<typeof lyricsInputSchema>, LyricsToolOutput> = tool({
  description:
    "Fetch the lyrics of one track. Without a provider, providers are tried in order until one has the song. The result carries the source URL and attribution, which belong with any quotation of the text.",
  inputSchema: lyricsInputSchema,
  execute: async ({ artist, track, album, duration, id, provider }) => {
    const query = { artist, track, album, duration, id };
    if (isAllProviders(provider)) {
      return { comparison: serializeOutcomes(await lyricsAll(query)) };
    }
    if (!providerArg(provider)) {
      const fallback = await lyricsWithFallback(query);
      return { provider: fallback.provider, lyrics: fallback.lyrics, skipped: fallback.skipped };
    }
    const selected = selectProvider(provider);
    const lyrics = requireOperation(selected.provider, "lyrics");
    return { provider: selected.name, lyrics: await lyrics(query) };
  },
});

const lineAtInputSchema = z.object({
  lrc: lrcInput,
  seconds: secondsInput,
});

export const lineAtTool: Tool<
  z.infer<typeof lineAtInputSchema>,
  { seconds: number; line: SyncedLine | null; totalLines: number }
> = tool({
  description:
    "Read the line playing at a given second out of synchronized LRC lyrics, computed locally on text already fetched.",
  inputSchema: lineAtInputSchema,
  execute: async ({ lrc, seconds }) => {
    const lines = parseLrc(lrc);
    return { seconds, line: lineAt(lines, seconds) ?? null, totalLines: lines.length };
  },
});

export const providersTool: Tool<Record<string, never>, { providers: string[] }> = tool({
  description: "List registered lyrics provider keys accepted by the other lyrics tools.",
  inputSchema: z.object({}),
  execute: async () => {
    return { providers: providers() };
  },
});
