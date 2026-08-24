/** HTTP client wrapper for Lyrics providers */

import { ofetch } from "ofetch";
import { normalizeError } from "./errors.ts";
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
  timeout?: number;
  headers?: Record<string, string>;
  signal?: AbortSignal;
  provider?: string;
}

const DEFAULT_TIMEOUT_MS = 15_000;

/**
 * Fetch JSON with Lyrics headers and a 15-second default timeout.
 *
 * Transport failures are normalized before they leave this boundary.
 */
export async function getJSON<T>(url: string, options?: ClientOptions): Promise<T> {
  try {
    return await ofetch<T>(url, {
      method: "GET",
      headers: {
        Accept: "application/json",
        "User-Agent": USER_AGENT,
        ...options?.headers,
      },
      timeout: options?.timeout ?? DEFAULT_TIMEOUT_MS,
      signal: options?.signal,
      retry: false,
    });
  } catch (error) {
    throw normalizeError(error, options?.provider, url);
  }
}

/**
 * Fetch an HTML page as text, for the providers that read their lyrics out of markup.
 *
 * `responseType: "text"` is explicit: without it ofetch decides from the response content type,
 * and a site answering `application/json` for an error page would hand back an object.
 */
export async function getText(url: string, options?: ClientOptions): Promise<string> {
  try {
    return await ofetch<string, "text">(url, {
      method: "GET",
      responseType: "text",
      headers: {
        Accept: "text/html,application/xhtml+xml",
        "User-Agent": USER_AGENT,
        ...options?.headers,
      },
      timeout: options?.timeout ?? DEFAULT_TIMEOUT_MS,
      signal: options?.signal,
      retry: false,
    });
  } catch (error) {
    throw normalizeError(error, options?.provider, url);
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
