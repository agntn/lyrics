# lyrics - AGENTS.md

## Scope

Unified song lyrics provider library. Normalizes track search and lyrics retrieval (plain, synchronized LRC, translation) across six backends, with LRC parsing in core. Exports a CLI (`lyrics` binary), a programmatic API, an MCP server (`@agntn/lyrics/mcp`), Vercel AI SDK tools (`@agntn/lyrics/ai`), and Pi/OMP extensions.

## Providers

| Provider   | Auth                  | Capabilities                | Notes                                               |
| ---------- | --------------------- | --------------------------- | --------------------------------------------------- |
| lrclib     | none                  | search, lyrics, synced      | Open database; `/api/get` is case-insensitive       |
| lyricsovh  | none                  | lyrics                      | Single endpoint, no metadata, no search             |
| genius     | `GENIUS_ACCESS_TOKEN` | search, lyrics              | API has no lyrics; text comes from the song page    |
| tekstowo   | none                  | search, lyrics, translation | HTML only; the sole provider with translations      |
| azlyrics   | none                  | lyrics                      | HTML only; page URL is a function of artist + title |
| musixmatch | `MUSIXMATCH_API_KEY`  | search, lyrics              | Errors ride in-body with HTTP 200; free plan clips  |

## API audit (2026-08-24)

Live verification performed before scaffolding, per the agntn scaffold procedure. Every provider below answered; two candidates were dropped.

- **LRCLIB** (`lrclib.net`): `/api/get?artist_name=&track_name=` and `/api/search?q=` verified 200 without a key. Matching is case-insensitive and `duration` is a hint, not a filter (a wrong duration still resolved). A miss is HTTP 404 with `{ message, name: "TrackNotFound", statusCode }`. Fields: `id, trackName, artistName, albumName, duration, instrumental, plainLyrics, syncedLyrics`. `/api/get/{id}` verified.
- **lyrics.ovh** (`api.lyrics.ovh/v1/{artist}/{title}`): 200 with a single `lyrics` field, 404 for a miss. No search endpoint, no metadata.
- **Genius** (`api.genius.com`): alive; without a token `/search` answers HTTP 401, so the token gates search only. The song page is public: `genius.com/{Artist-slug}-{title-slug}-lyrics` returned 200 and its text sits in three `[data-lyrics-container]` sections. Slug rules verified live - words joined by hyphens, only the first character capitalized, leading articles kept (`The-beatles-yesterday-lyrics` resolves, `Beatles-yesterday-lyrics` is a 404).
- **Tekstowo.pl**: song pages live at `/{artist-slug}/{title-slug}` (the legacy `/piosenka,artist,title.html` 301s there). Text is `#songText .inner-text`, translation `#translation .inner-text`, heading `h1` as "Artist - Title". Search is `/szukaj/{query}`: the first `div.content div.card` holds songs under an h2 "Znalezione utwory", the second holds artists - both use `a.title`, which is why results are also filtered by href shape (a song is `/artist/title`, an artist is `/artist`).
- **AZLyrics**: `lyrics/{artistslug}/{titleslug}.html` returned 200 for four checks. Slug is lowercase alphanumerics with no separator and a dropped leading "the" (`beatles/yesterday` resolves, `thebeatles/yesterday` is a 404). The text sits in the one class-less `div` of `div.col-xs-12.col-lg-8.text-center`.
- **Musixmatch**: alive and key-gated. The envelope `{ message: { header: { status_code }, body } }` and the in-body 401 were verified live with a bogus key; **field names inside `body` come from the vendor documentation and secondary sources, not from a live keyed response** - re-verify `lyrics_body`, `lyrics_copyright`, `track_list[].track` against a real key before trusting the mapping.
- **Dropped**: ChartLyrics (`api.chartlyrics.com` - 404 over http, no https listener) and Vagalume (`api.vagalume.com.br` - 503). Do not scaffold them without re-checking.
- **User-Agent**: the identifying `agntn-lyrics/<version> (+url)` string is accepted by all six backends, including the three HTML sites. There is no reason to imitate a browser - do not add one.

## Conventions

