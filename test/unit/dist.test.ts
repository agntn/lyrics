import { existsSync, globSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vite-plus/test";

const root = fileURLToPath(new URL("../..", import.meta.url));

describe("the built package", () => {
  /** A map that sends you to the wrong line is worse than no map. */
  it.skipIf(!existsSync(join(root, "dist")))("ships no source maps", () => {
    const pointers = globSync("dist/**/*.{mjs,d.mts}", { cwd: root }).filter((file) =>
      readFileSync(join(root, file), "utf8").includes("sourceMappingURL"),
    );

    expect([...globSync("dist/**/*.map", { cwd: root }), ...pointers]).toEqual([]);
  });
});
