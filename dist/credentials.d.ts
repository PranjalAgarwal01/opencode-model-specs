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
    readonly type?: string;
    readonly id?: string;
    readonly name?: string;
    readonly [key: string]: unknown;
}
export interface ResolvedCredentialValue {
    readonly type?: string;
    readonly key?: string;
    readonly access?: string;
    readonly [key: string]: unknown;
}
export interface CredentialResolutionIntegration {
    readonly connection?: {
        readonly active?: (integrationID: string) => Promise<ActiveConnection | undefined>;
        readonly resolve?: (connection: ActiveConnection) => Promise<ResolvedCredentialValue | undefined>;
    };
}
export interface CredentialResolutionContext {
    readonly integration?: CredentialResolutionIntegration;
}
export interface ProviderForCredentialResolution {
    readonly id: string;
    readonly settings: Record<string, unknown>;
    readonly apiKey?: string;
}
export declare function resolveProviderCredential(ctx: CredentialResolutionContext, provider: ProviderForCredentialResolution, defaultIntegrationID?: (id: string) => string): Promise<string | undefined>;
