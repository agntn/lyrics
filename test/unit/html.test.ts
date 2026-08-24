import { describe, expect, it } from "vitest";
import { ParseError } from "../../src/core/errors.ts";
import {
  parseHtml,
  requireLyrics,
  selectLyrics,
  selectText,
  slugify,
} from "../../src/core/html.ts";

describe("parseHtml", () => {
  it("turns <br> into a line break", () => {
    const root = parseHtml("<div id='x'>First line<br>Second line<br/>Third line</div>");

    expect(selectLyrics(root, "#x")).toBe("First line\nSecond line\nThird line");
  });

  it("decodes HTML entities in the text", () => {
    const root = parseHtml("<div id='x'>Don&#x27;t &amp; won&#39;t</div>");

    expect(selectText(root, "#x")).toBe("Don't & won't");
  });
});

describe("selectLyrics", () => {
  it("joins every matching container in document order", () => {
    const root = parseHtml("<p class='c'>First</p><p class='c'>Second</p>");

    expect(selectLyrics(root, ".c")).toBe("First\nSecond");
  });

  it("returns undefined when nothing matches", () => {
    expect(selectLyrics(parseHtml("<p>text</p>"), ".missing")).toBeUndefined();
  });

  it("treats a whitespace-only container as absent", () => {
    expect(selectLyrics(parseHtml("<div id='x'>   \n  </div>"), "#x")).toBeUndefined();
  });
});

describe("requireLyrics", () => {
  it("reports a layout change rather than returning nothing", () => {
    expect(() =>
      requireLyrics(parseHtml("<p>text</p>"), ".gone", "tekstowo", "https://example.test/song"),
    ).toThrow(ParseError);
  });

  it("carries the page URL on the error", () => {
    try {
      requireLyrics(parseHtml("<p>t</p>"), ".gone", "genius", "https://example.test/song");
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
