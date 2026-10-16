import type { SpecPack } from "./specs.js";
/** Deliberately invalid reasoning_effort used to test whether the gateway validates unknown values. */
export declare const TIER_SENTINEL = "__specs_probe__";
/**
 * Modalities the probe re-tests for *rejection* while the pack does not declare them.
 * Video is deliberately absent: a gateway may serve video while a pack omits it for
 * client-side reasons (OpenCode drops video attachments before send), so "must be
 * rejected" would be a false invariant.
 */
export declare const REJECTION_MODALITIES: readonly ["audio", "pdf"];
export type RejectionModality = (typeof REJECTION_MODALITIES)[number];
export interface ProbeOptions {
    readonly baseURL: string;
    readonly apiKey?: string;
    readonly fetch?: typeof fetch;
    readonly timeoutMs?: number;
}
export interface AdvertRecord {
    readonly vision?: boolean;
    readonly video?: boolean;
    readonly inputLimit?: number;
    readonly outputLimit?: number;
}
/**
 * What the sentinel request (unknown reasoning_effort) revealed:
 *  - "error-set"     rejected and the message lists the supported values
 *  - "error-other"   rejected but the message could not be parsed
 *  - "accepted"      the unknown value was accepted (permissive/inert)
 *  - "unverifiable"  no verdict was obtained: network failure, timeout, or a
 *                    non-verdict HTTP status (auth, 404, 408, 429, 5xx, …)
 */
export type TierOutcome = "error-set" | "error-other" | "accepted" | "unverifiable";
export interface TierProbeResult {
    readonly outcome: TierOutcome;
    readonly status?: number;
    /** Supported tiers parsed out of the rejection message (informational). */
    readonly reportedTiers?: readonly string[];
    /** Raw (flattened, truncated) error message for diagnostics. */
    readonly message?: string;
}
/** Result of sending a real request with one of the pack's accepted tiers. */
export interface TierCheckResult {
    readonly tier: string;
    /** true: accepted; false: rejected (HTTP 400/422); undefined: no verdict (network failure or non-verdict status). */
    readonly accepted?: boolean;
    readonly status?: number;
    readonly message?: string;
}
export interface ServingProbeResult {
    readonly ok: boolean;
    readonly status?: number;
    readonly detail: string;
}
/** Result of sending a real request carrying a modality the pack does not declare. */
export interface ModalityCheckResult {
    readonly modality: RejectionModality;
    /** true: served (drift); false: rejected (HTTP 400/422); undefined: no verdict (network failure or non-verdict status). */
    readonly accepted?: boolean;
    readonly status?: number;
    readonly message?: string;
}
export interface ModelProbeResult {
    readonly id: string;
    /** Present in GET /models; undefined when the list endpoint was unavailable. */
    readonly present?: boolean;
    readonly advert?: AdvertRecord;
    readonly tier: TierProbeResult;
    readonly tierChecks: readonly TierCheckResult[];
    readonly serving: ServingProbeResult;
    readonly modalityChecks: readonly ModalityCheckResult[];
}
export type FindingKind = "missing-model" | "serving-failed" | "tier-rejected" | "enforcement-drift" | "tier-unverifiable" | "advert-changed" | "undeclared-accepted" | "modality-unverifiable";
export interface ProbeFinding {
    readonly kind: FindingKind;
    readonly modelID: string;
    readonly detail: string;
}
export interface ProbeReport {
    readonly baseURL: string;
    readonly probedAt: string;
    readonly requestedModelIDs: readonly string[];
    /** Model ids served by GET /models; undefined when that endpoint failed or its payload was unparseable. */
    readonly servedModelIDs?: readonly string[];
    readonly models: readonly ModelProbeResult[];
    readonly missing: readonly string[];
    readonly findings: readonly ProbeFinding[];
    readonly notes: readonly string[];
}
/**
 * Parse the supported reasoning tiers out of an error message (informational —
 * the authoritative check is a real request per tier, see runProbe).
 *
 * Known gateway messages (vLLM / LiteLLM gateways):
 *  - "Supported types are xhigh (default), medium, and low."
 *  - "Input should be 'none', 'minimal', 'low', 'medium', 'high', 'xhigh' or 'max'" (Pydantic literal)
 *
 * Only messages produced by the reasoning_effort sentinel probe reach this parser; the
 * supported-types branch additionally requires a reasoning_effort mention, and the
 * literal branch captures nothing but the run of quoted values, so Pydantic metadata
 * keys can never be ingested as tiers.
 */
export declare function parseReportedTiers(text: string): string[] | undefined;
export declare function runProbe(pack: SpecPack, options: ProbeOptions): Promise<ProbeReport>;
