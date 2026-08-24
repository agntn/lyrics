#!/usr/bin/env node

/** Lyrics CLI - unified song lyrics commands */
import { defineCommand, runMain } from "citty";
import { version } from "./version.ts";

/** Side-effect import: registers every built-in provider before the CLI parses arguments. */
import "./providers/index.ts";

const main = defineCommand({
  meta: {
    name: "lyrics",
    version,
    description: "Unified song lyrics CLI",
  },
  subCommands: {
    get: () => import("./commands/get.ts").then((m) => m.default),
    search: () => import("./commands/search.ts").then((m) => m.default),
    synced: () => import("./commands/synced.ts").then((m) => m.default),
    providers: () => import("./commands/providers.ts").then((m) => m.default),
    mcp: () => import("./commands/mcp.ts").then((m) => m.default),
  },
});

await runMain(main);
