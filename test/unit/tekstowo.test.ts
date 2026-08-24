import { afterEach, describe, expect, it, vi } from "vitest";
import { InvalidInputError, ParseError } from "../../src/core/errors.ts";
import { create } from "../../src/core/registry.ts";
import { tekstowoPath } from "../../src/providers/tekstowo.ts";
import { FAKE_PLAIN, stubHTML } from "../helpers.ts";
import "../../src/providers/tekstowo.ts";

/** Song page shape: original text in #songText, community translation in #translation. */
const SONG_PAGE = `<html><body>
  <h1>Placeholder Artist - Placeholder Song</h1>
  <div id="songText"><div class="inner-text">First placeholder line<br>Second placeholder line<br>Third placeholder line</div></div>
  <div id="translation"><div class="inner-text">Pierwsza linia<br>Druga linia</div></div>
</body></html>`;

/**
 * Search page shape: the songs card comes first, the artists card second, and both use the
 * same link class - the artist entry has a one-segment href.
 */
const SEARCH_PAGE = `<html><body><div class="content">
  <h2>Znalezione utwory:</h2>
  <div class="card mb-4"><div class="box-przeboje">
    <a class="title" href="/placeholder-artist/placeholder-song">Placeholder Artist - Placeholder Song</a>
    <a class="title" href="/other-artist/cover-version">Other Artist - Cover Version</a>
  </div></div>
  <h2 class="t-artists">Znalezieni artyści:</h2>
  <div class="card mb-4"><div class="box-przeboje">
    <a class="title" href="/placeholder-artist">Placeholder Artist</a>
  </div></div>
</div></body></html>`;

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("tekstowoPath", () => {
  it.each([
    ["Radiohead", "Creep", "radiohead/creep"],
    ["Łukasz Dembiński", "Zieleń", "lukasz-dembinski/zielen"],
    ["Kordian", "13 czerwonych róż", "kordian/13-czerwonych-roz"],
  ])("builds the path for %s - %s", (artist, track, expected) => {
    expect(tekstowoPath(artist, track)).toBe(expected);
  });
});

describe("tekstowo provider", () => {
  it("is the provider that serves translations", () => {
    expect(create("tekstowo").capabilities).toEqual({
      search: true,
      lyrics: true,
      synced: false,
      translation: true,
    });
  });

  it("returns the original text and the translation side by side", async () => {
    const fetch = stubHTML(SONG_PAGE);

    const lyrics = await create("tekstowo").lyrics({
      artist: "Placeholder Artist",
      track: "Placeholder Song",
    });

    expect(String(fetch.mock.calls[0]?.[0])).toBe(
      "https://www.tekstowo.pl/placeholder-artist/placeholder-song",
    );
    expect(lyrics).toMatchObject({
      provider: "tekstowo",
      artist: "Placeholder Artist",
      track: "Placeholder Song",
      plain: FAKE_PLAIN,
      translation: "Pierwsza linia\nDruga linia",
    });
  });

  it("takes artist and title from the page heading, not from the query", async () => {
    stubHTML(SONG_PAGE);

    const lyrics = await create("tekstowo").lyrics({ artist: "placeholder", track: "song" });

    expect(lyrics.artist).toBe("Placeholder Artist");
  });

  it("keeps the translation absent when the page has none", async () => {
    stubHTML(`<html><body><h1>A - B</h1>
      <div id="songText"><div class="inner-text">Only line</div></div></body></html>`);

    const lyrics = await create("tekstowo").lyrics({ artist: "A", track: "B" });

    expect(lyrics.translation).toBeUndefined();
  });

  it("returns song rows from search and drops the artist card", async () => {
    stubHTML(SEARCH_PAGE);

    const matches = await create("tekstowo").search?.("placeholder");

    expect(matches).toEqual([
      {
        artist: "Placeholder Artist",
        track: "Placeholder Song",
        url: "https://www.tekstowo.pl/placeholder-artist/placeholder-song",
      },
      {
        artist: "Other Artist",
        track: "Cover Version",
        url: "https://www.tekstowo.pl/other-artist/cover-version",
      },
    ]);
  });

  it("honors the requested result count", async () => {
    stubHTML(SEARCH_PAGE);

    const matches = await create("tekstowo").search?.("placeholder", { limit: 1 });

    expect(matches).toHaveLength(1);
  });

  it("accepts a two-segment site path as the track id", async () => {
    const fetch = stubHTML(SONG_PAGE);

    await create("tekstowo").lyrics({ artist: "a", track: "b", id: "placeholder-artist/song" });

    expect(String(fetch.mock.calls[0]?.[0])).toBe(
      "https://www.tekstowo.pl/placeholder-artist/song",
    );
  });

  it.each(["../../elsewhere", "https://example.test/x", "one-segment", "a/b/c", "a/b?x=1"])(
    "refuses %s as a track id before building a URL",
    async (id) => {
      const fetch = stubHTML(SONG_PAGE);

      await expect(create("tekstowo").lyrics({ artist: "a", track: "b", id })).rejects.toThrow(
        InvalidInputError,
      );
      expect(fetch).not.toHaveBeenCalled();
    },
  );

  it("reports a layout change as a parse failure", async () => {
    stubHTML("<html><body><h1>A - B</h1><div>nothing here</div></body></html>");

    await expect(create("tekstowo").lyrics({ artist: "A", track: "B" })).rejects.toThrow(
      ParseError,
    );
  });
});
