#!/usr/bin/env node

/** Lyrics CLI: one command per lyrics tool, `synced`, and the MCP server. */
import { runCli } from "@agntn/tools/cli";
import { syncedCommand } from "./cli-commands.ts";
import { LyricsError } from "./core/errors.ts";
import { lyricsTools } from "./tools.ts";
import { version } from "./version.ts";

await runCli({
  name: "lyrics",
  version,
  description: "Unified song lyrics CLI",
  tools: lyricsTools,
  commands: [syncedCommand],
  mcp: true,
  expected: (error) => error instanceof LyricsError,
});
