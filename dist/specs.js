/**
 * Spec pack types and loader.
 *
 * The plugin ships no model specs: the pack is user data, verified by hand
 * against a real gateway (raw API probes) and dated in `verifiedAt` — see
 * README "The pack". Load order:
 *
 *   1. the file named by $OPENCODE_MODEL_SPECS_PACK, when set and non-empty;
 *   2. `<config dir>/model-specs.json`, where the config dir is
 *      `$XDG_CONFIG_HOME/opencode` when XDG_CONFIG_HOME is set, else
 *      `~/.config/opencode` — the directory OpenCode uses for `opencode.json`.
 */
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
/** File name of the default pack location (inside OpenCode's config directory). */
export const PACK_FILE_NAME = "model-specs.json";
/** Environment variable that overrides the pack path. */
export const PACK_ENV_VAR = "OPENCODE_MODEL_SPECS_PACK";
/** Load the user's pack. A missing file is "unconfigured" (no error); a bad file is an error. */
export function loadPack(options = {}) {
    const env = options.env ?? process.env;
    const override = env[PACK_ENV_VAR];
    const xdg = env.XDG_CONFIG_HOME;
    const configDir = options.configDir ??
        join(typeof xdg === "string" && xdg.trim().length > 0 ? xdg.trim() : join(homedir(), ".config"), "opencode");
    const path = typeof override === "string" && override.trim().length > 0 ? override.trim() : join(configDir, PACK_FILE_NAME);
    let text;
    try {
        text = readFileSync(path, "utf8");
    }
    catch (error) {
        if (error.code === "ENOENT")
            return { path };
        return { path, error: `cannot read pack: ${error instanceof Error ? error.message : String(error)}` };
    }
    // A UTF-8 BOM (routine on Windows editors) is not JSON.
    if (text.charCodeAt(0) === 0xfeff)
        text = text.slice(1);
    let value;
    try {
        value = JSON.parse(text);
    }
    catch (error) {
        return { path, error: `invalid JSON: ${error instanceof Error ? error.message : String(error)}` };
    }
    const parsed = parsePack(value);
    return "error" in parsed ? { path, error: parsed.error } : { path, pack: parsed.pack };
}
const MODALITIES = ["text", "image", "video", "audio", "pdf"];
const ENFORCEMENTS = ["validated", "permissive", "inert"];
/** Validate an untrusted value (typically parsed JSON) into a SpecPack. */
export function parsePack(value) {
    if (!isRecord(value))
        return { error: "pack must be a JSON object" };
    if (!isNonEmptyString(value.providerID))
        return { error: "providerID must be a non-empty string" };
    if (!isNonEmptyString(value.baseURL) || !/^https?:\/\//u.test(value.baseURL)) {
        return { error: "baseURL must be an http(s) URL" };
    }
    if (!isDateString(value.verifiedAt))
        return { error: "verifiedAt must be a date string" };
    if (!Array.isArray(value.models) || value.models.length === 0)
        return { error: "models must be a non-empty array" };
    const seen = new Set();
    for (const [index, raw] of value.models.entries()) {
        const where = `models[${index}]`;
        if (!isRecord(raw))
            return { error: `${where} must be an object` };
        if (!isNonEmptyString(raw.id))
            return { error: `${where}.id must be a non-empty string` };
        if (seen.has(raw.id))
            return { error: `${where}.id duplicates model '${raw.id}'` };
        seen.add(raw.id);
        if (!isNonEmptyString(raw.backing))
            return { error: `${where}.backing must be a non-empty string` };
        if (typeof raw.tools !== "boolean")
            return { error: `${where}.tools must be a boolean` };
        if (!Array.isArray(raw.input) ||
            raw.input.length === 0 ||
            !raw.input.every((entry) => typeof entry === "string" && MODALITIES.includes(entry))) {
            return { error: `${where}.input must be a non-empty array of ${MODALITIES.join("/")}` };
        }
        if (!raw.input.includes("text")) {
            return { error: `${where}.input must include "text"` };
        }
        if (!isRecord(raw.limit))
            return { error: `${where}.limit must be an object` };
        const { context, input, output } = raw.limit;
        if (!isPositiveInteger(context))
            return { error: `${where}.limit.context must be a positive integer` };
        if (!isPositiveInteger(input))
            return { error: `${where}.limit.input must be a positive integer` };
        if (!isPositiveInteger(output))
            return { error: `${where}.limit.output must be a positive integer` };
        if (input > context)
            return { error: `${where}.limit.input must not exceed limit.context` };
        if (!Array.isArray(raw.tiers) || !raw.tiers.every((entry) => isNonEmptyString(entry))) {
            return { error: `${where}.tiers must be an array of strings (empty when the model exposes no variants)` };
        }
        if (raw.defaultTier !== undefined && !isNonEmptyString(raw.defaultTier)) {
            return { error: `${where}.defaultTier must be a non-empty string when present` };
        }
        if (!isNonEmptyString(raw.enforcement) || !ENFORCEMENTS.includes(raw.enforcement)) {
            return { error: `${where}.enforcement must be one of ${ENFORCEMENTS.join("/")}` };
        }
        if (!isRecord(raw.advert))
            return { error: `${where}.advert must be an object` };
        if (typeof raw.advert.vision !== "boolean" || typeof raw.advert.video !== "boolean") {
            return { error: `${where}.advert.vision and ${where}.advert.video must be booleans` };
        }
        if (!isPositiveInteger(raw.advert.inputLimit) || !isPositiveInteger(raw.advert.outputLimit)) {
            return { error: `${where}.advert.inputLimit and ${where}.advert.outputLimit must be positive integers` };
        }
        if (!isDateString(raw.verifiedAt))
            return { error: `${where}.verifiedAt must be a date string` };
        if (raw.notes !== undefined && typeof raw.notes !== "string") {
            return { error: `${where}.notes must be a string when present` };
        }
    }
    return { pack: value };
}
function isRecord(value) {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}
function isNonEmptyString(value) {
    return typeof value === "string" && value.trim().length > 0;
}
/**
 * Strict YYYY-MM-DD. `Date.parse` alone rolls over out-of-range days
 * ("2026-02-30" becomes March 2) and accepts partials like "2026" or "0".
 */
function isDateString(value) {
    if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/u.test(value))
        return false;
    const parsed = new Date(`${value}T00:00:00Z`);
    return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}
function isPositiveInteger(value) {
    return typeof value === "number" && Number.isInteger(value) && value > 0;
}
export function specByModelID(pack, modelID) {
    return pack.models.find((spec) => spec.id === modelID);
}
