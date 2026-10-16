/**
 * Defensive normalizers for plugin-host API responses.
 *
 * The host returns lists either as arrays or as `{ data: [...] }`, and provider
 * entries may be wrapped as `{ provider: {...} }`. Normalizing keeps the plugin
 * tolerant across minor SDK versions without spreading casts through the code.
 */
export interface ListedProvider {
    readonly id: string;
    readonly name?: string;
    readonly settings: Record<string, unknown>;
}
export interface CatalogModel {
    readonly id: string;
    readonly providerID?: string;
    readonly name?: string;
    readonly enabled?: boolean;
    readonly capabilities?: {
        readonly tools?: boolean;
        readonly input?: readonly string[];
    };
    readonly limit?: {
        readonly context?: number;
        readonly input?: number;
        readonly output?: number;
    };
    readonly variants?: readonly {
        readonly id?: string;
    }[];
}
export declare function normalizeProviderList(value: unknown): ListedProvider[];
export declare function normalizeModelList(value: unknown): CatalogModel[];
