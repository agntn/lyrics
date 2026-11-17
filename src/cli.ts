#!/usr/bin/env node

/** Lyrics CLI: one command per lyrics tool, `synced`, and the MCP server. */

import { existsSync } from "node:fs";
import { sep } from "node:path";
import { fileURLToPath } from "node:url";
import { runCli } from "@agntn/tools/cli";
import { syncedCommand } from "./cli-commands.ts";
import { LyricsError } from "./core/errors.ts";
import type { createMcpServer } from "./mcp.ts";
import { serverInfo } from "./server-info.ts";
import { lyricsTools } from "./tools.ts";

/** Built at runtime, so the bundler leaves `src` out. The npm package ships only `dist`. */
const sourceMcp = new URL("../src/mcp.ts", import.meta.url);
const sourceMcpPath = fileURLToPath(sourceMcp);

/**
 * Narrows what a runtime URL import returned, which TypeScript types as `any`.
 * @param value - The imported module namespace.
 * @returns {value is { createMcpServer: typeof createMcpServer }} Whether it exports the server.
 */
function isMcpModule(value: unknown): value is { createMcpServer: typeof createMcpServer } {
  return typeof value === "object" && value !== null && "createMcpServer" in value;
}

/**
 * In a checkout `lyrics mcp` plays `src/` live. `LYRICS_DIST=1` keeps the bundle.
 * @param argv - Every argument after the bin.
 * @returns {boolean} Whether it's a bare `mcp` with source Node can run.
 */
function servesSource(argv: readonly string[]): boolean {
  return (
    argv.length === 1 &&
    argv[0] === "mcp" &&
    process.env["LYRICS_DIST"] !== "1" &&
    Boolean(process.features.typescript) &&
    !sourceMcpPath.includes(`${sep}node_modules${sep}`) &&
    existsSync(sourceMcpPath)
  );
}

/**
 * Serves `src/mcp.ts` over stdio.
 * @returns {Promise<void>} Once the server is connected.
 */
async function serveSource(): Promise<void> {
  const module: unknown = await import(sourceMcp.href);
  if (!isMcpModule(module)) throw new TypeError(`${sourceMcpPath} has no createMcpServer`);
  const { StdioServerTransport } = await import("@modelcontextprotocol/server/stdio");
  await module.createMcpServer().connect(new StdioServerTransport());
}

const argv = process.argv.slice(2);
if (servesSource(argv)) {
  await serveSource();
} else {
  await runCli(
    {
      ...serverInfo,
      tools: lyricsTools,
      commands: [syncedCommand],
      mcp: true,
      expected: (error) => error instanceof LyricsError,
    },
    argv,
  );
}
