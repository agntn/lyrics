/** Executors behind the lyrics tools: one text for every host, the data as details. */

import { stripVTControlCharacters } from "node:util";
import { sanitizeLine, type Static, type ToolResult } from "@agntn/tools";
import {
  lyricsAll,
  lyricsWithFallback,
  searchAll,
  serializeOutcomes,
  type SerializedOutcome,
} from "./core/all.ts";
import {
  formatFallback,
  formatLyrics,
  formatLyricsAll,
  formatLyricsFooter,
  formatProviders,
  formatSearchAll,
  formatTracks,
  formatTranslation,
} from "./core/format.ts";
import { requireOperation } from "./core/provider.ts";
import { listProviders, type ProviderListing } from "./core/registry.ts";
import { isAllProviders, providerArg, selectProvider, usableProviders } from "./core/resolve.ts";
import { formatDuration, lineAt as findLine, parseLrc, type SyncedLine } from "./core/text.ts";
import type { Lyrics, TrackMatch, TrackQuery } from "./core/types.ts";
import type { getSchema, lineAtSchema, searchSchema } from "./tools.ts";
import "./providers/index.ts";

export interface ProvidersDetails {
  providers: ProviderListing[];
}

export type SearchDetails =
  | { provider: string; matches: TrackMatch[] }
  | { comparison: SerializedOutcome<TrackMatch[]>[] };

export type LyricsDetails =
  | { provider: string; lyrics: Lyrics; skipped?: { provider: string; error: string }[] }
  | { comparison: SerializedOutcome<Lyrics>[] };

export interface LineAtDetails {
  provider: string;
  seconds: number;
  /** The line sung at `seconds`, or null before the first one and when nothing is synced. */
  line: SyncedLine | null;
  totalLines: number;
}

/** What `lyrics synced` prints from: the whole LRC, or the one line at `at`. */
export interface SyncedInput {
  readonly artist: string;
  readonly track: string;
  readonly provider?: string;
  readonly at?: number;
  readonly duration?: number;
}

/** What `lyrics synced` answers with: the provider and its LRC, null when it has none. */
export interface SyncedDetails {
  provider: string;
  synced: string | null;
}

/** Controls but tab and newline, plus the bidi marks that reorder a line. */
const UNPRINTABLE =
  /* oxlint-disable-next-line no-control-regex */
  /[\u0000-\u0008\u000B-\u001F\u007F-\u009F؜‎‏‪-‮⁦-⁯]/g;

/** ESC and C1 CSI, which open every sequence worth stripping. */
/* oxlint-disable-next-line no-control-regex */
const ESCAPE_OPENER = /[\u001B\u009B]/;

/** Longest line `stripVTControlCharacters` gets, quadratic as it is on an unclosed sequence. */
const MAX_ESCAPED_LINE = 2000;

function stripEscapes(line: string): string {
  if (!ESCAPE_OPENER.test(line)) return line;
  const chars = Array.from(line);
  const bounded =
    chars.length > MAX_ESCAPED_LINE ? `${chars.slice(0, MAX_ESCAPED_LINE).join("")}…` : line;
  return stripVTControlCharacters(bounded);
}

/**
 * Scraped text meets the terminal here: verses stay, escapes and bidi tricks don't.
 *
 * @param text - The text every host prints.
 * @param details - The data behind it.
 * @param isError - Marks the answer as a failure.
 * @returns {ToolResult<Details>} The tool result.
 */
function answer<Details>(text: string, details: Details, isError?: true): ToolResult<Details> {
  const clean = text
    .replaceAll(/\r\n?/g, "\n")
    .split("\n")
    .map(stripEscapes)
    .join("\n")
    .replaceAll(UNPRINTABLE, "")
    .replaceAll(/[\u2028\u2029]/g, " ");
  return { content: [{ type: "text", text: clean }], details, ...(isError && { isError }) };
}

/** Caller text comes back in headers and errors, so a newline in it would forge a reply line. */
function line(value: string): string;
function line(value: string | undefined): string | undefined;
function line(value: string | undefined): string | undefined {
  return value === undefined ? undefined : sanitizeLine(value);
}

/**
 * Walks the providers that serve synced lyrics, or asks the one the caller named.
 *
 * @param query - The track query.
 * @param provider - A provider the caller named, blank for none.
 * @param signal - Cancels the requests.
 * @returns {Promise<Lyrics>} The lyrics, synced or not.
 */
async function fetchSynced(
  query: TrackQuery,
  provider: string | undefined,
  signal?: AbortSignal,
): Promise<Lyrics> {
  if (providerArg(provider)) {
    return requireOperation(selectProvider(provider, "lyrics", signal).provider, "lyrics")(query);
  }
  return (await lyricsWithFallback(query, usableProviders("synced"), signal)).lyrics;
}

