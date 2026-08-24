/** Fan-out helpers: compare every provider, or walk them until one has the track. */

import type { Provider } from "./provider.ts";
import type { Lyrics, SearchOptions, TrackMatch, TrackQuery } from "./types.ts";
import { LyricsError, NotFoundError, normalizeError } from "./errors.ts";
import { requireOperation } from "./provider.ts";
import { create, providers } from "./registry.ts";

/**
 * One provider's contribution to a comparison: either its result or its normalized failure.
 *
 * Failures stay in the list on purpose - a provider that needs a missing API key or does not
 * serve the operation is itself useful signal when comparing backends.
 */
export type ProviderOutcome<T> =
  | { provider: string; result: T; error?: never }
  | { provider: string; error: LyricsError; result?: never };

/** JSON-safe view of outcomes: errors reduced to their messages. */
export interface SerializedOutcome<T> {
  provider: string;
  result?: T;
  error?: string;
}

async function runAll<T>(run: (provider: Provider) => Promise<T>): Promise<ProviderOutcome<T>[]> {
  return Promise.all(
    providers().map(async (name): Promise<ProviderOutcome<T>> => {
      try {
        return { provider: name, result: await run(create(name)) };
      } catch (error) {
        return { provider: name, error: normalizeError(error, name) };
      }
    }),
  );
}

/**
 * Search every registered provider in parallel.
 *
 * @example
 *   ```ts
 *   import { searchAll } from "@agntn/lyrics";
 *
 *   const outcomes = await searchAll("creep radiohead", { limit: 3 });
 *   ```
 */
export function searchAll(
  query: string,
  options?: SearchOptions,
): Promise<ProviderOutcome<TrackMatch[]>[]> {
  return runAll((provider) => requireOperation(provider, "search")(query, options));
}

/** Fetch one track's lyrics from every registered provider in parallel, for comparison. */
export function lyricsAll(query: TrackQuery): Promise<ProviderOutcome<Lyrics>[]> {
  return runAll((provider) => requireOperation(provider, "lyrics")(query));
}

/** A successful fallback walk: the text plus the provider that finally had it. */
export interface FallbackResult {
  /** Registry key of the provider that answered */
  provider: string;
  /** The lyrics that provider returned */
  lyrics: Lyrics;
  /** Providers tried before it, with the reason each was passed over */
  skipped: { provider: string; error: string }[];
}

/**
 * Ask providers for a track in order until one has it.
 *
 * No single lyrics site has every song, which is the whole reason this library has more than
 * one provider. A missing track, a missing key, a paywalled plan, or a provider that cannot
 * serve lyrics at all moves the walk on to the next candidate; anything else - a rate limit, a
 * transport failure - stops it, because retrying those on another backend hides a real problem.
 *
 * @example
 *   ```ts
 *   import { lyricsWithFallback } from "@agntn/lyrics";
 *
 *   const { provider, lyrics } = await lyricsWithFallback({ artist: "Radiohead", track: "Creep" });
 *   ```
 *
 * @throws {LyricsError} The last failure, when no provider could serve the track.
 */
export async function lyricsWithFallback(
  query: TrackQuery,
  order: string[] = providers(),
): Promise<FallbackResult> {
  const skipped: { provider: string; error: string }[] = [];
  let lastError: LyricsError | undefined;

  for (const name of order) {
    try {
      const lyrics = await requireOperation(create(name), "lyrics")(query);
      return { provider: name, lyrics, skipped };
    } catch (error) {
      const normalized = normalizeError(error, name);
      lastError = normalized;
      if (!isSkippable(normalized)) throw normalized;
      skipped.push({ provider: name, error: normalized.message });
    }
  }

  throw lastError ?? new NotFoundError(`${query.artist} - ${query.track}`);
}

/**
 * Failures that mean "ask someone else" rather than "something is wrong".
 *
 * Matched by name rather than by `instanceof`: the registry accepts providers registered from
 * outside this package, and one loaded through a second copy of the module would throw errors
 * from a different set of classes that no `instanceof` here would recognize.
 */
const SKIPPABLE_ERRORS = new Set([
  "NotFoundError",
  "AuthError",
  "PaymentError",
  "UnsupportedOperationError",
  "ParseError",
]);

function isSkippable(error: LyricsError): boolean {
  return SKIPPABLE_ERRORS.has(error.name);
}

/** Reduce outcomes to a JSON-safe shape for MCP and AI tool results. */
export function serializeOutcomes<T>(outcomes: ProviderOutcome<T>[]): SerializedOutcome<T>[] {
  return outcomes.map((outcome) =>
    outcome.error
      ? { provider: outcome.provider, error: outcome.error.message }
      : { provider: outcome.provider, result: outcome.result },
  );
}
