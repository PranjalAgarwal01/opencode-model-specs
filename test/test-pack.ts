import type { SpecPack } from "../src/specs.js"

/**
 * Synthetic pack for the offline suite. Mirrors the shapes real packs have
 * (tier ladders, enforcement modes, advert snapshots) with example values only.
 */
export const TEST_PACK: SpecPack = {
  providerID: "test-gateway",
  baseURL: "https://gateway.test/v1",
  verifiedAt: "2026-10-16",
  models: [
    {
      id: "example-chat-31b",
      backing: "Example-Chat-31B",
      tools: true,
      input: ["text", "image"],
      limit: { context: 143000, input: 123000, output: 20000 },
      tiers: ["none", "low", "medium", "xhigh"],
      defaultTier: "xhigh",
      enforcement: "validated",
      advert: { vision: true, video: false, inputLimit: 125000, outputLimit: 20000 },
      verifiedAt: "2026-10-16",
      notes: "xhigh equals the gateway default tier",
    },
    {
      id: "example-vl-27b",
      backing: "Example-VL-27B",
      tools: true,
      input: ["text", "image"],
      limit: { context: 129000, input: 109000, output: 20000 },
      tiers: ["low", "medium", "xhigh"],
      defaultTier: "xhigh",
      enforcement: "validated",
      advert: { vision: true, video: true, inputLimit: 125000, outputLimit: 20000 },
      verifiedAt: "2026-10-16",
      notes: "thinking cannot be disabled",
    },
    {
      id: "example-omni-27b",
      backing: "Example-Omni-27B",
      tools: true,
      input: ["text", "image"],
      limit: { context: 129000, input: 109000, output: 20000 },
      tiers: ["none", "low", "medium", "xhigh"],
      defaultTier: "xhigh",
      enforcement: "validated",
      advert: { vision: true, video: true, inputLimit: 125000, outputLimit: 20000 },
      verifiedAt: "2026-10-16",
    },
    {
      id: "example-coder-30b",
      backing: "Example-Coder-30B",
      tools: true,
      input: ["text"],
      limit: { context: 46000, input: 34000, output: 12000 },
      tiers: [],
      enforcement: "validated",
      advert: { vision: false, video: false, inputLimit: 125000, outputLimit: 20000 },
      verifiedAt: "2026-10-16",
    },
  ],
}
