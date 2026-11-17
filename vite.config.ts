import oxfmt from "@agntn/ox/oxfmt";
import oxlint from "@agntn/ox/oxlint";
import { defineConfig } from "vite-plus";

/** Lint, format and test run on Vite+. The build stays on obuild (`build.config.ts`). */
export default defineConfig({
  fmt: { ...oxfmt, ignorePatterns: ["dist"] },
  lint: {
    ...oxlint,
    rules: {
      ...oxlint.rules,
      "typescript/prefer-readonly-parameter-types": [
        "error",
        {
          allow: [
            /* Public types and the provider itself. An internal type gets `readonly` instead. */
            {
              from: "file",
              name: [
                "ClientOptions",
                "FallbackResult",
                "Lyrics",
                "LyricsError",
                "Provider",
                "ProviderConfig",
                "ProviderListing",
                "ProviderOutcome",
                "SearchOptions",
                "SyncedLine",
                "TrackMatch",
                "TrackQuery",
              ],
            },
            /* Lib types the rule reads as mutable whatever wraps them. */
            { from: "lib", name: ["AbortSignal", "Headers", "Response"] },
            /* `HTMLElement`, the page the HTML providers query, exported as `default`. */
            { from: "package", name: "default", package: "node-html-parser" },
            {
              from: "package",
              name: ["ExtensionAPI"],
              package: "@earendil-works/pi-coding-agent",
            },
            { from: "package", name: ["ExtensionAPI"], package: "@oh-my-pi/pi-coding-agent" },
          ],
          ignoreInferredTypes: true,
        },
      ],
    },
    overrides: [
      {
        /* Tests build mutable doubles and need no API docs. */
        files: ["test/**/*.ts"],
        rules: {
          "jsdoc/require-param": "off",
          "jsdoc/require-returns": "off",
          "typescript/prefer-readonly-parameter-types": "off",
        },
      },
    ],
    ignorePatterns: ["dist"],
  },
  test: {
    include: ["test/**/*.test.ts"],
    setupFiles: ["./test/setup.ts"],
  },
});
