/** Vercel AI SDK tool surface over the shared lyrics tool definitions. */

import type { Static } from "@agntn/tools";
import { toAiTool, type AiToolOutput } from "@agntn/tools/ai";
import type { Tool } from "ai";
import type {
  LineAtDetails,
  LyricsDetails,
  ProvidersDetails,
  SearchDetails,
} from "./tool-operations.ts";
import {
  getSchema,
  getTool,
  lineAtSchema,
  lineAtTool as lineAtDefinition,
  providersSchema,
  providersTool as providersDefinition,
  searchSchema,
  searchTool as searchDefinition,
} from "./tools.ts";

export const searchTool: Tool<Static<typeof searchSchema>, AiToolOutput<SearchDetails>> = toAiTool(
  searchDefinition,
);

export const lyricsTool: Tool<Static<typeof getSchema>, AiToolOutput<LyricsDetails>> = toAiTool(
  getTool,
);

export const lineAtTool: Tool<Static<typeof lineAtSchema>, AiToolOutput<LineAtDetails>> = toAiTool(
  lineAtDefinition,
);

export const providersTool: Tool<
  Static<typeof providersSchema>,
  AiToolOutput<ProvidersDetails>
> = toAiTool(providersDefinition);
