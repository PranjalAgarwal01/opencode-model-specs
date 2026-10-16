import { describe, expect, it } from "vitest"
import { REJECTION_MODALITIES, runProbe, TIER_SENTINEL } from "../src/probe.js"
import { TEST_PACK as PACK } from "./test-pack.js"

interface ChatBehavior {
  status: number
  body: unknown
}

interface StubConfig {
  models?: { status: number; body: unknown } | "throw"
  info?: { status: number; body: unknown } | "throw"
  /** Behavior for the sentinel request (unknown reasoning_effort) per model. */
  sentinel: Record<string, ChatBehavior | "throw">
  /** Behavior for each pack tier per model. */
  tierValue: Record<string, Record<string, ChatBehavior | "throw">>
  serving: Record<string, ChatBehavior | "throw">
  /** Behavior for the undeclared-modality rejection checks, per model and modality. */
  modality: Record<string, Record<string, ChatBehavior | "throw">>
}

interface RecordedCall {
  path: string
  method: string
  headers: Record<string, string>
  body?: Record<string, unknown>
}

/** The message content array is how modality probes differ from serving probes. */
function firstMessageContent(body: Record<string, unknown> | undefined): unknown {
  const messages = body?.messages
  if (!Array.isArray(messages) || messages.length === 0) return undefined
  return (messages[0] as { content?: unknown } | undefined)?.content
}

function modalityOf(content: unknown): "audio" | "pdf" | undefined {
  if (!Array.isArray(content)) return undefined
  for (const part of content) {
    const type = (part as { type?: unknown } | undefined)?.type
    if (type === "input_audio") return "audio"
    if (type === "file") return "pdf"
  }
  return undefined
}

/** Modalities the probe re-tests for rejection: ones the pack declares are skipped. */
function rejectionModalitiesFor(spec: (typeof PACK.models)[number]) {
  return REJECTION_MODALITIES.filter((modality) => !spec.input.includes(modality))
}

function stubFetch(config: StubConfig): { fetch: typeof fetch; calls: RecordedCall[] } {
  const calls: RecordedCall[] = []
  const impl = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url
    const path = new URL(url).pathname.replace(/^\/v1(?=\/)/u, "")
    const headers = (init?.headers ?? {}) as Record<string, string>
    const body = typeof init?.body === "string" ? (JSON.parse(init.body) as Record<string, unknown>) : undefined
    calls.push({ path, method: init?.method ?? "GET", headers, ...(body ? { body } : {}) })

    const respond = (status: number, payload: unknown): Response =>
      new Response(typeof payload === "string" ? payload : JSON.stringify(payload), { status })

    if (path === "/models") {
      if (config.models === "throw") throw new Error("models boom")
      if (config.models) return respond(config.models.status, config.models.body)
    }
    if (path === "/model/info") {
      if (config.info === "throw") throw new Error("info boom")
      if (config.info) return respond(config.info.status, config.info.body)
    }
    if (path === "/chat/completions") {
      const model = String(body?.model)
      const effort = body?.reasoning_effort
      const content = firstMessageContent(body)
      const modality = modalityOf(content)
      let behavior: ChatBehavior | "throw" | undefined
      if (effort === TIER_SENTINEL) {
        behavior = config.sentinel[model]
      } else if (typeof effort === "string") {
        behavior = config.tierValue[model]?.[effort]
      } else if (modality) {
        behavior = config.modality[model]?.[modality]
      } else {
        behavior = config.serving[model]
      }
      if (behavior === "throw") throw new Error(`${model} boom`)
      if (behavior) return respond(behavior.status, behavior.body)
      return respond(404, "unknown model")
    }
    return respond(404, "not found")
  }
  return { fetch: impl as unknown as typeof fetch, calls }
}

function advertEntry(spec: (typeof PACK.models)[number]): unknown {
  return {
    model_name: spec.id,
    model_info: {
      supports_vision: spec.advert.vision,
      supports_video_input: spec.advert.video,
      max_input_tokens: spec.advert.inputLimit,
      max_output_tokens: spec.advert.outputLimit,
    },
  }
}

