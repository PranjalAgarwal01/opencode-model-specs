import type { ModelSpec, SpecPack } from "./specs.js"
import { specByModelID } from "./specs.js"

/**
 * Minimal structural view of a catalog model (compatible with Model.Info).
 * Keep this interface narrow: the plugin only ever writes the three fields below.
 */
export interface EditorModel {
  id: string
  capabilities?: { tools?: boolean; input?: readonly string[]; output?: readonly string[] } & Record<string, unknown>
  limit?: { context?: number; input?: number; output?: number } & Record<string, unknown>
  variants?: readonly { id: string; body?: Record<string, unknown> }[]
}

/** Structural subset of the plugin ModelEditor used for applying specs. */
export interface SpecEditor {
  list(providerID?: string): readonly EditorModel[]
  update(providerID: string, modelID: string, update: (model: EditorModel) => void): void
}

export interface ApplyOutcome {
  readonly applied: readonly string[]
  readonly failed: readonly { readonly id: string; readonly error: string }[]
}

/**
 * Overlay the spec onto a catalog model (mutates `model` in place).
 *
 * Only these fields are written:
 *  - capabilities.tools / capabilities.input (capabilities.output is preserved)
 *  - limit (context / input / output)
 *  - variants (full replacement: one variant per accepted tier, forwarding `body.reasoning_effort`)
 */
export function applySpecToModel(model: EditorModel, spec: ModelSpec): void {
  const capabilities = { ...(model.capabilities ?? {}) }
  model.capabilities = { ...capabilities, tools: spec.tools, input: [...spec.input] }
  model.limit = { context: spec.limit.context, input: spec.limit.input, output: spec.limit.output }
  model.variants = spec.tiers.map((tier) => ({ id: tier, body: { reasoning_effort: tier } }))
}

/**
 * Apply the pack to every catalog model of the pack's provider whose id is
 * listed in the pack. Models outside the pack are left untouched, and a failure
 * on one model never prevents the others from being applied.
 */
export function applySpecsToEditor(editor: SpecEditor, pack: SpecPack): ApplyOutcome {
  const applied: string[] = []
  const failed: { id: string; error: string }[] = []
  for (const model of editor.list(pack.providerID)) {
    const spec = specByModelID(pack, model.id)
    if (!spec) continue
    try {
      editor.update(pack.providerID, model.id, (target) => applySpecToModel(target, spec))
      applied.push(model.id)
    } catch (error) {
      failed.push({ id: model.id, error: error instanceof Error ? error.message : String(error) })
    }
  }
  return { applied, failed }
}
