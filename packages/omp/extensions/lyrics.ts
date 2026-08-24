/** OMP extension: Lyrics - unified song lyrics tools. */
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { stripVTControlCharacters } from "node:util";

import type { AgentToolResult, ExtensionAPI } from "@oh-my-pi/pi-coding-agent";
import { Text } from "@oh-my-pi/pi-coding-agent";
import { renderStatusLine } from "@oh-my-pi/pi-coding-agent/tui";

import type * as LyricsModule from "../../../dist/index.d.mts";

const sourceModulePath = fileURLToPath(new URL("../../../src/index.ts", import.meta.url));
let lyricsModulePromise: Promise<typeof LyricsModule> | undefined;

/**
 * Load current source in development and fall back to the built package in distributions.
 *
 * Both specifiers stay literal: OMP rewrites bare dependencies only for imports it can see
 * statically. existsSync chooses the branch; it does not build a URL for a single import().
 */
function loadLibrary(): Promise<typeof LyricsModule> {
  lyricsModulePromise ??= existsSync(sourceModulePath)
    ? (import("../../../src/index.ts") as unknown as Promise<typeof LyricsModule>)
    : (import("../../../dist/index.mjs") as Promise<typeof LyricsModule>);

  return lyricsModulePromise;
}

/**
 * Renderer interpolations cross the terminal trust boundary: model arguments and provider text
 * may carry ANSI/OSC escape sequences or raw control bytes that OMP's Text component passes to
 * the terminal unchanged. String() first, because hostile JSON is not bound by the declared
 * parameter types.
 */
const CONTROL_CHARACTERS = /\p{Cc}/gu;
const SPACE_RUNS = / +/g;

export function sanitizeTerminalText(value: unknown): string {
  return stripVTControlCharacters(String(value))
    .replace(CONTROL_CHARACTERS, " ")
    .replace(SPACE_RUNS, " ")
    .trim();
}

/**
 * Sanitize multi-line tool output while keeping its line structure.
 *
 * Lyrics are the whole point of this tool, and their line breaks carry meaning, so control
 * bytes are removed per line rather than by a regex that would have to spare `\n` itself.
 */
function sanitizeTerminalBlock(text: string): string {
  return stripVTControlCharacters(text)
    .split("\n")
    .map((line) => line.replace(CONTROL_CHARACTERS, " "))
    .join("\n");
}

type LyricsToolResult = AgentToolResult<undefined>;

function textResult(text: string): LyricsToolResult {
  return {
    content: [{ type: "text", text: sanitizeTerminalBlock(text) }],
    details: undefined,
  };
}

/**
 * Register Lyrics tools with the OMP extension host.
 *
 * OMP validates tool parameters with its own TypeBox build, so schemas must come from the
 * host-injected facade rather than a standalone typebox import.
 */
