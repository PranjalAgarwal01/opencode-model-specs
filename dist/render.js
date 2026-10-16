import { PACK_ENV_VAR } from "./specs.js";
/** Pack strings are user data: keep them on one line so they cannot forge report sections. */
export function mdInline(value) {
    return value.replace(/[\r\n\u2028\u2029]+/gu, " ").replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/gu, "");
}
/**
 * Additionally protect GFM table cells: an unescaped `|` would split the cell, and
 * backslashes must be escaped first so a raw `\|` cannot collapse into an escaped
 * backslash plus an unescaped pipe (which marked/remark read as a cell split).
 */
function mdCell(value) {
    return mdInline(value).replace(/\\/gu, "\\\\").replace(/\|/gu, "\\|");
}
export function buildShowLive(pack, models) {
    return pack.models.map((spec) => {
        const found = models.find((model) => model.id === spec.id);
        if (!found)
            return { id: spec.id, found: false };
        return {
            id: spec.id,
            found: true,
            ...(typeof found.enabled === "boolean" ? { enabled: found.enabled } : {}),
            ...(found.limit ? { limit: found.limit } : {}),
            ...(found.variants
                ? { variants: found.variants.flatMap((variant) => (typeof variant.id === "string" ? [variant.id] : [])) }
                : {}),
            ...(found.capabilities?.input ? { input: found.capabilities.input } : {}),
        };
    });
}
/** Rendered by both commands when no pack is configured or the pack file is unusable. */
export function renderPackProblem(path, error) {
    if (error) {
        return [
            "## model specs — pack unusable",
            "",
            `The pack file \`${mdInline(path)}\` exists but cannot be used:`,
            "",
            `> ${mdInline(error)}`,
            "",
            'Fix the file (see the README section "The pack") and run the command again.',
        ].join("\n");
    }
    return [
        "## model specs — no pack configured",
        "",
        `No spec pack found at \`${mdInline(path)}\`.`,
        "",
        `Create one with your provider's verified specs there, or point \`${PACK_ENV_VAR}\` at a pack file — ` +
            'see the README section "The pack".',
    ].join("\n");
}
export function renderShow(pack, live, pluginVersion) {
    const lines = [];
    lines.push(`## ${mdInline(pack.providerID)} model specs — pack ${mdInline(pack.verifiedAt)} (plugin v${pluginVersion})`);
    lines.push("");
    lines.push(`Provider \`${mdInline(pack.providerID)}\` · gateway \`${mdInline(pack.baseURL)}\``);
    lines.push("");
    lines.push("### Verified specs (applied by this plugin)");
    lines.push("");
    lines.push("| model | backing | context | input | output | input modalities | thinking tiers | verified |");
    lines.push("|---|---|---|---|---|---|---|---|");
    for (const spec of pack.models) {
        const defaultTier = spec.defaultTier ? ` (default \`${mdCell(spec.defaultTier)}\`)` : " (gateway default unverified)";
        lines.push(`| \`${mdCell(spec.id)}\` | ${mdCell(spec.backing)} | ${spec.limit.context} | ${spec.limit.input} | ${spec.limit.output} | ` +
            `${mdCell(spec.input.join(" + "))} | ${mdCell(spec.tiers.join(", "))}${defaultTier} | ${mdCell(spec.verifiedAt)} |`);
    }
    lines.push("");
    lines.push("### Applied to the live catalog");
    lines.push("");
    if (!live) {
        lines.push("Live catalog unavailable here — run `/specs:show` from a chat session to see the applied state.");
    }
    else {
        for (const entry of live) {
            if (!entry.found) {
                lines.push(`- ❌ \`${mdInline(entry.id)}\` — not in the catalog (provider offline, or discovery did not materialize it)`);
                continue;
            }
            const limits = entry.limit && typeof entry.limit.context === "number"
                ? `limit ${entry.limit.context}${typeof entry.limit.input === "number" ? `/${entry.limit.input}` : ""}/${entry.limit.output ?? "?"}`
                : "limit n/a";
            const variants = entry.variants && entry.variants.length > 0 ? `variants [${mdInline(entry.variants.join(", "))}]` : "variants none";
            const input = entry.input && entry.input.length > 0 ? `; input [${mdInline(entry.input.join(", "))}]` : "";
            const enabled = entry.enabled === false ? "; disabled" : "";
            lines.push(`- ✅ \`${mdInline(entry.id)}\` — ${limits}; ${variants}${input}${enabled}`);
        }
    }
    lines.push("");
    lines.push("### Notes");
    lines.push("");
    const tiered = pack.models.find((spec) => spec.tiers.length > 0);
    const firstTier = tiered?.tiers[0];
    if (tiered && firstTier !== undefined) {
        const preferred = tiered.defaultTier;
        const example = preferred && tiered.tiers.includes(preferred) ? preferred : firstTier;
        lines.push(`- Thinking tiers are selectable per chat via model variants: ` +
            `\`${mdInline(pack.providerID)}/${mdInline(tiered.id)}#${mdInline(example)}\`.`);
    }
    lines.push("- Input modalities list only what OpenCode clients can deliver: **text + PNG/JPEG/GIF/WebP**. Video may work at the " +
        "gateway API (see per-model notes) but video/PDF/audio attachments are silently dropped client-side before send.");
    for (const spec of pack.models) {
        if (spec.notes)
            lines.push(`- \`${mdInline(spec.id)}\`: ${mdInline(spec.notes)}.`);
    }
    return lines.join("\n");
}
const SEVERITY = {
    "missing-model": "error",
    "serving-failed": "error",
    "tier-rejected": "error",
    "enforcement-drift": "error",
    "tier-unverifiable": "error",
    "advert-changed": "info",
    "undeclared-accepted": "info",
    "modality-unverifiable": "error",
};
export function renderProbeReport(report, pack) {
    const lines = [];
    const when = report.probedAt.replace("T", " ").replace(/\.\d+Z$/u, " UTC");
    lines.push(`## ${mdInline(pack.providerID)} spec probe — ${when}`);
    lines.push("");
    lines.push(`Endpoint: \`${mdInline(report.baseURL)}\` · pack verified ${mdInline(pack.verifiedAt)} · ${report.requestedModelIDs.length} models requested`);
    if (report.servedModelIDs) {
        lines.push(`Served: ${report.servedModelIDs.length} model ids from \`GET /models\``);
    }
    lines.push("");
    for (const probe of report.models) {
        const findings = report.findings.filter((finding) => finding.modelID === probe.id);
        const hasError = findings.some((finding) => SEVERITY[finding.kind] === "error");
        const hasInfo = findings.some((finding) => SEVERITY[finding.kind] === "info");
        const icon = hasError ? "❌" : hasInfo ? "⚠️" : "✅";
        lines.push(`${icon} \`${mdInline(probe.id)}\` — ${mdInline(describeModel(probe))}`);
        for (const finding of findings) {
            lines.push(`    - ${mdInline(finding.detail)}`);
        }
    }
    lines.push("");
    lines.push("### Findings");
    lines.push("");
    const errors = report.findings.filter((finding) => SEVERITY[finding.kind] === "error");
    const infos = report.findings.filter((finding) => SEVERITY[finding.kind] === "info");
    if (errors.length === 0 && infos.length === 0) {
        lines.push("- None — the gateway matches the pack.");
    }
    for (const finding of errors)
        lines.push(`- **${finding.kind}** \`${mdInline(finding.modelID)}\`: ${mdInline(finding.detail)}`);
    for (const finding of infos)
        lines.push(`- ${finding.kind} \`${mdInline(finding.modelID)}\`: ${mdInline(finding.detail)}`);
    if (report.notes.length > 0) {
        lines.push("");
        lines.push("### Notes");
        lines.push("");
        for (const note of report.notes)
            lines.push(`- ${mdInline(note)}`);
    }
    return lines.join("\n");
}
function describeModel(probe) {
    const bits = [];
    bits.push(probe.serving.ok ? "serving ok" : `serving FAILED (${truncate(probe.serving.detail, 140)})`);
    const tier = probe.tier;
    if (tier.outcome === "error-set" || tier.outcome === "error-other") {
        bits.push("validates unknown reasoning_effort");
    }
    else if (tier.outcome === "accepted") {
        bits.push("accepts any reasoning_effort");
    }
    else {
        bits.push(`validation check unverifiable: ${truncate(tier.message ?? "no verdict obtained", 140)}`);
    }
    if (probe.tierChecks.length > 0) {
        const accepted = probe.tierChecks.filter((check) => check.accepted === true).length;
        const unverifiable = probe.tierChecks.filter((check) => check.accepted === undefined).length;
        bits.push(`pack tiers ${accepted}/${probe.tierChecks.length} accepted${unverifiable > 0 ? `, ${unverifiable} unverifiable` : ""}`);
    }
    if (probe.modalityChecks.length > 0) {
        const rejected = probe.modalityChecks.filter((check) => check.accepted === false).length;
        const unverifiable = probe.modalityChecks.filter((check) => check.accepted === undefined).length;
        const modalities = probe.modalityChecks.map((check) => check.modality).join("+");
        bits.push(`undeclared ${modalities} rejected ${rejected}/${probe.modalityChecks.length}${unverifiable > 0 ? `, ${unverifiable} unverifiable` : ""}`);
    }
    return bits.join("; ");
}
function truncate(text, limit) {
    return text.length > limit ? `${text.slice(0, limit)}…` : text;
}
