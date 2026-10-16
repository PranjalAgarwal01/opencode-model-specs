export type TierID = string;
export type TierEnforcement = "validated" | "permissive" | "inert";
export type InputModality = "text" | "image" | "video" | "audio" | "pdf";
export interface AdvertSnapshot {
    readonly vision: boolean;
    readonly video: boolean;
    /** Gateway-advertised max input tokens at verification time (litellm model_info). */
    readonly inputLimit: number;
    /** Gateway-advertised max output tokens at verification time. */
    readonly outputLimit: number;
}
export interface ModelSpec {
    /** Gateway model id (the id that discovery materializes). */
    readonly id: string;
    /** Human-readable backing model. */
    readonly backing: string;
    /** Whether the model serves tool calling. */
    readonly tools: boolean;
    /** Input modalities declared to OpenCode: only what clients can actually deliver (video/PDF/audio attachments are dropped by OpenCode before send). */
    readonly input: readonly InputModality[];
    /** Corrected limits for OpenCode: context / input / output tokens. */
    readonly limit: {
        readonly context: number;
        readonly input: number;
        readonly output: number;
    };
    /** Accepted `reasoning_effort` values the pack exposes as variants, verified live. */
    readonly tiers: readonly TierID[];
    /** Tier used by the gateway when `reasoning_effort` is absent (undefined when unverified). */
    readonly defaultTier?: TierID;
    /**
     * How the gateway treats unknown `reasoning_effort` values:
     * "validated" -> rejects with 400 listing supported values;
     * "permissive" -> accepts and ignores unknown values;
     * "inert" -> model has no reasoning; the field is ignored.
     */
    readonly enforcement: TierEnforcement;
    /** What GET /model/info advertised at verification time (used for drift reporting). */
    readonly advert: AdvertSnapshot;
    /** ISO date of the last live verification for this model. */
    readonly verifiedAt: string;
    readonly notes?: string;
}
export interface SpecPack {
    readonly providerID: string;
    readonly baseURL: string;
    readonly verifiedAt: string;
    readonly models: readonly ModelSpec[];
}
/** File name of the default pack location (inside OpenCode's config directory). */
export declare const PACK_FILE_NAME = "model-specs.json";
/** Environment variable that overrides the pack path. */
export declare const PACK_ENV_VAR = "OPENCODE_MODEL_SPECS_PACK";
export interface PackLookup {
    /** The path that was consulted (env override or the default location). */
    readonly path: string;
    /** The parsed pack when one is configured and valid. */
    readonly pack?: SpecPack;
    /** A human-readable problem when a pack file exists but cannot be used. */
    readonly error?: string;
}
/** Load the user's pack. A missing file is "unconfigured" (no error); a bad file is an error. */
export declare function loadPack(options?: {
    env?: Record<string, string | undefined>;
    configDir?: string;
}): PackLookup;
/** Validate an untrusted value (typically parsed JSON) into a SpecPack. */
export declare function parsePack(value: unknown): {
    pack: SpecPack;
} | {
    error: string;
};
export declare function specByModelID(pack: SpecPack, modelID: string): ModelSpec | undefined;
