/** Zod fragments shared by the MCP server and the AI SDK tools. */

import { z } from "zod";

/** Optional provider selector; empty-like strings are rejected before selection. */
export const providerInput = {
  provider: z
    .string()
    .trim()
    .min(1)
    .optional()
    .describe("Lyrics provider key, or 'all' to query every provider and compare"),
};

/** Free-form query for track search. */
export const queryInput = z
  .string()
  .trim()
  .min(1)
  .describe("Free-form search query, for example 'radiohead creep'");

/** Performing artist of the wanted track. */
export const artistInput = z.string().trim().min(1).describe("Performing artist");

/** Title of the wanted track. */
export const trackInput = z.string().trim().min(1).describe("Track title");

/** Release name, used by the providers that match on it. */
export const albumInput = z.string().trim().min(1).optional().describe("Album or release name");

/** Track length, which LRCLIB uses to pick between recordings of the same title. */
export const durationInput = z
  .number()
  .positive()
  .max(36_000)
  .optional()
  .describe("Track length in seconds; sharpens the match on providers that use it");

/** Provider-native identifier carried over from a search result. */
export const trackIdInput = z
  .string()
  .trim()
  .min(1)
  .max(200)
  .optional()
  .describe("Provider-native track id from a previous search on the same provider");

/** Search result bound; providers clamp to their own maximum. */
export const limitInput = z
  .number()
  .int()
  .positive()
  .max(50)
  .optional()
  .describe("Max results; providers cap this at 10-20 and silently truncate");

/** Position in the recording, for reading a synced line at a moment. */
export const secondsInput = z
  .number()
  .nonnegative()
  .max(36_000)
  .describe("Offset from the start of the recording, in seconds");

/** LRC text to read locally, without contacting any provider. */
export const lrcInput = z
  .string()
  .min(1)
  .max(200_000)
  .describe("Synchronized lyrics in LRC format, as returned in the 'synced' field");
