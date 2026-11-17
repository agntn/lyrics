import { createMcpServer as createToolServer } from "@agntn/tools/mcp";
import type { Server } from "@modelcontextprotocol/server";
import { lyricsTools } from "./tools.ts";
import { version } from "./version.ts";

/**
 * An unconnected MCP server with the lyrics tools; providers load on the first call.
 *
 * @returns {Server} The server.
 */
export function createMcpServer(): Server {
  return createToolServer({ name: "lyrics", version }, lyricsTools);
}
