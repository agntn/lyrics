/**
 * lyrics.ovh provider - a single-endpoint public lyrics API
 *
 * No API key, no search, no metadata: give it an artist and a title and it answers with the
 * text or a 404. That narrowness makes it a good second opinion when another provider misses.
 *
 * API: https://api.lyrics.ovh/v1/{artist}/{title}
 */

import type { Lyrics, ProviderCapabilities, ProviderConfig, TrackQuery } from "../core/types.ts";
import { Provider, assertTrackQuery } from "../core/provider.ts";
import { NotFoundError } from "../core/errors.ts";
import { register } from "../core/registry.ts";
import { normalizeLyrics } from "../core/text.ts";

const DEFAULT_BASE_URL = "https://api.lyrics.ovh";

interface LyricsOvhResponse {
  lyrics?: string;
  error?: string;
}

class LyricsOvh extends Provider {
  static readonly key = "lyricsovh";

  private readonly baseUrl: string;

  constructor(config: ProviderConfig) {
    super(config);
    this.baseUrl = config.baseUrl ?? DEFAULT_BASE_URL;
  }

  get capabilities(): ProviderCapabilities {
    return {
      search: false,
      lyrics: true,
      synced: false,
      translation: false,
    };
  }

  async lyrics(query: TrackQuery): Promise<Lyrics> {
    assertTrackQuery(query, LyricsOvh.key);
    const url = `${this.baseUrl}/v1/${encodeURIComponent(query.artist)}/${encodeURIComponent(
      query.track,
    )}`;
    const data = await this.getJSON<LyricsOvhResponse>(url);
    const plain = data.lyrics ? normalizeLyrics(data.lyrics) : "";
    if (!plain) {
      throw new NotFoundError(`${query.artist} - ${query.track}`, LyricsOvh.key);
    }
    return {
      provider: LyricsOvh.key,
      artist: query.artist,
      track: query.track,
      plain,
      instrumental: false,
      partial: false,
      url,
    };
  }
}

register(LyricsOvh, DEFAULT_BASE_URL);
