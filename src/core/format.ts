/** Plain-text formatters shared by the CLI, MCP server, AI tools, and agent extensions. */

import type { FallbackResult, ProviderOutcome } from "./all.ts";
import type { ProviderListing } from "./registry.ts";
import { formatDuration } from "./text.ts";
import type { Lyrics, TrackMatch } from "./types.ts";

/** One-line label for a track in a list of matches. */
export function formatTrackLine(match: TrackMatch): string {
  const details = [
    match.album,
    match.duration !== undefined ? formatDuration(match.duration) : undefined,
    match.instrumental ? "instrumental" : undefined,
    match.id !== undefined ? `id=${match.id}` : undefined,
  ].filter(Boolean);
  const tail = details.length > 0 ? `  (${details.join(", ")})` : "";
  return `${match.artist} - ${match.track}${tail}`;
}

/** Multi-line listing of search matches for a query. */
export function formatTracks(providerName: string, query: string, matches: TrackMatch[]): string {
  if (matches.length === 0) return `[${providerName}] No matches for "${query}"`;
  const lines = matches.map((match) => formatTrackLine(match));
  return `[${providerName}] ${matches.length} matches for "${query}":\n${lines.join("\n")}`;
}

/** Header line naming the track a lyrics result belongs to. */
export function formatLyricsHeader(lyrics: Lyrics): string {
  const details = [
    lyrics.album,
    lyrics.duration !== undefined ? formatDuration(lyrics.duration) : undefined,
    lyrics.partial ? "excerpt only" : undefined,
    lyrics.synced ? "synced available" : undefined,
  ].filter(Boolean);
  const tail = details.length > 0 ? `  (${details.join(", ")})` : "";
  return `[${lyrics.provider}] ${lyrics.artist} - ${lyrics.track}${tail}`;
}

/**
 * Full lyrics rendering: header, text, then source and attribution.
 *
 * The source URL and the provider's attribution line travel with the text on every surface -
 * lyrics are somebody's copyrighted work, and the reader should always see where they came from.
 */
export function formatLyrics(lyrics: Lyrics, options?: { synced?: boolean }): string {
  const body = lyrics.instrumental
    ? "(instrumental - no lyrics)"
    : ((options?.synced ? lyrics.synced : undefined) ??
      lyrics.plain ??
      lyrics.synced ??
      "(no text returned)");
  return [
    formatLyricsHeader(lyrics),
    "",
    body,
    "",
    lyrics.url ? `Source: ${lyrics.url}` : null,
    lyrics.attribution ? lyrics.attribution : null,
  ]
    .filter((line) => line !== null)
    .join("\n");
}

/** Translation rendering, or a clear note when the provider returned none. */
export function formatTranslation(lyrics: Lyrics): string {
  if (!lyrics.translation) {
    return `${formatLyricsHeader(lyrics)}\n\n(no translation from ${lyrics.provider})`;
  }
  return [
    formatLyricsHeader(lyrics),
    "",
    lyrics.translation,
    "",
    lyrics.url ? `Source: ${lyrics.url}` : null,
  ]
    .filter((line) => line !== null)
    .join("\n");
}

/** Side-by-side search results from every registered provider, failures included. */
export function formatSearchAll(query: string, outcomes: ProviderOutcome<TrackMatch[]>[]): string {
  return outcomes
    .map((outcome) =>
      outcome.error
        ? `[${outcome.provider}] error: ${outcome.error.message}`
        : formatTracks(outcome.provider, query, outcome.result),
    )
    .join("\n\n");
}

/** Side-by-side lyrics from every registered provider, failures included. */
export function formatLyricsAll(outcomes: ProviderOutcome<Lyrics>[]): string {
  return outcomes
    .map((outcome) =>
      outcome.error
        ? `[${outcome.provider}] error: ${outcome.error.message}`
        : formatLyrics(outcome.result),
    )
    .join("\n\n");
}

/** Lyrics from a fallback walk, prefixed with the providers that were passed over. */
export function formatFallback(result: FallbackResult, options?: { synced?: boolean }): string {
  const skipped = result.skipped.map((entry) => `[${entry.provider}] skipped: ${entry.error}`);
  return [...skipped, skipped.length > 0 ? "" : null, formatLyrics(result.lyrics, options)]
    .filter((line) => line !== null)
    .join("\n");
}

/** Multi-line listing of registered providers and what each can serve. */
export function formatProviders(listings: ProviderListing[]): string {
  const lines = listings.map((listing) => {
    const capabilities = Object.entries(listing.capabilities)
      .filter(([, enabled]) => enabled)
      .map(([operation]) => operation)
      .join(", ");
    const credential = listing.envKey
      ? listing.configured
        ? ` [${listing.envKey} set]`
        : ` [needs ${listing.envKey}]`
      : "";
    return `  ${listing.name}: ${capabilities || "(nothing)"}${credential}`;
  });
  return `Registered providers (${listings.length}):\n${lines.join("\n")}`;
}
