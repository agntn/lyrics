# @agntn/lyrics

[![npm version](https://npmx.dev/api/registry/badge/version/@agntn/lyrics)](https://npmx.dev/package/@agntn/lyrics)
[![npm downloads](https://npmx.dev/api/registry/badge/downloads/@agntn/lyrics)](https://npmx.dev/package/@agntn/lyrics)
[![license](https://npmx.dev/api/registry/badge/license/@agntn/lyrics)](https://npmx.dev/package/@agntn/lyrics)
[![Ask DeepWiki](https://deepwiki.com/badge.svg)](https://deepwiki.com/agntn/lyrics)

🎵 Six lyrics providers. Ask for a song, get its words, timestamps and source when available.

## Why?

Genius knows plenty about a song, but its API won't give you the lyrics. Other sites have the words, each with its own catalogue and quirks. Apparently remembering the chorus was the easy part. This package puts six providers behind one TypeScript API and CLI.

## ✨ Features

- 🔎 **Find the track first.** Search by artist and title, then use a provider's track ID for a more specific lookup.
- 🔑 **Start without credentials.** LRCLIB, lyrics.ovh, Tekstowo and AZLyrics need no key.
- 🪜 **Try the next catalogue.** Lyrics lookups can skip missing tracks, auth failures, paywalls, unsupported operations and parse errors. Rate limits and transport failures still stop the call.
- ⏱️ **Follow the timestamps.** LRCLIB supplies LRC. Parse it or find the current line locally.
- 🌍 **Read a translation.** Tekstowo exposes community translations alongside the original text, when available.
- 🤖 **Bring your agent.** MCP, Pi, OMP and Vercel AI SDK tools sit alongside the CLI and library.
- 📎 **Keep the source attached.** Results can include source URLs and attribution. Keep them when displaying the text.

## 📦 Install

Requires Node.js 24 or newer.

```bash
pnpm add @agntn/lyrics
```

The package is not published to npm yet. Registry install commands here are for use after publication. For now, use the checkout instructions under Development.

## 🚀 First call

Start by checking which providers are available:

```bash
npx @agntn/lyrics providers
```

Output from the local build, with both credential variables unset:

```text
Registered providers (6):
  lrclib: search, lyrics, synced
  lyricsovh: lyrics
  genius: search, lyrics [needs GENIUS_ACCESS_TOKEN]
  tekstowo: search, lyrics, translation
  azlyrics: lyrics
  musixmatch: search, lyrics [needs MUSIXMATCH_API_KEY]

ℹ Use --provider <name> to select one, --provider all to compare every provider, or leave it out to walk providers until one has the song
```

No key needed for this check. After installation, use `pnpm exec lyrics` for the commands below.

### Commands

| Command     | What you get                                      | Example                                               |
| ----------- | ------------------------------------------------- | ----------------------------------------------------- |
| `get`       | One track's lyrics                                | `pnpm exec lyrics get "Radiohead" "Creep"`            |
| `search`    | Matching tracks                                   | `pnpm exec lyrics search "radiohead creep" -n 5`      |
| `synced`    | LRC, or the line at a given second                | `pnpm exec lyrics synced "Radiohead" "Creep" --at 45` |
| `providers` | Provider capabilities and credential requirements | `pnpm exec lyrics providers`                          |
| `mcp`       | MCP server over stdio                             | `pnpm exec lyrics mcp`                                |

Want a translation? Try `pnpm exec lyrics get "Kult" "Arahja" -p tekstowo --translation`. Use `get --help`, `search --help` or `synced --help` for each command's options.

`lyrics synced` prints a source footer after the LRC or selected line, including attribution when provided. Need just the LRC for a player? Use the library result's `synced` field.

## 🧠 Library

```ts
import { formatLyrics, lyricsWithFallback } from "@agntn/lyrics";

const { lyrics, skipped } = await lyricsWithFallback({
  artist: "Radiohead",
  track: "Creep",
  duration: 239,
});

console.log(formatLyrics(lyrics));
console.log(skipped);
```

You get the song and a record of providers passed over. `formatLyrics()` prints the source and attribution when provided. Need a particular catalogue? Use `create("lrclib").lyrics(query)` instead. For comparisons, `searchAll()` and `lyricsAll()` return each provider's result or error.

Already have LRC? No request needed. These lines are invented:

```ts
import { lineAt, parseLrc } from "@agntn/lyrics";

const lines = parseLrc("[00:10.00] The kettle joins the band\n[00:20.50] Nobody hired the spoon");
console.log(lineAt(lines, 21));
```

```text
{ time: 20.5, text: 'Nobody hired the spoon' }
```

See the [result types](./src/core/types.ts), [exports](./src/index.ts) and [LRC helpers](./src/core/text.ts) for the rest.

## 🗺️ Providers

| Provider     | Credentials                                   | Search | Lyrics | LRC | Translation |
| ------------ | --------------------------------------------- | :----: | :----: | :-: | :---------: |
| `lrclib`     | None                                          |   ✓    |   ✓    |  ✓  |             |
| `lyricsovh`  | None                                          |        |   ✓    |     |             |
| `genius`     | `GENIUS_ACCESS_TOKEN` for search or track IDs |   ✓    |   ✓    |     |             |
| `tekstowo`   | None                                          |   ✓    |   ✓    |     |      ✓      |
| `azlyrics`   | None                                          |        |   ✓    |     |             |
| `musixmatch` | `MUSIXMATCH_API_KEY`                          |   ✓    |   ✓    |     |             |

`get` tries providers in registration order. `search` selects the first usable search provider. Pass `-p all` to either command for comparison, or name one provider to avoid fallback. Adding a key doesn't promote that provider. See the [provider implementations](./src/providers).

Genius can fetch lyrics without a token using an artist/title URL, but spelling differences can make that miss. Musixmatch's free plan returns an excerpt marked `partial: true`.

## 🤖 Agents

Install the extension for your harness:

```bash
pi install @agntn/lyrics
omp install @agntn/lyrics
```

For an MCP client that accepts `mcpServers` configuration:

```json
{
  "mcpServers": {
    "lyrics": {
      "command": "npx",
      "args": ["-y", "@agntn/lyrics", "mcp"]
    }
  }
}
```

MCP and both extensions expose `lyrics_get`, `lyrics_search`, `lyrics_line_at` and `lyrics_providers`. The line lookup works locally on supplied LRC. Using Vercel AI SDK instead? Install the `ai` peer dependency and import tools from `@agntn/lyrics/ai`. See the [tool exports](./src/ai.ts) and [MCP server](./src/mcp.ts).

## 🚫 Copyright still applies

Fetching lyrics doesn't license them to you. Keep the source URL and attribution with any text you display. Quote only the shortest excerpt your task needs.

Genius, Tekstowo and AZLyrics read HTML. Their terms restrict automated access, and layout changes can cause `ParseError`. Musixmatch uses a licensed API, subject to its plan and terms. Choosing acceptable sources is your responsibility as the operator.

## 🧩 Adding a provider

Have another catalogue? Extend [Provider](./src/core/provider.ts), declare its capabilities and call [register()](./src/core/registry.ts). The [lyrics.ovh implementation](./src/providers/lyricsovh.ts) is a small example. Search is optional, lyrics retrieval isn't.

## 🛠️ Development

From a checkout:

```bash
pnpm install
pnpm build
node dist/cli.mjs providers
```

```bash
pnpm test       # Provider tests use mocked requests
pnpm typecheck  # Core and extension types, including a build
pnpm lint       # Lint and formatting checks
pnpm fmt        # Apply lint fixes and formatting
```

Tests use invented lyrics, not fragments of real songs. Please keep it that way.

## 💛 Thanks

[Claude for Open Source](https://claude.com/contact-sales/claude-for-oss) and [Codex for Open Source](https://developers.openai.com/community/codex-for-oss) help make this package possible. More time for the code, fewer tabs to juggle.

## 📄 License

[MIT](./LICENSE). The package's code, not the songs.