const SENTINEL_MESSAGES: Record<string, string> = {
  "example-chat-31b": "Input should be 'none', 'minimal', 'low', 'medium', 'high', 'xhigh' or 'max'",
  "example-vl-27b": "Input should be 'none', 'minimal', 'low', 'medium', 'high', 'xhigh' or 'max'",
  "example-omni-27b": "Input should be 'none', 'minimal', 'low', 'medium', 'high', 'xhigh' or 'max'",
  "example-coder-30b": "Input should be 'low', 'medium' or 'high'",
}

const SERVING_OK: ChatBehavior = { status: 200, body: { choices: [{ message: { role: "assistant", content: "OK" } }] } }

function happyConfig(models: readonly (typeof PACK.models)[number][] = PACK.models): StubConfig {
  return {
    models: { status: 200, body: { data: models.map((spec) => ({ id: spec.id })) } },
    info: { status: 200, body: { data: models.map(advertEntry) } },
    sentinel: Object.fromEntries(
      models.map((spec) => [spec.id, { status: 400, body: SENTINEL_MESSAGES[spec.id] ?? "Input should be 'low'" }]),
    ),
    tierValue: Object.fromEntries(
      models.map((spec) => [
        spec.id,
        Object.fromEntries(spec.tiers.map((tier) => [tier, SERVING_OK])),
      ]),
    ),
    serving: Object.fromEntries(models.map((spec) => [spec.id, SERVING_OK])),
    modality: Object.fromEntries(
      models.map((spec) => [
        spec.id,
        Object.fromEntries(
          rejectionModalitiesFor(spec).map((modality) => [
            modality,
            {
              status: 400,
              body: {
                error: {
                  message:
                    modality === "audio"
                      ? "At most 0 audio(s) may be provided in one prompt."
                      : "Unsupported chat content part type: 'file'.",
                },
              },
            },
          ]),
        ),
      ]),
    ),
  }
}

/** One sentinel + one request per pack tier + one serving probe + one request per undeclared probed modality, per model. */
function expectedChatCalls(): number {
  return PACK.models.reduce(
    (total, spec) =>
      total + 1 + spec.tiers.length + 1 + rejectionModalitiesFor(spec).length,
    0,
  )
}

