import { afterEach, describe, expect, it, vi } from "vitest"
import { setupPlugin } from "../src/index.js"
import type { PackLookup } from "../src/specs.js"
import { TEST_PACK as PACK } from "./test-pack.js"

interface Captured {
  model?: (editor: unknown) => unknown
}

function fakeContext(captured: Captured): unknown {
  return {
    model: {
      transform: async (callback: (editor: unknown) => unknown) => {
        captured.model = callback
      },
    },
    command: { transform: async () => {} },
  }
}

describe("setupPlugin", () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it("does not throw when the model editor fails to list", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {})
    const captured: Captured = {}
    await setupPlugin(fakeContext(captured) as never, { loadPack: () => ({ path: "test", pack: PACK }) })
    expect(captured.model).toBeDefined()

    const throwingEditor = {
      list: () => {
        throw new Error("list boom")
      },
      update: () => {},
    }
    await expect(Promise.resolve(captured.model?.(throwingEditor))).resolves.toBeUndefined()
    expect(spy).toHaveBeenCalledWith(expect.stringContaining("list boom"))
  })

  it("applies the pack to a healthy editor without logging errors", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {})
    const captured: Captured = {}
    await setupPlugin(fakeContext(captured) as never, { loadPack: () => ({ path: "test", pack: PACK }) })

    const updates: Array<{ providerID: string; modelID: string }> = []
    const editor = {
      list: () => PACK.models.map((spec) => ({ id: spec.id })),
      update: (providerID: string, modelID: string) => {
        updates.push({ providerID, modelID })
      },
    }
    await expect(Promise.resolve(captured.model?.(editor))).resolves.toBeUndefined()
    expect(spy).not.toHaveBeenCalled()
    expect(updates).toEqual(PACK.models.map((spec) => ({ providerID: PACK.providerID, modelID: spec.id })))
  })

  it("stays inert and silent when no pack is configured", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {})
    const captured: Captured = {}
    await setupPlugin(fakeContext(captured) as never, { loadPack: () => ({ path: "test" }) })

    const editor = { list: () => [], update: () => {} }
    await expect(Promise.resolve(captured.model?.(editor))).resolves.toBeUndefined()
    expect(spy).not.toHaveBeenCalled()
  })

  it("logs an unusable pack once, and again after the pack changes state", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {})
    const captured: Captured = {}
    let current: PackLookup = { path: "test", error: "bad pack" }
    await setupPlugin(fakeContext(captured) as never, { loadPack: () => current })

    // Listing exactly the pack's ids applies every spec without failure, so
    // the recovery run below is a clean run (the log memory resets on it).
    const editor = {
      list: () => PACK.models.map((spec) => ({ id: spec.id })),
      update: () => {},
    }

    await Promise.resolve(captured.model?.(editor))
    await Promise.resolve(captured.model?.(editor))
    expect(spy).toHaveBeenCalledTimes(1)
    expect(spy).toHaveBeenCalledWith(expect.stringContaining("bad pack"))

    current = { path: "test", pack: PACK }
    await Promise.resolve(captured.model?.(editor))
    expect(spy).toHaveBeenCalledTimes(1)

    current = { path: "test", error: "bad pack" }
    await Promise.resolve(captured.model?.(editor))
    expect(spy).toHaveBeenCalledTimes(2)
  })

  it("logs each distinct problem once even when problems alternate", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {})
    const captured: Captured = {}
    let current: PackLookup = { path: "test", error: "bad pack" }
    await setupPlugin(fakeContext(captured) as never, { loadPack: () => current })

    const editor = { list: () => [], update: () => {} }
    await Promise.resolve(captured.model?.(editor))
    current = { path: "test", error: "other pack" }
    await Promise.resolve(captured.model?.(editor))
    current = { path: "test", error: "bad pack" }
    await Promise.resolve(captured.model?.(editor))

    // "bad pack" was already reported; only "other pack" is new.
    expect(spy).toHaveBeenCalledTimes(2)
    expect(spy).toHaveBeenCalledWith(expect.stringContaining("other pack"))
  })
})
