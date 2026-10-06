import { afterEach, describe, expect, it, vi } from "vitest";
import { lyricsAll, lyricsWithFallback, searchAll, serializeOutcomes } from "../../src/core/all.ts";
import { NotFoundError, RateLimitError } from "../../src/core/errors.ts";
import { Provider, requireOperation } from "../../src/core/provider.ts";
import type { Lyrics, ProviderCapabilities, TrackQuery } from "../../src/core/types.ts";
import { create, register } from "../../src/core/registry.ts";
import { FAKE_PLAIN, stubHTML, stubJSON, stubPendingFetch } from "../helpers.ts";
import { usableProviders } from "../../src/core/resolve.ts";
import "../../src/providers/index.ts";

/** Behaviour a scripted provider should show for one call. */
type Behaviour = "hit" | "miss" | "rate-limit";

/** Build a provider class whose registry key and outcome are fixed up front. */
function scripted(key: string, behaviour: Behaviour) {
  return class Scripted extends Provider {
    static readonly key = key;

    get capabilities(): ProviderCapabilities {
      return { search: false, lyrics: true, synced: false, translation: false };
    }

    async lyrics(query: TrackQuery): Promise<Lyrics> {
      if (behaviour === "miss") throw new NotFoundError(`${query.artist} - ${query.track}`, key);
      if (behaviour === "rate-limit") throw new RateLimitError(key, 30);
      return {
        provider: key,
        artist: query.artist,
        track: query.track,
        plain: FAKE_PLAIN,
        instrumental: false,
        partial: false,
      };
    }
  };
}

const QUERY: TrackQuery = { artist: "Placeholder Artist", track: "Placeholder Song" };

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("lyricsWithFallback", () => {
  it("returns the first provider that has the track", async () => {
    register(scripted("miss-one", "miss"));
    register(scripted("has-it", "hit"));

    const result = await lyricsWithFallback(QUERY, ["miss-one", "has-it"]);

    expect(result.provider).toBe("has-it");
    expect(result.lyrics.plain).toBe(FAKE_PLAIN);
  });

  it("records why each earlier provider was passed over", async () => {
    register(scripted("miss-one", "miss"));
    register(scripted("has-it", "hit"));

    const result = await lyricsWithFallback(QUERY, ["miss-one", "has-it"]);

    expect(result.skipped).toEqual([
      { provider: "miss-one", error: expect.stringContaining("Not found") },
    ]);
  });

  it("stops on a failure that is not about this provider missing the song", async () => {
    register(scripted("limited", "rate-limit"));
    register(scripted("has-it", "hit"));

    await expect(lyricsWithFallback(QUERY, ["limited", "has-it"])).rejects.toThrow(RateLimitError);
  });

  it("skips a provider that cannot serve lyrics at all", async () => {
    register(scripted("has-it", "hit"));

    const result = await lyricsWithFallback(QUERY, ["lyricsovh-like-missing", "has-it"]).catch(
      (error: unknown) => error,
    );

    expect(result).toBeInstanceOf(Error);
  });

  it("throws the last failure when nobody has the track", async () => {
    register(scripted("miss-one", "miss"));
    register(scripted("miss-two", "miss"));

    await expect(lyricsWithFallback(QUERY, ["miss-one", "miss-two"])).rejects.toThrow(
      NotFoundError,
    );
  });

  it("throws when handed an empty provider order", async () => {
    await expect(lyricsWithFallback(QUERY, [])).rejects.toThrow(NotFoundError);
  });
});

describe("capability-scoped fallback", () => {
  it("walks only the providers that serve the wanted capability", async () => {
    const order = usableProviders("translation");
    stubHTML(`<html><body><h1>A - B</h1>
      <div id="songText"><div class="inner-text">Original line</div></div>
      <div id="translation"><div class="inner-text">Translated line</div></div></body></html>`);

    const result = await lyricsWithFallback(QUERY, order);

    expect(order).toEqual(["tekstowo"]);
    expect(result.provider).toBe("tekstowo");
    expect(result.lyrics.translation).toBe("Translated line");
  });

  it("would otherwise stop at a provider that has no translation at all", async () => {
    stubJSON({ id: 1, trackName: "b", artistName: "a", plainLyrics: FAKE_PLAIN });

    const unscoped = await lyricsWithFallback(QUERY);

    expect(unscoped.provider).toBe("lrclib");
    expect(unscoped.lyrics.translation).toBeUndefined();
  });
});

