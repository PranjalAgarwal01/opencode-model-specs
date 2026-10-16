import { specByModelID } from "./specs.js";
/**
 * Overlay the spec onto a catalog model (mutates `model` in place).
 *
 * Only these fields are written:
 *  - capabilities.tools / capabilities.input (capabilities.output is preserved)
 *  - limit (context / input / output)
 *  - variants (full replacement: one variant per accepted tier, forwarding `body.reasoning_effort`)
 */
export function applySpecToModel(model, spec) {
    const capabilities = { ...(model.capabilities ?? {}) };
    model.capabilities = { ...capabilities, tools: spec.tools, input: [...spec.input] };
    model.limit = { context: spec.limit.context, input: spec.limit.input, output: spec.limit.output };
    model.variants = spec.tiers.map((tier) => ({ id: tier, body: { reasoning_effort: tier } }));
}
/**
 * Apply the pack to every catalog model of the pack's provider whose id is
 * listed in the pack. Models outside the pack are left untouched, and a failure
 * on one model never prevents the others from being applied.
 */
export function applySpecsToEditor(editor, pack) {
    const applied = [];
    const failed = [];
    for (const model of editor.list(pack.providerID)) {
        const spec = specByModelID(pack, model.id);
        if (!spec)
            continue;
        try {
            editor.update(pack.providerID, model.id, (target) => applySpecToModel(target, spec));
            applied.push(model.id);
        }
        catch (error) {
            failed.push({ id: model.id, error: error instanceof Error ? error.message : String(error) });
        }
    }
    return { applied, failed };
}
