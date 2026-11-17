/**
 * HTML reading shared by the providers that parse pages instead of calling an API.
 *
 * Three sites, one contract: turn `<br>` into a line break, take the text of a container, and
 * fail loudly when the container is gone. Keeping it here means a layout change is one file's
 * problem rather than three.
 */

import type { HTMLElement } from "node-html-parser";
import { ParseError } from "./errors.ts";
import { normalizeLyrics } from "./text.ts";

/**
 * Parse a page after turning `<br>` into a newline.
 *
 * Lyrics markup separates lines with `<br>`, which carries no text of its own; substituting
 * before parsing is what preserves the line structure that `.text` would otherwise flatten.
 * `.text` then decodes HTML entities, so apostrophes and dashes come out as characters.
 * The parser loads on the first page, so code that never scrapes one never loads its 110 kB.
 *
 * @param html - The page as served.
 * @returns {Promise<HTMLElement>} The parsed document.
 */
export async function parseHtml(html: string): Promise<HTMLElement> {
  const { parse } = await import("node-html-parser");
  return parse(html.replaceAll(/<br\s*\/?>/gi, "\n"));
}

/**
 * Text of the first element matching `selector`, or `undefined` when nothing matches.
 *
 * @param root - The parsed page.
 * @param selector - CSS selector.
 * @returns {string | undefined} The trimmed text.
 */
export function selectText(root: HTMLElement, selector: string): string | undefined {
  const element = root.querySelector(selector);
  const text = element?.text?.trim();
  return text ? text : undefined;
}

/**
 * Normalized lyrics from every element matching `selector`, joined in document order.
 *
 * @param root - The parsed page.
 * @param selector - CSS selector of the lyrics containers.
 * @returns {string | undefined} The lyrics, or nothing when no container has text.
 */
export function selectLyrics(root: HTMLElement, selector: string): string | undefined {
  const parts = root
    .querySelectorAll(selector)
    .map((element) => element.text)
    .filter((text) => text.trim() !== "");
  if (parts.length === 0) return undefined;
  const lyrics = normalizeLyrics(parts.join("\n"));
  return lyrics || undefined;
}

/**
 * Same as `selectLyrics`, but a missing container is an error rather than `undefined`.
 *
 * @throws {ParseError} When no element matches, which means the site changed its layout.
 * @param root - The parsed page.
 * @param selector - CSS selector of the lyrics container.
 * @param provider - Provider the page belongs to.
 * @param url - Page URL, for the error.
 * @returns {string} The lyrics.
 */
export function requireLyrics(
  root: HTMLElement,
  selector: string,
  provider: string,
  url: string,
): string {
  const lyrics = selectLyrics(root, selector);
  if (!lyrics) {
    throw new ParseError(`no lyrics container matched "${selector}"`, provider, url);
  }
  return lyrics;
}

/**
 * Latin letters that Unicode decomposition leaves alone.
 *
 * NFD splits `ń` into `n` plus a combining mark, but `ł` is a letter in its own right with no
 * decomposition - stripping marks would drop it entirely and turn "Łukasz" into "ukasz".
 */
const UNDECOMPOSED_LETTERS: Readonly<Record<string, string>> = {
  ł: "l",
  ø: "o",
  đ: "d",
  ħ: "h",
  ŧ: "t",
  æ: "ae",
  œ: "oe",
  ß: "ss",
};

/**
 * Turn free text into a URL path segment the lyrics sites accept.
 *
 * Diacritics fold onto ASCII, everything that is not a letter or digit is dropped, and the
 * result is lowercased - the shape AZLyrics uses for its `/lyrics/<artist>/<title>.html` paths.
 *
 * @param value - Artist or title.
 * @param separator - What joins the words; nothing by default.
 * @returns {string} The path segment.
 */
export function slugify(value: string, separator = ""): string {
  const words = value
    .toLowerCase()
    .replaceAll(/[łøđħŧæœß]/g, (letter) => UNDECOMPOSED_LETTERS[letter] ?? letter)
    .normalize("NFD")
    .replaceAll(/\p{Diacritic}/gu, "")
    .split(/[^a-z0-9]+/)
    .filter((word) => word !== "");
  return words.join(separator);
}
