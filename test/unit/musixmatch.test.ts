import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import {
  AuthError,
  LyricsError,
  NotFoundError,
  PaymentError,
  RateLimitError,
} from "../../src/core/errors.ts";
import { create } from "../../src/core/registry.ts";
import { FAKE_PLAIN, requestedUrl, stubJSON } from "../helpers.ts";
import "../../src/providers/musixmatch.ts";

/** Musixmatch answers HTTP 200 for everything; the real status rides in the envelope header. */
function envelope(status: number, body: unknown) {
  return { message: { header: { status_code: status }, body } };
}

const LYRICS_BODY = {
  lyrics: {
    lyrics_id: 42,
    lyrics_body: FAKE_PLAIN,
    lyrics_language: "en",
    lyrics_copyright: "Placeholder copyright notice",
  },
};

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("musixmatch provider", () => {
  it("serves search and plain lyrics", () => {
    expect(create("musixmatch").capabilities).toEqual({
      search: true,
      lyrics: true,
      synced: false,
      translation: false,
    });
  });

  it("names the variable to set when no key is configured", async () => {
    const fetch = stubJSON(envelope(200, LYRICS_BODY));

    await expect(create("musixmatch").lyrics({ artist: "a", track: "b" })).rejects.toThrow(
      /MUSIXMATCH_API_KEY/,
    );
    expect(fetch).not.toHaveBeenCalled();
  });

  it("matches on artist and title, carrying the copyright line through", async () => {
    vi.stubEnv("MUSIXMATCH_API_KEY", "key");
    const fetch = stubJSON(envelope(200, LYRICS_BODY));

    const lyrics = await create("musixmatch").lyrics({
      artist: "Placeholder Artist",
      track: "Placeholder Song",
    });

    const url = requestedUrl(fetch);
    expect(url).toContain("matcher.lyrics.get");
    expect(url).toContain("q_artist=Placeholder+Artist");
    expect(lyrics).toMatchObject({
      provider: "musixmatch",
      plain: FAKE_PLAIN,
      partial: false,
      attribution: "Placeholder copyright notice",
    });
  });

  it("uses the id endpoint when a track id is supplied", async () => {
    vi.stubEnv("MUSIXMATCH_API_KEY", "key");
    const fetch = stubJSON(envelope(200, LYRICS_BODY));

    await create("musixmatch").lyrics({ artist: "a", track: "b", id: "42" });

    expect(requestedUrl(fetch)).toContain("track.lyrics.get?track_id=42");
  });

  it("cuts the free-plan banner and flags the result as an excerpt", async () => {
    vi.stubEnv("MUSIXMATCH_API_KEY", "key");
    stubJSON(
      envelope(200, {
        lyrics: {
          lyrics_body: `${FAKE_PLAIN}\n...\n\n******* This Lyrics is NOT for Commercial use *******\n(1409624)`,
        },
      }),
    );

    const lyrics = await create("musixmatch").lyrics({ artist: "a", track: "b" });

    expect(lyrics.partial).toBe(true);
    expect(lyrics.plain).toBe(FAKE_PLAIN);
    expect(lyrics.plain).not.toContain("*");
  });

  it("detects the banner even when the ellipsis line is absent", async () => {
    vi.stubEnv("MUSIXMATCH_API_KEY", "key");
    stubJSON(
      envelope(200, {
        lyrics: { lyrics_body: `${FAKE_PLAIN}\n******* Not for Commercial use *******\n(1409624)` },
      }),
    );

    const lyrics = await create("musixmatch").lyrics({ artist: "a", track: "b" });

    expect(lyrics.partial).toBe(true);
    expect(lyrics.plain).toBe(FAKE_PLAIN);
  });

  it("scans a body of blank lines without stalling", async () => {
    vi.stubEnv("MUSIXMATCH_API_KEY", "key");
    stubJSON(envelope(200, { lyrics: { lyrics_body: `\n${" \n".repeat(20_000)}x` } }));

    const started = performance.now();
    const lyrics = await create("musixmatch").lyrics({ artist: "a", track: "b" });

    expect(performance.now() - started).toBeLessThan(200);
    expect(lyrics.partial).toBe(false);
  });

  it("leaves a complete lyric unflagged", async () => {
    vi.stubEnv("MUSIXMATCH_API_KEY", "key");
    stubJSON(envelope(200, LYRICS_BODY));

    const lyrics = await create("musixmatch").lyrics({ artist: "a", track: "b" });

    expect(lyrics.partial).toBe(false);
    expect(lyrics.plain).toBe(FAKE_PLAIN);
  });

  it.each([
    [401, AuthError],
    [402, PaymentError],
    [403, AuthError],
    [404, NotFoundError],
    [429, RateLimitError],
    [500, LyricsError],
  ])("maps in-body status %s onto the error hierarchy", async (status, expected) => {
    vi.stubEnv("MUSIXMATCH_API_KEY", "key");
    stubJSON(envelope(status, []));

    await expect(create("musixmatch").lyrics({ artist: "a", track: "b" })).rejects.toThrow(
      expected,
    );
  });

  it("treats an empty body array as a miss", async () => {
    vi.stubEnv("MUSIXMATCH_API_KEY", "key");
    stubJSON(envelope(200, []));

    await expect(create("musixmatch").lyrics({ artist: "a", track: "b" })).rejects.toThrow(
      NotFoundError,
    );
  });

  it("maps search hits onto track matches", async () => {
    vi.stubEnv("MUSIXMATCH_API_KEY", "key");
    stubJSON(
      envelope(200, {
        track_list: [
          {
            track: {
              track_id: 42,
              track_name: "Placeholder Song",
              artist_name: "Placeholder Artist",
              album_name: "Placeholder Album",
              track_length: 239,
              instrumental: 0,
              track_share_url: "https://www.musixmatch.com/lyrics/placeholder",
            },
          },
        ],
      }),
    );

    const matches = await create("musixmatch").search?.("placeholder");

    expect(matches?.[0]).toMatchObject({
      artist: "Placeholder Artist",
      track: "Placeholder Song",
      duration: 239,
      id: "42",
      instrumental: false,
    });
  });

  it("keeps the key out of the error message", async () => {
    vi.stubEnv("MUSIXMATCH_API_KEY", "SECRET123");
    stubJSON(envelope(500, []));

    await expect(create("musixmatch").lyrics({ artist: "a", track: "b" })).rejects.not.toThrow(
      /SECRET123/,
    );
  });
});
