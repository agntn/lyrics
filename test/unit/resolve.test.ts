import { afterEach, describe, expect, it, vi } from "vitest";
import { UnknownProviderError } from "../../src/core/errors.ts";
import { isConfigured, resolveProvider, selectProvider } from "../../src/core/resolve.ts";
import "../../src/providers/index.ts";

afterEach(() => {
  vi.unstubAllEnvs();
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
});
