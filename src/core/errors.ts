/** Lyrics error hierarchy */

/**
 * Base class for failures surfaced through Lyrics.
 *
 * Every message passes through `sanitizeUrl` here, so secret query params - the Musixmatch
 * `apikey` included - are redacted at one boundary instead of at each construction site.
 */
export class LyricsError extends Error {
  readonly provider?: string;

  constructor(message: string, provider?: string) {
    super(sanitizeUrl(message));
    this.name = "LyricsError";
    this.provider = provider;
  }
}

/**
 * Strip API keys from URLs and URL-bearing text for safe error messages.
 *
 * @param url - A URL, or text that may hold one.
 * @returns {string} The text with secret query values redacted.
 */
function sanitizeUrl(url: string): string {
  return url.replaceAll(/([?&])(api[-_]?key|key|secret|token)=[^&#]*/gi, "$1$2=REDACTED");
}

/** HTTP failure with a redacted request URL in its message and a redacted response body. */
export class HTTPError extends LyricsError {
  readonly statusCode: number;

  /** Request URL with secrets redacted. Non-enumerable to keep serialized errors compact. */
  readonly rawUrl: string;

  /** Response body, redacted in case the server echoes the request URL. */
  readonly body?: string;

  constructor(statusCode: number, url: string, body?: string, provider?: string) {
    super(`HTTP ${statusCode} from ${url}`, provider);
    this.statusCode = statusCode;
    if (body !== undefined) this.body = sanitizeUrl(body);
    this.rawUrl = sanitizeUrl(url);
    Object.defineProperty(this, "rawUrl", { enumerable: false });
    this.name = "HTTPError";
  }
}

/** Provider credentials were missing, rejected, or the provider refused the client. */
export class AuthError extends LyricsError {
  constructor(provider: string, detail?: string) {
    super(`Authentication failed for ${provider}${detail ? `: ${detail}` : ""}`, provider);
    this.name = "AuthError";
  }
}

/** Provider demands payment or a higher plan for the request. */
export class PaymentError extends LyricsError {
  readonly statusCode: number;

  constructor(provider: string, statusCode = 402) {
    super(`Payment required by ${provider} (HTTP ${statusCode})`, provider);
    this.statusCode = statusCode;
    this.name = "PaymentError";
  }
}

/** Provider refused a request because its rate limit was reached. */
export class RateLimitError extends LyricsError {
  readonly retryAfter?: number;

  constructor(provider: string, retryAfter?: number) {
    super(
      `Rate limited by ${provider}${retryAfter ? ` (retry after ${retryAfter}s)` : ""}`,
      provider,
    );
    this.retryAfter = retryAfter;
    this.name = "RateLimitError";
  }
}

/** The provider has no lyrics for the requested track. */
export class NotFoundError extends LyricsError {
  constructor(resource: string, provider?: string) {
    super(`Not found: ${resource}`, provider);
    this.name = "NotFoundError";
  }
}

/**
 * A page was served but its lyrics container was missing.
 *
 * This is the failure mode of the HTML-scraping providers: the site answered, so the request
 * itself was fine, but the layout no longer matches the selector. It is distinct from
 * `NotFoundError`, which means the site itself said it has no such track.
 */
export class ParseError extends LyricsError {
  /** Page whose markup could not be read. */
  readonly url?: string;

  constructor(detail: string, provider: string, url?: string) {
    super(`Could not read lyrics from ${provider}: ${detail}`, provider);
    this.url = url;
    this.name = "ParseError";
  }
}

/** Provider backend does not expose the requested operation. */
export class UnsupportedOperationError extends LyricsError {
  constructor(operation: string, provider: string) {
    super(`Operation "${operation}" not supported by ${provider}`, provider);
    this.name = "UnsupportedOperationError";
  }
}

/** Registry does not contain the requested provider name. */
export class UnknownProviderError extends LyricsError {
  constructor(provider: string) {
    super(`Unknown provider: ${provider}`, provider);
    this.name = "UnknownProviderError";
  }
}

/** Caller input failed validation before any request was sent. */
export class InvalidInputError extends LyricsError {
  constructor(message: string, provider?: string) {
    super(message, provider);
    this.name = "InvalidInputError";
  }
}

/** A 4xx or 5xx before `normalizeError` sorts it into the hierarchy. It never leaves the client. */
export class ResponseError extends Error {
  readonly status: number;
  readonly url: string;
  readonly body: string;
  readonly headers: Headers;

  constructor(status: number, url: string, body: string, headers: Headers) {
    super(`HTTP ${status} from ${url}`);
    this.status = status;
    this.url = url;
    this.body = body;
    this.headers = headers;
    this.name = "ResponseError";
  }
}

/** What a failure says about itself before it's sorted into the hierarchy. */
interface Failure {
  readonly message: string;
  readonly lower: string;
  readonly status: number;
  readonly url: string | undefined;
  /** Response body, when a response came back. */
  readonly body: string | undefined;
  /** The `retry-after` header as sent. */
  readonly retryAfter: string | undefined;
  readonly provider: string | undefined;
  /** The provider, or `unknown` for the classes that need a name. */
  readonly source: string;
}

/**
 * What a `ResponseError` knows that a bare message doesn't.
 *
 * @param error - The thrown value.
 * @returns {Partial<Failure>} Status, URL, body and `retry-after`, or nothing.
 */
function responseParts(error: unknown): Partial<Failure> {
  if (!(error instanceof ResponseError)) return {};
  return {
    status: error.status,
    url: error.url,
    body: error.body,
    retryAfter: error.headers.get("retry-after") ?? undefined,
  };
}

/**
 * Read the status, URL and message off whatever was thrown.
 *
 * @param error - The thrown value.
 * @param provider - Provider the request belonged to.
 * @param requestUrl - URL of the request, when the caller knows it.
 * @returns {Failure} The parts the classifiers read.
 */
function describeFailure(error: unknown, provider?: string, requestUrl?: string): Failure {
  const message = error instanceof Error ? error.message : String(error);
  const sent = responseParts(error);
  return {
    message,
    lower: message.toLowerCase(),
    status: sent.status ?? Number(/HTTP (\d{3})/i.exec(message)?.[1] ?? 0),
    url: requestUrl ?? sent.url,
    body: sent.body,
    retryAfter: sent.retryAfter,
    provider,
    source: provider ?? "unknown",
  };
}

/**
 * A 404, or a message that says so.
 *
 * @param failure - The failure to sort.
 * @returns {LyricsError | undefined} The error, or nothing when this isn't one.
 */
function notFound(failure: Failure): LyricsError | undefined {
  if (failure.status !== 404 && !failure.lower.includes("not found")) return undefined;
  return new NotFoundError(failure.url ?? failure.message, failure.provider);
}

/**
 * A 429, with the wait the server asked for.
 *
 * @param failure - The failure to sort.
 * @returns {LyricsError | undefined} The error, or nothing when this isn't one.
 */
function rateLimited(failure: Failure): LyricsError | undefined {
  if (failure.status !== 429 && !failure.lower.includes("rate limit")) return undefined;
  const retryAfter = Number(failure.retryAfter ?? Number.NaN);
  return new RateLimitError(failure.source, Number.isFinite(retryAfter) ? retryAfter : undefined);
}

/**
 * A 402.
 *
 * @param failure - The failure to sort.
 * @returns {LyricsError | undefined} The error, or nothing when this isn't one.
 */
function paymentRequired(failure: Failure): LyricsError | undefined {
  return failure.status === 402 ? new PaymentError(failure.source, failure.status) : undefined;
}

/**
 * A 401 or a 403: on a lyrics site both mean the client was refused.
 *
 * @param failure - The failure to sort.
 * @returns {LyricsError | undefined} The error, or nothing when this isn't one.
 */
function unauthorized(failure: Failure): LyricsError | undefined {
  const { status, url } = failure;
  if (status !== 401 && status !== 403 && !failure.lower.includes("unauthorized")) {
    return undefined;
  }
  return new AuthError(failure.source, url ? `HTTP ${status} from ${url}` : failure.message);
}

/** Messages of a request that never got an answer. */
const TRANSPORT_HINTS = ["econnrefused", "etimedout", "timeouterror"];

/**
 * Any other status, or a request that died on the wire.
 *
 * @param failure - The failure to sort.
 * @returns {LyricsError | undefined} The error, or nothing when this isn't one.
 */
function transport(failure: Failure): LyricsError | undefined {
  const { status, url, lower } = failure;
  if (!(status > 0 || url || TRANSPORT_HINTS.some((hint) => lower.includes(hint)))) {
    return undefined;
  }
  return new HTTPError(status, url ?? "unknown", failure.body ?? failure.message, failure.provider);
}

/** First match wins, so a 404 is never read as a plain HTTP error. */
const CLASSIFIERS = [notFound, rateLimited, paymentRequired, unauthorized, transport];

/**
 * Turn an unknown provider or transport failure into the Lyrics error hierarchy.
 *
 * Existing `LyricsError` instances pass through unchanged. Structured HTTP failures retain their
 * status, response body, and redacted request URL.
 *
 * HTTP 403 maps onto `AuthError`, not `PaymentError`: on the lyrics sites a 403 means the
 * service refused the client, and only Musixmatch charges for access - it reports that in its
 * response body, which its own provider maps.
 *
 * @param error - The thrown value.
 * @param provider - Provider the request belonged to.
 * @param requestUrl - URL of the request, when the caller knows it.
 * @returns {LyricsError} The failure as one of the library's classes.
 */
export function normalizeError(
  error: unknown,
  provider?: string,
  requestUrl?: string,
): LyricsError {
  if (error instanceof LyricsError) return error;

  const failure = describeFailure(error, provider, requestUrl);
  for (const classify of CLASSIFIERS) {
    const sorted = classify(failure);
    if (sorted) return sorted;
  }
  return new LyricsError(failure.message, provider);
}
