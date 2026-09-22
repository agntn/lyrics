import { runCommand } from "citty";
import consola from "consola";
import { afterEach, describe, expect, it, vi } from "vitest";
import syncedCommand from "../../src/commands/synced.ts";
import { register } from "../../src/core/registry.ts";
import { AttributedProvider, FAKE_SYNCED } from "../helpers.ts";

const FOOTER = "Source: https://example.com/placeholder\nPlaceholder attribution";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("synced command", () => {
  it.each([
    { args: [], text: FAKE_SYNCED },
    { args: ["--at", "25"], text: "[0:20] Second placeholder line" },
    { args: ["--at", "0"], text: "(nothing sung at 0s)" },
  ])("keeps provenance with output for $args", async ({ args, text }) => {
    register(AttributedProvider);
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    const log = vi.spyOn(consola, "log").mockImplementation(() => {});

    await runCommand(syncedCommand, {
      rawArgs: ["Placeholder Artist", "Placeholder Song", "-p", "attributed", ...args],
    });

    expect(log.mock.calls).toEqual([[`${text}\n\n${FOOTER}`]]);
    expect(fetch).not.toHaveBeenCalled();
  });
});