/**
 * The line at `seconds` with its timestamp, or a note that nobody sings there yet.
 *
 * @param line - The line `lineAt` found.
 * @param seconds - The offset that was asked for.
 * @returns {string} One line of text.
 */
function lineText(line: SyncedLine | undefined, seconds: number): string {
  return line ? `[${formatDuration(line.time)}] ${line.text}` : `(nothing sung at ${seconds}s)`;
}

const PROVIDERS_HINT =
  "Pass a provider to choose one, provider 'all' to compare every provider, or leave it out to walk providers until one has the song.";

export async function providers(): Promise<ToolResult<ProvidersDetails>> {
  const listings = listProviders();
  return answer(`${formatProviders(listings)}\n\n${PROVIDERS_HINT}`, { providers: listings });
}

export async function search(
  params: Static<typeof searchSchema>,
  signal?: AbortSignal,
): Promise<ToolResult<SearchDetails>> {
  const query = line(params.query);
  const options = { limit: params.limit };
  const chosen = line(params.provider);
  if (isAllProviders(chosen)) {
    const outcomes = await searchAll(query, options, signal);
    return answer(formatSearchAll(query, outcomes), { comparison: serializeOutcomes(outcomes) });
  }
  const { name, provider } = selectProvider(chosen, "search", signal);
  const matches = await requireOperation(provider, "search")(query, options);
  return answer(formatTracks(name, query, matches), { provider: name, matches });
}

export async function get(
  params: Static<typeof getSchema>,
  signal?: AbortSignal,
): Promise<ToolResult<LyricsDetails>> {
  const query: TrackQuery = {
    artist: line(params.artist),
    track: line(params.track),
    album: line(params.album),
    duration: params.duration,
    id: line(params.id),
  };
  const view = { synced: params.synced === true };
  const translation = params.translation === true;
  const chosen = line(params.provider);

  if (isAllProviders(chosen)) {
    const outcomes = await lyricsAll(query, signal);
    return answer(formatLyricsAll(outcomes), { comparison: serializeOutcomes(outcomes) });
  }
  if (!providerArg(chosen)) {
    const order = translation ? usableProviders("translation") : undefined;
    const fallback = await lyricsWithFallback(query, order, signal);
    return answer(
      translation ? formatTranslation(fallback.lyrics) : formatFallback(fallback, view),
      { provider: fallback.provider, lyrics: fallback.lyrics, skipped: fallback.skipped },
    );
  }
  const { name, provider } = selectProvider(chosen, "lyrics", signal);
  const lyrics = await requireOperation(provider, "lyrics")(query);
  return answer(translation ? formatTranslation(lyrics) : formatLyrics(lyrics, view), {
    provider: name,
    lyrics,
  });
}

export async function lineAt(
  params: Static<typeof lineAtSchema>,
  signal?: AbortSignal,
): Promise<ToolResult<LineAtDetails>> {
  const query = {
    artist: line(params.artist),
    track: line(params.track),
    duration: params.duration,
  };
  const lyrics = await fetchSynced(query, line(params.provider), signal);
  const { seconds } = params;
  if (!lyrics.synced) {
    return answer(`No synchronized lyrics from ${lyrics.provider} for this track`, {
      provider: lyrics.provider,
      seconds,
      line: null,
      totalLines: 0,
    });
  }
  const lines = parseLrc(lyrics.synced);
  const found = findLine(lines, seconds);
  return answer(`${lineText(found, seconds)}\n\n${formatLyricsFooter(lyrics)}`, {
    provider: lyrics.provider,
    seconds,
    line: found ?? null,
    totalLines: lines.length,
  });
}

/**
 * `lyrics synced`: the whole LRC, or the line at `at`; a track without timestamps fails.
 *
 * @param params - Track, provider and the optional offset.
 * @param signal - Cancels the requests.
 * @returns {Promise<ToolResult<SyncedDetails>>} The LRC or the one line, with its source.
 */
export async function synced(
  params: SyncedInput,
  signal?: AbortSignal,
): Promise<ToolResult<SyncedDetails>> {
  const query = {
    artist: line(params.artist),
    track: line(params.track),
    duration: params.duration,
  };
  const lyrics = await fetchSynced(query, line(params.provider), signal);
  if (!lyrics.synced) {
    return answer(
      `No synchronized lyrics from ${lyrics.provider} for this track`,
      { provider: lyrics.provider, synced: null },
      true,
    );
  }
  const body =
    params.at === undefined
      ? lyrics.synced
      : lineText(findLine(lyrics.synced, params.at), params.at);
  return answer(`${body}\n\n${formatLyricsFooter(lyrics)}`, {
    provider: lyrics.provider,
    synced: lyrics.synced,
  });
}
