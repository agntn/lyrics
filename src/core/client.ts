/** HTTP client wrapper for Lyrics providers */

import { InvalidInputError, ResponseError, normalizeError } from "./errors.ts";
import { version } from "../version.ts";

/**
 * Identifying User-Agent.
 *
 * Every backend - the JSON APIs and the three sites parsed as HTML - answers this string, so
 * there is no reason to imitate a browser. LRCLIB asks clients to identify themselves and their
 * version, which this satisfies.
 */
const USER_AGENT = `agntn-lyrics/${version} (+https://github.com/agntn/lyrics)`;

/** Request metadata shared by the HTTP helpers. */
export interface ClientOptions {
  /** Milliseconds before the request gives up: 15 s by default, 0 waits forever. */
  timeout?: number;
  headers?: Record<string, string>;
  signal?: AbortSignal;
  provider?: string;
}

const DEFAULT_TIMEOUT_MS = 15_000;

/** Node's timer ceiling. Past it, `AbortSignal.timeout` fires after 1 ms. */
const MAX_TIMEOUT_MS = 2_147_483_647;

/** Statuses whose response never carries a body. */
const EMPTY_STATUS_CODES = new Set([101, 204, 205, 304]);

/** What a request asks for and how its body is read. */
interface Request {
  readonly accept: string;
  readonly format: "json" | "text";
}

/** Fetch JSON with Lyrics headers. It's parsed even when the API serves it as `text/plain`. */
export async function getJSON<T>(url: string, options?: ClientOptions): Promise<T> {
  return (await get(url, { accept: "application/json", format: "json" }, options)) as T;
}

/** Fetch an HTML page as text, even when a site labels its error page JSON. */
export async function getText(url: string, options?: ClientOptions): Promise<string> {
  const page = await get(
    url,
    { accept: "text/html,application/xhtml+xml", format: "text" },
    options,
  );
  return typeof page === "string" ? page : "";
}

/** One GET with the shared headers and deadline; no retry, failures leave normalized. */
async function get(url: string, request: Request, options?: ClientOptions): Promise<unknown> {
  try {
    const response = await fetch(url, {
      method: "GET",
      headers: { Accept: request.accept, "User-Agent": USER_AGENT, ...options?.headers },
      signal: requestSignal(options),
    });
    if (response.status >= 400 && response.status < 600) {
      throw new ResponseError(response.status, url, await response.text(), response.headers);
    }
    return await readBody(response, request.format);
  } catch (error) {
    throw normalizeError(error, options?.provider, url);
  }
}

/** The caller's signal joined with the deadline. A bad timeout fails here, not 1 ms in flight. */
function requestSignal(options?: ClientOptions): AbortSignal | undefined {
  const timeout = Math.ceil(options?.timeout ?? DEFAULT_TIMEOUT_MS);
  if (!(timeout >= 0 && timeout <= MAX_TIMEOUT_MS)) {
    throw new InvalidInputError(
      `timeout must be between 0 and ${MAX_TIMEOUT_MS} ms, got ${options?.timeout}`,
      options?.provider,
    );
  }
  const signals = [options?.signal, timeout > 0 ? AbortSignal.timeout(timeout) : undefined].filter(
    (signal) => signal !== undefined,
  );
  return signals.length > 1 ? AbortSignal.any(signals) : signals[0];
}

/** Read a body as JSON or text; a bodiless status reads as nothing. */
async function readBody(response: Response, format: Request["format"]): Promise<unknown> {
  if (!response.body || EMPTY_STATUS_CODES.has(response.status)) return undefined;
  const text = await response.text();
  return format === "json" ? parseJSON(text) : text;
}

/** JSON when it parses, the raw text when it doesn't, and never a key that reaches a prototype. */
function parseJSON(text: string): unknown {
  try {
    return JSON.parse(text, (key, value: unknown) =>
      key === "__proto__" ||
      (key === "constructor" && typeof value === "object" && value !== null && "prototype" in value)
        ? undefined
        : value,
    );
  } catch {
    return text;
  }
}

/**
 * Build a query string while dropping parameters whose value is `undefined`.
 *
 * @example
 *   ```ts
 *   buildQuery({ track_name: "Creep", duration: undefined }); // '?track_name=Creep'
 *   ```
 */
export function buildQuery(params: Record<string, string | number | undefined>): string {
  const usp = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined) usp.set(key, String(value));
  }
  const s = usp.toString();
  return s ? `?${s}` : "";
}
