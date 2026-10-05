/**
 * Genius provider - song metadata over the official API, text off the song page
 *
 * The Genius API deliberately serves everything about a song except its words: search, artist,
 * album and the canonical page URL, but never the lyrics themselves. So `search()` needs
 * `GENIUS_ACCESS_TOKEN` and `lyrics()` reads the page the API points at. Without a token the
 * page URL is derived from artist and title instead, which resolves for most songs.
 *
 * API: https://api.genius.com (REST, JSON, Bearer token)
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
import { AuthError, NotFoundError } from "../core/errors.ts";
import { parseHtml, requireLyrics, slugify } from "../core/html.ts";
import { register } from "../core/registry.ts";
import { clampMaxResults } from "../core/types.ts";

const MAX_RESULTS = 20;
const DEFAULT_BASE_URL = "https://api.genius.com";
const SITE_URL = "https://genius.com";

/** The lyrics of a song page live in these containers, one per section. */
const LYRICS_SELECTOR = "[data-lyrics-container]";

/** Page header Genius tucks into the first container: contributor count, translations, blurb. */
const PAGE_HEADER_SELECTOR = "[data-exclude-from-selection]";

interface GeniusSong {
  id: number;
  title?: string;
  full_title?: string;
  url?: string;
  primary_artist?: { name?: string };
  release_date_for_display?: string;
}

interface GeniusSearchResponse {
  response?: { hits?: { result?: GeniusSong }[] };
}

interface GeniusSongResponse {
  response?: { song?: GeniusSong & { album?: { name?: string } } };
}

/**
 * Build the canonical song-page URL the way Genius spells it.
 *
 * Verified against live pages: words are joined with hyphens, only the first character of the
 * artist is capitalized, and leading articles are kept - `Beatles-yesterday-lyrics` is a 404
 * while `The-beatles-yesterday-lyrics` resolves.
 */
export function geniusSongUrl(artist: string, track: string): string {
  const artistSlug = slugify(artist, "-");
  const capitalized = artistSlug.charAt(0).toUpperCase() + artistSlug.slice(1);
  return `${SITE_URL}/${capitalized}-${slugify(track, "-")}-lyrics`;
}

class Genius extends Provider {
  static readonly key = "genius";
  static readonly envKey = "GENIUS_ACCESS_TOKEN";

  private readonly baseUrl: string;
  private readonly apiKey: string | undefined;

  constructor(config: ProviderConfig) {
    super(config);
    this.baseUrl = config.baseUrl ?? DEFAULT_BASE_URL;
    this.apiKey = config.apiKey ?? process.env[Genius.envKey];
  }

  get capabilities(): ProviderCapabilities {
    return {
      search: true,
      lyrics: true,
      synced: false,
      translation: false,
    };
  }

  /** Bearer header, or a clear failure naming the variable to set. */
  private authHeaders(): Record<string, string> {
    if (!this.apiKey) {
      throw new AuthError(Genius.key, `set ${Genius.envKey} to search Genius`);
    }
    return { Authorization: `Bearer ${this.apiKey}` };
  }

  override async search(query: string, options?: SearchOptions): Promise<TrackMatch[]> {
    assertQuery(query, Genius.key);
    const headers = this.authHeaders();
    const url = `${this.baseUrl}/search${buildQuery({ q: query })}`;
    const data = await this.getJSON<GeniusSearchResponse>(url, { headers });
    const hits = data.response?.hits ?? [];
    return hits
      .map((hit) => hit.result)
      .filter((song): song is GeniusSong => song !== undefined)
      .slice(0, clampMaxResults(options?.limit, MAX_RESULTS))
      .map((song) => ({
        artist: song.primary_artist?.name ?? "",
        track: song.title ?? "",
        id: String(song.id),
        url: song.url,
        raw: song as unknown as Record<string, unknown>,
      }));
  }

  async lyrics(query: TrackQuery): Promise<Lyrics> {
    assertTrackQuery(query, Genius.key);
    const song = await this.findSong(query);
    const url = song?.url ?? geniusSongUrl(query.artist, query.track);
    const page = await this.getText(url);
    const root = await parseHtml(page);
    for (const header of root.querySelectorAll(PAGE_HEADER_SELECTOR)) header.remove();
    const plain = requireLyrics(root, LYRICS_SELECTOR, Genius.key, url);
    return {
      provider: Genius.key,
      artist: song?.primary_artist?.name ?? query.artist,
      track: song?.title ?? query.track,
      album: song?.album?.name,
      plain,
      instrumental: false,
      partial: false,
      url,
      attribution: "Lyrics hosted by Genius",
    };
  }

  /**
   * Resolve the song record whose page holds the text.
   *
   * A token buys an exact match through the API; without one the caller still gets lyrics from
   * the derived URL, so a missing token is not an error on this path - unless the caller passed
   * an `id`, which only the API can resolve. Silently ignoring it would answer a different
   * question than the one asked.
   */
  private async findSong(
    query: TrackQuery,
  ): Promise<(GeniusSong & { album?: { name?: string } }) | undefined> {
    if (!this.apiKey) {
      if (query.id) {
        throw new AuthError(Genius.key, `set ${Genius.envKey} to look a song up by id`);
      }
      return undefined;
    }
    if (query.id) {
      const url = `${this.baseUrl}/songs/${encodeURIComponent(query.id)}`;
      const data = await this.getJSON<GeniusSongResponse>(url, { headers: this.authHeaders() });
      const song = data.response?.song;
      if (!song) throw new NotFoundError(`song ${query.id}`, Genius.key);
      return song;
    }
    const matches = await this.search(`${query.artist} ${query.track}`, { limit: 1 });
    const first = matches[0];
    return first?.raw as (GeniusSong & { album?: { name?: string } }) | undefined;
  }
}

register(Genius, DEFAULT_BASE_URL);
