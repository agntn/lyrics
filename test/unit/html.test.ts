import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { ParseError } from "../../src/core/errors.ts";
import {
  parseHtml,
  requireLyrics,
  selectLyrics,
  selectText,
  slugify,
} from "../../src/core/html.ts";

describe("parseHtml", () => {
  afterEach(() => {
    vi.doUnmock("node-html-parser");
    vi.resetModules();
  });

  /** Importing the package shouldn't drag the parser into a consumer's entry chunk. */
  it("loads the parser on the first page, not on import", async () => {
    const loaded = vi.fn();
    vi.resetModules();
    vi.doMock("node-html-parser", async (importOriginal) => {
      loaded();
      return importOriginal();
    });

    const lyrics = await import("../../src/index.ts");
    expect(loaded).not.toHaveBeenCalled();

    const root = await lyrics.parseHtml("<p id='x'>line</p>");
    expect(loaded).toHaveBeenCalledOnce();
    expect(selectText(root, "#x")).toBe("line");
  });

  it("turns <br> into a line break", async () => {
    const root = await parseHtml("<div id='x'>First line<br>Second line<br/>Third line</div>");

    expect(selectLyrics(root, "#x")).toBe("First line\nSecond line\nThird line");
  });

  it("decodes HTML entities in the text", async () => {
    const root = await parseHtml("<div id='x'>Don&#x27;t &amp; won&#39;t</div>");

    expect(selectText(root, "#x")).toBe("Don't & won't");
  });
});

describe("selectLyrics", () => {
  it("joins every matching container in document order", async () => {
    const root = await parseHtml("<p class='c'>First</p><p class='c'>Second</p>");

    expect(selectLyrics(root, ".c")).toBe("First\nSecond");
  });

  it("returns undefined when nothing matches", async () => {
    expect(selectLyrics(await parseHtml("<p>text</p>"), ".missing")).toBeUndefined();
  });

  it("treats a whitespace-only container as absent", async () => {
    expect(selectLyrics(await parseHtml("<div id='x'>   \n  </div>"), "#x")).toBeUndefined();
  });
});

describe("requireLyrics", () => {
  it("reports a layout change rather than returning nothing", async () => {
    const root = await parseHtml("<p>text</p>");

    expect(() => requireLyrics(root, ".gone", "tekstowo", "https://example.test/song")).toThrow(
      ParseError,
    );
  });

  it("carries the page URL on the error", async () => {
    const root = await parseHtml("<p>t</p>");
    try {
      requireLyrics(root, ".gone", "genius", "https://example.test/song");
      expect.unreachable("requireLyrics should have thrown");
    } catch (error) {
      expect(error).toBeInstanceOf(ParseError);
      expect((error as ParseError).url).toBe("https://example.test/song");
      expect((error as ParseError).provider).toBe("genius");
    }
  });
});

describe("slugify", () => {
  it.each(["(", "[", "+", ".", "|"])("accepts %s as a separator instead of throwing", (sep) => {
    expect(slugify("Test  Value", sep)).toBe(`test${sep}value`);
  });

  it("trims a multi-character separator from both ends", () => {
    expect(slugify(" Test Value ", "--")).toBe("test--value");
  });

  it.each([
    ["Radiohead", "", "radiohead"],
    ["Guns N' Roses", "", "gunsnroses"],
    ["AC/DC", "", "acdc"],
    ["Łukasz Dembiński", "-", "lukasz-dembinski"],
    ["13 czerwonych róż", "-", "13-czerwonych-roz"],
    ["  Spaced  Out  ", "-", "spaced-out"],
  ])("turns %s into %s", (value, separator, expected) => {
    expect(slugify(value, separator)).toBe(expected);
  });
});
