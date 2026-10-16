/**
 * Live verification of the configured spec pack against the real gateway.
 *
 * Skipped unless OPENCODE_MODEL_SPECS_LIVE=1. The pack is read from
 * $OPENCODE_MODEL_SPECS_PACK, or ~/.config/opencode/model-specs.json. The
 * credential is resolved at runtime in the same spirit as the host (first
 * match wins):
 *   1. OPENCODE_MODEL_SPECS_API_KEY
 *   2. active credential for the pack's providerID in
 *      ~/.local/share/opencode/opencode.db (v2 credential store, active = 1)
 *   3. ~/.local/share/opencode/auth.json  (entry = providerID -> key)
 *
 * It is never logged, written or asserted on — only used as a Bearer header.
 * With OPENCODE_MODEL_SPECS_CAPTURE=1 the raw responses are written to
 * test/fixtures/live/ (gitignored captures, kept locally for diffing).
 *
 *   npm run test:live                                 # verify the live gateway
 *   OPENCODE_MODEL_SPECS_CAPTURE=1 npm run test:live  # plus capture raw payloads
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"
import { runProbe } from "../src/probe.js"
import { renderProbeReport } from "../src/render.js"
import { loadPack } from "../src/specs.js"

const LIVE = process.env.OPENCODE_MODEL_SPECS_LIVE === "1"
const CAPTURE = process.env.OPENCODE_MODEL_SPECS_CAPTURE === "1"

function readAuthJsonKey(providerID: string): string | undefined {
  try {
    const file = join(homedir(), ".local", "share", "opencode", "auth.json")
    const parsed = JSON.parse(readFileSync(file, "utf8")) as Record<string, { key?: unknown } | undefined>
    const key = parsed[providerID]?.key
    return typeof key === "string" && key.trim().length > 0 ? key.trim() : undefined
  } catch {
    return undefined
  }
}

async function readCredentialFromDb(providerID: string): Promise<string | undefined> {
  try {
    const { DatabaseSync } = await import("node:sqlite")
    const database = new DatabaseSync(join(homedir(), ".local", "share", "opencode", "opencode.db"), { readOnly: true })
    try {
      const row = database
        .prepare("SELECT value FROM credential WHERE integration_id = ? AND active = 1 ORDER BY time_updated DESC LIMIT 1")
        .get(providerID) as { value?: unknown } | undefined
      if (!row || typeof row.value !== "string") return undefined
      const parsed = JSON.parse(row.value) as { type?: unknown; key?: unknown; access?: unknown }
      const value = parsed.key ?? parsed.access
      return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined
    } finally {
      database.close()
    }
  } catch {
    return undefined
  }
}

async function readGatewayKey(providerID: string): Promise<string | undefined> {
  const fromEnv = process.env.OPENCODE_MODEL_SPECS_API_KEY
  if (fromEnv && fromEnv.trim().length > 0) return fromEnv.trim()
  return (await readCredentialFromDb(providerID)) ?? readAuthJsonKey(providerID)
}

describe.skipIf(!LIVE)("live gateway probe", () => {
  it("verifies the configured pack against the real gateway", async () => {
    const loaded = loadPack()
    const pack = loaded.pack
    if (!pack) {
      expect.fail(
        loaded.error
          ? `pack at ${loaded.path} is unusable: ${loaded.error}`
          : `no pack configured (looked at ${loaded.path})`,
      )
    }
    const baseURL = process.env.OPENCODE_MODEL_SPECS_BASE_URL ?? pack.baseURL
    const apiKey = await readGatewayKey(pack.providerID)
    const report = await runProbe(pack, { baseURL, apiKey, timeoutMs: 30000 })

    // eslint-disable-next-line no-console
    console.log(renderProbeReport(report, pack))

    if (CAPTURE) {
      const dir = fileURLToPath(new URL("./fixtures/live", import.meta.url))
      mkdirSync(dir, { recursive: true })
      const headers: Record<string, string> = { accept: "application/json" }
      if (apiKey) headers.authorization = `Bearer ${apiKey}`
      for (const [name, path] of [
        ["models", "/models"],
        ["model-info", "/model/info"],
      ] as const) {
        try {
          const response = await fetch(`${baseURL.replace(/\/+$/u, "")}${path}`, { headers })
          writeFileSync(join(dir, `${name}.json`), await response.text(), "utf8")
        } catch {
          // Capture is best-effort; the report alone is still useful.
        }
      }
      writeFileSync(join(dir, "report.json"), JSON.stringify(report, null, 2), "utf8")
    }

    expect(report.servedModelIDs, "GET /models must be reachable — check credential/network").toBeDefined()
    expect(report.missing, "pack models missing from GET /models").toEqual([])
    for (const probe of report.models) {
      expect(probe.serving.ok, `${probe.id} serving — ${probe.serving.detail}`).toBe(true)
    }
    const errors = report.findings
    expect(errors, JSON.stringify(errors, null, 2)).toEqual([])
  }, 180_000)
})
