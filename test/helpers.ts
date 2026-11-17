import { vi } from "vite-plus/test";
import { Provider } from "../src/core/provider.ts";
import type { Lyrics } from "../src/core/types.ts";

/**
 * Placeholder lyrics used across the suite.
 *
 * Deliberately invented rather than sampled from a real song: fixtures are committed, and a
 * committed fixture of somebody's lyrics is a copy of their work living in this repository.
 */
export const FAKE_PLAIN = "First placeholder line\nSecond placeholder line\nThird placeholder line";

/** The same placeholder text with LRC timestamps. */
export const FAKE_SYNCED =
  "[00:10.00] First placeholder line\n[00:20.50] Second placeholder line\n[01:00.00] Third placeholder line";

/** Local provider for testing attribution on surfaces that fetch synchronized lyrics. */
export class AttributedProvider extends Provider {
  static readonly key = "attributed";

  get capabilities() {
    return { search: false, lyrics: true, synced: true, translation: true };
  }

  async lyrics(): Promise<Lyrics> {
    return {
      provider: AttributedProvider.key,
      artist: "Placeholder Artist",
      track: "Placeholder Song",
      plain: FAKE_PLAIN,
      synced: FAKE_SYNCED,
      translation: "Translated placeholder line",
      instrumental: false,
      partial: false,
      url: "https://example.com/placeholder",
      attribution: "Placeholder attribution",
    };
  }
}

/** LRCLIB record shape, as `/api/get` returns it, with placeholder text. */
export const LRCLIB_TRACK = {
  id: 496,
  trackName: "Placeholder Song",
  artistName: "Placeholder Artist",
  duration: 239,
  instrumental: false,
  plainLyrics: FAKE_PLAIN,
  syncedLyrics: FAKE_SYNCED,
};

/** Look up a registered extension tool, failing loudly when registration missed it. */
export function requireTool<T>(tools: Map<string, T>, name: string): T {
  const tool = tools.get(name);
  if (!tool) throw new Error(`Tool not registered: ${name}`);
  return tool;
}

/** Stub global fetch with one JSON body; returns the mock for call inspection. */
export function stubJSON(body: unknown, status = 200) {
  return stubRoutes({ "": { body, status } });
}

/** Stub global fetch with one HTML body; returns the mock for call inspection. */
export function stubHTML(body: string, status = 200) {
  return stubRoutes({ "": { body, status, html: true } });
}

/** Stub global fetch with requests that settle only on abort; returns the signals they got. */
export function stubPendingFetch(): AbortSignal[] {
  const signals: AbortSignal[] = [];
  const fetch = vi.fn(
    (_input: RequestInfo | URL, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        const signal = init?.signal ?? undefined;
        if (!signal) return;
        signals.push(signal);
        if (signal.aborted) reject(signal.reason);
        signal.addEventListener("abort", () => reject(signal.reason), { once: true });
      }),
  );
  vi.stubGlobal("fetch", fetch);
  return signals;
}

/** The address of a request, whichever of the three shapes fetch takes. */
function urlOf(input: RequestInfo | URL): string {
  if (typeof input === "string") return input;
  return input instanceof URL ? input.href : input.url;
}

/** The URL a stubbed fetch was called with, empty when that call never happened. */
export function requestedUrl(fetch: ReturnType<typeof stubRoutes>, call = 0): string {
  const input = fetch.mock.calls[call]?.[0];
  return input === undefined ? "" : urlOf(input);
}

/** Stub global fetch with a per-URL body map; unmatched URLs answer 404. */
export function stubRoutes(
  routes: Record<string, { body: unknown; status?: number; html?: boolean }>,
) {
  const fetch = vi.fn(async (input: RequestInfo | URL, _init?: RequestInit) => {
    const url = urlOf(input);
    const match = Object.entries(routes).find(([pattern]) => url.includes(pattern));
    if (!match) {
      return new Response(JSON.stringify({ error: "not found" }), {
        status: 404,
        headers: { "Content-Type": "application/json" },
      });
    }
    const [, route] = match;
    return new Response(route.html ? String(route.body) : JSON.stringify(route.body), {
      status: route.status ?? 200,
      headers: {
        "Content-Type": route.html ? "text/html; charset=utf-8" : "application/json",
      },
    });
  });
  vi.stubGlobal("fetch", fetch);
  return fetch;
}

/** Every call that reaches a provider, for the cancellation tests of each surface. */
export const NETWORKED_CALLS: ReadonlyArray<readonly [string, Record<string, unknown>]> = [
  ["lyrics_get", { artist: "a", track: "b" }],
  ["lyrics_get", { artist: "a", track: "b", provider: "lrclib" }],
  ["lyrics_get", { artist: "a", track: "b", provider: "all" }],
  ["lyrics_search", { query: "placeholder", provider: "lrclib" }],
  ["lyrics_search", { query: "placeholder", provider: "all" }],
  ["lyrics_line_at", { artist: "a", track: "b", seconds: 20 }],
];
