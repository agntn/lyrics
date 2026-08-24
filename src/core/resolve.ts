/** Auto-select a provider from the environment and the operation being requested */

import { create, getEnvKey, has, providers, supportsOperation } from "./registry.ts";
import { UnknownProviderError } from "./errors.ts";
import type { Provider, ProviderOperation } from "./provider.ts";

/**
 * Check for the reserved "all" provider value, which fans a request out to every registered
 * provider instead of selecting one. Surfaces test this before calling `selectProvider`.
 */
export function isAllProviders(preferred?: string): boolean {
  return preferred?.trim().toLowerCase() === "all";
}

/** True when the provider needs no credential, or has the one it needs. */
export function isConfigured(name: string): boolean {
  const envKey = getEnvKey(name);
  return envKey === undefined || Boolean(process.env[envKey]);
}

/**
 * Choose a registered provider for the current environment.
 *
 * An explicit preference always wins, even when the provider does not serve `operation` - the
 * caller then gets `UnsupportedOperationError` naming their own choice instead of a silent
 * switch to a different backend.
 *
 * Without a preference, candidates are those that serve the operation and are usable right now,
 * and registration order decides among them. A configured key therefore *adds* a provider
 * rather than capturing traffic: unlike a paid maps API, a Musixmatch key buys an excerpt where
 * keyless LRCLIB returns the whole song, so promoting the keyed provider would be a downgrade.
 *
 * @throws {UnknownProviderError} When an explicit preference is not registered.
 */
export function resolveProvider(
  preferred?: string,
  operation: ProviderOperation = "lyrics",
): string {
  if (preferred) {
    if (!has(preferred)) {
      throw new UnknownProviderError(preferred);
    }
    return preferred;
  }

  const capable = providers().filter((name) => supportsOperation(name, operation));
  const usable = capable.find((name) => isConfigured(name));

  return usable ?? capable[0] ?? providers()[0] ?? "lrclib";
}

/** A provider instance paired with its registry key. */
export interface SelectedProvider {
  /** Registry key of the selected provider */
  name: string;
  /** Ready-to-use provider instance */
  provider: Provider;
}

/**
 * Resolve the provider one request should use.
 *
 * This is the single selection path shared by the CLI, MCP server, AI tools, and both agent
 * extensions. Empty or whitespace-only arguments count as absent, so a client that sends `""`
 * gets the same behavior as one that omits the field.
 */
export function selectProvider(
  preferred?: string,
  operation: ProviderOperation = "lyrics",
): SelectedProvider {
  const preferredName = preferred?.trim() || undefined;
  const name = resolveProvider(preferredName, operation);
  return { name, provider: create(name) };
}
