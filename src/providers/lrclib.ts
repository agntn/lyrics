/**
 * LRCLIB provider - the open community database of synchronized lyrics
 *
 * No API key. Matching is case-insensitive and `duration` only nudges the choice between
 * recordings of the same title, so a rough query still resolves.
 *
 * API: https://lrclib.net/docs (REST, JSON)
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
import { register } from "../core/registry.ts";
import { normalizeLyrics } from "../core/text.ts";
import { clampMaxResults } from "../core/types.ts";

const MAX_RESULTS = 20;
const DEFAULT_BASE_URL = "https://lrclib.net";

/** One record of the LRCLIB track database, as `/api/get` and `/api/search` return it. */
interface LrclibTrack {
  id: number;
  trackName?: string;
  artistName?: string;
  albumName?: string;
  /** Track length in seconds, fractional */
  duration?: number;
  instrumental?: boolean;
  plainLyrics?: string | null;
  syncedLyrics?: string | null;
}

class Lrclib extends Provider {
  static readonly key = "lrclib";

  private readonly baseUrl: string;

  constructor(config: ProviderConfig) {
    super(config);
    this.baseUrl = config.baseUrl ?? DEFAULT_BASE_URL;
  }

  get capabilities(): ProviderCapabilities {
    return {
      search: true,
      lyrics: true,
      synced: true,
      translation: false,
    };
  }

  override async search(query: string, options?: SearchOptions): Promise<TrackMatch[]> {
    assertQuery(query, Lrclib.key);
    const url = `${this.baseUrl}/api/search${buildQuery({ q: query })}`;
    const data = await this.getJSON<LrclibTrack[]>(url);
    return data.slice(0, clampMaxResults(options?.limit, MAX_RESULTS)).map((track) => ({
      artist: track.artistName ?? "",
      track: track.trackName ?? "",
      album: track.albumName,
      duration: track.duration,
      id: String(track.id),
      url: `${this.baseUrl}/api/get/${track.id}`,
      instrumental: track.instrumental,
      raw: track as unknown as Record<string, unknown>,
    }));
  }

  async lyrics(query: TrackQuery): Promise<Lyrics> {
    assertTrackQuery(query, Lrclib.key);
    const url = query.id
      ? `${this.baseUrl}/api/get/${encodeURIComponent(query.id)}`
      : `${this.baseUrl}/api/get${buildQuery({
          artist_name: query.artist,
          track_name: query.track,
          album_name: query.album,
          duration: query.duration,
        })}`;
    const track = await this.getJSON<LrclibTrack>(url);
    return {
      provider: Lrclib.key,
      artist: track.artistName ?? query.artist,
      track: track.trackName ?? query.track,
      album: track.albumName,
      duration: track.duration,
      plain: track.plainLyrics ? normalizeLyrics(track.plainLyrics) : undefined,
      synced: track.syncedLyrics ? normalizeLyrics(track.syncedLyrics) : undefined,
      instrumental: track.instrumental === true,
      partial: false,
      url: `${this.baseUrl}/api/get/${track.id}`,
    };
  }
}

register(Lrclib, DEFAULT_BASE_URL);
