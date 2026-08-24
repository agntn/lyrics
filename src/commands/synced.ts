/** Fetch synchronized lyrics, or the single line playing at a given moment */
import { defineCommand } from "citty";
import consola from "consola";
import { lyricsWithFallback } from "../core/all.ts";
import { formatDuration, lineAt } from "../core/text.ts";
import { requireOperation } from "../core/provider.ts";
import { selectProvider } from "../core/resolve.ts";
import type { TrackQuery } from "../core/types.ts";
import { providers } from "../core/registry.ts";
import { supportsOperation } from "../core/registry.ts";
import { isConfigured } from "../core/resolve.ts";
import { create } from "../core/registry.ts";

/** Providers that can serve synced lyrics, in registration order. */
function syncedProviders(): string[] {
  return providers().filter(
    (name) =>
      supportsOperation(name, "lyrics") && isConfigured(name) && create(name).capabilities.synced,
  );
}

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
      let duration: number | undefined;
      if (args.duration !== undefined) {
        duration = Number.parseFloat(args.duration);
        if (!Number.isFinite(duration) || duration <= 0) {
          consola.error(`Invalid duration: ${args.duration}`);
          process.exit(1);
        }
      }

      const query: TrackQuery = { artist: args.artist, track: args.track, duration };
      const lyrics = args.provider
        ? await requireOperation(selectProvider(args.provider).provider, "lyrics")(query)
        : (await lyricsWithFallback(query, syncedProviders())).lyrics;

      if (!lyrics.synced) {
        consola.error(`No synchronized lyrics from ${lyrics.provider} for this track`);
        process.exit(1);
      }

      if (args.at === undefined) {
        consola.log(lyrics.synced);
        return;
      }

      const seconds = Number.parseFloat(args.at);
      if (!Number.isFinite(seconds) || seconds < 0) {
        consola.error(`Invalid offset: ${args.at}`);
        process.exit(1);
      }
      const line = lineAt(lyrics.synced, seconds);
      consola.log(
        line ? `[${formatDuration(line.time)}] ${line.text}` : `(nothing sung at ${args.at}s)`,
      );
    } catch (error) {
      consola.error(`Error: ${error instanceof Error ? error.message : error}`);
      process.exit(1);
    }
  },
});
