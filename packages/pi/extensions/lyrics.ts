/** Pi extension: Lyrics - unified song lyrics tools */
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

import type { AgentToolResult, ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

import type * as LyricsModule from "../../../dist/index.d.mts";

const sourceModuleUrl = new URL("../../../src/index.ts", import.meta.url);
const distributionModuleUrl = new URL("../../../dist/index.mjs", import.meta.url);
let lyricsModulePromise: Promise<typeof LyricsModule> | undefined;

/** Load current source in development and fall back to the built package in distributions. */
function loadLibrary(): Promise<typeof LyricsModule> {
  lyricsModulePromise ??= import(
    existsSync(fileURLToPath(sourceModuleUrl)) ? sourceModuleUrl.href : distributionModuleUrl.href
  ) as Promise<typeof LyricsModule>;

  return lyricsModulePromise;
}

type LyricsToolResult = AgentToolResult<undefined>;

function textResult(text: string): LyricsToolResult {
  return {
    content: [{ type: "text", text }],
    details: undefined,
  };
}

const artistParameter = Type.String({ description: "Performing artist", minLength: 1 });
const trackParameter = Type.String({ description: "Track title", minLength: 1 });
const providerParameter = Type.Optional(
  Type.String({
    description:
      "Registered provider key, or 'all' to compare every provider; use lyrics_providers to list them",
    minLength: 1,
  }),
);
const durationParameter = Type.Optional(
  Type.Number({
    description: "Track length in seconds; sharpens the match on providers that use it",
    exclusiveMinimum: 0,
    maximum: 36_000,
  }),
);

export default function lyricsExtension(pi: ExtensionAPI): void {
  pi.registerTool({
    name: "lyrics_get",
    label: "Lyrics Get",
    description: "Fetch the lyrics of one track from a lyrics provider",
    promptSnippet: "Use lyrics_get to fetch the words of a song by artist and title.",
    promptGuidelines: [
      "Use lyrics_get with the artist and the track title; without a provider it walks providers until one has the song.",
      "Every lyrics_get result ends with the source URL and the provider's attribution - keep both with the text whenever you quote it.",
      "Pass provider 'all' to lyrics_get to compare what every provider has for the same track.",
      "Song lyrics are copyrighted: quote the shortest excerpt the task needs rather than repeating a whole lyrics_get result.",
    ],
    parameters: Type.Object({
      artist: artistParameter,
      track: trackParameter,
      album: Type.Optional(Type.String({ description: "Album or release name", minLength: 1 })),
      duration: durationParameter,
      id: Type.Optional(
        Type.String({
          description: "Provider-native track id from a previous lyrics_search on that provider",
          minLength: 1,
          maxLength: 200,
        }),
      ),
      synced: Type.Optional(
        Type.Boolean({ description: "Prefer synchronized LRC lyrics when the provider has them" }),
      ),
      translation: Type.Optional(
        Type.Boolean({ description: "Return the translation instead of the original text" }),
      ),
      provider: providerParameter,
    }),
    async execute(_toolCallId, params, signal): Promise<LyricsToolResult> {
      const lib = await loadLibrary();
      const query = {
        artist: params.artist,
        track: params.track,
        album: params.album,
        duration: params.duration,
        id: params.id,
      };

      if (lib.isAllProviders(params.provider)) {
        return textResult(lib.formatLyricsAll(await lib.lyricsAll(query, signal)));
      }
      if (!lib.providerArg(params.provider)) {
        const fallback = await lib.lyricsWithFallback(query, undefined, signal);
        return textResult(
          params.translation
            ? lib.formatTranslation(fallback.lyrics)
            : lib.formatFallback(fallback, { synced: params.synced }),
        );
      }
      const { provider } = lib.selectProvider(params.provider, "lyrics", signal);
      const lyrics = await lib.requireOperation(provider, "lyrics")(query);
      return textResult(
        params.translation
          ? lib.formatTranslation(lyrics)
          : lib.formatLyrics(lyrics, { synced: params.synced }),
      );
    },
  });

  pi.registerTool({
    name: "lyrics_search",
    label: "Lyrics Search",
    description: "Find tracks matching a free-form query",
    promptSnippet: "Use lyrics_search to find the exact artist and title spelling for a song.",
    promptGuidelines: [
      "Use lyrics_search when the artist or title spelling is uncertain; it returns candidates with album, length and provider id.",
      "Feed the id from lyrics_search into lyrics_get with the same provider for an exact lookup.",
    ],
    parameters: Type.Object({
      query: Type.String({
        description: "Free-form query, for example 'radiohead creep'",
        minLength: 1,
      }),
      limit: Type.Optional(
        Type.Integer({ description: "Maximum number of results", minimum: 1, maximum: 50 }),
      ),
      provider: providerParameter,
    }),
    async execute(_toolCallId, params, signal): Promise<LyricsToolResult> {
      const lib = await loadLibrary();
      const options = { limit: params.limit };
      if (lib.isAllProviders(params.provider)) {
        return textResult(
          lib.formatSearchAll(params.query, await lib.searchAll(params.query, options, signal)),
        );
      }
      const { name, provider } = lib.selectProvider(params.provider, "search", signal);
      const search = lib.requireOperation(provider, "search");
      return textResult(lib.formatTracks(name, params.query, await search(params.query, options)));
    },
  });

  pi.registerTool({
    name: "lyrics_line_at",
    label: "Lyrics Line At",
    description: "Read the line playing at a given second of a track with synchronized lyrics",
    promptSnippet: "Use lyrics_line_at to find which line is sung at a moment of a song.",
    promptGuidelines: [
      "Use lyrics_line_at with an artist, a title and an offset in seconds; it needs a provider that serves synchronized lyrics.",
      "lyrics_line_at fetches the synced text itself, so call it directly rather than passing lyrics from another tool.",
    ],
    parameters: Type.Object({
      artist: artistParameter,
      track: trackParameter,
      seconds: Type.Number({
        description: "Offset from the start of the recording, in seconds",
        minimum: 0,
        maximum: 36_000,
      }),
      duration: durationParameter,
      provider: Type.Optional(
        Type.String({ description: "Provider that serves synchronized lyrics", minLength: 1 }),
      ),
    }),
    async execute(_toolCallId, params, signal): Promise<LyricsToolResult> {
      const lib = await loadLibrary();
      const query = { artist: params.artist, track: params.track, duration: params.duration };
      const syncedProviders = lib.usableProviders("synced");
      const lyrics = lib.providerArg(params.provider)
        ? await lib.requireOperation(
            lib.selectProvider(params.provider, "lyrics", signal).provider,
            "lyrics",
          )(query)
        : (await lib.lyricsWithFallback(query, syncedProviders, signal)).lyrics;

      if (!lyrics.synced) {
        return textResult(`No synchronized lyrics from ${lyrics.provider} for this track`);
      }
      const line = lib.lineAt(lyrics.synced, params.seconds);
      return textResult(
        line
          ? `[${lib.formatDuration(line.time)}] ${line.text}\n\n${lib.formatLyricsFooter(lyrics)}`
          : `(nothing sung at ${params.seconds}s)`,
      );
    },
  });

  pi.registerTool({
    name: "lyrics_providers",
    label: "Lyrics Providers",
    description: "List registered lyrics providers and what each can serve",
    promptSnippet: "Use lyrics_providers to check which lyrics backends are available.",
    promptGuidelines: [
      "Use lyrics_providers to list provider keys, their capabilities and which credentials are configured.",
    ],
    parameters: Type.Object({}),
    async execute(): Promise<LyricsToolResult> {
      const lib = await loadLibrary();
      return textResult(lib.formatProviders(lib.listProviders()));
    },
  });
}
