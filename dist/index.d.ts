import { Plugin } from "@opencode/plugin";
import { type PackLookup } from "./specs.js";
export { loadPack, parsePack, PACK_ENV_VAR, specByModelID } from "./specs.js";
export type { AdvertSnapshot, InputModality, ModelSpec, PackLookup, SpecPack, TierEnforcement, TierID } from "./specs.js";
export { applySpecToModel, applySpecsToEditor } from "./apply.js";
export { parseReportedTiers, runProbe, TIER_SENTINEL } from "./probe.js";
export type { ProbeFinding, ProbeReport } from "./probe.js";
export { PLUGIN_VERSION } from "./version.js";
export interface PluginDeps {
    /** Overrides how the pack is located (injectable so tests never depend on machine state). */
    loadPack?: () => PackLookup;
}
/** Exported for tests: registers the model-transform overlay and the slash commands. */
export declare function setupPlugin(ctx: Plugin.Context, deps?: PluginDeps): Promise<void>;
declare const _default: Plugin.Plugin;
export default _default;
