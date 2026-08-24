/** Lyrics - unified song lyrics provider types */

/** A track a provider knows about, before its text is fetched. */
export interface TrackMatch {
  /** Performing artist as the provider spells it */
  artist: string;
  /** Track title as the provider spells it */
  track: string;
  /** Release the provider associates with the track */
  album?: string;
  /** Track length in seconds when the provider reports it */
  duration?: number;
  /** Provider-native identifier; pass it back as `TrackQuery.id` for an exact lookup */
  id?: string;
  /** Canonical page for the track on the provider */
  url?: string;
  /** True when the provider marks the recording as having no lyrics to show */
  instrumental?: boolean;
  /** Raw provider data */
  raw?: Record<string, unknown>;
}

/** Normalized lyrics for one track, with the attribution needed to display them. */
export interface Lyrics {
  /** Registry key of the provider that served the text */
  provider: string;
  /** Performing artist as the provider spells it */
  artist: string;
  /** Track title as the provider spells it */
  track: string;
  /** Release the provider associates with the track */
  album?: string;
  /** Track length in seconds when the provider reports it */
  duration?: number;
  /** Unsynchronized lyrics, newline separated; absent for an instrumental */
  plain?: string;
  /** Synchronized lyrics in LRC format when the provider serves them */
  synced?: string;
  /** Translated lyrics when the provider serves them alongside the original */
  translation?: string;
  /** True when the provider marks the recording as instrumental */
  instrumental: boolean;
  /** True when the provider returns an excerpt rather than the full text */
  partial: boolean;
  /** Page the text came from - keep it with the text wherever it is displayed */
  url?: string;
  /** Attribution or copyright line the provider asks callers to show */
  attribution?: string;
  /** Raw provider data */
  raw?: Record<string, unknown>;
}

/**
 * Identifies the track whose lyrics are wanted.
 *
 * `artist` and `track` are the portable pair every provider accepts. `id` and `duration` sharpen
 * the match on providers that support them and are ignored elsewhere.
 */
export interface TrackQuery {
  /** Performing artist */
  artist: string;
  /** Track title */
  track: string;
  /** Release name, used by providers that match on it */
  album?: string;
  /** Track length in seconds; LRCLIB uses it to pick between recordings */
  duration?: number;
  /** Provider-native identifier from a previous `search()` result */
  id?: string;
}

/** Options for `search()`. */
export interface SearchOptions {
  /** Max results; providers clamp to their own maximum */
  limit?: number;
}

/** Feature flags for what a provider can actually serve at runtime. */
export interface ProviderCapabilities {
  /** Can list tracks matching a free-form query */
  search: boolean;
  /** Can return the text of a track */
  lyrics: boolean;
  /** Can return synchronized (LRC) lyrics, not only plain text */
  synced: boolean;
  /** Can return a translation alongside the original text */
  translation: boolean;
}

/** Shared construction options. Providers ignore fields they cannot use. */
export interface ProviderConfig {
  /** API key or access token for providers that require one. */
  apiKey?: string;
  /** Custom API base URL when the provider supports an override. */
  baseUrl?: string;
  /** Request timeout in milliseconds. Defaults to 15 seconds. */
  timeout?: number;
}

/**
 * Round a requested result limit and keep it inside the provider's range.
 *
 * A missing or zero limit uses `max`.
 */
export function clampMaxResults(limit?: number, max = 10): number {
  if (!limit) return max;
  return Math.min(Math.max(1, Math.round(limit)), max);
}
