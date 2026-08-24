import { afterEach, describe, expect, it, vi } from "vitest";
import { InvalidInputError, NotFoundError } from "../../src/core/errors.ts";
import { create } from "../../src/core/registry.ts";
import { FAKE_PLAIN, FAKE_SYNCED, stubJSON } from "../helpers.ts";
import "../../src/providers/lrclib.ts";

/**
 * Shape captured from a live `/api/get` response during the pre-scaffold API audit (2026-08-24),
 * with the text replaced by placeholder lines.
 */
const TRACK = {
  id: 496,
  name: "Placeholder Song",
  trackName: "Placeholder Song",
  artistName: "Placeholder Artist",
  albumName: "Placeholder Album",
  duration: 239,
  instrumental: false,
  plainLyrics: FAKE_PLAIN,
  syncedLyrics: FAKE_SYNCED,
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("lrclib provider", () => {
  it("serves search, lyrics and synced lyrics", () => {
    expect(create("lrclib").capabilities).toEqual({
      search: true,
      lyrics: true,
      synced: true,
      translation: false,
    });
  });

  it("maps a track onto the normalized lyrics shape", async () => {
    stubJSON(TRACK);

    const lyrics = await create("lrclib").lyrics({
      artist: "Placeholder Artist",
      track: "Placeholder Song",
    });

    expect(lyrics).toMatchObject({
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
    });
  });

  it("sends artist, track, album and duration as query parameters", async () => {
    const fetch = stubJSON(TRACK);

    await create("lrclib").lyrics({
      artist: "Placeholder Artist",
      track: "Placeholder Song",
      album: "Placeholder Album",
      duration: 239,
    });

    const url = String(fetch.mock.calls[0]?.[0]);
    expect(url).toContain("artist_name=Placeholder+Artist");
    expect(url).toContain("track_name=Placeholder+Song");
    expect(url).toContain("album_name=Placeholder+Album");
    expect(url).toContain("duration=239");
  });

  it("looks a track up by id when one is supplied", async () => {
    const fetch = stubJSON(TRACK);

    await create("lrclib").lyrics({ artist: "a", track: "b", id: "496" });

    expect(String(fetch.mock.calls[0]?.[0])).toBe("https://lrclib.net/api/get/496");
  });

  it("reports an instrumental without inventing text", async () => {
    stubJSON({ ...TRACK, instrumental: true, plainLyrics: null, syncedLyrics: null });

    const lyrics = await create("lrclib").lyrics({ artist: "a", track: "b" });

    expect(lyrics.instrumental).toBe(true);
    expect(lyrics.plain).toBeUndefined();
    expect(lyrics.synced).toBeUndefined();
  });

  it("turns a missing track into NotFoundError", async () => {
    stubJSON({ message: "Failed to find specified track", name: "TrackNotFound" }, 404);

    await expect(create("lrclib").lyrics({ artist: "a", track: "b" })).rejects.toThrow(
      NotFoundError,
    );
  });

  it("maps search hits with their provider-native id", async () => {
    stubJSON([TRACK]);

    const matches = await create("lrclib").search?.("placeholder");

    expect(matches?.[0]).toMatchObject({
      artist: "Placeholder Artist",
      track: "Placeholder Song",
      duration: 239,
      id: "496",
    });
  });

  it("clamps the requested result count locally", async () => {
    stubJSON(Array.from({ length: 30 }, (_, index) => ({ ...TRACK, id: index })));

    const matches = await create("lrclib").search?.("placeholder", { limit: 3 });

    expect(matches).toHaveLength(3);
  });

  it.each([
    { artist: "", track: "b" },
    { artist: "a", track: "  " },
    { artist: "a", track: "b", duration: -5 },
  ])("rejects %j before any request", async (query) => {
    const fetch = stubJSON(TRACK);

    await expect(create("lrclib").lyrics(query)).rejects.toThrow(InvalidInputError);
    expect(fetch).not.toHaveBeenCalled();
  });
});
