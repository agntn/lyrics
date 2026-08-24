/** Fetch the lyrics of one track */
import { defineCommand } from "citty";
import consola from "consola";
import { lyricsAll, lyricsWithFallback } from "../core/all.ts";
import {
  formatFallback,
  formatLyrics,
  formatLyricsAll,
  formatTranslation,
} from "../core/format.ts";
import { requireOperation } from "../core/provider.ts";
import { isAllProviders, selectProvider } from "../core/resolve.ts";
import type { TrackQuery } from "../core/types.ts";

export default defineCommand({
  meta: {
    name: "get",
    description: "Fetch the lyrics of one track",
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
      description: 'Provider, or "all" to compare every provider; omit to walk until one has it',
    },
    album: {
      type: "string",
      description: "Album name, used by providers that match on it",
    },
    duration: {
      type: "string",
      alias: "d",
      description: "Track length in seconds, to pick between recordings",
    },
    id: {
      type: "string",
      description: "Provider-native track id from a previous search",
    },
    synced: {
      type: "boolean",
      alias: "s",
      description: "Print synchronized LRC lyrics when the provider has them",
    },
    translation: {
      type: "boolean",
      alias: "t",
      description: "Print the translation instead of the original text",
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

      const query: TrackQuery = {
        artist: args.artist,
        track: args.track,
        album: args.album,
        duration,
        id: args.id,
      };

      if (isAllProviders(args.provider)) {
        consola.log(formatLyricsAll(await lyricsAll(query)));
        return;
      }

      if (!args.provider) {
        const result = await lyricsWithFallback(query);
        consola.log(
          args.translation
            ? formatTranslation(result.lyrics)
            : formatFallback(result, { synced: args.synced }),
        );
        return;
      }

      const { provider } = selectProvider(args.provider);
      const lyrics = await requireOperation(provider, "lyrics")(query);
      consola.log(
        args.translation
          ? formatTranslation(lyrics)
          : formatLyrics(lyrics, { synced: args.synced }),
      );
    } catch (error) {
      consola.error(`Error: ${error instanceof Error ? error.message : error}`);
      process.exit(1);
    }
  },
});
