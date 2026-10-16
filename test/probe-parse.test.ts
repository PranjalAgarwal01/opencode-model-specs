import { describe, expect, it } from "vitest"
import { parseReportedTiers } from "../src/probe.js"

describe("parseReportedTiers", () => {
  it("parses the gateway template error", () => {
    const message =
      "BadRequestError: model 'example-vl-27b' does not support reasoning_effort value '__specs_probe__'. " +
      "Supported types are xhigh (default), medium, and low."
    expect(parseReportedTiers(message)).toEqual(["xhigh", "medium", "low"])
  })

  it("parses Pydantic literal errors with trailing annotations", () => {
    const message = [
      "1 validation error for ChatCompletionRequest",
      "reasoning_effort",
      "  Input should be 'none', 'low', 'medium', 'high', 'xhigh' or 'max' [type=literal_error, input_value='__specs_probe__']",
    ].join("\n")
    expect(parseReportedTiers(message)).toEqual(["none", "low", "medium", "high", "xhigh", "max"])
  })

  it("falls back to quoted literals when the message clearly mentions reasoning_effort", () => {
    expect(parseReportedTiers("invalid reasoning_effort: allowed values are 'low' and 'medium'")).toEqual(["low", "medium"])
  })

  it("does not guess from unrelated errors", () => {
    expect(parseReportedTiers("model not found")).toBeUndefined()
    expect(parseReportedTiers("")).toBeUndefined()
  })

  it("never reports the probe sentinel as a tier", () => {
    const message = "reasoning_effort '__specs_probe__' is invalid"
    expect(parseReportedTiers(message)).toBeUndefined()
  })
  it("parses the real captured litellm blob without ingesting dict keys", () => {
    // Verbatim tier.message shape from a captured sentinel rejection (JSON-escaped
    // wire text kept as-is; the offline suite never reads fixtures).
    const message = "{\"error\":{\"message\":\"litellm.BadRequestError: Hosted_vllmException - {\\\"error\\\":{\\\"message\\\":\\\"1 validation erroREDACTED {'type': 'literal_error', 'loc': ('body', 'reasoning_effort'), 'msg': \\\\\\\"Input should be 'none', 'minimal', 'low', 'medium', 'high', 'xhigh' or 'max'\\\\\\\", 'input': '__specs_probe__', 'ctx': {'expected': \\\\\\\"'none', 'minimal', 'low', 'medium', 'high', 'xhigh' or 'max'\\\\\\\"}}\\\\n\\\\n File \\\\\\\"REDACTED\\\", line 40, in create_chat_completion\\\\n POST /v1/chat/completions [{'type': 'literal_error', 'loc': ('body', 'reasoning_effort'), 'msg': \\\\\\\"Input should be 'none', 'minimal', 'low', 'medium', 'high', 'xhigh' or 'max'\\\\\\\", 'input': '__specs_probe__', 'ctx': {'expected': \\\\\\\"'none', 'minimal', 'low', 'medium', 'high', 'xhigh' or 'max'\\\\\\\"}}]\\\",\\\"type\\\":\\\"Bad Request\\\",\\\"param\\\"…"
    expect(parseReportedTiers(message)).toEqual(["none", "minimal", "low", "medium", "high", "xhigh", "max"])
  })

  it("stops the quoted run at dict-key literals", () => {
    expect(parseReportedTiers("validation rejected: Input should be 'none', 'low' or 'max', 'input': ignored")).toEqual(["none", "low", "max"])
  })

  it("accepts an Oxford comma inside the literal list", () => {
    expect(parseReportedTiers("Input should be 'low', 'medium', or 'high'")).toEqual(["low", "medium", "high"])
  })

  it("does not read an unrelated 'supported types' list as reasoning tiers", () => {
    expect(parseReportedTiers("Bad request: Supported types are text, image.")).toBeUndefined()
  })
})
