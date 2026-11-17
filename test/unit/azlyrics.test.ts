import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { ParseError, UnsupportedOperationError } from "../../src/core/errors.ts";
import { requireOperation } from "../../src/core/provider.ts";
import { create } from "../../src/core/registry.ts";
import { azlyricsPath } from "../../src/providers/azlyrics.ts";
import { FAKE_PLAIN, requestedUrl, stubHTML } from "../helpers.ts";
import "../../src/providers/azlyrics.ts";

/** Song page shape: the text sits in the one class-less div of the song column. */
const SONG_PAGE = `<html><body><div class="col-xs-12 col-lg-8 text-center">
  <div class="lyricsh"><h2>Placeholder Artist Lyrics</h2></div>
  <div class="ringtone"><span>ad</span></div>
  <div>First placeholder line<br>Second placeholder line<br>Third placeholder line</div>
  <div class="smt noprint">footer</div>
</div></body></html>`;

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("azlyricsPath", () => {
  it.each([
    ["Radiohead", "Creep", "lyrics/radiohead/creep.html"],
    ["The Beatles", "Yesterday", "lyrics/beatles/yesterday.html"],
    ["Guns N' Roses", "November Rain", "lyrics/gunsnroses/novemberrain.html"],
    ["AC/DC", "Thunderstruck", "lyrics/acdc/thunderstruck.html"],
  ])("builds the path for %s - %s", (artist, track, expected) => {
    expect(azlyricsPath(artist, track)).toBe(expected);
  });

  it("keeps an artist whose whole name is 'The'", () => {
    expect(azlyricsPath("The", "Song")).toBe("lyrics/the/song.html");
  });
});

describe("azlyrics provider", () => {
  it("serves plain lyrics only", () => {
    expect(create("azlyrics").capabilities).toEqual({
      search: false,
      lyrics: true,
      synced: false,
      translation: false,
    });
  });

  it("reads the text off the deterministic page URL", async () => {
    const fetch = stubHTML(SONG_PAGE);

    const lyrics = await create("azlyrics").lyrics({
      artist: "Placeholder Artist",
      track: "Placeholder Song",
    });

    expect(requestedUrl(fetch)).toBe(
      "https://www.azlyrics.com/lyrics/placeholderartist/placeholdersong.html",
    );
    expect(lyrics).toMatchObject({
      provider: "azlyrics",
      plain: FAKE_PLAIN,
      attribution: "Lyrics hosted by AZLyrics",
    });
  });

  it("ignores the classed divs around the lyrics", async () => {
    stubHTML(SONG_PAGE);

    const lyrics = await create("azlyrics").lyrics({ artist: "a", track: "b" });

    expect(lyrics.plain).not.toContain("footer");
    expect(lyrics.plain).not.toContain("Lyrics");
  });

  it("reports a layout change as a parse failure", async () => {
    stubHTML(`<html><body><div class="col-xs-12 col-lg-8 text-center">
      <div class="smt">only classed divs</div></div></body></html>`);

    await expect(create("azlyrics").lyrics({ artist: "a", track: "b" })).rejects.toThrow(
      ParseError,
    );
  });

  it("refuses search at the capability gate", () => {
    expect(() => requireOperation(create("azlyrics"), "search")).toThrow(UnsupportedOperationError);
  });
});
