/** Fetch synchronized lyrics, or the single line playing at a given moment */
import { defineCommand } from "citty";
import consola from "consola";
import { lyricsWithFallback } from "../core/all.ts";
import { formatLyricsFooter } from "../core/format.ts";
import { formatDuration, lineAt } from "../core/text.ts";
import { requireOperation } from "../core/provider.ts";
import { selectProvider, usableProviders } from "../core/resolve.ts";
import type { TrackQuery } from "../core/types.ts";
import { parseNumericArg } from "./args.ts";

export default defineCommand({
  meta: {
    name: "synced",
    description: "Fetch synchronized (LRC) lyrics for a track",
  },
  args: {
    artist: {
      type: "positional",
      description: "Performing artist",
      required: true,
    },
    track: {
      type: "positional",
      description: "Track title",
      required: true,
    },
    provider: {
      type: "string",
      alias: "p",
      description: "Provider; omit to walk the providers that serve synced lyrics",
    },
    at: {
      type: "string",
      description: "Print only the line playing at this offset in seconds",
    },
    duration: {
      type: "string",
      alias: "d",
      description: "Track length in seconds, to pick between recordings",
    },
  },
  async run({ args }) {
    try {
      const duration = parseNumericArg(args.duration, "duration", { min: Number.EPSILON });

      const query: TrackQuery = { artist: args.artist, track: args.track, duration };
      const lyrics = args.provider
        ? await requireOperation(selectProvider(args.provider).provider, "lyrics")(query)
        : (await lyricsWithFallback(query, usableProviders("synced"))).lyrics;

      if (!lyrics.synced) {
        consola.error(`No synchronized lyrics from ${lyrics.provider} for this track`);
        process.exit(1);
      }

      if (args.at === undefined) {
        consola.log(`${lyrics.synced}\n\n${formatLyricsFooter(lyrics)}`);
        return;
      }

      const seconds = parseNumericArg(args.at, "offset") ?? 0;
      const line = lineAt(lyrics.synced, seconds);
      const text = line
        ? `[${formatDuration(line.time)}] ${line.text}`
        : `(nothing sung at ${args.at}s)`;
      consola.log(`${text}\n\n${formatLyricsFooter(lyrics)}`);
    } catch (error) {
      consola.error(`Error: ${error instanceof Error ? error.message : error}`);
      process.exit(1);
    }
  },
});
