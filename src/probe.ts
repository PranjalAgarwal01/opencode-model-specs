import type { ModelSpec, SpecPack } from "./specs.js"

/** Deliberately invalid reasoning_effort used to test whether the gateway validates unknown values. */
export const TIER_SENTINEL = "__specs_probe__"

/**
 * Modalities the probe re-tests for *rejection* while the pack does not declare them.
 * Video is deliberately absent: a gateway may serve video while a pack omits it for
 * client-side reasons (OpenCode drops video attachments before send), so "must be
 * rejected" would be a false invariant.
 */
export const REJECTION_MODALITIES = ["audio", "pdf"] as const

export type RejectionModality = (typeof REJECTION_MODALITIES)[number]

/**
 * How many models are probed concurrently. Requests within one model (sentinel, its
 * tiers, serving, undeclared modality checks) stay sequential; only whole per-model
 * pipelines run in parallel, in bounded batches, so fan-out never grows with the pack.
 */
const MODEL_PROBE_CONCURRENCY = 4

export interface ProbeOptions {
  readonly baseURL: string
  readonly apiKey?: string
  readonly fetch?: typeof fetch
  readonly timeoutMs?: number
}

export interface AdvertRecord {
  readonly vision?: boolean
  readonly video?: boolean
  readonly inputLimit?: number
  readonly outputLimit?: number
}

/**
 * What the sentinel request (unknown reasoning_effort) revealed:
 *  - "error-set"     rejected and the message lists the supported values
 *  - "error-other"   rejected but the message could not be parsed
 *  - "accepted"      the unknown value was accepted (permissive/inert)
 *  - "unverifiable"  no verdict was obtained: network failure, timeout, or a
 *                    non-verdict HTTP status (auth, 404, 408, 429, 5xx, …)
 */
export type TierOutcome = "error-set" | "error-other" | "accepted" | "unverifiable"

export interface TierProbeResult {
  readonly outcome: TierOutcome
  readonly status?: number
  /** Supported tiers parsed out of the rejection message (informational). */
  readonly reportedTiers?: readonly string[]
  /** Raw (flattened, truncated) error message for diagnostics. */
  readonly message?: string
}

/** Result of sending a real request with one of the pack's accepted tiers. */
export interface TierCheckResult {
  readonly tier: string
  /** true: accepted; false: rejected (HTTP 400/422); undefined: no verdict (network failure or non-verdict status). */
  readonly accepted?: boolean
  readonly status?: number
  readonly message?: string
}

export interface ServingProbeResult {
  readonly ok: boolean
  readonly status?: number
  readonly detail: string
}

/** Result of sending a real request carrying a modality the pack does not declare. */
export interface ModalityCheckResult {
  readonly modality: RejectionModality
  /** true: served (drift); false: rejected (HTTP 400/422); undefined: no verdict (network failure or non-verdict status). */
  readonly accepted?: boolean
  readonly status?: number
  readonly message?: string
}

export interface ModelProbeResult {
  readonly id: string
  /** Present in GET /models; undefined when the list endpoint was unavailable. */
  readonly present?: boolean
  readonly advert?: AdvertRecord
  readonly tier: TierProbeResult
  readonly tierChecks: readonly TierCheckResult[]
  readonly serving: ServingProbeResult
  readonly modalityChecks: readonly ModalityCheckResult[]
}

export type FindingKind =
  | "missing-model"
  | "serving-failed"
  | "tier-rejected"
  | "enforcement-drift"
  | "tier-unverifiable"
  | "advert-changed"
  | "undeclared-accepted"
  | "modality-unverifiable"

export interface ProbeFinding {
  readonly kind: FindingKind
  readonly modelID: string
  readonly detail: string
}

export interface ProbeReport {
  readonly baseURL: string
  readonly probedAt: string
  readonly requestedModelIDs: readonly string[]
  /** Model ids served by GET /models; undefined when that endpoint failed or its payload was unparseable. */
  readonly servedModelIDs?: readonly string[]
  readonly models: readonly ModelProbeResult[]
  readonly missing: readonly string[]
  readonly findings: readonly ProbeFinding[]
  readonly notes: readonly string[]
}

