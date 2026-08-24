/**
 * Musixmatch provider - the licensed lyrics catalogue
 *
 * Requires `MUSIXMATCH_API_KEY`. Failures ride in the response body with HTTP 200, so every
 * call goes through `assertOkStatus` before its payload is read.
 *
 * On the free plan the served text is an excerpt closed by a disclaimer banner rather than the
 * whole song; the provider cuts the banner and reports `partial: true`, so callers can tell an
 * excerpt from a complete lyric.
 *
 * API: https://api.musixmatch.com/ws/1.1 (REST, JSON)
 */

import type {
  Lyrics,
  ProviderCapabilities,
  ProviderConfig,
  SearchOptions,
  TrackMatch,
  TrackQuery,
} from "../core/types.ts";
import { Provider, assertQuery, assertTrackQuery } from "../core/provider.ts";
import { buildQuery } from "../core/client.ts";
import {
  AuthError,
  LyricsError,
  NotFoundError,
  PaymentError,
  RateLimitError,
} from "../core/errors.ts";
import { register } from "../core/registry.ts";
import { normalizeLyrics } from "../core/text.ts";
import { clampMaxResults } from "../core/types.ts";

const MAX_RESULTS = 20;
const DEFAULT_BASE_URL = "https://api.musixmatch.com/ws/1.1";

/**
 * Line of asterisks the free plan appends after the excerpt it is willing to serve.
 *
 * Anchored per line rather than written as one pattern spanning the gap before it: a single
 * pattern needs `\s*` between the newline and the asterisks, `\s` also matches a newline, and
 * lyrics made of blank lines then cost the engine a retry from every position (20k blank lines
 * measured 474 ms). Searching for the banner line itself is unambiguous and linear.
 */
const EXCERPT_BANNER = /^[^\S\n]*\*{3,}/m;

/** Ellipsis line marking where the text was cut; it belongs to the banner, not to the song. */
const EXCERPT_ELLIPSIS = /\n[^\S\n]*\.{3}$/;

/** Split a served body into the text proper and whether it was an excerpt. */
function cutExcerptBanner(body: string): { text: string; partial: boolean } {
  const bannerAt = body.search(EXCERPT_BANNER);
  if (bannerAt === -1) return { text: body, partial: false };
  return {
    text: body.slice(0, bannerAt).replace(/\s+$/, "").replace(EXCERPT_ELLIPSIS, ""),
    partial: true,
  };
}

interface MusixmatchEnvelope<T> {
  message?: {
    header?: { status_code?: number };
    body?: T | [];
  };
}

interface MusixmatchTrack {
  track_id?: number;
  track_name?: string;
  artist_name?: string;
  album_name?: string;
  /** Track length in seconds */
  track_length?: number;
  has_lyrics?: number;
  instrumental?: number;
  track_share_url?: string;
}

interface MusixmatchLyrics {
  lyrics_id?: number;
  lyrics_body?: string;
  lyrics_language?: string;
  lyrics_copyright?: string;
  explicit?: number;
}

/**
 * Map the in-body status code onto the error hierarchy.
 *
 * @throws {LyricsError} For every documented non-success code.
 */
function assertOkStatus(status: number | undefined, resource: string): void {
  switch (status) {
    case 200: {
      return;
    }
    case 401: {
      throw new AuthError("musixmatch", `set MUSIXMATCH_API_KEY (status ${status})`);
    }
    case 402: {
      throw new PaymentError("musixmatch", status);
    }
    case 403: {
      throw new AuthError("musixmatch", `plan does not allow this call (status ${status})`);
    }
    case 404: {
      throw new NotFoundError(resource, "musixmatch");
    }
    case 429: {
      throw new RateLimitError("musixmatch");
    }
    default: {
      throw new LyricsError(`Musixmatch returned status ${status ?? "unknown"}`, "musixmatch");
    }
  }
}

class Musixmatch extends Provider {
  static readonly key = "musixmatch";
  static readonly envKey = "MUSIXMATCH_API_KEY";

  private readonly baseUrl: string;
  private readonly apiKey: string | undefined;

  constructor(config: ProviderConfig) {
    super(config);
    this.baseUrl = config.baseUrl ?? DEFAULT_BASE_URL;
    this.apiKey = config.apiKey ?? process.env[Musixmatch.envKey];
  }

  get capabilities(): ProviderCapabilities {
    return {
      search: true,
      lyrics: true,
      synced: false,
      translation: false,
    };
  }

  /** The key travels as a query param, which the error sanitizer redacts. */
  private requireApiKey(): string {
    if (!this.apiKey) {
      throw new AuthError(Musixmatch.key, `set ${Musixmatch.envKey}`);
    }
    return this.apiKey;
  }

  private async call<T>(
    method: string,
    params: Record<string, string | number | undefined>,
    resource: string,
  ): Promise<T> {
    const url = `${this.baseUrl}/${method}${buildQuery({
      ...params,
      apikey: this.requireApiKey(),
    })}`;
    const envelope = await this.getJSON<MusixmatchEnvelope<T>>(url);
    assertOkStatus(envelope.message?.header?.status_code, resource);
    const body = envelope.message?.body;
    if (body === undefined || Array.isArray(body)) {
      throw new NotFoundError(resource, Musixmatch.key);
    }
    return body;
  }

  override async search(query: string, options?: SearchOptions): Promise<TrackMatch[]> {
    assertQuery(query, Musixmatch.key);
    const body = await this.call<{ track_list?: { track?: MusixmatchTrack }[] }>(
      "track.search",
      {
        q: query,
        page_size: clampMaxResults(options?.limit, MAX_RESULTS),
        s_track_rating: "desc",
      },
      query,
    );
    return (body.track_list ?? [])
      .map((entry) => entry.track)
      .filter((track): track is MusixmatchTrack => track !== undefined)
      .map((track) => ({
        artist: track.artist_name ?? "",
        track: track.track_name ?? "",
        album: track.album_name,
        duration: track.track_length,
        id: track.track_id === undefined ? undefined : String(track.track_id),
        url: track.track_share_url,
        instrumental: track.instrumental === 1,
        raw: track as unknown as Record<string, unknown>,
      }));
  }

  async lyrics(query: TrackQuery): Promise<Lyrics> {
    assertTrackQuery(query, Musixmatch.key);
    const resource = `${query.artist} - ${query.track}`;
    const body = query.id
      ? await this.call<{ lyrics?: MusixmatchLyrics }>(
          "track.lyrics.get",
          { track_id: query.id },
          resource,
        )
      : await this.call<{ lyrics?: MusixmatchLyrics }>(
          "matcher.lyrics.get",
          { q_track: query.track, q_artist: query.artist },
          resource,
        );

    const lyrics = body.lyrics;
    const rawBody = lyrics?.lyrics_body ?? "";
    if (!rawBody.trim()) {
      throw new NotFoundError(resource, Musixmatch.key);
    }
    const excerpt = cutExcerptBanner(rawBody);
    return {
      provider: Musixmatch.key,
      artist: query.artist,
      track: query.track,
      album: query.album,
      duration: query.duration,
      plain: normalizeLyrics(excerpt.text),
      instrumental: false,
      partial: excerpt.partial,
      attribution: lyrics?.lyrics_copyright?.trim() || undefined,
      raw: lyrics as unknown as Record<string, unknown> | undefined,
    };
  }
}

register(Musixmatch, DEFAULT_BASE_URL);