export default function lyricsExtension(pi: ExtensionAPI): void {
  const { Type } = pi.typebox;
  pi.setLabel("Lyrics");

  type RenderCallOptions = { isPartial?: boolean; spinnerFrame?: number };
  type RenderTheme = Parameters<typeof renderStatusLine>[1];

  function statusLine(
    title: string,
    description: string,
    options: RenderCallOptions,
    theme: RenderTheme,
  ): Text {
    const icon = options.isPartial
      ? options.spinnerFrame === undefined
        ? "pending"
        : "running"
      : "done";

    return new Text(
      renderStatusLine(
        {
          icon,
          spinnerFrame: options.spinnerFrame,
          title,
          description: sanitizeTerminalText(description),
        },
        theme,
      ),
      0,
      0,
    );
  }

  const artistParameter = Type.String({ description: "Performing artist", minLength: 1 });
  const trackParameter = Type.String({ description: "Track title", minLength: 1 });
  const durationParameter = Type.Optional(
    Type.Number({
      description: "Track length in seconds; sharpens the match on providers that use it",
      exclusiveMinimum: 0,
      maximum: 36_000,
    }),
  );

  pi.registerTool({
    name: "lyrics_get",
    label: "Lyrics Get",
    description:
      "Fetch the lyrics of one track. Without a provider, providers are tried in order until one has the song. The result ends with the source URL and attribution, which belong with any quotation of the text.",
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
      provider: Type.Optional(
        Type.String({
          description:
            "Registered provider key, or 'all' to compare every provider; use lyrics_providers to list them",
          minLength: 1,
        }),
      ),
    }),
    approval: "read",
    renderCall(args, options, theme) {
      return statusLine("Lyrics Get", `${args.artist} - ${args.track}`, options, theme);
    },
    async execute(_toolCallId, params): Promise<LyricsToolResult> {
      const lib = await loadLibrary();
      const query = {
        artist: params.artist,
        track: params.track,
        album: params.album,
        duration: params.duration,
        id: params.id,
      };

      if (lib.isAllProviders(params.provider)) {
        return textResult(lib.formatLyricsAll(await lib.lyricsAll(query)));
      }
      if (lib.providerArg(params.provider)) {
        const { provider } = lib.selectProvider(params.provider);
        const lyrics = await lib.requireOperation(provider, "lyrics")(query);
        return textResult(
          params.translation
            ? lib.formatTranslation(lyrics)
            : lib.formatLyrics(lyrics, { synced: params.synced }),
        );
      }
      const fallback = await lib.lyricsWithFallback(query);
      return textResult(
        params.translation
          ? lib.formatTranslation(fallback.lyrics)
          : lib.formatFallback(fallback, { synced: params.synced }),
      );
    },
  });

  pi.registerTool({
    name: "lyrics_search",
    label: "Lyrics Search",
    description:
      "Find tracks matching a free-form query. Returns candidates with album, length and the provider-native id to pass back to lyrics_get.",
    parameters: Type.Object({
      query: Type.String({
        description: "Free-form query, for example 'radiohead creep'",
        minLength: 1,
      }),
      limit: Type.Optional(
        Type.Integer({ description: "Maximum number of results", minimum: 1, maximum: 50 }),
      ),
      provider: Type.Optional(
        Type.String({
          description: "Provider, or 'all' to compare every provider",
          minLength: 1,
        }),
      ),
    }),
    approval: "read",
    renderCall(args, options, theme) {
      return statusLine("Lyrics Search", String(args.query), options, theme);
    },
    async execute(_toolCallId, params): Promise<LyricsToolResult> {
      const lib = await loadLibrary();
      const options = { limit: params.limit };
      if (lib.isAllProviders(params.provider)) {
        return textResult(
          lib.formatSearchAll(params.query, await lib.searchAll(params.query, options)),
        );
      }
      const { name, provider } = lib.selectProvider(params.provider, "search");
      const search = lib.requireOperation(provider, "search");
      return textResult(lib.formatTracks(name, params.query, await search(params.query, options)));
    },
  });

  pi.registerTool({
    name: "lyrics_line_at",
    label: "Lyrics Line At",
    description:
      "Read the line playing at a given second of a track, using a provider that serves synchronized lyrics.",
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
    approval: "read",
    renderCall(args, options, theme) {
      return statusLine(
        "Lyrics Line At",
        `${args.artist} - ${args.track} @ ${args.seconds}s`,
        options,
        theme,
      );
    },
    async execute(_toolCallId, params): Promise<LyricsToolResult> {
      const lib = await loadLibrary();
      const query = { artist: params.artist, track: params.track, duration: params.duration };
      const syncedProviders = lib.usableProviders("synced");
      const lyrics = lib.providerArg(params.provider)
        ? await lib.requireOperation(lib.selectProvider(params.provider).provider, "lyrics")(query)
        : (await lib.lyricsWithFallback(query, syncedProviders)).lyrics;

      if (!lyrics.synced) {
        return textResult(`No synchronized lyrics from ${lyrics.provider} for this track`);
      }
      const line = lib.lineAt(lyrics.synced, params.seconds);
      return textResult(
        line
          ? `[${lib.formatDuration(line.time)}] ${line.text}\n\nSource: ${lyrics.url ?? lyrics.provider}`
          : `(nothing sung at ${params.seconds}s)`,
      );
    },
  });

  pi.registerTool({
    name: "lyrics_providers",
    label: "Lyrics Providers",
    description: "List registered lyrics providers, their capabilities and credential state.",
    parameters: Type.Object({}),
    approval: "read",
    renderCall(_args, options, theme) {
      return statusLine("Lyrics Providers", "registered providers", options, theme);
    },
    async execute(): Promise<LyricsToolResult> {
      const lib = await loadLibrary();
      return textResult(lib.formatProviders(lib.listProviders()));
    },
  });
}
