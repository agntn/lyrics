/** Self-registering provider registry for Lyrics */

import { Provider } from "./provider.ts";
import type { ProviderConstructor, ProviderOperation } from "./provider.ts";
import type { ProviderCapabilities, ProviderConfig } from "./types.ts";
import { UnknownProviderError } from "./errors.ts";

interface RegistryEntry {
  defaultURL?: string;
  providerClass: ProviderConstructor;
}

const registry = new Map<string, RegistryEntry>();

/**
 * Register a provider class under its stable `key`.
 *
 * Registering the same name again replaces the previous entry. That is useful in tests, but easy
 * to do by accident in application code.
 *
 * @param providerClass - The provider class.
 * @param defaultURL - Public endpoint to advertise.
 */
export function register(providerClass: ProviderConstructor, defaultURL?: string): void {
  registry.set(providerClass.key, { defaultURL, providerClass });
}

/**
 * Create a registered provider with optional backend configuration.
 *
 * Construction never checks credentials, so a provider can always be asked what it supports;
 * a missing key surfaces as `AuthError` when an operation actually needs it.
 *
 * @example
 *   ```ts
 *   import { create } from "@agntn/lyrics";
 *
 *   const provider = create("lrclib");
 *   const song = await provider.lyrics({ artist: "Radiohead", track: "Creep" });
 *   ```
 *
 * @throws {UnknownProviderError} When `name` has not been registered.
 * @param name - Registry key.
 * @param config - Backend configuration.
 * @returns {Provider} A new instance.
 */
export function create(name: string, config?: ProviderConfig): Provider {
  const entry = registry.get(name);
  if (!entry) {
    throw new UnknownProviderError(name);
  }
  return new entry.providerClass(config ?? {});
}

/**
 * Return registered provider names in registration order.
 *
 * @returns {string[]} The registry keys.
 */
export function providers(): string[] {
  return Array.from(registry.keys());
}

/**
 * Check whether a name can be passed to `create`.
 *
 * @param name - Registry key.
 * @returns {boolean} Whether it's registered.
 */
export function has(name: string): boolean {
  return registry.has(name);
}

/**
 * Return the public endpoint advertised when a provider was registered.
 *
 * Per-instance `baseUrl` overrides are deliberately not reflected here.
 *
 * @param name - Registry key.
 * @returns {string | undefined} The endpoint, or nothing for an unknown name.
 */
export function getDefaultURL(name: string): string | undefined {
  return registry.get(name)?.defaultURL;
}

/**
 * Return the environment variable holding a provider's credential, if it needs one.
 *
 * The name lives on the provider class, so auto-selection reads it straight from the registry
 * and an externally registered provider is selectable on the same terms as a built-in one.
 *
 * @param name - Registry key.
 * @returns {string | undefined} The variable name.
 */
export function getEnvKey(name: string): string | undefined {
  return registry.get(name)?.providerClass.envKey;
}

/**
 * True when the provider needs no credential, or has the one it needs.
 *
 * This lives with the registry because it is a fact about a registration, and `listProviders`
 * would otherwise answer the same question with its own copy of the rule.
 *
 * @param name - Registry key.
 * @returns {boolean} Whether the provider can be used right now.
 */
export function isConfigured(name: string): boolean {
  const envKey = getEnvKey(name);
  return envKey === undefined || Boolean(process.env[envKey]);
}

/**
 * True when the registered provider serves `operation`.
 *
 * @param name - Registry key.
 * @param operation - `search` or `lyrics`.
 * @returns {boolean} False for an unknown name too.
 */
export function supportsOperation(name: string, operation: ProviderOperation): boolean {
  const entry = registry.get(name);
  if (!entry) return false;
  return new entry.providerClass({}).capabilities[operation];
}

/** One row of `listProviders()`. */
export interface ProviderListing {
  /** Registry key */
  name: string;
  /** Public endpoint advertised at registration */
  defaultUrl?: string;
  /** Operations and result kinds the provider serves */
  capabilities: ProviderCapabilities;
  /** Environment variable holding the provider's credential, when it needs one */
  envKey?: string;
  /** True when `envKey` is set in the current environment */
  configured: boolean;
}

/**
 * Enumerate registered providers with their capabilities and credential state.
 *
 * @returns {ProviderListing[]} One row per provider, in registration order.
 */
export function listProviders(): ProviderListing[] {
  return providers().map((name) => ({
    name,
    defaultUrl: getDefaultURL(name),
    capabilities: create(name).capabilities,
    envKey: getEnvKey(name),
    configured: isConfigured(name),
  }));
}
