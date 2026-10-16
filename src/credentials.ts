/**
 * Provider credential resolution.
 *
 * Adapted from opencode-models-discovery (https://github.com/yuhp/opencode-models-discovery),
 * MIT License, Copyright (c) yuhp. Same resolution order, reimplemented here:
 *
 *   1. provider.settings.apiKey (explicit key in provider config)
 *   2. provider.apiKey (pre-resolved)
 *   3. active connection for the integration id(s) -> resolved credential key/access
 *   4. environment connection (connection.type === "env") -> process.env
 *
 * The plugin never logs or stores the resolved value.
 */

export interface ActiveConnection {
  readonly type?: string
  readonly id?: string
  readonly name?: string
  readonly [key: string]: unknown
}

export interface ResolvedCredentialValue {
  readonly type?: string
  readonly key?: string
  readonly access?: string
  readonly [key: string]: unknown
}

export interface CredentialResolutionIntegration {
  readonly connection?: {
    readonly active?: (integrationID: string) => Promise<ActiveConnection | undefined>
    readonly resolve?: (connection: ActiveConnection) => Promise<ResolvedCredentialValue | undefined>
  }
}

export interface CredentialResolutionContext {
  readonly integration?: CredentialResolutionIntegration
}

export interface ProviderForCredentialResolution {
  readonly id: string
  readonly settings: Record<string, unknown>
  readonly apiKey?: string
}

export async function resolveProviderCredential(
  ctx: CredentialResolutionContext,
  provider: ProviderForCredentialResolution,
  defaultIntegrationID?: (id: string) => string,
): Promise<string | undefined> {
  if (typeof provider.settings.apiKey === "string" && provider.settings.apiKey.trim().length > 0) {
    return provider.settings.apiKey.trim()
  }

  if (typeof provider.apiKey === "string" && provider.apiKey.trim().length > 0) {
    return provider.apiKey.trim()
  }

  const integration = ctx.integration
  if (!integration?.connection?.active || !integration?.connection?.resolve) {
    return undefined
  }

  const candidates: string[] = []
  if (typeof provider.settings.integrationID === "string" && provider.settings.integrationID.trim().length > 0) {
    candidates.push(provider.settings.integrationID.trim())
  }
  if (defaultIntegrationID) {
    const fallback = defaultIntegrationID(provider.id)
    if (!candidates.includes(fallback)) candidates.push(fallback)
  }
  if (!candidates.includes(provider.id)) {
    candidates.push(provider.id)
  }

  for (const id of candidates) {
    try {
      const connection = await integration.connection.active(id)
      if (!connection) continue

      if (connection.type === "env" && typeof connection.name === "string") {
        const envValue = process.env[connection.name]
        if (typeof envValue === "string" && envValue.trim().length > 0) {
          return envValue.trim()
        }
      }

      const credential = await integration.connection.resolve(connection)
      if (credential?.type === "key" && typeof credential.key === "string" && credential.key.trim().length > 0) {
        return credential.key.trim()
      }
      if (credential?.type === "oauth" && typeof credential.access === "string" && credential.access.trim().length > 0) {
        return credential.access.trim()
      }
    } catch {
      // Resolving one candidate must never fail the whole command.
    }
  }

  return undefined
}
