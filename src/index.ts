import { Plugin } from "@opencode/plugin"
import { applySpecsToEditor, type SpecEditor } from "./apply.js"
import { registerSpecCommands } from "./commands.js"
import { loadPack, type PackLookup } from "./specs.js"
import { PLUGIN_ID } from "./version.js"

export { loadPack, parsePack, PACK_ENV_VAR, specByModelID } from "./specs.js"
export type { AdvertSnapshot, InputModality, ModelSpec, PackLookup, SpecPack, TierEnforcement, TierID } from "./specs.js"
export { applySpecToModel, applySpecsToEditor } from "./apply.js"
export { parseReportedTiers, runProbe, TIER_SENTINEL } from "./probe.js"
export type { ProbeFinding, ProbeReport } from "./probe.js"
export { PLUGIN_VERSION } from "./version.js"

export interface PluginDeps {
  /** Overrides how the pack is located (injectable so tests never depend on machine state). */
  loadPack?: () => PackLookup
}

/** Exported for tests: registers the model-transform overlay and the slash commands. */
export async function setupPlugin(ctx: Plugin.Context, deps: PluginDeps = {}): Promise<void> {
  const load = deps.loadPack ?? loadPack

  // Transforms re-run on every catalog reload; report each distinct problem only
  // once per clean-run cycle so a persistently broken pack cannot spam the log
  // on every reload.
  const seenProblems = new Set<string>()
  const logOnce = (problem: string): void => {
    if (seenProblems.has(problem)) return
    seenProblems.add(problem)
    console.error(problem)
  }

  // Overlay the user's spec pack onto the models of the pack's provider.
  // Transforms are in-memory and re-run on every catalog reload; the plugin
  // never persists anything and never edits the user's configuration.
  await ctx.model.transform((editor) => {
    try {
      const { pack, error } = load()
      if (error) {
        logOnce(`[${PLUGIN_ID}] spec pack unusable: ${error}`)
        return
      }
      if (!pack) {
        seenProblems.clear()
        return
      }
      const outcome = applySpecsToEditor(editor as unknown as SpecEditor, pack)
      if (outcome.failed.length > 0) {
        logOnce(
          `[${PLUGIN_ID}] failed to apply ${outcome.failed.length} spec(s): ` +
            outcome.failed.map((entry) => `${entry.id} (${entry.error})`).join(", "),
        )
      } else {
        seenProblems.clear()
      }
    } catch (error) {
      // A catalog reload must never be broken by this plugin.
      logOnce(`[${PLUGIN_ID}] spec transform failed: ${error instanceof Error ? error.message : String(error)}`)
    }
  })

  await registerSpecCommands(ctx, load)
}

export default Plugin.define({
  id: PLUGIN_ID,
  setup: setupPlugin,
})
