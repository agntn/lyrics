import { describe, expect, it } from "vitest";
import {
  AuthError,
  HTTPError,
  LyricsError,
  NotFoundError,
  PaymentError,
  RateLimitError,
  ResponseError,
  normalizeError,
} from "../../src/core/errors.ts";

/** Build the failure the HTTP client throws for a rejected status, before classification. */
function responseError(status: number, url: string, body = "", headers?: Record<string, string>) {
  return new ResponseError(status, url, body, new Headers(headers ?? {}));
}

describe("normalizeError", () => {
  it.each([
    [404, NotFoundError],
    [401, AuthError],
    [403, AuthError],
    [402, PaymentError],
    [429, RateLimitError],
    [500, HTTPError],
  ])("maps HTTP %s onto the right class", (status, expected) => {
    const error = normalizeError(responseError(status, "https://api.test/x"), "lrclib");

    expect(error).toBeInstanceOf(expected);
    expect(error.provider).toBe("lrclib");
  });

  it("reads retry-after off the response headers", () => {
    const error = normalizeError(
      responseError(429, "https://api.test/x", undefined, { "retry-after": "30" }),
      "lrclib",
    );

    expect(error).toBeInstanceOf(RateLimitError);
    expect((error as RateLimitError).retryAfter).toBe(30);
  });

  it("passes an existing library error through unchanged", () => {
    const original = new NotFoundError("track", "lrclib");

    expect(normalizeError(original, "genius")).toBe(original);
  });

  it("reads the status from the message when no structured error is available", () => {
    expect(normalizeError(new Error("HTTP 404 from somewhere"), "azlyrics")).toBeInstanceOf(
      NotFoundError,
    );
  });

  it("falls back to the base class for a failure with no status or URL", () => {
    const error = normalizeError(new Error("something odd"), "genius");

    expect(error).toBeInstanceOf(LyricsError);
    expect(error).not.toBeInstanceOf(HTTPError);
  });
});

describe("secret redaction", () => {
  it("redacts a key in the message of every error in the hierarchy", () => {
    const url = "https://api.musixmatch.com/ws/1.1/matcher.lyrics.get?q_track=x&apikey=SECRET123";
    const error = new HTTPError(500, url, `upstream said ${url}`, "musixmatch");

    expect(error.message).toContain("apikey=REDACTED");
    expect(error.message).not.toContain("SECRET123");
    expect(error.body).not.toContain("SECRET123");
    expect(error.rawUrl).not.toContain("SECRET123");
  });

  it("redacts a key carried in a normalized transport failure", () => {
    const error = normalizeError(
      responseError(500, "https://api.test/x?token=SECRET123"),
      "musixmatch",
    );

    expect(error.message).not.toContain("SECRET123");
  });

  it("keeps rawUrl off the enumerable surface", () => {
    const error = new HTTPError(500, "https://api.test/x", undefined, "lrclib");

    expect(Object.keys(error)).not.toContain("rawUrl");
    expect(error.rawUrl).toBe("https://api.test/x");
  });
});
