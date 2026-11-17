import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { AuthError, ParseError } from "../../src/core/errors.ts";
import { create } from "../../src/core/registry.ts";
import { geniusSongUrl } from "../../src/providers/genius.ts";
import { FAKE_PLAIN, requestedUrl, stubHTML, stubRoutes } from "../helpers.ts";
import "../../src/providers/genius.ts";

/** Song page shape: several `data-lyrics-container` sections, lines split by `<br>`. */
const SONG_PAGE = `<html><body>
  <div data-lyrics-container="true">First placeholder line<br>Second placeholder line</div>
  <div data-lyrics-container="true">Third placeholder line</div>
</body></html>`;

/** Live layout: Genius parks the page header inside the first container, before the first line. */
const SONG_PAGE_WITH_HEADER = `<html><body>
  <div data-lyrics-container="true"><div data-exclude-from-selection="true"><div>12 Contributors</div><div>TranslationsPolski</div><div>A placeholder blurb about the song… Read More</div></div>First placeholder line<br>Second placeholder line</div>
  <div data-lyrics-container="true">Third placeholder line</div>
</body></html>`;

const SEARCH_RESPONSE = {
  response: {
    hits: [
      {
        result: {
          id: 1234,
          title: "Placeholder Song",
          url: "https://genius.com/Placeholder-artist-placeholder-song-lyrics",
          primary_artist: { name: "Placeholder Artist" },
        },
      },
    ],
  },
};

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("geniusSongUrl", () => {
  it.each([
    ["Radiohead", "Creep", "https://genius.com/Radiohead-creep-lyrics"],
    ["The Beatles", "Yesterday", "https://genius.com/The-beatles-yesterday-lyrics"],
    ["Kult", "Arahja", "https://genius.com/Kult-arahja-lyrics"],
  ])("derives the page URL for %s - %s", (artist, track, expected) => {
    expect(geniusSongUrl(artist, track)).toBe(expected);
  });
});

describe("genius provider", () => {
  it("serves search and lyrics but never synced text", () => {
    expect(create("genius").capabilities).toEqual({
      search: true,
      lyrics: true,
      synced: false,
      translation: false,
    });
  });

  it("reads the text off the derived page when no token is configured", async () => {
    const fetch = stubHTML(SONG_PAGE);

    const lyrics = await create("genius").lyrics({
      artist: "Placeholder Artist",
      track: "Placeholder Song",
    });

    expect(requestedUrl(fetch)).toBe(
      "https://genius.com/Placeholder-artist-placeholder-song-lyrics",
    );
    expect(lyrics).toMatchObject({
      provider: "genius",
      plain: FAKE_PLAIN,
      url: "https://genius.com/Placeholder-artist-placeholder-song-lyrics",
      attribution: "Lyrics hosted by Genius",
    });
  });

  it("leaves the page header out of the text", async () => {
    stubHTML(SONG_PAGE_WITH_HEADER);

    const lyrics = await create("genius").lyrics({ artist: "a", track: "b" });

    expect(lyrics.plain).toBe(FAKE_PLAIN);
  });

  it("resolves the page through the API when a token is configured", async () => {
    vi.stubEnv("GENIUS_ACCESS_TOKEN", "token");
    const fetch = stubRoutes({
      "api.genius.com/search": { body: SEARCH_RESPONSE },
      "genius.com/Placeholder-artist": { body: SONG_PAGE, html: true },
    });

    const lyrics = await create("genius").lyrics({ artist: "Placeholder", track: "Song" });

    expect(requestedUrl(fetch)).toContain("api.genius.com/search");
    expect(lyrics.artist).toBe("Placeholder Artist");
    expect(lyrics.track).toBe("Placeholder Song");
  });

  it("sends the token as a bearer header", async () => {
    vi.stubEnv("GENIUS_ACCESS_TOKEN", "token");
    const fetch = stubJSONSearch();

    await create("genius").search?.("placeholder");

    const headers = new Headers(fetch.mock.calls[0]?.[1]?.headers as HeadersInit);
    expect(headers.get("authorization")).toBe("Bearer token");
  });

  it("names the variable to set when search is called without a token", async () => {
    await expect(create("genius").search?.("placeholder")).rejects.toThrow(AuthError);
    await expect(create("genius").search?.("placeholder")).rejects.toThrow(/GENIUS_ACCESS_TOKEN/);
  });

  it("refuses an id lookup without a token instead of ignoring the id", async () => {
    const fetch = stubHTML(SONG_PAGE);

    await expect(create("genius").lyrics({ artist: "a", track: "b", id: "1234" })).rejects.toThrow(
      AuthError,
    );
    expect(fetch).not.toHaveBeenCalled();
  });

  it("reports a layout change as a parse failure, not as a missing song", async () => {
    stubHTML("<html><body><div>no lyrics container here</div></body></html>");

    await expect(create("genius").lyrics({ artist: "a", track: "b" })).rejects.toThrow(ParseError);
  });
});

/** Search stub kept separate: the assertion needs the request init, not only the URL. */
function stubJSONSearch() {
  const fetch = vi.fn(
    async (_input: RequestInfo | URL, _init?: RequestInit) =>
      new Response(JSON.stringify(SEARCH_RESPONSE), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
  );
  vi.stubGlobal("fetch", fetch);
  return fetch;
}
