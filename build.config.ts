import { defineBuildConfig } from "obuild/config";

export default defineBuildConfig({
  /** One bundle, so a provider registered through the main entry is the one MCP and the tools see. */
  entries: [
    {
      type: "bundle",
      input: ["./src/index.ts", "./src/cli.ts", "./src/mcp.ts", "./src/ai.ts", "./src/tools.ts"],
      /** No maps: obuild's comment stripping knocks every one off its line. */
      dts: { sourcemap: false },
    },
  ],
});
