import { createServer } from "node:http";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vite-plus/test";
import { getJSON, getText } from "../../src/core/client.ts";
import {
  AuthError,
  HTTPError,
  InvalidInputError,
  NotFoundError,
  RateLimitError,
} from "../../src/core/errors.ts";

const URL_ = "https://lyrics.test/api/get";

afterEach(() => {
  vi.unstubAllGlobals();
});

type Signal = AbortSignal | null | undefined;

/** Stub fetch like undici: an aborted signal rejects unsent, a live one reaches `respond`. */
function stubFetch(respond: (signal: Signal) => Promise<Response>) {
  const fetch = vi.fn<typeof globalThis.fetch>((_input, init) =>
    init?.signal?.aborted ? Promise.reject(init.signal.reason) : respond(init?.signal),
  );
  vi.stubGlobal("fetch", fetch);
  return fetch;
}

/** A request that never answers and settles only when its signal aborts. */
function stall(signal: Signal): Promise<Response> {
  return new Promise((_, reject) => {
    signal?.addEventListener("abort", () => reject(signal.reason), { once: true });
  });
}

/** Headers of the one request the stub saw. */
function sentHeaders(fetch: ReturnType<typeof stubFetch>): Headers {
  return new Headers(fetch.mock.calls[0]?.[1]?.headers);
}

