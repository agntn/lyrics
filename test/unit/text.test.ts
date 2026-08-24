import { describe, expect, it } from "vitest";
import { InvalidInputError } from "../../src/core/errors.ts";
import {
  formatDuration,
  lineAt,
  lrcToPlain,
  normalizeLyrics,
  parseLrc,
} from "../../src/core/text.ts";
import { FAKE_SYNCED } from "../helpers.ts";

describe("normalizeLyrics", () => {
  it("collapses line endings, trailing spaces and blank runs", () => {
    const messy = "First line   \r\nSecond line\r\n\r\n\r\n\r\nThird line\n\n";

    expect(normalizeLyrics(messy)).toBe("First line\nSecond line\n\nThird line");
  });

  it("keeps a single blank line as a verse separator", () => {
    expect(normalizeLyrics("A\n\nB")).toBe("A\n\nB");
  });

  it("folds the non-breaking space that HTML providers deliver from &nbsp;", () => {
    const nbsp = String.fromCharCode(0x00_a0);

    expect(normalizeLyrics(`First${nbsp}line`)).toBe("First line");
  });

  it("drops a zero-width space instead of turning it into a gap", () => {
    const zeroWidth = String.fromCharCode(0x20_0b);

    expect(normalizeLyrics(`First${zeroWidth}line`)).toBe("Firstline");
  });
});

describe("parseLrc", () => {
  it("reads timestamps in both LRC forms", () => {
    expect(parseLrc("[00:10.00] alpha\n[1:05] beta")).toEqual([
      { time: 10, text: "alpha" },
      { time: 65, text: "beta" },
    ]);
  });

  it("expands a line repeated at several timestamps", () => {
    expect(parseLrc("[00:10.00][02:30.00] chorus")).toEqual([
      { time: 10, text: "chorus" },
      { time: 150, text: "chorus" },
    ]);
  });

  it("skips metadata tags and untimed lines", () => {
    expect(parseLrc("[ar:Someone]\nno timestamp here\n[00:05.00] alpha")).toEqual([
      { time: 5, text: "alpha" },
    ]);
  });

  it("orders lines by time even when the file does not", () => {
    expect(parseLrc("[00:30.00] later\n[00:05.00] earlier").map((line) => line.text)).toEqual([
      "earlier",
      "later",
    ]);
  });

  it("accepts the colon-separated hundredths some writers emit", () => {
    expect(parseLrc("[00:10:50] alpha")).toEqual([{ time: 10.5, text: "alpha" }]);
  });
});

describe("lrcToPlain", () => {
  it("strips timestamps and leaves the text", () => {
    expect(lrcToPlain(FAKE_SYNCED)).toBe(
      "First placeholder line\nSecond placeholder line\nThird placeholder line",
    );
  });
});

describe("lineAt", () => {
  it("returns the line in force at a moment", () => {
    expect(lineAt(FAKE_SYNCED, 25)).toEqual({ time: 20.5, text: "Second placeholder line" });
  });

  it("returns the line starting exactly at the requested second", () => {
    expect(lineAt(FAKE_SYNCED, 20.5)?.text).toBe("Second placeholder line");
  });

  it("returns nothing before the first timestamp", () => {
    expect(lineAt(FAKE_SYNCED, 2)).toBeUndefined();
  });

  it("holds the last line past the end", () => {
    expect(lineAt(FAKE_SYNCED, 9999)?.text).toBe("Third placeholder line");
  });

  it.each([Number.NaN, -1, Number.POSITIVE_INFINITY])("rejects %s as an offset", (seconds) => {
    expect(() => lineAt(FAKE_SYNCED, seconds)).toThrow(InvalidInputError);
  });
});

describe("formatDuration", () => {
  it.each([
    [0, "0:00"],
    [65, "1:05"],
    [239.4, "3:59"],
    [3600, "60:00"],
  ])("formats %s seconds as %s", (seconds, expected) => {
    expect(formatDuration(seconds)).toBe(expected);
  });
});
