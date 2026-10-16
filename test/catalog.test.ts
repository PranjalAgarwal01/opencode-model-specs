import { describe, expect, it } from "vitest"
import { normalizeModelList, normalizeProviderList } from "../src/catalog.js"

describe("normalizeProviderList", () => {
  it("accepts arrays, {data} envelopes and wrapped entries", () => {
    const wrapped = normalizeProviderList({
      data: [{ provider: { id: "test-gateway", name: "Gateway", settings: { baseURL: "https://x/v1" } } }],
    })
    expect(wrapped).toEqual([{ id: "test-gateway", name: "Gateway", settings: { baseURL: "https://x/v1" } }])

    const plain = normalizeProviderList([{ id: "test-gateway" }])
    expect(plain).toEqual([{ id: "test-gateway", settings: {} }])
  })

  it("skips malformed entries", () => {
    expect(normalizeProviderList([null, "x", {}, { id: 42 }])).toEqual([])
    expect(normalizeProviderList(undefined)).toEqual([])
  })
})

describe("normalizeModelList", () => {
  it("parses the model fields the plugin reads", () => {
    const models = normalizeModelList({
      data: [
        {
          id: "example-chat-31b",
          providerID: "test-gateway",
          enabled: true,
          capabilities: { tools: true, input: ["text", "image"], extra: 1 },
          limit: { context: 143000, input: 123000, output: 20000 },
          variants: [{ id: "none", body: {} }, { id: "xhigh" }, { broken: true }],
        },
      ],
    })
    expect(models).toEqual([
      {
        id: "example-chat-31b",
        providerID: "test-gateway",
        enabled: true,
        capabilities: { tools: true, input: ["text", "image"] },
        limit: { context: 143000, input: 123000, output: 20000 },
        variants: [{ id: "none" }, { id: "xhigh" }],
      },
    ])
  })

  it("drops entries without a usable id", () => {
    expect(normalizeModelList([{ providerID: "test-gateway" }, null, 7])).toEqual([])
  })
})
