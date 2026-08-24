/**
 * Self-registering provider imports - each import triggers register().
 *
 * Order matters: it is the order `resolveProvider` and `lyricsWithFallback` walk. Keyless
 * providers that return a complete song come first, the excerpt-only licensed API last.
 */
import "./lrclib.ts";
import "./lyricsovh.ts";
import "./genius.ts";
import "./tekstowo.ts";
import "./azlyrics.ts";
import "./musixmatch.ts";
