import { callTool, createMcpServer as createToolServer, errorResult } from "@agntn/tools/mcp";
import type { Server } from "@modelcontextprotocol/server";
import { serverInfo } from "./server-info.ts";
import { sourceChangeCheck } from "./source-change.ts";
import { lyricsTools } from "./tools.ts";

const RESTART = "src/ changed under this server, restart it to load the new code";
const DROPPED =
  "src/ changed during this call, so its answer was dropped. Restart the server and ask again";

/** Counted from process start, so a pull during the first imports counts too. */
const changed = import.meta.url.endsWith(".ts")
  ? sourceChangeCheck(import.meta.dirname, performance.timeOrigin)
  : undefined;

/**
 * An unconnected MCP server with the lyrics tools; providers load on the first call.
 * Run from `src/`, it won't sing from a tree that changed under it: restart first.
 *
 * @returns {Server} The server.
 */
export function createMcpServer(): Server {
  const server = createToolServer(serverInfo, lyricsTools);
  if (!changed) return server;

  server.setRequestHandler("tools/call", async (request, ctx) => {
    if (changed()) return errorResult(RESTART);
    const result = await callTool(
      serverInfo,
      lyricsTools,
      request.params.name,
      request.params.arguments,
      { signal: ctx.mcpReq.signal },
    );
    return changed() ? errorResult(DROPPED) : result;
  });
  return server;
}