describe("runProbe", () => {
  it("reports no findings when the gateway matches the pack", async () => {
    const stub = stubFetch(happyConfig())
    const report = await runProbe(PACK, { baseURL: "https://gateway.test/v1", apiKey: "test-key", fetch: stub.fetch })

    expect(report.servedModelIDs).toHaveLength(4)
    expect(report.missing).toEqual([])
    expect(report.notes).toEqual([])
    expect(report.findings).toEqual([])
    expect(report.models.map((probe) => probe.present)).toEqual([true, true, true, true])
    for (const probe of report.models) {
      expect(probe.serving.ok, probe.id).toBe(true)
      expect(probe.tier.outcome, probe.id).toBe("error-set")
      expect(
        probe.tierChecks.map((check) => check.accepted),
        `${probe.id} tier checks`,
      ).toEqual(probe.tierChecks.map(() => true))
      expect(probe.modalityChecks.map((check) => check.modality), `${probe.id} probed modalities`).toEqual(["audio", "pdf"])
      expect(
        probe.modalityChecks.map((check) => check.accepted),
        `${probe.id} modality checks`,
      ).toEqual(probe.modalityChecks.map(() => false))
    }
  })

  it("sends the credential on every request and probes every pack tier for real", async () => {
    const stub = stubFetch(happyConfig())
    await runProbe(PACK, { baseURL: "https://gateway.test/v1", apiKey: "test-key", fetch: stub.fetch })

    expect(stub.calls).toHaveLength(expectedChatCalls() + 2)
    for (const call of stub.calls) {
      expect(call.headers.authorization, `${call.path} auth`).toBe("Bearer test-key")
    }
    const sentinelCalls = stub.calls.filter(
      (call) => call.path === "/chat/completions" && call.body?.reasoning_effort === TIER_SENTINEL,
    )
    expect(sentinelCalls).toHaveLength(4)
    const tierCalls = stub.calls.filter(
      (call) => call.path === "/chat/completions" && call.body?.reasoning_effort !== TIER_SENTINEL && call.body?.reasoning_effort !== undefined,
    )
    expect(tierCalls).toHaveLength(PACK.models.reduce((total, spec) => total + spec.tiers.length, 0))

    const modalityCalls = stub.calls.filter(
      (call) => call.path === "/chat/completions" && modalityOf(firstMessageContent(call.body)) !== undefined,
    )
    expect(modalityCalls).toHaveLength(
      PACK.models.reduce((total, spec) => total + rejectionModalitiesFor(spec).length, 0),
    )
    const audioCall = modalityCalls.find((call) => modalityOf(firstMessageContent(call.body)) === "audio")
    const audioPart = (firstMessageContent(audioCall?.body) as Array<Record<string, unknown>>)[1] as {
      type: string
      input_audio: { data: string; format: string }
    }
    expect(audioPart.type).toBe("input_audio")
    expect(audioPart.input_audio.format).toBe("wav")
    expect(audioPart.input_audio.data.length).toBeGreaterThan(100)
    const pdfCall = modalityCalls.find((call) => modalityOf(firstMessageContent(call.body)) === "pdf")
    const pdfPart = (firstMessageContent(pdfCall?.body) as Array<Record<string, unknown>>)[1] as {
      type: string
      file: { filename: string; file_data: string }
    }
    expect(pdfPart.type).toBe("file")
    expect(pdfPart.file.filename).toBe("spec-probe.pdf")
    expect(pdfPart.file.file_data.startsWith("data:application/pdf;base64,")).toBe(true)
    expect(pdfCall?.body?.max_tokens).toBe(4)
  })

  it("detects rejected tiers, enforcement drift, missing models and advert changes", async () => {
    const config = happyConfig()
    config.models = {
      status: 200,
      body: { data: PACK.models.filter((spec) => spec.id !== "example-vl-27b").map((spec) => ({ id: spec.id })) },
    }
    config.tierValue["example-chat-31b"] = { ...config.tierValue["example-chat-31b"], low: { status: 400, body: "Supported types are xhigh (default), medium, and none." } }
    config.sentinel["example-omni-27b"] = SERVING_OK
    config.sentinel["example-coder-30b"] = SERVING_OK
    config.info = {
      status: 200,
      body: {
        data: PACK.models.map((spec) =>
          spec.id === "example-chat-31b"
            ? { model_name: spec.id, model_info: { supports_vision: true, supports_video_input: true, max_input_tokens: 125000, max_output_tokens: 20000 } }
            : advertEntry(spec),
        ),
      },
    }

    const stub = stubFetch(config)
    const report = await runProbe(PACK, { baseURL: "https://gateway.test/v1", fetch: stub.fetch })

    expect(report.missing).toEqual(["example-vl-27b"])
    const kinds = report.findings.map((finding) => `${finding.kind}:${finding.modelID}`)
    expect(kinds).toContain("missing-model:example-vl-27b")
    expect(kinds).toContain("tier-rejected:example-chat-31b")
    expect(kinds).toContain("enforcement-drift:example-omni-27b")
    expect(kinds).toContain("enforcement-drift:example-coder-30b")
    expect(kinds).toContain("advert-changed:example-chat-31b")
    expect(kinds).not.toContain("serving-failed:example-chat-31b")

    const tierRejected = report.findings.find((finding) => finding.kind === "tier-rejected" && finding.modelID === "example-chat-31b")
    expect(tierRejected?.detail).toContain("tier 'low' rejected")
    expect(tierRejected?.detail).toContain("Supported types")
  })

  it("flags an undeclared modality the gateway starts serving", async () => {
    const config = happyConfig()
    config.modality["example-chat-31b"] = {
      audio: { status: 200, body: { choices: [{ message: { role: "assistant", content: "OK" } }] } },
      pdf: { status: 400, body: "Unsupported chat content part type: 'file'." },
    }

    const stub = stubFetch(config)
    const report = await runProbe(PACK, { baseURL: "https://gateway.test/v1", fetch: stub.fetch })

    const kinds = report.findings.map((finding) => `${finding.kind}:${finding.modelID}`)
    expect(kinds).toContain("undeclared-accepted:example-chat-31b")
    const finding = report.findings.find((entry) => entry.kind === "undeclared-accepted")
    expect(finding?.detail).toContain("audio")
    expect(finding?.detail).toContain("HTTP 200")
    const chat = report.models.find((probe) => probe.id === "example-chat-31b")
    expect(chat?.modalityChecks.map((check) => check.accepted)).toEqual([true, false])
  })

  it("keeps an ambiguous modality result out of the verdict (unverifiable)", async () => {
    const config = happyConfig()
    config.modality["example-omni-27b"] = {
      audio: { status: 429, body: "rate limited" },
      pdf: { status: 400, body: "Unsupported chat content part type: 'file'." },
    }

    const stub = stubFetch(config)
    const report = await runProbe(PACK, { baseURL: "https://gateway.test/v1", fetch: stub.fetch })

    const kinds = report.findings.map((finding) => `${finding.kind}:${finding.modelID}`)
    expect(kinds).toContain("modality-unverifiable:example-omni-27b")
    expect(kinds).not.toContain("undeclared-accepted:example-omni-27b")
    const finding = report.findings.find((entry) => entry.kind === "modality-unverifiable")
    expect(finding?.detail).toContain("audio")
    expect(finding?.detail).toContain("429")
  })

  it("degrades gracefully when the gateway is unreachable", async () => {
    const stub = stubFetch({
      models: "throw",
      info: "throw",
      sentinel: Object.fromEntries(PACK.models.map((spec) => [spec.id, "throw"])),
      tierValue: Object.fromEntries(PACK.models.map((spec) => [spec.id, Object.fromEntries(spec.tiers.map((tier) => [tier, "throw"]))])),
      serving: Object.fromEntries(PACK.models.map((spec) => [spec.id, "throw"])),
      modality: Object.fromEntries(
        PACK.models.map((spec) => [
          spec.id,
          Object.fromEntries(REJECTION_MODALITIES.map((modality) => [modality, "throw"])),
        ]),
      ),
    })
    const report = await runProbe(PACK, { baseURL: "https://gateway.test/v1", fetch: stub.fetch })

    expect(report.servedModelIDs).toBeUndefined()
    expect(report.missing).toEqual([])
    expect(report.notes.join(" ")).toContain("GET /models failed: models boom")
    expect(report.notes.join(" ")).toContain("GET /model/info failed: info boom")
    for (const probe of report.models) {
      expect(probe.present, probe.id).toBeUndefined()
      expect(probe.serving.ok, probe.id).toBe(false)
      expect(probe.tier.outcome, probe.id).toBe("unverifiable")
    }
    const kinds = new Set(report.findings.map((finding) => finding.kind))
    expect(kinds).toEqual(new Set(["serving-failed", "tier-unverifiable"]))
  })

  it("does not flag models as missing when the list endpoint alone fails", async () => {
    const config = happyConfig()
    config.models = "throw"
    const stub = stubFetch(config)
    const report = await runProbe(PACK, { baseURL: "https://gateway.test/v1", fetch: stub.fetch })

    expect(report.servedModelIDs).toBeUndefined()
    expect(report.findings).toEqual([])
    expect(report.models.every((probe) => probe.present === undefined)).toBe(true)
  })

  it("does not treat auth rejections as capability verdicts (dead key)", async () => {
    const unauthorized: ChatBehavior = { status: 401, body: "unauthorized" }
    const stub = stubFetch({
      models: { status: 401, body: "unauthorized" },
      info: { status: 401, body: "unauthorized" },
      sentinel: Object.fromEntries(PACK.models.map((spec) => [spec.id, unauthorized])),
      tierValue: Object.fromEntries(
        PACK.models.map((spec) => [spec.id, Object.fromEntries(spec.tiers.map((tier) => [tier, unauthorized]))]),
      ),
      serving: Object.fromEntries(PACK.models.map((spec) => [spec.id, unauthorized])),
      modality: Object.fromEntries(
        PACK.models.map((spec) => [
          spec.id,
          Object.fromEntries(REJECTION_MODALITIES.map((modality) => [modality, unauthorized])),
        ]),
      ),
    })
    const report = await runProbe(PACK, { baseURL: "https://gateway.test/v1", fetch: stub.fetch })

    expect(report.servedModelIDs).toBeUndefined()
    expect(report.notes.join(" ")).toContain("GET /models responded HTTP 401")
    for (const probe of report.models) {
      expect(probe.tier.outcome, probe.id).toBe("unverifiable")
      expect(probe.serving.ok, probe.id).toBe(false)
      expect(
        probe.tierChecks.every((check) => check.accepted === undefined),
        `${probe.id} tier checks`,
      ).toBe(true)
    }
    const kinds = report.findings.map((finding) => finding.kind)
    expect(new Set(kinds)).toEqual(new Set(["serving-failed", "tier-unverifiable"]))
    expect(kinds.filter((kind) => kind === "serving-failed")).toHaveLength(PACK.models.length)
    expect(kinds.filter((kind) => kind === "tier-unverifiable")).toHaveLength(PACK.models.length)
    expect(report.findings.find((finding) => finding.kind === "tier-unverifiable")?.detail).toContain("HTTP 401")
  })

  it("keeps a non-verdict sentinel status unverifiable while everything else is healthy", async () => {
    const config = happyConfig()
    config.sentinel["example-chat-31b"] = { status: 500, body: "backend exploded" }
    const stub = stubFetch(config)
    const report = await runProbe(PACK, { baseURL: "https://gateway.test/v1", fetch: stub.fetch })

    expect(report.findings.map((finding) => `${finding.kind}:${finding.modelID}`)).toEqual(["tier-unverifiable:example-chat-31b"])
    expect(report.findings[0]?.detail).toContain("HTTP 500")
    const chat = report.models.find((probe) => probe.id === "example-chat-31b")
    expect(chat?.tier.outcome).toBe("unverifiable")
    expect(chat?.tier.status).toBe(500)
  })

  it("marks a tier check with a non-verdict status unverifiable, not rejected", async () => {
    const config = happyConfig()
    config.tierValue["example-chat-31b"] = { ...config.tierValue["example-chat-31b"], low: { status: 429, body: "rate limited" } }
    const stub = stubFetch(config)
    const report = await runProbe(PACK, { baseURL: "https://gateway.test/v1", fetch: stub.fetch })

    const kinds = report.findings.map((finding) => `${finding.kind}:${finding.modelID}`)
    expect(kinds).toContain("tier-unverifiable:example-chat-31b")
    expect(kinds).not.toContain("tier-rejected:example-chat-31b")
    expect(report.findings.find((entry) => entry.kind === "tier-unverifiable")?.detail).toContain("429")
    const chat = report.models.find((probe) => probe.id === "example-chat-31b")
    expect(chat?.tierChecks.find((check) => check.tier === "low")?.accepted).toBeUndefined()
  })

  it("marks a modality check with a non-verdict status unverifiable", async () => {
    const config = happyConfig()
    config.modality["example-omni-27b"] = {
      audio: { status: 403, body: "forbidden" },
      pdf: { status: 400, body: "Unsupported chat content part type: 'file'." },
    }
    const stub = stubFetch(config)
    const report = await runProbe(PACK, { baseURL: "https://gateway.test/v1", fetch: stub.fetch })

    const kinds = report.findings.map((finding) => `${finding.kind}:${finding.modelID}`)
    expect(kinds).toContain("modality-unverifiable:example-omni-27b")
    expect(kinds).not.toContain("undeclared-accepted:example-omni-27b")
    expect(report.findings.find((entry) => entry.kind === "modality-unverifiable")?.detail).toContain("403")
  })

  it("reports other findings for a model missing from GET /models when its endpoints still answer", async () => {
    const config = happyConfig()
    config.models = {
      status: 200,
      body: { data: PACK.models.filter((spec) => spec.id !== "example-chat-31b").map((spec) => ({ id: spec.id })) },
    }
    config.tierValue["example-chat-31b"] = {
      ...config.tierValue["example-chat-31b"],
      low: {
        status: 400,
        body: "model 'example-chat-31b' does not support reasoning_effort value 'low'. Supported types are xhigh (default), medium, and none.",
      },
    }
    const stub = stubFetch(config)
    const report = await runProbe(PACK, { baseURL: "https://gateway.test/v1", fetch: stub.fetch })

    const kinds = report.findings.map((finding) => `${finding.kind}:${finding.modelID}`)
    expect(kinds).toContain("missing-model:example-chat-31b")
    expect(kinds).toContain("tier-rejected:example-chat-31b")
    const chat = report.models.find((probe) => probe.id === "example-chat-31b")
    expect(chat?.present).toBe(false)
    expect(chat?.serving.ok).toBe(true)
  })

  it("treats an unparseable GET /models payload as unavailable instead of an empty list", async () => {
    const config = happyConfig()
    config.models = { status: 200, body: { models: "unexpected shape" } }
    const stub = stubFetch(config)
    const report = await runProbe(PACK, { baseURL: "https://gateway.test/v1", fetch: stub.fetch })

    expect(report.servedModelIDs).toBeUndefined()
    expect(report.missing).toEqual([])
    expect(report.findings).toEqual([])
    expect(report.notes.join(" ")).toContain("GET /models")
    expect(report.models.every((probe) => probe.present === undefined)).toBe(true)
  })

  it("treats a data array without any usable ids as unavailable", async () => {
    const config = happyConfig()
    config.models = { status: 200, body: { data: [{ object: "model" }, 42, null] } }
    const stub = stubFetch(config)
    const report = await runProbe(PACK, { baseURL: "https://gateway.test/v1", fetch: stub.fetch })

    expect(report.servedModelIDs).toBeUndefined()
    expect(report.findings).toEqual([])
    expect(report.notes.join(" ")).toContain("GET /models")
  })

  it("treats an explicitly empty data array as a real empty list", async () => {
    const config = happyConfig()
    config.models = { status: 200, body: { data: [] } }
    const stub = stubFetch(config)
    const report = await runProbe(PACK, { baseURL: "https://gateway.test/v1", fetch: stub.fetch })

    expect(report.servedModelIDs).toEqual([])
    expect(report.missing).toEqual(PACK.models.map((spec) => spec.id))
    expect(report.findings.map((finding) => finding.kind)).toEqual(PACK.models.map(() => "missing-model"))
  })

  it("probes models concurrently in bounded batches, preserving pack order", async () => {
    const specs = Array.from({ length: 9 }, (_, index) => {
      const base = PACK.models[index % PACK.models.length]!
      return { ...base, id: `synthetic-${index}` }
    })
    const pack = { ...PACK, models: specs }
    const stub = stubFetch(happyConfig(specs))
    let inFlight = 0
    let maxInFlight = 0
    const countingFetch = (async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
      inFlight += 1
      maxInFlight = Math.max(maxInFlight, inFlight)
      try {
        await new Promise((resolve) => setTimeout(resolve, 1))
        return await stub.fetch(input, init)
      } finally {
        inFlight -= 1
      }
    }) as typeof fetch

    const report = await runProbe(pack, { baseURL: "https://gateway.test/v1", fetch: countingFetch })

    expect(report.findings).toEqual([])
    expect(report.models.map((probe) => probe.id)).toEqual(specs.map((spec) => spec.id))
    expect(maxInFlight).toBeGreaterThan(1)
    expect(maxInFlight).toBeLessThanOrEqual(4)
  })

  it("treats a 2xx that is not a completions payload as unverifiable, not accepted", async () => {
    const config = happyConfig()
    // Alternate between an HTML page (say, a redirect to a login screen) and JSON
    // without `choices`: neither is a model answer, so neither proves acceptance.
    const notCompletion = (index: number): ChatBehavior =>
      index % 2 === 0 ? { status: 200, body: "<html>sign in</html>" } : { status: 200, body: {} }
    config.sentinel = Object.fromEntries(PACK.models.map((spec, index) => [spec.id, notCompletion(index)]))
    config.tierValue = Object.fromEntries(
      PACK.models.map((spec, index) => [
        spec.id,
        Object.fromEntries(spec.tiers.map((tier) => [tier, notCompletion(index)])),
      ]),
    )
    config.modality = Object.fromEntries(
      PACK.models.map((spec, index) => [
        spec.id,
        Object.fromEntries(REJECTION_MODALITIES.map((modality) => [modality, notCompletion(index)])),
      ]),
    )

    const stub = stubFetch(config)
    const report = await runProbe(PACK, { baseURL: "https://gateway.test/v1", fetch: stub.fetch })

    for (const probe of report.models) {
      expect(probe.serving.ok, probe.id).toBe(true)
      expect(probe.tier.outcome, probe.id).toBe("unverifiable")
      expect(probe.tierChecks.every((check) => check.accepted === undefined), probe.id).toBe(true)
      expect(probe.modalityChecks.every((check) => check.accepted === undefined), probe.id).toBe(true)
    }
    // The unverifiable sentinel is the single root cause per model; per-check
    // modality/tier details stay in the model line instead of extra findings.
    const kinds = new Set(report.findings.map((finding) => finding.kind))
    expect(kinds).toEqual(new Set(["tier-unverifiable"]))
    expect(report.findings).toHaveLength(PACK.models.length)
    expect(report.findings.every((finding) => finding.kind === "tier-unverifiable")).toBe(true)
  })
})