// The supported-types branch stops at the first period/bracket/newline; it is only
// consulted for messages that mention reasoning_effort (see parseReportedTiers), so an
// unrelated "supported types are …" list cannot fabricate tiers.
const SUPPORTED_TYPES_RE = /supported types are\s+([^.\[\n]+)/i
// Only the run of quoted literals right after "input should be" is captured: Pydantic
// appends metadata afterwards (`, 'input': …, 'ctx': …`) whose quoted keys must not leak
// in (the per-item lookahead stops the run at `'key':` sequences).
const INPUT_SHOULD_BE_RE = /input should be\s+((?:'[^']*'(?!\s*:)(?:\s*(?:,|\bor\b|\band\b)\s*)*)+)/i
const REASONING_CONTEXT_RE = /reasoning[_\s]?effort/i

/**
 * Parse the supported reasoning tiers out of an error message (informational —
 * the authoritative check is a real request per tier, see runProbe).
 *
 * Known gateway messages (vLLM / LiteLLM gateways):
 *  - "Supported types are xhigh (default), medium, and low."
 *  - "Input should be 'none', 'minimal', 'low', 'medium', 'high', 'xhigh' or 'max'" (Pydantic literal)
 *
 * Only messages produced by the reasoning_effort sentinel probe reach this parser; the
 * supported-types branch additionally requires a reasoning_effort mention, and the
 * literal branch captures nothing but the run of quoted values, so Pydantic metadata
 * keys can never be ingested as tiers.
 */
export function parseReportedTiers(text: string): string[] | undefined {
  const mentionsReasoning = REASONING_CONTEXT_RE.test(text)

  const supported = mentionsReasoning ? SUPPORTED_TYPES_RE.exec(text) : null
  if (supported?.[1]) {
    const tiers = cleanTierList(supported[1])
    if (tiers.length > 0) return tiers
  }

  const inputShouldBe = INPUT_SHOULD_BE_RE.exec(text)
  if (inputShouldBe?.[1]) {
    const tiers = cleanTierList(inputShouldBe[1])
    if (tiers.length > 0) return tiers
  }

  // Last resort, restricted to messages that clearly talk about reasoning_effort:
  // collect quoted literal values.
  if (REASONING_CONTEXT_RE.test(text)) {
    const quoted = [...text.matchAll(/'([a-z][a-z0-9_-]*)'/giu)].map((match) => match[1]?.toLowerCase())
    const tiers = [...new Set(quoted.filter((value): value is string => typeof value === "string"))]
    if (tiers.length > 0) return tiers
  }

  return undefined
}

function cleanTierList(segment: string): string[] {
  const stripped = segment.replace(/\([^)]*\)/gu, " ")
  const tiers: string[] = []
  const push = (value: string): void => {
    const token = value.trim().toLowerCase()
    if (/^[a-z][a-z0-9_-]*$/u.test(token) && !tiers.includes(token)) tiers.push(token)
  }
  for (const part of stripped.split(/,|\band\b|\bor\b/iu)) {
    // Prefer quoted literals inside a part (Pydantic annotates them, e.g. `'max' [type=literal_error]`).
    const quoted = [...part.matchAll(/'([a-z][a-z0-9_-]*)'/giu)]
    if (quoted.length > 0) {
      for (const match of quoted) push(match[1] ?? "")
      continue
    }
    push(part.replace(/^["`]+|["`]+$/gu, ""))
  }
  return tiers
}

type RequestFn = (path: string, init?: RequestInit) => Promise<Response>

export async function runProbe(pack: SpecPack, options: ProbeOptions): Promise<ProbeReport> {
  const fetchImpl = options.fetch ?? fetch
  const base = options.baseURL.replace(/\/+$/u, "")
  const timeoutMs = options.timeoutMs ?? 15000
  const notes: string[] = []

  const headers: Record<string, string> = { accept: "application/json" }
  if (options.apiKey) headers.authorization = `Bearer ${options.apiKey}`

  const request: RequestFn = (path, init) =>
    fetchImpl(`${base}${path}`, {
      ...init,
      headers: { ...headers, ...(init?.headers as Record<string, string> | undefined) },
      signal: AbortSignal.timeout(timeoutMs),
    })

  let servedModelIDs: string[] | undefined
  try {
    const response = await request("/models")
    if (response.ok) {
      servedModelIDs = parseModelIDs(await response.json())
      if (servedModelIDs === undefined) {
        notes.push("GET /models response could not be parsed (no data array)")
      }
    } else {
      notes.push(`GET /models responded HTTP ${response.status}`)
    }
  } catch (error) {
    notes.push(`GET /models failed: ${errorMessage(error)}`)
  }

  let advertByID: Map<string, AdvertRecord> | undefined
  try {
    const response = await request("/model/info")
    if (response.ok) {
      advertByID = parseModelInfo(await response.json())
    } else {
      notes.push(`GET /model/info responded HTTP ${response.status}`)
    }
  } catch (error) {
    notes.push(`GET /model/info failed: ${errorMessage(error)}`)
  }

  const models: ModelProbeResult[] = []
  for (let start = 0; start < pack.models.length; start += MODEL_PROBE_CONCURRENCY) {
    const batch = pack.models.slice(start, start + MODEL_PROBE_CONCURRENCY)
    models.push(...(await Promise.all(batch.map((spec) => probeModel(spec, request, servedModelIDs, advertByID)))))
  }

  const missing = servedModelIDs ? pack.models.filter((spec) => !servedModelIDs.includes(spec.id)).map((spec) => spec.id) : []

  return {
    baseURL: base,
    probedAt: new Date().toISOString(),
    requestedModelIDs: pack.models.map((spec) => spec.id),
    ...(servedModelIDs ? { servedModelIDs } : {}),
    models,
    missing,
    findings: collectFindings(pack, models),
    notes,
  }
}

/** Probe one model: sentinel, every pack tier, serving, undeclared-modality rejections. */
async function probeModel(
  spec: ModelSpec,
  request: RequestFn,
  servedModelIDs: string[] | undefined,
  advertByID: Map<string, AdvertRecord> | undefined,
): Promise<ModelProbeResult> {
  const present = servedModelIDs ? servedModelIDs.includes(spec.id) : undefined
  const tier = await probeTierSentinel(spec.id, request)
  const tierChecks: TierCheckResult[] = []
  for (const value of spec.tiers) {
    tierChecks.push(await probeTierValue(spec.id, value, request))
  }
  const serving = await probeServing(spec.id, request)
  const modalityChecks: ModalityCheckResult[] = []
  for (const modality of REJECTION_MODALITIES) {
    if (spec.input.includes(modality)) continue
    modalityChecks.push(await probeModalityRejection(spec.id, modality, request))
  }
  const advert = advertByID?.get(spec.id)
  return {
    id: spec.id,
    ...(present !== undefined ? { present } : {}),
    ...(advert ? { advert } : {}),
    tier,
    tierChecks,
    serving,
    modalityChecks,
  }
}

function collectFindings(pack: SpecPack, models: readonly ModelProbeResult[]): ProbeFinding[] {
  const findings: ProbeFinding[] = []
  for (const probe of models) {
    const spec = pack.models.find((entry) => entry.id === probe.id)
    if (!spec) continue

    if (probe.present === false) {
      // Report presence as its own finding, but keep the probe findings: a stale
      // /models list must not hide that the model's chat endpoint actually answers.
      findings.push({ kind: "missing-model", modelID: probe.id, detail: "not served by GET /models" })
    }

    if (!probe.serving.ok) {
      findings.push({ kind: "serving-failed", modelID: probe.id, detail: probe.serving.detail })
    }

    const validated = spec.enforcement === "validated"
    const rejectedBySentinel = probe.tier.outcome === "error-set" || probe.tier.outcome === "error-other"
    if (probe.tier.outcome === "unverifiable") {
      findings.push({
        kind: "tier-unverifiable",
        modelID: probe.id,
        detail: probe.tier.message ?? "tier probe did not produce a verdict",
      })
    } else if (probe.tier.outcome === "accepted" && validated) {
      findings.push({
        kind: "enforcement-drift",
        modelID: probe.id,
        detail: "gateway accepted an unknown reasoning_effort value (no longer validates)",
      })
    } else if (rejectedBySentinel && !validated) {
      findings.push({
        kind: "enforcement-drift",
        modelID: probe.id,
        detail:
          `gateway now validates reasoning_effort (pack recorded "${spec.enforcement}")` +
          (probe.tier.reportedTiers ? `: [${probe.tier.reportedTiers.join(", ")}]` : ""),
      })
    }

    for (const check of probe.tierChecks) {
      if (check.accepted === false) {
        findings.push({
          kind: "tier-rejected",
          modelID: probe.id,
          detail: `tier '${check.tier}' rejected (HTTP ${check.status ?? "?"}): ${check.message ?? "no message"}`,
        })
      } else if (check.accepted === undefined && probe.tier.outcome !== "unverifiable") {
        findings.push({
          kind: "tier-unverifiable",
          modelID: probe.id,
          detail:
            `tier '${check.tier}' verification errored${check.status !== undefined ? ` (HTTP ${check.status})` : ""}: ` +
            (check.message ?? "unknown error"),
        })
      }
    }

    for (const check of probe.modalityChecks) {
      if (check.accepted === true) {
        findings.push({
          kind: "undeclared-accepted",
          modelID: probe.id,
          detail:
            `gateway served a ${check.modality} part the pack does not declare (HTTP ${check.status ?? "?"}) — ` +
            "re-verify the capability and update the pack",
        })
      } else if (check.accepted === undefined && probe.tier.outcome !== "unverifiable") {
        findings.push({
          kind: "modality-unverifiable",
          modelID: probe.id,
          detail: `${check.modality} rejection check errored${check.status !== undefined ? ` (HTTP ${check.status})` : ""}: ${check.message ?? "unknown error"}`,
        })
      }
    }

    if (probe.advert) {
      const diffs: string[] = []
      if (probe.advert.vision !== undefined && probe.advert.vision !== spec.advert.vision) {
        diffs.push(`vision: gateway ${probe.advert.vision}, pack ${spec.advert.vision}`)
      }
      if (probe.advert.video !== undefined && probe.advert.video !== spec.advert.video) {
        diffs.push(`video: gateway ${probe.advert.video}, pack ${spec.advert.video}`)
      }
      if (probe.advert.inputLimit !== undefined && probe.advert.inputLimit !== spec.advert.inputLimit) {
        diffs.push(`input limit: gateway ${probe.advert.inputLimit}, pack ${spec.advert.inputLimit}`)
      }
      if (probe.advert.outputLimit !== undefined && probe.advert.outputLimit !== spec.advert.outputLimit) {
        diffs.push(`output limit: gateway ${probe.advert.outputLimit}, pack ${spec.advert.outputLimit}`)
      }
      if (diffs.length > 0) {
        findings.push({ kind: "advert-changed", modelID: probe.id, detail: diffs.join("; ") })
      }
    }
  }
  return findings
}

/**
 * HTTP statuses that constitute a verdict about the input under test: the gateway
 * well-formedly refused this specific value/part. Every other non-2xx status (auth,
 * 404, 408, 429, 5xx, …) says nothing about the capability under test and must leave
 * the check unverifiable.
 */
function isVerdictStatus(status: number): boolean {
  return status === 400 || status === 422
}

/**
 * A 2xx only counts as acceptance when the body is a completions payload. A gateway
 * behind a redirecting proxy (an SSO login page, say) can answer 200 with HTML or with
 * JSON that never reached a model; that must leave the check unverifiable — mirroring
 * the shape check `probeServing` performs.
 */
async function isCompletionPayload(response: Response): Promise<boolean> {
  try {
    const payload = (await response.json()) as { choices?: unknown }
    return Array.isArray(payload?.choices) && payload.choices.length > 0
  } catch {
    return false
  }
}

async function probeTierSentinel(modelID: string, request: RequestFn): Promise<TierProbeResult> {
  try {
    const response = await request("/chat/completions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: modelID,
        messages: [{ role: "user", content: "spec probe" }],
        max_tokens: 4,
        reasoning_effort: TIER_SENTINEL,
      }),
    })
    if (response.ok) {
      return (await isCompletionPayload(response))
        ? { outcome: "accepted", status: response.status }
        : {
            outcome: "unverifiable",
            status: response.status,
            message: `HTTP ${response.status} but the body was not a completions payload`,
          }
    }
    const text = await response.text()
    if (!isVerdictStatus(response.status)) {
      return { outcome: "unverifiable", status: response.status, message: `HTTP ${response.status}: ${summarize(text)}` }
    }
    const reportedTiers = parseReportedTiers(text)
    if (reportedTiers) {
      return { outcome: "error-set", status: response.status, reportedTiers, message: summarize(text) }
    }
    return { outcome: "error-other", status: response.status, message: summarize(text) }
  } catch (error) {
    return { outcome: "unverifiable", message: errorMessage(error) }
  }
}

async function probeTierValue(modelID: string, tier: string, request: RequestFn): Promise<TierCheckResult> {
  try {
    const response = await request("/chat/completions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: modelID,
        messages: [{ role: "user", content: "spec probe" }],
        max_tokens: 4,
        reasoning_effort: tier,
      }),
    })
    if (response.ok) {
      return (await isCompletionPayload(response))
        ? { tier, accepted: true, status: response.status }
        : { tier, status: response.status, message: `HTTP ${response.status} but the body was not a completions payload` }
    }
    const message = summarize(await response.text(), 300)
    if (isVerdictStatus(response.status)) {
      return { tier, accepted: false, status: response.status, message }
    }
    return { tier, status: response.status, message }
  } catch (error) {
    return { tier, message: errorMessage(error) }
  }
}

async function probeServing(modelID: string, request: RequestFn): Promise<ServingProbeResult> {
  try {
    const response = await request("/chat/completions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: modelID,
        messages: [{ role: "user", content: "Reply with the single word: OK" }],
        max_tokens: 64,
        temperature: 0,
      }),
    })
    if (!response.ok) {
      return { ok: false, status: response.status, detail: `HTTP ${response.status}: ${summarize(await response.text(), 300)}` }
    }
    try {
      const payload = (await response.json()) as { choices?: unknown }
      const choices = Array.isArray(payload?.choices) ? payload.choices : []
      return choices.length > 0
        ? { ok: true, status: response.status, detail: `HTTP ${response.status}, choices=${choices.length}` }
        : { ok: false, status: response.status, detail: `HTTP ${response.status} but the response has no choices` }
    } catch (error) {
      return { ok: false, status: response.status, detail: `HTTP ${response.status} but the body was not JSON (${errorMessage(error)})` }
    }
  } catch (error) {
    return { ok: false, detail: errorMessage(error) }
  }
}

/**
 * Send one real request carrying an undeclared modality. The expected verdict is a
 * rejection (HTTP 400/422); a served request is drift (the gateway moved ahead of the
 * pack), and anything else (auth, 404, 408, 429, 5xx, network) leaves the check
 * unverifiable.
 */
async function probeModalityRejection(
  modelID: string,
  modality: RejectionModality,
  request: RequestFn,
): Promise<ModalityCheckResult> {
  try {
    const response = await request("/chat/completions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: modelID,
        messages: [{ role: "user", content: probeModalityContent(modality) }],
        max_tokens: 4,
      }),
    })
    if (response.ok) {
      return (await isCompletionPayload(response))
        ? { modality, accepted: true, status: response.status }
        : { modality, status: response.status, message: `HTTP ${response.status} but the body was not a completions payload` }
    }
    const message = summarize(await response.text(), 300)
    if (isVerdictStatus(response.status)) {
      return { modality, accepted: false, status: response.status, message }
    }
    return { modality, status: response.status, message }
  } catch (error) {
    return { modality, message: errorMessage(error) }
  }
}

/** Part shapes of the verified 2026-10-16 audio/PDF check (tiny WAV / minimal PDF). */
function probeModalityContent(modality: RejectionModality): readonly unknown[] {
  if (modality === "audio") {
    return [
      { type: "text", text: "spec probe" },
      { type: "input_audio", input_audio: { data: tinyWavB64(), format: "wav" } },
    ]
  }
  return [
    { type: "text", text: "spec probe" },
    { type: "file", file: { filename: "spec-probe.pdf", file_data: `data:application/pdf;base64,${tinyPdfB64()}` } },
  ]
}

let wavB64Cache: string | undefined

/** Tiny valid WAV (8 kHz mono 8-bit, ~0.1 s of silence) — the bytes used for the live check. */
function tinyWavB64(): string {
  if (wavB64Cache) return wavB64Cache
  const samples = 800
  const data = Buffer.alloc(samples, 128)
  const header = Buffer.alloc(44)
  header.write("RIFF", 0)
  header.writeUInt32LE(36 + data.length, 4)
  header.write("WAVE", 8)
  header.write("fmt ", 12)
  header.writeUInt32LE(16, 16)
  header.writeUInt16LE(1, 20)
  header.writeUInt16LE(1, 22)
  header.writeUInt32LE(8000, 24)
  header.writeUInt32LE(8000, 28)
  header.writeUInt16LE(1, 32)
  header.writeUInt16LE(8, 34)
  header.write("data", 36)
  header.writeUInt32LE(data.length, 40)
  wavB64Cache = Buffer.concat([header, data]).toString("base64")
  return wavB64Cache
}

let pdfB64Cache: string | undefined

/** Minimal valid single-page PDF with a correct xref table. */
function tinyPdfB64(): string {
  if (pdfB64Cache) return pdfB64Cache
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 72 72] >>",
  ]
  let pdf = "%PDF-1.4\n"
  const offsets: number[] = []
  objects.forEach((body, index) => {
    offsets.push(Buffer.byteLength(pdf, "utf8"))
    pdf += `${index + 1} 0 obj\n${body}\nendobj\n`
  })
  const xrefStart = Buffer.byteLength(pdf, "utf8")
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`
  for (const offset of offsets) pdf += `${String(offset).padStart(10, "0")} 00000 n \n`
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF\n`
  pdfB64Cache = Buffer.from(pdf, "utf8").toString("base64")
  return pdfB64Cache
}

/** Model ids served by GET /models; undefined when the payload has no usable model list. */
function parseModelIDs(payload: unknown): string[] | undefined {
  const data = (payload as { data?: unknown } | undefined)?.data
  if (!Array.isArray(data)) return undefined
  const ids: string[] = []
  for (const entry of data) {
    const id = typeof entry === "string" ? entry : entry && typeof entry === "object" ? (entry as { id?: unknown }).id : undefined
    if (typeof id === "string" && id.length > 0 && !ids.includes(id)) ids.push(id)
  }
  // A non-empty array without a single usable id is a malformed payload, not an empty list.
  if (ids.length === 0 && data.length > 0) return undefined
  return ids
}

/** Defensive parse of litellm-style /model/info payloads. */
function parseModelInfo(payload: unknown): Map<string, AdvertRecord> {
  const map = new Map<string, AdvertRecord>()
  const data = Array.isArray(payload) ? payload : (payload as { data?: unknown } | undefined)?.data
  if (!Array.isArray(data)) return map
  for (const entry of data) {
    if (!entry || typeof entry !== "object") continue
    const record = entry as Record<string, unknown>
    const info =
      record.model_info && typeof record.model_info === "object" && !Array.isArray(record.model_info)
        ? (record.model_info as Record<string, unknown>)
        : record
    const id = firstString(record.model_name) ?? firstString(record.id, record.literal) ?? firstString(info.id)
    if (!id) continue
    map.set(id, {
      ...(toBoolean(info.supports_vision) !== undefined ? { vision: toBoolean(info.supports_vision) } : {}),
      ...(toBoolean(info.supports_video_input) !== undefined ? { video: toBoolean(info.supports_video_input) } : {}),
      ...(toNumber(info.max_input_tokens) !== undefined ? { inputLimit: toNumber(info.max_input_tokens) } : {}),
      ...(toNumber(info.max_output_tokens) !== undefined ? { outputLimit: toNumber(info.max_output_tokens) } : {}),
    })
  }
  return map
}

function firstString(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value === "string" && value.length > 0) return value
  }
  return undefined
}

function toBoolean(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined
}

function toNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined
}

function summarize(text: string, limit = 800): string {
  const flat = text.replace(/\s+/gu, " ").trim()
  return flat.length > limit ? `${flat.slice(0, limit)}…` : flat
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
