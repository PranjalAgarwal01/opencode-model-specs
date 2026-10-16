import { describe, expect, it } from "vitest"
import { applySpecsToEditor, type EditorModel, type SpecEditor } from "../src/apply.js"
import { TEST_PACK as PACK } from "./test-pack.js"

interface FakeModel extends EditorModel {
  providerID: string
}

function fakeEditor(models: FakeModel[], failing: ReadonlySet<string> = new Set()): SpecEditor {
  return {
    list(providerID?: string) {
      return providerID ? models.filter((model) => model.providerID === providerID) : models
    },
    update(providerID: string, modelID: string, update: (model: EditorModel) => void) {
      if (failing.has(modelID)) throw new Error(`update failed for ${modelID}`)
      const model = models.find((entry) => entry.providerID === providerID && entry.id === modelID)
      if (model) update(model)
    },
  }
}

function staleModels(): FakeModel[] {
  return PACK.models.map((spec) => ({
    id: spec.id,
    providerID: "test-gateway",
    capabilities: { tools: false, input: ["text"], output: ["text"] },
    limit: { context: 1, input: 1, output: 1 },
    variants: [{ id: "bogus" }],
  }))
}

describe("applySpecsToEditor", () => {
  it("overwrites stale spec fields on every pack model", () => {
    const models = staleModels()
    const outcome = applySpecsToEditor(fakeEditor(models), PACK)

    expect(outcome.failed).toEqual([])
    expect(outcome.applied).toEqual(PACK.models.map((spec) => spec.id))

    for (const spec of PACK.models) {
      const model = models.find((entry) => entry.id === spec.id)
      expect(model?.capabilities?.tools, `${spec.id} tools`).toBe(spec.tools)
      expect(model?.capabilities?.input, `${spec.id} input`).toEqual([...spec.input])
      expect(model?.capabilities?.output, `${spec.id} output preserved`).toEqual(["text"])
      expect(model?.limit, `${spec.id} limit`).toEqual({ ...spec.limit })
      expect(model?.variants, `${spec.id} variants`).toEqual(
        spec.tiers.map((tier) => ({ id: tier, body: { reasoning_effort: tier } })),
      )
    }
  })

  it("leaves models outside the pack and other providers untouched", () => {
    const untouched: FakeModel = { id: "chat", providerID: "test-gateway", capabilities: { input: ["text"] } }
    const otherProvider: FakeModel = { id: "example-chat-31b", providerID: "other-provider" }
    const models = [...staleModels(), untouched, otherProvider]
    applySpecsToEditor(fakeEditor(models), PACK)

    expect(untouched).toEqual({ id: "chat", providerID: "test-gateway", capabilities: { input: ["text"] } })
    expect(otherProvider).toEqual({ id: "example-chat-31b", providerID: "other-provider" })
  })

  it("is idempotent", () => {
    const models = staleModels()
    applySpecsToEditor(fakeEditor(models), PACK)
    const afterFirst = JSON.parse(JSON.stringify(models))
    applySpecsToEditor(fakeEditor(models), PACK)
    expect(JSON.parse(JSON.stringify(models))).toEqual(afterFirst)
  })

  it("preserves unknown capability keys", () => {
    const models = staleModels()
    const chat = models.find((model) => model.id === "example-chat-31b")
    chat!.capabilities = { ...chat!.capabilities, custom: "keep-me" }
    applySpecsToEditor(fakeEditor(models), PACK)
    expect((chat!.capabilities as Record<string, unknown>).custom).toBe("keep-me")
  })

  it("isolates failures per model", () => {
    const models = staleModels()
    const outcome = applySpecsToEditor(fakeEditor(models, new Set(["example-omni-27b"])), PACK)

    expect(outcome.failed).toEqual([{ id: "example-omni-27b", error: "update failed for example-omni-27b" }])
    expect(outcome.applied).toEqual(["example-chat-31b", "example-vl-27b", "example-coder-30b"])
    expect(models.find((model) => model.id === "example-omni-27b")?.limit).toEqual({ context: 1, input: 1, output: 1 })
  })
})
