# Lyrics

Six lyrics sites, one shape.

No single site has every song, and the API you would reach for first, Genius, serves everything about a track except its actual words. So a lookup that works in practice means trying several backends and knowing what each one will refuse. That is this library: six providers behind one TypeScript API and one CLI, walked in order until one has the track.

## Features

- **Six providers, one contract.** LRCLIB, lyrics.ovh, Genius, Tekstowo.pl, AZLyrics and Musixmatch.
- **Works before the first key.** Four of the six need no credentials at all, so `lyrics get Radiohead Creep` works on a fresh checkout.
- **Falls through misses.** No single site has everything. Without an explicit provider, a lookup walks the registry until one has the song, and reports which providers it passed over.
- **Synchronized lyrics.** LRCLIB serves LRC, and `parseLrc`, `lrcToPlain` and `lineAt` read it locally - no key, no network, no rate limit.
- **Translations.** Tekstowo.pl carries community translations, exposed as `translation` on the result.
- **Failures say which kind they are.** "This site has no such song" and "this site changed its layout" are different problems with different fixes, so they are `NotFoundError` and `ParseError`, never one vague failure. Asking a provider for something it does not serve fails before the request, not halfway through it.
- **Attribution travels with the text.** Every result carries the source URL and the provider's attribution line, and every text surface prints them under the lyrics.
- **Five surfaces, one core.** Terminal, TypeScript, MCP client, Pi, OMP and the Vercel AI SDK all go through the same selection and formatting code, so none of them can drift into its own behaviour.
- **Keys never leak.** The Musixmatch key rides in a query param, which means every failed request would otherwise print it. Redaction happens in the error constructor, so there is no call site left to forget it.

## Install

```bash
pnpm add @agntn/lyrics
```

Requires Node.js 24 or newer.

## CLI

```bash
npx @agntn/lyrics providers
npx @agntn/lyrics get "Radiohead" "Creep"
npx @agntn/lyrics get "Kult" "Arahja" -p tekstowo --translation
npx @agntn/lyrics search "radiohead creep" -n 5
npx @agntn/lyrics synced "Radiohead" "Creep" --at 45
```

### Commands

| Command     | What it does                                    | Example                                 |
| ----------- | ----------------------------------------------- | --------------------------------------- |
| `get`       | Lyrics of one track                             | `lyrics get "Kult" "Arahja"`            |
| `search`    | Tracks matching a free-form query               | `lyrics search "arahja"`                |
| `synced`    | LRC lyrics, or the line at a given second       | `lyrics synced "Kult" "Arahja" --at 45` |
| `providers` | Registered providers, capabilities, credentials | `lyrics providers`                      |
| `mcp`       | MCP server over stdio                           | `lyrics mcp`                            |

### Common options

| Option              | Meaning                                                                    |
| ------------------- | -------------------------------------------------------------------------- |
| `-p, --provider`    | Provider key, or `all` to compare every provider. Omit to walk until a hit |
| `-d, --duration`    | Track length in seconds, to pick between recordings of the same title      |
| `-s, --synced`      | Print the synchronized text when the provider has it                       |
| `-t, --translation` | Print the translation instead of the original                              |
| `-n, --limit`       | Maximum number of results for `search`                                     |
| `--at`              | Offset in seconds for `synced`                                             |

## Providers

| Provider     | Credential            | search | lyrics | synced | translation | Notes                                          |
| ------------ | --------------------- | :----: | :----: | :----: | :---------: | ---------------------------------------------- |
| `lrclib`     | none                  |   ✓    |   ✓    |   ✓    |             | Open community database; plain and LRC         |
| `lyricsovh`  | none                  |        |   ✓    |        |             | One endpoint: artist plus title, or a 404      |
| `genius`     | `GENIUS_ACCESS_TOKEN` |   ✓    |   ✓    |        |             | Token for search; text read off the song page  |
| `tekstowo`   | none                  |   ✓    |   ✓    |        |      ✓      | Polish catalogue with community translations   |
| `azlyrics`   | none                  |        |   ✓    |        |             | Deterministic page URL; strong older catalogue |
| `musixmatch` | `MUSIXMATCH_API_KEY`  |   ✓    |   ✓    |        |             | Licensed API; the free plan returns an excerpt |

Without `--provider`, requests go to the first registered provider that serves the operation and has whatever credential it needs. A configured key _adds_ a provider rather than taking over: on the free Musixmatch plan a key buys an excerpt where keyless LRCLIB returns the whole song, so promoting the keyed provider would be a downgrade.

## Library

```ts
import { lyricsWithFallback, lineAt, parseLrc } from "@agntn/lyrics";

const { provider, lyrics, skipped } = await lyricsWithFallback({
  artist: "Radiohead",
  track: "Creep",
  duration: 239,
});

console.log(provider, lyrics.url, lyrics.attribution);
if (lyrics.synced) console.log(lineAt(lyrics.synced, 45), parseLrc(lyrics.synced).length);
```

Pick one backend explicitly when you care which catalogue answers:

```ts
import { create, requireOperation, searchAll } from "@agntn/lyrics";

const matches = await create("tekstowo").search?.("kult arahja");
const outcomes = await searchAll("creep"); // every provider in parallel, failures included
const song = await requireOperation(
  create("lrclib"),
  "lyrics",
)({
  artist: "Radiohead",
  track: "Creep",
});
```

## MCP server

```bash
claude mcp add lyrics --scope user -- npx -y @agntn/lyrics mcp
```

Tools: `lyrics_providers`, `lyrics_search`, `lyrics_get`, `lyrics_line_at`. All read-only; `lyrics_line_at` runs locally on LRC text you already have.

## Agent extensions

```bash
pi install @agntn/lyrics     # Pi
omp install @agntn/lyrics    # OMP
```

Both register `lyrics_get`, `lyrics_search`, `lyrics_line_at` and `lyrics_providers`.

## Copyright

Song lyrics are copyrighted works. This library fetches them from services that host them; it does not license them to you.

- Results carry `url` and `attribution`, and every text surface prints them under the lyrics. Keep them there.
- `genius`, `tekstowo` and `azlyrics` read the sites' HTML. Their terms of service restrict automated access, and the selectors break whenever a layout changes - that surfaces as `ParseError`, not as a missing song.
- `musixmatch` is the licensed path. Its free plan returns an excerpt, which the result marks with `partial: true`.
- Quote the shortest excerpt your task needs. Reproducing whole songs is what rights holders object to, and the agent extensions say so in their prompt guidelines.

Which of these is acceptable is your call as the operator, not this library's.

## License

MIT
