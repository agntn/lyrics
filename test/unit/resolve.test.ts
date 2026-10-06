import { afterEach, describe, expect, it, vi } from "vitest";
import { UnknownProviderError } from "../../src/core/errors.ts";
import {
  isConfigured,
  providerArg,
  resolveProvider,
  selectProvider,
  usableProviders,
} from "../../src/core/resolve.ts";
import "../../src/providers/index.ts";
import { stubPendingFetch } from "../helpers.ts";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("resolveProvider", () => {
  it("honors an explicitly registered provider", () => {
    expect(resolveProvider("azlyrics")).toBe("azlyrics");
  });

  it("honors an explicit provider even for an operation it cannot serve", () => {
    expect(resolveProvider("lyricsovh", "search")).toBe("lyricsovh");
  });

  it("rejects an unknown explicit provider", () => {
    expect(() => resolveProvider("missing")).toThrow(UnknownProviderError);
  });

  it("defaults to the keyless provider that returns whole songs", () => {
    expect(resolveProvider()).toBe("lrclib");
  });

  it("filters candidates by the requested operation", () => {
    expect(resolveProvider(undefined, "search")).toBe("lrclib");
  });

  it("does not let a configured key capture traffic from a keyless provider", () => {
    vi.stubEnv("MUSIXMATCH_API_KEY", "configured");

    expect(resolveProvider()).toBe("lrclib");
  });

  it("skips a keyed provider that has no credentials", () => {
    expect(isConfigured("genius")).toBe(false);
    expect(isConfigured("lrclib")).toBe(true);
  });

  it("treats a keyed provider as available once its variable is set", () => {
    vi.stubEnv("GENIUS_ACCESS_TOKEN", "token");

    expect(isConfigured("genius")).toBe(true);
  });
});

describe("selectProvider", () => {
  it("returns a ready-to-use provider instance", () => {
    const selected = selectProvider("lrclib");

    expect(selected.name).toBe("lrclib");
    expect(selected.provider.name).toBe("lrclib");
  });

  it.each(["", "   "])("treats an empty-like provider as absent", (value) => {
    expect(selectProvider(value).name).toBe("lrclib");
  });

  it("rejects an unknown explicit provider", () => {
    expect(() => selectProvider("missing")).toThrow(UnknownProviderError);
  });

  it("hands the caller's signal to every request of the provider", async () => {
    const signals = stubPendingFetch();
    const controller = new AbortController();
    const { provider } = selectProvider("lrclib", "lyrics", controller.signal);

    const pending = provider.lyrics({ artist: "Placeholder Artist", track: "Placeholder Song" });
    await vi.waitFor(() => expect(signals).toHaveLength(1));
    controller.abort();

    await expect(pending).rejects.toThrow();
    expect(signals[0]?.aborted).toBe(true);
  });
});

describe("usableProviders", () => {
  it("lists providers per capability, not only per operation", () => {
    expect(usableProviders("translation")).toEqual(["tekstowo"]);
    expect(usableProviders("synced")).toEqual(["lrclib"]);
    expect(usableProviders("search")).toEqual(["lrclib", "tekstowo"]);
  });

  it("admits a keyed provider once its variable is set", () => {
    expect(usableProviders("search")).not.toContain("musixmatch");
    vi.stubEnv("MUSIXMATCH_API_KEY", "key");
    expect(usableProviders("search")).toContain("musixmatch");
  });

  it("keeps registration order", () => {
    const lyrics = usableProviders("lyrics");
    expect(lyrics.indexOf("lrclib")).toBeLessThan(lyrics.indexOf("tekstowo"));
  });
});

describe("providerArg", () => {
  it.each([undefined, "", "   ", "\t"])("treats %j as no preference", (value) => {
    expect(providerArg(value)).toBeUndefined();
  });

  it("trims a named provider", () => {
    expect(providerArg("  lrclib ")).toBe("lrclib");
  });
});
