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

/**
 * Run one operation on every registered provider in parallel.
 *
 * @param run - The operation.
 * @param signal - Cancels every request.
 * @returns {Promise<ProviderOutcome<T>[]>} One outcome per provider, in registration order.
 */
async function runAll<T>(
  run: (provider: Provider) => Promise<T>,
  signal?: AbortSignal,
): Promise<ProviderOutcome<T>[]> {
  return Promise.all(
    providers().map(async (name): Promise<ProviderOutcome<T>> => {
      try {
        return { provider: name, result: await run(create(name, { signal })) };
      } catch (error) {
        return { provider: name, error: normalizeError(error, name) };
      }
    }),
  );
}

/**
 * Search every registered provider in parallel. Aborting `signal` cancels every request.
 *
 * @example
 *   ```ts
 *   import { searchAll } from "@agntn/lyrics";
 *
 *   const outcomes = await searchAll("creep radiohead", { limit: 3 });
 *   ```
 *
 * @param query - Free-form search query.
 * @param options - Result limit.
 * @param signal - Cancels every request.
 * @returns {Promise<ProviderOutcome<TrackMatch[]>[]>} Each provider's matches or failure.
 */
export function searchAll(
  query: string,
  options?: SearchOptions,
  signal?: AbortSignal,
): Promise<ProviderOutcome<TrackMatch[]>[]> {
  return runAll((provider) => requireOperation(provider, "search")(query, options), signal);
}

/**
 * Fetch one track's lyrics from every registered provider in parallel, for comparison.
 *
 * @param query - The track to look up.
 * @param signal - Cancels every request.
 * @returns {Promise<ProviderOutcome<Lyrics>[]>} Each provider's lyrics or failure.
 */
export function lyricsAll(
  query: TrackQuery,
  signal?: AbortSignal,
): Promise<ProviderOutcome<Lyrics>[]> {
  return runAll((provider) => requireOperation(provider, "lyrics")(query), signal);
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
 * An aborted `signal` stops it too: the provider it reached fails, and nobody after it is asked.
 *
 * @example
 *   ```ts
 *   import { lyricsWithFallback } from "@agntn/lyrics";
 *
 *   const { provider, lyrics } = await lyricsWithFallback({ artist: "Radiohead", track: "Creep" });
 *   ```
 *
 * @param query - The track to look up.
 * @param order - Registry keys to try; every provider by default.
 * @param signal - Stops the walk at the provider it reached.
 * @returns {Promise<FallbackResult>} The lyrics and the providers passed over before them.
 * @throws {LyricsError} The last failure, when no provider could serve the track.
 */
export async function lyricsWithFallback(
  query: TrackQuery,
  order: readonly string[] = providers(),
  signal?: AbortSignal,
): Promise<FallbackResult> {
  const skipped: { provider: string; error: string }[] = [];
  let lastError: LyricsError | undefined;

  for (const name of order) {
    try {
      const lyrics = await requireOperation(create(name, { signal }), "lyrics")(query);
      return { provider: name, lyrics, skipped };
    } catch (error) {
      const normalized = normalizeError(error, name);
      lastError = normalized;
      if (signal?.aborted || !isSkippable(normalized)) throw normalized;
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

/**
 * Whether the walk moves on after this failure.
 *
 * @param error - A normalized failure.
 * @returns {boolean} True for a failure that only says this provider lacks the song.
 */
function isSkippable(error: LyricsError): boolean {
  return SKIPPABLE_ERRORS.has(error.name);
}

/**
 * Reduce outcomes to a JSON-safe shape for MCP and AI tool results.
 *
 * @param outcomes - Outcomes from a fan-out.
 * @returns {SerializedOutcome<T>[]} The outcomes with errors reduced to their messages.
 */
export function serializeOutcomes<T>(
  outcomes: readonly ProviderOutcome<T>[],
): SerializedOutcome<T>[] {
  return outcomes.map((outcome) =>
    outcome.error
      ? { provider: outcome.provider, error: outcome.error.message }
      : { provider: outcome.provider, result: outcome.result },
  );
}
