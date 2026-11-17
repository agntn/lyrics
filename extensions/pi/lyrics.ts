/** Pi extension: Lyrics - unified song lyrics tools */
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { registerPiTools } from "@agntn/tools/pi";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

import type * as LyricsTools from "../../dist/tools.d.mts";

const sourceModuleUrl = new URL("../../src/tools.ts", import.meta.url);
const distributionModuleUrl = new URL("../../dist/tools.mjs", import.meta.url);

/** Load the definitions from the source in a checkout and from the build in the package. */
function loadTools(): Promise<typeof LyricsTools> {
  return import(
    existsSync(fileURLToPath(sourceModuleUrl)) ? sourceModuleUrl.href : distributionModuleUrl.href
  ) as Promise<typeof LyricsTools>;
}

/** Register the lyrics tools; the library loads on the first call. */
export default async function lyricsExtension(pi: ExtensionAPI): Promise<void> {
  const { lyricsTools } = await loadTools();
  registerPiTools(pi, lyricsTools);
}
