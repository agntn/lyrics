import { afterEach, describe, expect, it, vi } from "vitest";
import { UnknownProviderError, UnsupportedOperationError } from "../../src/core/errors.ts";
import { Provider, requireOperation } from "../../src/core/provider.ts";
import type { ProviderCapabilities } from "../../src/core/types.ts";
import {
  create,
  getEnvKey,
  has,
  listProviders,
  providers,
  register,
  supportsOperation,
} from "../../src/core/registry.ts";
import "../../src/providers/index.ts";

const BUILT_INS = ["lrclib", "lyricsovh", "genius", "tekstowo", "azlyrics", "musixmatch"];

/** A provider that claims an operation it never implemented. */
class LyingProvider extends Provider {
  static readonly key = "lying";

  get capabilities(): ProviderCapabilities {
    return { search: true, lyrics: true, synced: false, translation: false };
  }

  async lyrics(): Promise<never> {
    throw new Error("unreachable in this test");
  }
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("registry", () => {
  it("registers every built-in provider in fallback order", () => {
    expect(providers()).toEqual(expect.arrayContaining(BUILT_INS));
    expect(providers().slice(0, BUILT_INS.length)).toEqual(BUILT_INS);
  });

  it("rejects an unknown provider name", () => {
    expect(() => create("nope")).toThrow(UnknownProviderError);
    expect(has("nope")).toBe(false);
  });

  it("reads the credential variable off the provider class", () => {
    expect(getEnvKey("genius")).toBe("GENIUS_ACCESS_TOKEN");
    expect(getEnvKey("musixmatch")).toBe("MUSIXMATCH_API_KEY");
    expect(getEnvKey("lrclib")).toBeUndefined();
  });

  it("answers capability questions without constructing credentials", () => {
    expect(supportsOperation("lyricsovh", "search")).toBe(false);
    expect(supportsOperation("lyricsovh", "lyrics")).toBe(true);
    expect(supportsOperation("musixmatch", "search")).toBe(true);
    expect(supportsOperation("nope", "lyrics")).toBe(false);
  });

  it("reports which providers are configured in the current environment", () => {
    vi.stubEnv("GENIUS_ACCESS_TOKEN", "token");
    const listing = listProviders();

    expect(listing.find((entry) => entry.name === "genius")).toMatchObject({
      envKey: "GENIUS_ACCESS_TOKEN",
      configured: true,
    });
    expect(listing.find((entry) => entry.name === "musixmatch")).toMatchObject({
      configured: false,
    });
    expect(listing.find((entry) => entry.name === "lrclib")).toMatchObject({ configured: true });
  });

  it("lists capabilities for every provider, keyed or not", () => {
    for (const entry of listProviders()) {
      expect(Object.keys(entry.capabilities).sort()).toEqual([
        "lyrics",
        "search",
        "synced",
        "translation",
      ]);
    }
  });
});

describe("requireOperation", () => {
  it("returns a bound method for a supported operation", async () => {
    const provider = create("lrclib");

    expect(typeof requireOperation(provider, "lyrics")).toBe("function");
  });

  it("refuses an operation the provider does not serve", () => {
    expect(() => requireOperation(create("lyricsovh"), "search")).toThrow(
      UnsupportedOperationError,
    );
  });

  it("refuses an advertised operation that has no implementation", () => {
    register(LyingProvider);

    expect(() => requireOperation(create("lying"), "search")).toThrow(UnsupportedOperationError);
  });
});

describe("capability contract", () => {
  it("implements every operation each built-in provider advertises", () => {
    for (const name of BUILT_INS) {
      const provider = create(name);
      for (const operation of ["search", "lyrics"] as const) {
        if (provider.capabilities[operation]) {
          expect(typeof provider[operation]).toBe("function");
        }
      }
    }
  });

  it("keeps synced and translation on the providers that actually serve them", () => {
    expect(create("lrclib").capabilities.synced).toBe(true);
    expect(create("tekstowo").capabilities.translation).toBe(true);
    for (const name of ["lyricsovh", "genius", "azlyrics", "musixmatch"]) {
      expect(create(name).capabilities.synced).toBe(false);
    }
  });
});
