/**
 * AZLyrics provider - lyrics read off a deterministic page URL
 *
 * No API and no search: the site's URL is a pure function of artist and title, so this provider
 * goes straight to the page. Its value is coverage of older catalogue that the JSON APIs miss.
 *
 * Site: https://www.azlyrics.com
 */

import type { Lyrics, ProviderCapabilities, ProviderConfig, TrackQuery } from "../core/types.ts";
import { Provider, assertTrackQuery } from "../core/provider.ts";
import { parseHtml, requireLyrics, slugify } from "../core/html.ts";
import { register } from "../core/registry.ts";

const DEFAULT_BASE_URL = "https://www.azlyrics.com";

/**
 * The text sits in the one class-less div of the song column - the site gives it no id or class
 * of its own, so it is identified by position and by the absence of a class.
 */
const LYRICS_SELECTOR = "div.col-xs-12.col-lg-8.text-center > div:not([class])";

/**
 * Build the AZLyrics path for a song.
 *
 * Slugs are lowercase alphanumerics with nothing between them, and a leading "the" is dropped
 * from the artist: verified live, `beatles/yesterday` resolves while `thebeatles/yesterday`
 * is a 404.
 */
export function azlyricsPath(artist: string, track: string): string {
  const artistSlug = slugify(artist).replace(/^the(?=.)/, "");
  return `lyrics/${artistSlug}/${slugify(track)}.html`;
}

class AzLyrics extends Provider {
  static readonly key = "azlyrics";

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
    assertTrackQuery(query, AzLyrics.key);
    const url = `${this.baseUrl}/${azlyricsPath(query.artist, query.track)}`;
    const plain = requireLyrics(
      await parseHtml(await this.getText(url)),
      LYRICS_SELECTOR,
      AzLyrics.key,
      url,
    );
    return {
      provider: AzLyrics.key,
      artist: query.artist,
      track: query.track,
      plain,
      instrumental: false,
      partial: false,
      url,
      attribution: "Lyrics hosted by AZLyrics",
    };
  }
}

register(AzLyrics, DEFAULT_BASE_URL);
