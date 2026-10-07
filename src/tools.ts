/** The lyrics tools, declared once for every host. Executors load on the first call. */

import { defineTool, Type, type TOptional, type TString, type ToolDefinition } from "@agntn/tools";

type ToolOperations = typeof import("./tool-operations.ts");

let operations: Promise<ToolOperations> | undefined;

/** Loads the executors once. A failed load isn't cached, so a broken `dist` doesn't stick. */
export function loadOperations(): Promise<ToolOperations> {
  operations ??= import("./tool-operations.ts").catch((error: unknown) => {
    operations = undefined;
    throw error;
  });
  return operations;
}

/** Text that has to say something: blank or spaces only fail the schema, the executor trims. */
const FILLED = "\\S";

function text(description: string): TString {
  return Type.String({ pattern: FILLED, description });
}

function optionalText(description: string): TOptional<TString> {
  return Type.Optional(text(description));
}

/** Longest offset or track length anyone asks about: ten hours. */
const MAX_SECONDS = 36_000;

const artist = text("Performing artist");

const track = text("Track title");

const provider = optionalText(
  "Lyrics provider key, or 'all' to query every provider and compare; lyrics_providers lists the keys",
);

const duration = Type.Optional(
  Type.Number({
    exclusiveMinimum: 0,
    maximum: MAX_SECONDS,
    description: "Track length in seconds; sharpens the match on providers that use it",
  }),
);

const seconds = Type.Number({
  minimum: 0,
  maximum: MAX_SECONDS,
  description: "Offset from the start of the recording, in seconds",
});

export const providersSchema = Type.Object({});

export const providersTool = defineTool({
  name: "lyrics_providers",
  title: "List Providers",
  description: "List registered lyrics providers, their capabilities and credential state",
  snippet: "Use lyrics_providers to check which lyrics backends are available.",
  guidelines: [
    "Use lyrics_providers to list provider keys, their capabilities and which credentials are configured.",
  ],
  effect: "read",
  input: providersSchema,
  cli: { description: "List registered lyrics providers and capabilities" },
  execute: async () => (await loadOperations()).providers(),
});

export const searchSchema = Type.Object(
  {
    query: text("Free-form search query, for example 'radiohead creep'"),
    limit: Type.Optional(
      Type.Integer({
        minimum: 1,
        maximum: 50,
        description: "Max results; providers cap this at 10-20 and silently truncate",
      }),
    ),
    provider,
  },
  { additionalProperties: false },
);

export const searchTool = defineTool({
  name: "lyrics_search",
  title: "Search Tracks",
  description:
    "Find tracks matching a free-form query, best match first: album, length and the provider-native id to pass back to lyrics_get. Pass provider 'all' to compare every provider.",
  snippet: "Use lyrics_search to find the exact artist and title spelling for a song.",
  guidelines: [
    "Use lyrics_search when the artist or title spelling is uncertain; it returns candidates with album, length and provider id.",
    "Feed the id from lyrics_search into lyrics_get with the same provider for an exact lookup.",
  ],
  effect: "read",
  openWorld: true,
  input: searchSchema,
  cli: {
    description: "Search providers for tracks matching a query",
    rest: "query",
    short: { provider: "p", limit: "n" },
  },
  execute: async (params, { signal }) => (await loadOperations()).search(params, signal),
});

export const getSchema = Type.Object(
  {
    artist,
    track,
    album: optionalText("Album or release name"),
    duration,
    id: Type.Optional(
      Type.String({
        pattern: FILLED,
        maxLength: 200,
        description: "Provider-native track id from a previous lyrics_search on the same provider",
      }),
    ),
    synced: Type.Optional(
      Type.Boolean({ description: "Prefer synchronized LRC lyrics when the provider has them" }),
    ),
    translation: Type.Optional(
      Type.Boolean({
        description:
          "Return the translation instead of the original text; without a provider only providers with translations are tried",
      }),
    ),
    provider,
  },
  { additionalProperties: false },
);

export const getTool = defineTool({
  name: "lyrics_get",
  title: "Get Lyrics",
  description:
    "Fetch the lyrics of one track. Without a provider, providers are tried in order until one has the song. The result ends with the source URL and attribution, which belong with any quotation of the text.",
  snippet: "Use lyrics_get to fetch the words of a song by artist and title.",
  guidelines: [
    "Use lyrics_get with the artist and the track title; without a provider it walks providers until one has the song.",
    "Every lyrics_get result ends with the source URL and the provider's attribution - keep both with the text whenever you quote it.",
    "Pass provider 'all' to lyrics_get to compare what every provider has for the same track.",
    "Song lyrics are copyrighted: quote the shortest excerpt the task needs rather than repeating a whole lyrics_get result.",
  ],
  effect: "read",
  openWorld: true,
  input: getSchema,
  cli: {
    description: "Fetch the lyrics of one track",
    positional: ["artist", "track"],
    short: { provider: "p", duration: "d", synced: "s", translation: "t" },
  },
  execute: async (params, { signal }) => (await loadOperations()).get(params, signal),
});

export const lineAtSchema = Type.Object(
  {
    artist,
    track,
    seconds,
    duration,
    provider: optionalText("Provider that serves synchronized lyrics; omit to walk those that do"),
  },
  { additionalProperties: false },
);

export const lineAtTool = defineTool({
  name: "lyrics_line_at",
  title: "Read Line at Time",
  description:
    "Read the line sung at a given second of a track. Fetches the synchronized lyrics itself from a provider that serves them, so only that one line and its source come back.",
  snippet: "Use lyrics_line_at to find which line is sung at a moment of a song.",
  guidelines: [
    "Use lyrics_line_at with an artist, a title and an offset in seconds; it needs a provider that serves synchronized lyrics.",
    "lyrics_line_at fetches the synced text itself, so call it directly rather than passing lyrics from another tool.",
  ],
  effect: "read",
  openWorld: true,
  input: lineAtSchema,
  cli: {
    description: "Print the line sung at a given second of a track",
    positional: ["artist", "track", "seconds"],
    short: { provider: "p" },
  },
  execute: async (params, { signal }) => (await loadOperations()).lineAt(params, signal),
});

/** Every lyrics tool, in the order hosts list them. */
export const lyricsTools: readonly ToolDefinition[] = [
  providersTool,
  searchTool,
  getTool,
  lineAtTool,
];