describe("lyricsAll", () => {
  it("keeps failures beside results instead of hiding them", async () => {
    stubJSON({ message: "Failed to find specified track" }, 404);

    const outcomes = await lyricsAll(QUERY);
    const byProvider = new Map(outcomes.map((outcome) => [outcome.provider, outcome]));

    expect(byProvider.get("musixmatch")?.error?.message).toContain("MUSIXMATCH_API_KEY");
    expect(outcomes.length).toBeGreaterThanOrEqual(6);
  });
});

describe("searchAll", () => {
  it("reports the capability gate for providers that cannot search", async () => {
    stubJSON([]);

    const outcomes = await searchAll("placeholder");
    const lyricsovh = outcomes.find((outcome) => outcome.provider === "lyricsovh");

    expect(lyricsovh?.error?.message).toContain('Operation "search" not supported');
  });
});

/** Reports any failed request as a miss, the way a provider outside this package might. */
class MissOnFailure extends Provider {
  static readonly key = "miss-on-failure";

  get capabilities(): ProviderCapabilities {
    return { search: false, lyrics: true, synced: false, translation: false };
  }

  async lyrics(query: TrackQuery): Promise<Lyrics> {
    try {
      return await this.getJSON<Lyrics>("https://example.com/lyrics");
    } catch {
      throw new NotFoundError(`${query.artist} - ${query.track}`, MissOnFailure.key);
    }
  }
}

describe("cancellation", () => {
  it("stops a fallback walk at the provider it reached", async () => {
    const signals = stubPendingFetch();
    const controller = new AbortController();

    const pending = lyricsWithFallback(QUERY, ["lrclib", "lyricsovh"], controller.signal);
    await vi.waitFor(() => expect(signals).toHaveLength(1));
    controller.abort();

    await expect(pending).rejects.toThrow();
    expect(signals).toHaveLength(1);
    expect(signals[0]?.aborted).toBe(true);
  });

  it("does not walk on when an aborted request comes back as a miss", async () => {
    register(MissOnFailure);
    const signals = stubPendingFetch();
    const controller = new AbortController();

    const pending = lyricsWithFallback(QUERY, ["miss-on-failure", "lrclib"], controller.signal);
    await vi.waitFor(() => expect(signals).toHaveLength(1));
    controller.abort();

    await expect(pending).rejects.toThrow(NotFoundError);
    expect(signals).toHaveLength(1);
  });

  it.each([
    ["lyricsAll", (signal: AbortSignal) => lyricsAll(QUERY, signal)],
    ["searchAll", (signal: AbortSignal) => searchAll("placeholder", {}, signal)],
  ])("cancels every request of %s", async (_name, run) => {
    const signals = stubPendingFetch();
    const controller = new AbortController();

    const pending = run(controller.signal);
    await vi.waitFor(() => expect(signals.length).toBeGreaterThan(1));
    controller.abort();
    const outcomes = await pending;

    expect(signals.every((signal) => signal.aborted)).toBe(true);
    expect(outcomes.some((outcome) => outcome.error)).toBe(true);
  });
});

describe("serializeOutcomes", () => {
  it("reduces errors to their messages for JSON surfaces", () => {
    const serialized = serializeOutcomes([
      { provider: "lrclib", result: [1, 2] },
      { provider: "genius", error: new NotFoundError("track", "genius") },
    ]);

    expect(serialized).toEqual([
      { provider: "lrclib", result: [1, 2] },
      { provider: "genius", error: "Not found: track" },
    ]);
  });
});

describe("registry isolation", () => {
  it("leaves the built-in providers usable after scripted registrations", () => {
    expect(() => requireOperation(create("lrclib"), "lyrics")).not.toThrow();
  });
});
