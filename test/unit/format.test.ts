import { describe, expect, it } from "vitest";
import {
  formatFallback,
  formatLyrics,
  formatLyricsHeader,
  formatProviders,
  formatTrackLine,
  formatTracks,
  formatTranslation,
} from "../../src/core/format.ts";
import { listProviders } from "../../src/core/registry.ts";
import type { Lyrics } from "../../src/core/types.ts";
import { FAKE_PLAIN, FAKE_SYNCED } from "../helpers.ts";
import "../../src/providers/index.ts";

const LYRICS: Lyrics = {
  provider: "lrclib",
  artist: "Placeholder Artist",
  track: "Placeholder Song",
  album: "Placeholder Album",
  duration: 239,
  plain: FAKE_PLAIN,
  synced: FAKE_SYNCED,
  instrumental: false,
  partial: false,
  url: "https://lrclib.net/api/get/496",
  attribution: "Placeholder attribution",
};

describe("formatLyrics", () => {
  it("keeps the source URL and attribution with the text", () => {
    const output = formatLyrics(LYRICS);

    expect(output).toContain(FAKE_PLAIN);
    expect(output).toContain("Source: https://lrclib.net/api/get/496");
    expect(output).toContain("Placeholder attribution");
  });

  it("prints the synced text when asked for it", () => {
    expect(formatLyrics(LYRICS, { synced: true })).toContain("[00:10.00]");
  });

  it("falls back to plain text when synced is asked for but absent", () => {
    const output = formatLyrics({ ...LYRICS, synced: undefined }, { synced: true });

    expect(output).toContain(FAKE_PLAIN);
  });

  it("says so for an instrumental instead of printing nothing", () => {
    const output = formatLyrics({
      ...LYRICS,
      instrumental: true,
      plain: undefined,
      synced: undefined,
    });

    expect(output).toContain("(instrumental - no lyrics)");
  });

  it("flags an excerpt in the header", () => {
    expect(formatLyricsHeader({ ...LYRICS, partial: true })).toContain("excerpt only");
  });

  it("shows the track length as a timestamp", () => {
    expect(formatLyricsHeader(LYRICS)).toContain("3:59");
  });
});

describe("formatTranslation", () => {
  it("prints the translation when there is one", () => {
    expect(formatTranslation({ ...LYRICS, translation: "Pierwsza linia" })).toContain(
      "Pierwsza linia",
    );
  });

  it("names the provider that had none", () => {
    expect(formatTranslation(LYRICS)).toContain("(no translation from lrclib)");
  });
});

describe("formatFallback", () => {
  it("shows which providers were passed over on the way", () => {
    const output = formatFallback({
      provider: "lrclib",
      lyrics: LYRICS,
      skipped: [{ provider: "genius", error: "Not found: x" }],
    });

    expect(output).toContain("[genius] skipped: Not found: x");
    expect(output).toContain(FAKE_PLAIN);
  });

  it("prints nothing extra when the first provider answered", () => {
    const output = formatFallback({ provider: "lrclib", lyrics: LYRICS, skipped: [] });

    expect(output.startsWith("[lrclib]")).toBe(true);
  });
});

describe("formatTracks", () => {
  it("labels a match with its album, length and id", () => {
    const line = formatTrackLine({
      artist: "Placeholder Artist",
      track: "Placeholder Song",
      album: "Placeholder Album",
      duration: 239,
      id: "496",
    });

    expect(line).toBe("Placeholder Artist - Placeholder Song  (Placeholder Album, 3:59, id=496)");
  });

  it("says plainly when a query found nothing", () => {
    expect(formatTracks("lrclib", "nothing", [])).toBe('[lrclib] No matches for "nothing"');
  });
});

describe("formatProviders", () => {
  it("shows which credential each keyed provider still needs", () => {
    const output = formatProviders(listProviders());

    expect(output).toContain("lrclib: search, lyrics, synced");
    expect(output).toContain("needs GENIUS_ACCESS_TOKEN");
    expect(output).toContain("needs MUSIXMATCH_API_KEY");
  });
});
