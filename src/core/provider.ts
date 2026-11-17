import type {
  Lyrics,
  ProviderCapabilities,
  ProviderConfig,
  SearchOptions,
  TrackMatch,
  TrackQuery,
} from "./types.ts";
import { getJSON, getText } from "./client.ts";
import type { ClientOptions } from "./client.ts";

/** What a provider may set on one request. The name and the timeout are the provider's own. */
interface RequestOptions {
  readonly headers?: Readonly<Record<string, string>>;
  readonly signal?: AbortSignal;
}
import { InvalidInputError, UnsupportedOperationError } from "./errors.ts";

/**
 * Common API for lyrics backends.
 *
 * A provider holds backend configuration, not a track. Every provider serves `lyrics()`; the
 * other operations are optional, so check `capabilities` - or go through `requireOperation` -
 * before using one.
 */
export abstract class Provider {
  private readonly timeout: number | undefined;
  private readonly signal: AbortSignal | undefined;

  constructor(config: ProviderConfig = {}) {
    this.timeout = config.timeout;
    this.signal = config.signal;
  }

  /**
   * Registry key owned by the concrete class.
   *
   * @returns {string} The key.
   */
  get name(): string {
    return (this.constructor as ProviderConstructor).key;
  }

  /** Operations this provider can actually serve. */
  abstract get capabilities(): ProviderCapabilities;

  /** Fetch the text of one track. */
  abstract lyrics(query: TrackQuery): Promise<Lyrics>;

  /** List tracks matching a free-form query, best match first. */
  search?(query: string, options?: SearchOptions): Promise<TrackMatch[]>;

  /**
   * Execute a provider-attributed GET request for JSON using the configured timeout and signal.
   *
   * @param url - Absolute request URL.
   * @param options - Headers and a signal for this request.
   * @returns {Promise<T>} The parsed body.
   */
  protected getJSON<T>(url: string, options?: RequestOptions): Promise<T> {
    return getJSON<T>(url, this.requestOptions(options));
  }

  /**
   * Execute a provider-attributed GET request for an HTML page.
   *
   * @param url - Absolute request URL.
   * @param options - Headers and a signal for this request.
   * @returns {Promise<string>} The page.
   */
  protected getText(url: string, options?: RequestOptions): Promise<string> {
    return getText(url, this.requestOptions(options));
  }

  /**
   * Attribute a request to this provider. Its signal and the configured one both cancel it.
   *
   * @param options - Headers and a signal for this request.
   * @returns {ClientOptions} The options the client gets.
   */
  private requestOptions(options?: RequestOptions): ClientOptions {
    const signals = [options?.signal, this.signal].filter((signal) => signal !== undefined);
    return {
      ...options,
      signal: signals.length > 1 ? AbortSignal.any(signals) : signals[0],
      timeout: this.timeout,
      provider: this.name,
    };
  }
}

/** Concrete provider class accepted by the registry. */
export interface ProviderConstructor {
  /** Stable registry key owned by the concrete class. */
  readonly key: string;
  /**
   * Environment variable holding this provider's credential, or absent when it needs none.
   *
   * Auto-selection reads it off the class, so a provider registered from outside this package
   * takes part in credential-aware selection on the same terms as a built-in one.
   */
  readonly envKey?: string;
  new (config: ProviderConfig): Provider;
}

/**
 * Reject an empty or whitespace-only search query before any request is sent.
 *
 * @throws {InvalidInputError} When `query` carries no content.
 * @param query - The search query.
 * @param provider - Provider to name in the error.
 */
export function assertQuery(query: string, provider: string): void {
  if (!query.trim()) {
    throw new InvalidInputError("query is empty", provider);
  }
}

/**
 * Reject a track query that cannot identify a recording.
 *
 * Every provider matches on artist and title, so both must carry content even when the caller
 * also passes a provider-native `id`.
 *
 * @throws {InvalidInputError} When artist or track is missing or blank.
 * @param query - The track query.
 * @param provider - Provider to name in the error.
 */
export function assertTrackQuery(query: TrackQuery, provider: string): void {
  if (!query.artist?.trim()) {
    throw new InvalidInputError("artist is empty", provider);
  }
  if (!query.track?.trim()) {
    throw new InvalidInputError("track is empty", provider);
  }
  if (query.duration !== undefined && (!Number.isFinite(query.duration) || query.duration <= 0)) {
    throw new InvalidInputError(
      `duration must be a positive number of seconds, got ${query.duration}`,
      provider,
    );
  }
}

/** Operation names accepted by `requireOperation` - one per provider method. */
export type ProviderOperation = "search" | "lyrics";

/**
 * Return a bound provider method after checking its capability flag.
 *
 * The runtime check covers both halves of the contract: a provider that advertises an operation
 * it never implemented fails here rather than as `undefined is not a function` deeper in a call.
 *
 * @throws {UnsupportedOperationError} When the provider does not serve the operation.
 * @param provider - The provider to ask.
 * @param operation - `search` or `lyrics`.
 * @returns {NonNullable<Provider[K]>} The method, bound to the provider.
 */
export function requireOperation<K extends ProviderOperation>(
  provider: Provider,
  operation: K,
): NonNullable<Provider[K]> {
  const method = provider[operation];
  if (!provider.capabilities[operation] || typeof method !== "function") {
    throw new UnsupportedOperationError(operation, provider.name);
  }
  return method.bind(provider) as NonNullable<Provider[K]>;
}
