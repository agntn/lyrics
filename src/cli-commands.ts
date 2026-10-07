/** CLI-only `synced`: the whole LRC of a track, or with `--at` the one line sung then. */

import { defineTool, Type } from "@agntn/tools";
import { loadOperations } from "./tools.ts";

const filled = (description: string) => Type.String({ pattern: "\\S", description });

export const syncedCommand = defineTool({
  name: "lyrics_synced",
  title: "Synced Lyrics",
  description: "Fetch synchronized (LRC) lyrics for a track",
  effect: "read",
  openWorld: true,
  input: Type.Object(
    {
      artist: filled("Performing artist"),
      track: filled("Track title"),
      provider: Type.Optional(
        filled("Provider; omit to walk the providers that serve synced lyrics"),
      ),
      at: Type.Optional(
        Type.Number({
          minimum: 0,
          maximum: 36_000,
          description: "Print only the line playing at this offset in seconds",
        }),
      ),
      duration: Type.Optional(
        Type.Number({
          exclusiveMinimum: 0,
          maximum: 36_000,
          description: "Track length in seconds, to pick between recordings",
        }),
      ),
    },
    { additionalProperties: false },
  ),
  cli: { command: "synced", positional: ["artist", "track"] },
  execute: async (params, { signal }) => (await loadOperations()).synced(params, signal),
});
