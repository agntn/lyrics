/**
 * Tekstowo.pl provider - Polish lyrics with community translations
 *
 * No API: both operations read the site's HTML. Its distinguishing feature is the translation
 * panel, which is why this is the only provider with `translation` capability.
 *
 * Site: https://www.tekstowo.pl
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
import { InvalidInputError } from "../core/errors.ts";
import { parseHtml, requireLyrics, selectLyrics, selectText, slugify } from "../core/html.ts";
import { register } from "../core/registry.ts";
import { clampMaxResults } from "../core/types.ts";

const MAX_RESULTS = 20;
const DEFAULT_BASE_URL = "https://www.tekstowo.pl";

/** Original text; the translation lives in the sibling panel. */
const LYRICS_SELECTOR = "#songText .inner-text";
const TRANSLATION_SELECTOR = "#translation .inner-text";

/**
 * Search results, in document order, are the links of the first card under "Znalezione utwory".
 * The artist card that follows uses the same link class, so results are also filtered by shape:
 * a song is `/artist/title`, an artist is `/artist`.
 */
const RESULT_SELECTOR = "div.content div.card a.title";

/** A track id here is a site path: exactly two slug segments, as `search()` returns. */
const PATH_ID = /^[a-z0-9-]+\/[a-z0-9-]+$/;

/** Song page path, for example `radiohead/creep`. Diacritics fold onto ASCII. */
export function tekstowoPath(artist: string, track: string): string {
  return `${slugify(artist, "-")}/${slugify(track, "-")}`;
}

/** Split "Artist - Title", the label shape used by both search rows and page headings. */
function splitLabel(label: string, fallback: { artist: string; track: string }) {
  const separator = label.indexOf(" - ");
  if (separator === -1) return fallback;
  return {
    artist: label.slice(0, separator).trim() || fallback.artist,
    track: label.slice(separator + 3).trim() || fallback.track,
  };
}

class Tekstowo extends Provider {
  static readonly key = "tekstowo";

  private readonly baseUrl: string;

  constructor(config: ProviderConfig) {
    super(config);
    this.baseUrl = config.baseUrl ?? DEFAULT_BASE_URL;
  }

  get capabilities(): ProviderCapabilities {
    return {
      search: true,
      lyrics: true,
      synced: false,
      translation: true,
    };
  }

  override async search(query: string, options?: SearchOptions): Promise<TrackMatch[]> {
    assertQuery(query, Tekstowo.key);
    const url = `${this.baseUrl}/szukaj/${encodeURIComponent(query.trim())}`;
    const page = await this.getText(url);
    const rows = (await parseHtml(page)).querySelectorAll(RESULT_SELECTOR);
    const matches: TrackMatch[] = [];
    for (const row of rows) {
      const href = row.getAttribute("href");
      if (!href || href.split("/").filter(Boolean).length !== 2) continue;
      const label = row.text.replace(/\s+/g, " ").trim();
      const { artist, track } = splitLabel(label, { artist: "", track: label });
      matches.push({ artist, track, url: `${this.baseUrl}${href}` });
      if (matches.length >= clampMaxResults(options?.limit, MAX_RESULTS)) break;
    }
    return matches;
  }

  async lyrics(query: TrackQuery): Promise<Lyrics> {
    assertTrackQuery(query, Tekstowo.key);
    if (query.id !== undefined && !PATH_ID.test(query.id)) {
      throw new InvalidInputError(
        `id must be an "artist/title" site path, got "${query.id}"`,
        Tekstowo.key,
      );
    }
    const url = `${this.baseUrl}/${query.id ?? tekstowoPath(query.artist, query.track)}`;
    const root = await parseHtml(await this.getText(url));
    const plain = requireLyrics(root, LYRICS_SELECTOR, Tekstowo.key, url);
    const heading = selectText(root, "h1")?.replace(/\s+/g, " ") ?? "";
    const { artist, track } = splitLabel(heading, { artist: query.artist, track: query.track });
    return {
      provider: Tekstowo.key,
      artist,
      track,
      plain,
      translation: selectLyrics(root, TRANSLATION_SELECTOR),
      instrumental: false,
      partial: false,
      url,
      attribution: "Lyrics and translation from tekstowo.pl",
    };
  }
}

register(Tekstowo, DEFAULT_BASE_URL);