describe("successful responses", () => {
  it("parses JSON and identifies itself", async () => {
    const fetch = stubFetch(async () => Response.json({ id: 496 }));

    await expect(getJSON(URL_)).resolves.toEqual({ id: 496 });
    const headers = sentHeaders(fetch);
    expect(headers.get("accept")).toBe("application/json");
    expect(headers.get("user-agent")).toMatch(/^agntn-lyrics\/\S+ \(\+https:/);
  });

  it("lets caller headers override the defaults", async () => {
    const fetch = stubFetch(async () => Response.json({}));

    await getJSON(URL_, { headers: { Accept: "application/vnd.test+json", "X-Key": "k" } });
    const headers = sentHeaders(fetch);
    expect(headers.get("accept")).toBe("application/vnd.test+json");
    expect(headers.get("x-key")).toBe("k");
  });

  it("parses JSON served as text/plain", async () => {
    stubFetch(async () => new Response('{"lyrics":"First placeholder line"}'));

    await expect(getJSON(URL_)).resolves.toEqual({ lyrics: "First placeholder line" });
  });

  it("keeps an HTML page a string even when it claims to be JSON", async () => {
    const fetch = stubFetch(async () => Response.json({ error: "maintenance" }));

    await expect(getText(URL_)).resolves.toBe('{"error":"maintenance"}');
    expect(sentHeaders(fetch).get("accept")).toBe("text/html,application/xhtml+xml");
  });

  it("drops keys that would reach a prototype", async () => {
    stubFetch(async () => new Response('{"track":"Placeholder","__proto__":{"polluted":true}}'));

    const record = await getJSON<Record<string, unknown>>(URL_);
    expect(record).toEqual({ track: "Placeholder" });
    expect(Object.getPrototypeOf(record)).toBe(Object.prototype);
  });
});

describe("empty responses", () => {
  it("answers a bodiless status with nothing for JSON and an empty page for HTML", async () => {
    stubFetch(async () => new Response(null, { status: 204 }));

    await expect(getJSON(URL_)).resolves.toBeUndefined();
    await expect(getText(URL_)).resolves.toBe("");
  });

  it("reads an empty body as an empty string", async () => {
    stubFetch(async () => new Response(""));

    await expect(getJSON(URL_)).resolves.toBe("");
    await expect(getText(URL_)).resolves.toBe("");
  });
});

describe("HTTP failures", () => {
  it("maps a 404 onto NotFoundError with the provider attached", async () => {
    stubFetch(async () => Response.json({ name: "TrackNotFound" }, { status: 404 }));

    const error = await getJSON(URL_, { provider: "lrclib" }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(NotFoundError);
    expect(error).toMatchObject({ provider: "lrclib" });
  });

  it("maps a 403 HTML page onto AuthError", async () => {
    stubFetch(async () => new Response("<h1>Forbidden</h1>", { status: 403 }));

    await expect(getText(URL_, { provider: "azlyrics" })).rejects.toBeInstanceOf(AuthError);
  });

  it("keeps the status and body of a server error and does not retry it", async () => {
    const fetch = stubFetch(async () => new Response("down for maintenance", { status: 503 }));

    await expect(getJSON(URL_, { provider: "lrclib" })).rejects.toMatchObject({
      name: "HTTPError",
      statusCode: 503,
      body: "down for maintenance",
      provider: "lrclib",
    });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("keeps an empty error body empty", async () => {
    stubFetch(async () => new Response("", { status: 500 }));

    await expect(getJSON(URL_)).rejects.toMatchObject({ name: "HTTPError", body: "" });
  });

  it("reads retry-after off a rate limit", async () => {
    stubFetch(async () => new Response("", { status: 429, headers: { "Retry-After": "30" } }));

    const error = await getJSON(URL_, { provider: "lrclib" }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(RateLimitError);
    expect(error).toMatchObject({ retryAfter: 30 });
  });

  it("redacts a key from the URL and the echoed body", async () => {
    const url = "https://api.musixmatch.test/ws/1.1/track.search?q=x&apikey=SECRET123";
    stubFetch(async () => new Response(`bad request to ${url}`, { status: 400 }));

    const error = await getJSON(url, { provider: "musixmatch" }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(HTTPError);
    expect(JSON.stringify(error) + String(error)).not.toContain("SECRET123");
  });
});

describe("deadline and cancellation", () => {
  it("gives every request a deadline by default", async () => {
    const fetch = stubFetch(async () => Response.json({}));

    await getJSON(URL_);
    const signal = fetch.mock.calls[0]?.[1]?.signal;
    expect(signal).toBeInstanceOf(AbortSignal);
    expect(signal?.aborted).toBe(false);
  });

  it("turns a stalled request into an HTTPError once the timeout passes", async () => {
    stubFetch(stall);

    await expect(getJSON(URL_, { timeout: 50 })).rejects.toMatchObject({
      name: "HTTPError",
      statusCode: 0,
    });
  });

  it("keeps the timeout when the caller passes a signal of its own", async () => {
    stubFetch(stall);

    await expect(
      getText(URL_, { timeout: 50, signal: new AbortController().signal }),
    ).rejects.toMatchObject({ name: "HTTPError", statusCode: 0 });
  });

  it("stops a request in flight when the caller aborts", async () => {
    const fetch = stubFetch(stall);
    const controller = new AbortController();

    const pending = getJSON(URL_, { signal: controller.signal });
    await vi.waitFor(() => expect(fetch).toHaveBeenCalled());
    controller.abort();

    await expect(pending).rejects.toBeInstanceOf(HTTPError);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("waits indefinitely when the timeout is 0", async () => {
    const fetch = stubFetch(async () => Response.json({}));

    await getJSON(URL_, { timeout: 0 });
    expect(fetch.mock.calls[0]?.[1]?.signal).toBeUndefined();
  });

  it("rounds a fractional timeout up instead of rejecting it", async () => {
    stubFetch(async () => Response.json({ ok: true }));

    await expect(getJSON(URL_, { timeout: 1.5 })).resolves.toEqual({ ok: true });
  });

  it.each([Number.NaN, -1, -0.5, Number.POSITIVE_INFINITY, 2 ** 31])(
    "refuses a timeout of %s before sending anything",
    async (timeout) => {
      const fetch = stubFetch(async () => Response.json({}));

      await expect(getJSON(URL_, { timeout, provider: "lrclib" })).rejects.toBeInstanceOf(
        InvalidInputError,
      );
      expect(fetch).not.toHaveBeenCalled();
    },
  );
});

describe("against a real server", () => {
  let server: Server;
  let base: string;
  const agents: (string | undefined)[] = [];

  beforeAll(async () => {
    server = createServer((request, response) => {
      agents.push(request.headers["user-agent"]);
      if (request.url === "/piosenka") {
        response.writeHead(301, { Location: "/artist/title" }).end();
      } else if (request.url === "/artist/title") {
        response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        response.end("<div id='songText'>Pierwsza linijka, zażółć gęślą jaźń</div>");
      } else {
        response.writeHead(404).end();
      }
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    await new Promise((resolve) => server.close(resolve));
  });

  it("follows a redirect to the page, decodes it and identifies itself on both hops", async () => {
    await expect(getText(`${base}/piosenka`)).resolves.toBe(
      "<div id='songText'>Pierwsza linijka, zażółć gęślą jaźń</div>",
    );
    expect(agents).toHaveLength(2);
    for (const agent of agents) expect(agent).toMatch(/^agntn-lyrics\/\S+ \(\+https:/);
  });

  it("maps the server's 404 onto NotFoundError", async () => {
    await expect(getJSON(`${base}/missing`, { provider: "lrclib" })).rejects.toBeInstanceOf(
      NotFoundError,
    );
  });
});
