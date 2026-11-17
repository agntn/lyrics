import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { NotFoundError, UnsupportedOperationError } from "../../src/core/errors.ts";
import { requireOperation } from "../../src/core/provider.ts";
import { create } from "../../src/core/registry.ts";
import { FAKE_PLAIN, requestedUrl, stubJSON } from "../helpers.ts";
import "../../src/providers/lyricsovh.ts";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("lyricsovh provider", () => {
  it("serves lyrics only", () => {
    expect(create("lyricsovh").capabilities).toEqual({
      search: false,
      lyrics: true,
      synced: false,
      translation: false,
    });
  });

  it("returns the normalized text with its source URL", async () => {
    stubJSON({ lyrics: `${FAKE_PLAIN}\r\n\r\n\r\n` });

    const lyrics = await create("lyricsovh").lyrics({
      artist: "Placeholder Artist",
      track: "Placeholder Song",
    });

    expect(lyrics).toMatchObject({
      provider: "lyricsovh",
      artist: "Placeholder Artist",
      track: "Placeholder Song",
      plain: FAKE_PLAIN,
      partial: false,
      url: "https://api.lyrics.ovh/v1/Placeholder%20Artist/Placeholder%20Song",
    });
  });

  it("escapes artist and title into the path", async () => {
    const fetch = stubJSON({ lyrics: FAKE_PLAIN });

    await create("lyricsovh").lyrics({ artist: "AC/DC", track: "Song & Song" });

    expect(requestedUrl(fetch)).toBe("https://api.lyrics.ovh/v1/AC%2FDC/Song%20%26%20Song");
  });

  it("treats an empty body as a miss rather than empty lyrics", async () => {
    stubJSON({ lyrics: "   " });

    await expect(create("lyricsovh").lyrics({ artist: "a", track: "b" })).rejects.toThrow(
      NotFoundError,
    );
  });

  it("refuses search at the capability gate", () => {
    expect(() => requireOperation(create("lyricsovh"), "search")).toThrow(
      UnsupportedOperationError,
    );
  });
});
