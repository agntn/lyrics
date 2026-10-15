/** OMP extension: Lyrics - unified song lyrics tools. */
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { registerOmpTools } from "@agntn/tools/omp";
import type { ExtensionAPI } from "@oh-my-pi/pi-coding-agent";

import type * as LyricsTools from "../../dist/tools.d.mts";

/** Longest argument on the status line, cut before the adapter's sanitizer sees it. */
const PREVIEW_LENGTH = 80;

const sourceModulePath = fileURLToPath(new URL("../../src/tools.ts", import.meta.url));

/** Source in a checkout, build in the package; compiled OMP resolves only literal specifiers. */
function loadTools(): Promise<typeof LyricsTools> {
  return (
    existsSync(sourceModulePath) ? import("../../src/tools.ts") : import("../../dist/tools.mjs")
  ) as Promise<typeof LyricsTools>;
}

type Args = Readonly<Record<string, unknown>>;

function song(args: Args, suffix = ""): string {
  return `${String(args["artist"])} - ${String(args["track"])}${suffix}`.slice(0, PREVIEW_LENGTH);
}

const describeCall: Record<string, (args: Args) => string> = {
  lyrics_providers: () => "registered providers",
  lyrics_search: (args) => String(args["query"]).slice(0, PREVIEW_LENGTH),
  lyrics_get: (args) => song(args),
  lyrics_line_at: (args) => song(args, ` @ ${String(args["seconds"])}s`),
};

/** Register the lyrics tools with the OMP host; the library loads on the first call. */
export default async function lyricsExtension(pi: ExtensionAPI): Promise<void> {
  pi.setLabel("Lyrics");
  const { lyricsTools } = await loadTools();
  registerOmpTools(pi, lyricsTools, {
    Text: pi.pi.Text,
    renderers: Object.fromEntries(
      Object.entries(describeCall).map(([name, describe]) => [name, { describeCall: describe }]),
    ),
  });
}
