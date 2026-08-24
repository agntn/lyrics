/** Lyrics text normalization and LRC handling, shared by providers and every surface. */

import { InvalidInputError } from "./errors.ts";

/** One timed line of an LRC file. */
export interface SyncedLine {
  /** Offset from the start of the recording, in seconds */
  time: number;
  /** Line text with its timestamp removed */
  text: string;
}

/** `[mm:ss.xx]` or `[mm:ss]`, the two forms LRC files use for a line timestamp. */
const LRC_TIMESTAMP = /\[(\d{1,3}):(\d{1,2}(?:[.:]\d{1,3})?)\]/g;

/**
 * Normalize lyrics text into the shape every provider returns.
 *
 * Line endings collapse onto `\n`, trailing spaces go, and runs of blank lines shrink to a
 * single separator - providers disagree wildly on all three, and the difference is noise.
 *
 * `\p{Zs}` covers the non-breaking space that HTML providers deliver from `&nbsp;`, which looks
 * like a space but compares unequal to one. Zero-width characters are deleted rather than
 * folded: they are invisible, so turning one into a space would insert a gap that is not there.
 */
export function normalizeLyrics(text: string): string {
  return text
    .replace(/\r\n?/g, "\n")
    .replace(/[\u{00AD}\u{200B}-\u{200D}\u{FEFF}]/gu, "")
    .replace(/[\t\p{Zs}]/gu, " ")
    .split("\n")
    .map((line) => line.replace(/\s+$/, ""))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * Parse LRC-formatted lyrics into timed lines, ordered by time.
 *
 * Lines carrying several timestamps - the LRC way of repeating a chorus - yield one entry per
 * timestamp. Metadata tags such as `[ar:...]` and untimed lines are skipped.
 *
 * @example
 *   ```ts
 *   parseLrc("[00:12.50] first line"); // [{ time: 12.5, text: "first line" }]
 *   ```
 */
export function parseLrc(synced: string): SyncedLine[] {
  const lines: SyncedLine[] = [];
  for (const raw of normalizeLyrics(synced).split("\n")) {
    const stamps = [...raw.matchAll(LRC_TIMESTAMP)];
    if (stamps.length === 0) continue;
    const text = raw.replace(LRC_TIMESTAMP, "").trim();
    for (const stamp of stamps) {
      const minutes = Number(stamp[1]);
      const seconds = Number(stamp[2]?.replace(":", "."));
      if (!Number.isFinite(minutes) || !Number.isFinite(seconds)) continue;
      lines.push({ time: minutes * 60 + seconds, text });
    }
  }
  return lines.sort((a, b) => a.time - b.time);
}

/** Strip the timestamps from LRC-formatted lyrics, leaving the plain text. */
export function lrcToPlain(synced: string): string {
  return normalizeLyrics(
    parseLrc(synced)
      .map((line) => line.text)
      .join("\n"),
  );
}

/**
 * Return the line being sung at `seconds`, or `undefined` before the first timestamp.
 *
 * Runs locally on already-fetched lyrics - no provider involved.
 *
 * @throws {InvalidInputError} When `seconds` is not a finite, non-negative number.
 */
export function lineAt(synced: string, seconds: number): SyncedLine | undefined {
  if (!Number.isFinite(seconds) || seconds < 0) {
    throw new InvalidInputError(`seconds must be a non-negative number, got ${seconds}`);
  }
  let current: SyncedLine | undefined;
  for (const line of parseLrc(synced)) {
    if (line.time > seconds) break;
    current = line;
  }
  return current;
}

/**
 * Format `seconds` as the `m:ss` timestamp used when printing track durations and line offsets.
 *
 * Truncates rather than rounds: a line that starts at 20.5 s is already being sung at 0:20, and
 * showing 0:21 would put it in the future.
 */
export function formatDuration(seconds: number): string {
  const whole = Math.max(0, Math.floor(seconds));
  const minutes = Math.floor(whole / 60);
  return `${minutes}:${String(whole % 60).padStart(2, "0")}`;
}
