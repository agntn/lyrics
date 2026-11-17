/** Who the server says it is. `lyrics --help` and MCP read the same card. */
import { version } from "./version.ts";

export const serverInfo = {
  name: "lyrics",
  version,
  description: "Song lyrics across providers: plain text, synced lines and translations",
} as const;