- Two operations only: `search(query, options)` and `lyrics(query)`. `ProviderOperation` is the pair of methods; `ProviderCapabilities` additionally carries `synced` and `translation`, which describe the result, not a method
- `lyrics` is abstract on `Provider`, `search` is an optional method - a provider that cannot search simply does not implement it, and `requireOperation()` checks the capability flag _and_ the method before returning it bound
- Provider construction never checks credentials. That keeps `create()` total, so `listProviders()` and `supportsOperation()` can answer for keyed providers too; a missing key surfaces as `AuthError` naming the variable when an operation needs it
- Credentials are declared as `static readonly envKey` on the provider class, not in a map in `resolve.ts`. Auto-selection reads it off the registry, so an externally registered provider participates on the same terms as a built-in one
- `usableProviders(capability)` in `core/resolve.ts` is the one list of providers that serve a capability and are usable now. It answers for all four capabilities, not just the two operations: `--translation` without a named provider walks only providers that have translations, which is the difference between reaching tekstowo and stopping at lrclib with nothing to show
- `providerArg()` normalizes a caller-supplied provider argument in one place. Every surface that answered "did the caller name a provider" with its own truthiness check drifted: `"  "` counted as a named provider on one surface and as absent on another
- Auto-selection is **registration order among usable candidates**, deliberately _not_ "configured keys first" as in `@agntn/maps`: a Musixmatch key buys an excerpt where keyless LRCLIB returns the whole song, so promoting a keyed provider would degrade the result. Registration order in `src/providers/index.ts` is therefore the fallback order and is load-bearing
- `lyricsWithFallback()` walks providers on `NotFoundError`, `AuthError`, `PaymentError`, `UnsupportedOperationError` and `ParseError` - "this one does not have it" - and rethrows anything else (rate limits, transport failures), because retrying those elsewhere hides a real problem
- HTML providers go through `core/html.ts`: `parseHtml()` substitutes `<br>` with a newline _before_ parsing (that is what preserves line structure; `.text` then decodes entities), and `requireLyrics()` raises `ParseError` when a selector matches nothing. Selectors live at the top of each provider file. `parseHtml()` is async and imports `node-html-parser` inside the call: a static value import anywhere in `src/` puts the 110 kB parser back into the entry chunk of every consumer bundle, and `test/unit/html.test.ts` fails on it
- `slugify()` lowercases first and maps the Latin letters Unicode does not decompose (`ł ø đ ħ ŧ æ œ ß`) before stripping diacritics - NFD alone drops `Ł` entirely and turns "Łukasz" into "ukasz"
- Error hierarchy: `LyricsError` → `HTTPError`, `AuthError`, `PaymentError` (402), `RateLimitError`, `NotFoundError`, `ParseError`, `UnsupportedOperationError`, `UnknownProviderError`, `InvalidInputError`; `normalizeError()` wraps everything at the client boundary. HTTP 403 maps to `AuthError`, not `PaymentError` - on a lyrics site a 403 is a refusal, and the one provider that charges reports that in its body
- `LyricsError` sanitizes messages: secret query params (`key`, `api[-_]key`, `secret`, `token`) are redacted, which covers the Musixmatch `apikey`
- `formatDuration()` truncates rather than rounds: a line starting at 20.5 s is already being sung at 0:20
- Every `Lyrics` carries `provider`, `url` and `attribution`, and `formatLyrics()` prints the last two under the text. Do not add a surface that drops them
- Internal imports use explicit `.ts` extensions (nodenext + `allowImportingTsExtensions`); `erasableSyntaxOnly` forbids parameter properties
- Provider registration is a class side effect: importing `src/providers/index.ts` triggers all `register()` calls - because of that, `package.json` must NOT declare `sideEffects: false`
- One obuild bundle with five inputs (`index`, `cli`, `mcp`, `ai`, `tools`) so every entry shares the chunk holding the registry
- Tools come from `@agntn/tools`: one `defineTool` per tool in `src/tools.ts`, handed to MCP (`createMcpServer`), Pi (`registerPiTools`), OMP (`registerOmpTools`), the AI SDK (`toAiTool`) and the CLI (`runCli`). Schemas use `Type` from `@agntn/tools`, never a bare `typebox` import, which OMP rewrites to its own facade. Validation lives in that core, so every surface rejects the same input before an executor runs
- Executors in `src/tool-operations.ts` load behind a cached dynamic import, so the extensions register tools without loading the providers. Each one returns the formatter text every host prints and the data as `details`; MCP sends only the text, the AI SDK gets `{ ...details, text }`, the CLI prints `details` with `--json`. Provider text goes through `answer()`, which keeps line breaks and strips escapes, C0/C1 controls and bidi marks. Caller text (query, artist, track, provider) goes through `sanitizeLine` from `@agntn/tools` first: it comes back in headers and errors, and since MCP gets text instead of JSON, a newline in it would forge a line of the reply
- `lyrics_line_at` fetches the synced lyrics itself and returns one line with its source, on every surface. A whole LRC never has to pass through the model to read one line
- Cancellation rides on `ProviderConfig.signal`: the base `Provider` adds it to every request, `selectProvider()` and the fan-out helpers in `core/all.ts` take it as their last argument, and every agent surface hands over its host's signal (the `@agntn/tools` adapters pass it to executors as `context.signal`). An aborted fallback walk stops at the provider it reached, whatever that provider threw
- `selectProvider()` in `core/resolve.ts` is the single selection path for the CLI, MCP, AI tools and both extensions; empty or whitespace-only arguments count as absent. The value `all` is reserved and tested with `isAllProviders()` before selection

## Key files

