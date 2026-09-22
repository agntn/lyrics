/** Side-effect import: registers every built-in provider. */
import "./providers/index.ts";

export { version } from "./version.ts";
export type {
  Lyrics,
  ProviderCapabilities,
  ProviderConfig,
  SearchOptions,
  TrackMatch,
  TrackQuery,
} from "./core/types.ts";
export { clampMaxResults } from "./core/types.ts";
export { Provider, assertQuery, assertTrackQuery, requireOperation } from "./core/provider.ts";
export type { ProviderConstructor, ProviderOperation } from "./core/provider.ts";
export {
  LyricsError,
  HTTPError,
  AuthError,
  PaymentError,
  RateLimitError,
  NotFoundError,
  ParseError,
  UnsupportedOperationError,
  UnknownProviderError,
  InvalidInputError,
  normalizeError,
} from "./core/errors.ts";
export { getJSON, getText, buildQuery } from "./core/client.ts";
export { parseHtml, requireLyrics, selectLyrics, selectText, slugify } from "./core/html.ts";
export { formatDuration, lineAt, lrcToPlain, normalizeLyrics, parseLrc } from "./core/text.ts";
export type { SyncedLine } from "./core/text.ts";
export {
  register,
  create,
  providers,
  has,
  getDefaultURL,
  getEnvKey,
  listProviders,
  supportsOperation,
} from "./core/registry.ts";
export type { ProviderListing } from "./core/registry.ts";
export {
  isAllProviders,
  isConfigured,
  providerArg,
  resolveProvider,
  selectProvider,
  usableProviders,
} from "./core/resolve.ts";
export type { SelectedProvider } from "./core/resolve.ts";
export { lyricsAll, lyricsWithFallback, searchAll, serializeOutcomes } from "./core/all.ts";
export type { FallbackResult, ProviderOutcome, SerializedOutcome } from "./core/all.ts";
export {
  formatFallback,
  formatLyrics,
  formatLyricsAll,
  formatLyricsHeader,
  formatLyricsFooter,
  formatProviders,
  formatSearchAll,
  formatTrackLine,
  formatTracks,
  formatTranslation,
} from "./core/format.ts";
export { geniusSongUrl } from "./providers/genius.ts";
export { tekstowoPath } from "./providers/tekstowo.ts";
export { azlyricsPath } from "./providers/azlyrics.ts";
