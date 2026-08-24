import { defineCommand } from "citty";

export default defineCommand({
  meta: {
    name: "mcp",
    description: "Run the Lyrics MCP server over stdio",
  },
  /**
   * The SDK and the server load here, not at module scope.
   *
   * citty resolves every lazy subcommand to read its `meta` when rendering help, so a top-level
   * import would pull the MCP SDK into `lyrics --help` and every other command - measured at
   * roughly twice the startup time for people who never run the server.
   */
  async run() {
    const [{ StdioServerTransport }, { createMcpServer }] = await Promise.all([
      import("@modelcontextprotocol/sdk/server/stdio.js"),
      import("../mcp.ts"),
    ]);
    await createMcpServer().connect(new StdioServerTransport());
  },
});
