import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { homedir, tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { loadPack, PACK_ENV_VAR, parsePack, specByModelID } from "../src/specs.js"
import { TEST_PACK } from "./test-pack.js"

describe("parsePack", () => {
  const clone = (): Record<string, any> => JSON.parse(JSON.stringify(TEST_PACK)) as Record<string, any>
  const mutated = (mutate: (pack: Record<string, any>) => void): Record<string, any> => {
    const pack = clone()
    mutate(pack)
    return pack
  }

  it("accepts a coherent pack", () => {
    const result = parsePack(TEST_PACK)
    expect("pack" in result ? result.pack.providerID : result.error).toBe("test-gateway")
  })

  it("accepts the shipped example pack", () => {
    const example = JSON.parse(readFileSync(new URL("../pack.example.json", import.meta.url), "utf8")) as unknown
    const result = parsePack(example)
    expect("error" in result ? result.error : undefined).toBeUndefined()
  })

  it("accepts a defaultTier that is not one of the exposed tiers", () => {
    // The gateway's implicit default may be a tier the pack does not expose as
    // a variant; rendering falls back to an exposed tier in that case.
    const result = parsePack(mutated((pack) => { pack.models[0].defaultTier = "turbo" }))
    expect("error" in result ? result.error : undefined).toBeUndefined()
  })

  it("accepts a plain-http baseURL (localhost gateways)", () => {
    const result = parsePack(mutated((pack) => { pack.baseURL = "http://localhost:11434/v1" }))
    expect("error" in result ? result.error : undefined).toBeUndefined()
  })

  it("rejects malformed packs with a specific error", () => {
    const cases: Array<[string, unknown, string]> = [
      ["non-object", 42, "must be a JSON object"],
      ["missing providerID", mutated((pack) => { pack.providerID = "" }), "providerID"],
      ["non-http baseURL", mutated((pack) => { pack.baseURL = "ftp://x" }), "baseURL"],
      ["bad verifiedAt", mutated((pack) => { pack.verifiedAt = "soon" }), "date string"],
      ["empty models", mutated((pack) => { pack.models = [] }), "non-empty array"],
      ["non-object model", mutated((pack) => { pack.models.push(3) }), "must be an object"],
      ["duplicate model ids", mutated((pack) => { pack.models.push({ ...pack.models[0] }) }), "duplicates"],
      ["missing model id", mutated((pack) => { pack.models[0].id = "" }), "id must be"],
      ["missing backing", mutated((pack) => { delete pack.models[0].backing }), "backing must be"],
      ["non-boolean tools", mutated((pack) => { pack.models[0].tools = "yes" }), "tools must be a boolean"],
      ["unknown modality", mutated((pack) => { pack.models[0].input = ["text", "hologram"] }), "input must be"],
      ["input without text", mutated((pack) => { pack.models[0].input = ["image"] }), 'must include "text"'],
      ["negative limit", mutated((pack) => { pack.models[0].limit.context = -1 }), "limit.context"],
      [
        "input above context",
        mutated((pack) => { pack.models[0].limit.input = pack.models[0].limit.context + 1 }),
        "must not exceed",
      ],
      ["non-object limit", mutated((pack) => { pack.models[0].limit = 7 }), "limit must be an object"],
      ["non-string tiers", mutated((pack) => { pack.models[0].tiers = [7] }), "tiers must be"],
      ["non-string defaultTier", mutated((pack) => { pack.models[0].defaultTier = 3 }), "defaultTier must be"],
      ["unknown enforcement", mutated((pack) => { pack.models[0].enforcement = "strict" }), "enforcement"],
      ["non-object advert", mutated((pack) => { pack.models[0].advert = "nope" }), "advert must be an object"],
      ["non-boolean advert flag", mutated((pack) => { pack.models[0].advert.vision = "yes" }), "advert.vision"],
      ["bad model verifiedAt", mutated((pack) => { pack.models[0].verifiedAt = "soon" }), "date string"],
      ["rolled-over verifiedAt", mutated((pack) => { pack.verifiedAt = "2026-02-30" }), "date string"],
      ["partial verifiedAt", mutated((pack) => { pack.verifiedAt = "2026" }), "date string"],
      ["epoch-number verifiedAt", mutated((pack) => { pack.verifiedAt = "0" }), "date string"],
      ["non-string notes", mutated((pack) => { pack.models[0].notes = 3 }), "notes must be a string"],
    ]
    for (const [name, value, expected] of cases) {
      const result = parsePack(value)
      expect("error" in result ? result.error : "<accepted>", name).toContain(expected)
    }
  })

  it("resolves specs by model id", () => {
    expect(specByModelID(TEST_PACK, "example-chat-31b")?.backing).toBe("Example-Chat-31B")
    expect(specByModelID(TEST_PACK, "nope")).toBeUndefined()
  })
})

describe("loadPack", () => {
  let dir: string
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "specs-test-"))
  })
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it("reports the default path when no pack is configured", () => {
    const result = loadPack({ env: {}, configDir: dir })
    expect(result.path).toBe(join(dir, "model-specs.json"))
    expect(result.pack).toBeUndefined()
    expect(result.error).toBeUndefined()
  })

  it("uses XDG_CONFIG_HOME for the default config directory", () => {
    const xdg = join(dir, "xdg")
    const result = loadPack({ env: { XDG_CONFIG_HOME: xdg } })
    expect(result.path).toBe(join(xdg, "opencode", "model-specs.json"))
    expect(result.pack).toBeUndefined()
    expect(result.error).toBeUndefined()
  })

  it("falls back to ~/.config when XDG_CONFIG_HOME is empty", () => {
    const result = loadPack({ env: { XDG_CONFIG_HOME: "  " } })
    expect(result.path).toBe(join(homedir(), ".config", "opencode", "model-specs.json"))
  })

  it("treats a whitespace-only env override as unset", () => {
    const result = loadPack({ env: { [PACK_ENV_VAR]: "   " }, configDir: dir })
    expect(result.path).toBe(join(dir, "model-specs.json"))
  })

  it("loads a valid pack from the config directory", () => {
    writeFileSync(join(dir, "model-specs.json"), JSON.stringify(TEST_PACK), "utf8")
    const result = loadPack({ env: {}, configDir: dir })
    expect(result.error).toBeUndefined()
    expect(result.pack?.models).toHaveLength(TEST_PACK.models.length)
  })

  it("loads a pack written with a UTF-8 BOM", () => {
    writeFileSync(join(dir, "model-specs.json"), "\uFEFF" + JSON.stringify(TEST_PACK), "utf8")
    const result = loadPack({ env: {}, configDir: dir })
    expect(result.error).toBeUndefined()
    expect(result.pack).toBeDefined()
  })

  it("honors the environment override over XDG_CONFIG_HOME", () => {
    const file = join(dir, "elsewhere.json")
    writeFileSync(file, JSON.stringify(TEST_PACK), "utf8")
    const result = loadPack({
      env: { [PACK_ENV_VAR]: file, XDG_CONFIG_HOME: join(dir, "unused") },
      configDir: join(dir, "missing"),
    })
    expect(result.path).toBe(file)
    expect(result.pack).toBeDefined()
  })

  it("reports invalid JSON as an error", () => {
    writeFileSync(join(dir, "model-specs.json"), "{ nope", "utf8")
    const result = loadPack({ env: {}, configDir: dir })
    expect(result.error).toContain("invalid JSON")
    expect(result.pack).toBeUndefined()
  })

  it("reports an invalid shape as an error", () => {
    writeFileSync(join(dir, "model-specs.json"), JSON.stringify({ providerID: "x" }), "utf8")
    const result = loadPack({ env: {}, configDir: dir })
    expect(result.error).toContain("baseURL")
  })
})
