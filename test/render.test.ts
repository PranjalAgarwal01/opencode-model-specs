import { describe, expect, it } from "vitest"
import type { ProbeReport } from "../src/probe.js"
import { buildShowLive, renderPackProblem, renderProbeReport, renderShow } from "../src/render.js"
import { TEST_PACK as PACK } from "./test-pack.js"

describe("renderShow", () => {
  it("renders the pack table and the unavailable-catalog note", () => {
    const text = renderShow(PACK, undefined, "0.0.0-test")
    expect(text).toContain("pack 2026-10-16")
    expect(text).toContain("| `example-chat-31b` | Example-Chat-31B | 143000 | 123000 | 20000 |")
    expect(text).toContain("Live catalog unavailable")
    expect(text).toContain("example-chat-31b#xhigh")
  })

  it("renders the applied catalog state", () => {
    const live = buildShowLive(PACK, [
      {
        id: "example-chat-31b",
        providerID: "test-gateway",
        enabled: true,
        limit: { context: 143000, input: 123000, output: 20000 },
        variants: [{ id: "none" }, { id: "xhigh" }],
        capabilities: { input: ["text", "image"] },
      },
      { id: "example-vl-27b", providerID: "test-gateway", enabled: true },
    ])
    const text = renderShow(PACK, live, "0.0.0-test")
    expect(text).toContain("variants [none, xhigh]")
    expect(text).toContain("limit 143000/123000/20000")
    expect(text).toContain("input [text, image]")
    expect(text.match(/not in the catalog/gu)).toHaveLength(2)
  })

  it("keeps pack strings on one line and inside their table cells", () => {
    const pack = JSON.parse(JSON.stringify(PACK)) as Record<string, any>
    pack.providerID = "evil\n## forged heading"
    pack.models[0].backing = "A | B"
    pack.models[0].notes = "note\n\n## injected section"
    const text = renderShow(pack as never, undefined, "0.0.0-test")
    expect(text).toContain("evil ## forged heading model specs")
    expect(text).not.toContain("\n## forged heading")
    expect(text).not.toContain("\n## injected section")
    expect(text).toContain("A \\| B")
    expect(text).toContain("note ## injected section")
  })

  it("suggests an exposed tier when the recorded default is not a variant", () => {
    const pack = JSON.parse(JSON.stringify(PACK)) as Record<string, any>
    pack.models[0].defaultTier = "turbo"
    const text = renderShow(pack as never, undefined, "0.0.0-test")
    expect(text).toContain("(default \`turbo\`)")
    expect(text).toContain("example-chat-31b#none")
    expect(text).not.toContain("#turbo")
  })

  it("escapes a backslash before a table pipe so cells cannot be forged", () => {
    const pack = JSON.parse(JSON.stringify(PACK)) as Record<string, any>
    pack.models[0].backing = "A\\|999"
    const text = renderShow(pack as never, undefined, "0.0.0-test")
    // Escaping backslashes first keeps a raw \| from collapsing into an escaped
    // backslash plus an unescaped pipe — which marked/remark (the real OpenCode
    // renderers) parse as a cell split.
    expect(text).toContain("A\\\\\\|999")
    expect(text).not.toContain("A\\\\|999")
  })
})

describe("renderProbeReport", () => {
  it("renders per-model verdicts and findings", () => {
    const report: ProbeReport = {
      baseURL: "https://gateway.test/v1",
      probedAt: "2026-10-16T12:00:00.000Z",
      requestedModelIDs: ["example-chat-31b", "example-vl-27b", "example-omni-27b"],
      servedModelIDs: ["example-chat-31b", "example-vl-27b", "example-omni-27b"],
      models: [
        {
          id: "example-chat-31b",
          present: true,
          tier: { outcome: "error-set", status: 400, reportedTiers: ["xhigh", "medium", "low", "none"] },
          tierChecks: [
            { tier: "none", accepted: true, status: 200 },
            { tier: "low", accepted: true, status: 200 },
          ],
          serving: { ok: true, status: 200, detail: "HTTP 200, choices=1" },
          modalityChecks: [
            { modality: "audio", accepted: false, status: 400 },
            { modality: "pdf", accepted: false, status: 400 },
          ],
        },
        {
          id: "example-vl-27b",
          present: true,
          tier: { outcome: "error-set", status: 400, reportedTiers: ["none", "low", "medium", "high"] },
          tierChecks: [
            { tier: "low", accepted: true, status: 200 },
            { tier: "medium", status: 500, message: "boom" },
          ],
          serving: { ok: true, status: 200, detail: "HTTP 200, choices=1" },
          modalityChecks: [{ modality: "audio", message: "fetch failed" }],
        },
        {
          id: "example-omni-27b",
          present: true,
          tier: { outcome: "unverifiable", message: "fetch failed" },
          tierChecks: [],
          serving: { ok: true, status: 200, detail: "HTTP 200, choices=1" },
          modalityChecks: [],
        },
      ],
      missing: [],
      findings: [
        { kind: "tier-unverifiable", modelID: "example-vl-27b", detail: "tier 'medium' verification errored (HTTP 500): boom" },
        { kind: "modality-unverifiable", modelID: "example-vl-27b", detail: "audio rejection check errored: fetch failed" },
        { kind: "tier-unverifiable", modelID: "example-omni-27b", detail: "fetch failed" },
      ],
      notes: [],
    }

    const text = renderProbeReport(report, PACK)
    expect(text).toContain("spec probe — 2026-10-16 12:00:00 UTC")
    expect(text).toContain("✅ `example-chat-31b`")
    expect(text).toContain("❌ `example-vl-27b`")
    expect(text).toContain("❌ `example-omni-27b`")
    expect(text).toContain("**tier-unverifiable** `example-vl-27b`: tier 'medium' verification errored (HTTP 500): boom")
    expect(text).toContain("**modality-unverifiable** `example-vl-27b`: audio rejection check errored: fetch failed")
    expect(text).toContain("**tier-unverifiable** `example-omni-27b`: fetch failed")
    expect(text).toContain("pack tiers 1/2 accepted, 1 unverifiable")
    expect(text).toContain("validation check unverifiable: fetch failed")
    expect(text).toContain("undeclared audio rejected 0/1, 1 unverifiable")
    expect(text).toContain("undeclared audio+pdf rejected 2/2")
  })

  it("reports a clean sweep", () => {
    const report: ProbeReport = {
      baseURL: "https://gateway.test/v1",
      probedAt: "2026-10-16T12:00:00.000Z",
      requestedModelIDs: [],
      servedModelIDs: [],
      models: [],
      missing: [],
      findings: [],
      notes: [],
    }
    expect(renderProbeReport(report, PACK)).toContain("None — the gateway matches the pack.")
  })
})

describe("renderPackProblem", () => {
  it("explains an unconfigured pack and an unusable file", () => {
    const missing = renderPackProblem("C:/config/model-specs.json")
    expect(missing).toContain("no pack configured")
    expect(missing).toContain("OPENCODE_MODEL_SPECS_PACK")

    const broken = renderPackProblem("C:/config/model-specs.json", "invalid JSON: boom")
    expect(broken).toContain("pack unusable")
    expect(broken).toContain("invalid JSON: boom")
  })
})