- `src/core/types.ts` - `TrackMatch`, `Lyrics`, `TrackQuery`, options, capabilities, config, `clampMaxResults`
- `src/core/provider.ts` - abstract `Provider`, `assertTrackQuery`, `requireOperation()` capability gate
- `src/core/text.ts` - `normalizeLyrics`, `parseLrc`, `lrcToPlain`, `lineAt`, `formatDuration` (all local, no network)
- `src/core/html.ts` - `parseHtml`, `selectLyrics`, `requireLyrics`, `slugify` - everything the scraping providers share
- `src/core/errors.ts` - error hierarchy + `normalizeError` + URL sanitization
- `src/core/registry.ts` - self-registering registry (register, create, providers, has, getEnvKey, supportsOperation, listProviders)
- `src/core/resolve.ts` - capability-aware selection: `usableProviders`, `providerArg`, `selectProvider`, `isAllProviders`; `isConfigured` lives in the registry and is re-exported here
- `src/core/all.ts` - `searchAll`, `lyricsAll`, `lyricsWithFallback`, `serializeOutcomes`
- `src/core/format.ts` - plain-text formatters shared by every output surface
- `src/core/client.ts` - native `fetch` wrapper: `getJSON` parses the body whatever its content type, `getText` keeps HTML a string; 15 s timeout joined with the caller's `signal`, no retry, identifying User-Agent. A 4xx or 5xx becomes a `ResponseError`, which `normalizeError()` classifies before it leaves the client
- `src/providers/*.ts` - one file per provider, self-registering via `register()`; order in `index.ts` is the fallback order
- `src/tools.ts` - the tool definitions and `loadOperations()`; `src/tool-operations.ts` - their executors
- `src/mcp.ts` - `createMcpServer()` over the same read-only tools
- `src/ai.ts` - Vercel AI SDK tool surface
- `src/cli.ts` - `runCli` builds one command per tool, plus `mcp`. `src/cli-commands.ts` holds `synced`, a CLI-only command over the same executors. Short flags and the joined `search` query come from the `short` and `rest` hints on each definition, so a new option takes its letter there
- `extensions/pi/lyrics.ts`, `extensions/omp/lyrics.ts` - agent extensions; they load the tool list from `src/tools.ts` in a checkout and `dist/tools.mjs` in the package. The OMP loader keeps both dynamic imports literal: `existsSync(src)` chooses `import("../../src/tools.ts")` or `import("../../dist/tools.mjs")`. OMP gets its `Text` from `pi.pi.Text`; no import from `@oh-my-pi/pi-coding-agent/tui`, which compiled OMP doesn't hand to extensions and which took the whole extension down before. An `import(url.href)` loses dependency resolution in the compiled binary

## Constraints

- **Lyrics are copyrighted.** Results carry `url` and `attribution` and every text surface prints them; the extensions tell the model to quote the shortest excerpt needed. No fixture in this repository contains real lyrics - `test/helpers.ts` exports invented placeholder lines, and new tests must use them rather than sampling a real song
- The three HTML providers depend on site layout. A selector change surfaces as `ParseError` with the page URL; fix the selector in the provider file and re-verify live before believing a test fixture
- Their terms of service restrict automated access. That is an operator decision, documented in the README, not something the library asserts a right to
- `Lyrics` carries no `raw` field. Providers keep their payload in `TrackMatch.raw` where it has a reader; on `Lyrics` nothing read it while every MCP and AI result serialized it, which tripled the response and put the whole song in the model's context twice
- Musixmatch free plan returns an excerpt closed by a `*******` banner; the provider cuts the banner and sets `partial: true`. Do not strip the flag to make output look complete
- Genius without a token derives the page URL from artist and title, which misses for songs whose Genius spelling differs. With a token the URL comes from the API. An `id` without a token raises `AuthError` rather than being silently ignored
- LRCLIB `/api/search` returns community records of uneven quality: some rows repeat the artist inside `trackName` ("Radiohead - Creep" as the title). That is the data, not the mapping - `/api/get` is the accurate path once artist and title are known
- Tests never hit the live sites: every provider test stubs `fetch`. `test/setup.ts` deletes `GENIUS_ACCESS_TOKEN` and `MUSIXMATCH_API_KEY` so a configured host cannot flip selection or leak live requests

## Testing

`pnpm test` (`vp test run`, 21 files / 291 tests, mocked via `vi.stubGlobal("fetch", ...)`; `client.test.ts` also runs the client against a loopback `node:http` server).

Packed-layout gate (manual): `pnpm pack`, install the tarball with `npm install --legacy-peer-deps` in an empty dir, register a custom provider through the main entry and confirm `lyrics_providers` from `@agntn/lyrics/mcp` lists it - this catches registry chunk splits, missing deps and broken `files`.

Pi 1.x: the Pi peer runs `>=0.84.2 <2` and the dev pin sits on 1.0.2, so `tsc` checks the extension against the 1.x types. On 2026-10-06 the packed tarball installed next to Pi 1.0.2 without `ERESOLVE`, and a real `pi -p` session listed the providers, got `Unknown provider` back as `isError` and read a line from LRCLIB. The fence moves to the next major only after that same session.

## Build & scripts

```bash
pnpm build       # obuild → dist/ (one bundle: index, cli, mcp, ai, tools)
pnpm typecheck   # tsc → build → tsc -p tsconfig.extensions.json
pnpm test        # vp test run
pnpm fmt         # build → vp lint --fix → vp fmt
pnpm lint        # build → vp lint → vp fmt --check
```
