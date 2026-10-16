import { normalizeModelList, normalizeProviderList } from "./catalog.js";
import { resolveProviderCredential } from "./credentials.js";
import { runProbe } from "./probe.js";
import { buildShowLive, mdInline, renderPackProblem, renderProbeReport, renderShow } from "./render.js";
import { loadPack } from "./specs.js";
import { PLUGIN_VERSION } from "./version.js";
export const SHOW_COMMAND = "specs:show";
export const PROBE_COMMAND = "specs:probe";
const PROBE_TIMEOUT_MS = 30000;
/**
 * Server-side slash commands. `/specs:show` renders the configured pack and the
 * applied catalog state; `/specs:probe` verifies the gateway against the pack.
 * Both are read-only and render into the session via `session.synthetic` with
 * `resume: false`, so the report is displayed WITHOUT waking the agent (no
 * model turn is started by showing a report).
 *
 * `load` is injectable so tests never depend on machine state.
 */
export async function registerSpecCommands(ctx, load = loadPack) {
    await ctx.command.transform((editor) => {
        editor.add({
            name: SHOW_COMMAND,
            description: "Model specs: the configured pack and the applied catalog state",
            execute: async (input) => {
                const text = await showReport(ctx, load);
                await ctx.session.synthetic({
                    sessionID: input.sessionID,
                    text,
                    description: "model specs",
                    resume: false,
                });
            },
        });
        editor.add({
            name: PROBE_COMMAND,
            description: "Verify the gateway against the configured spec pack (read-only; includes audio/PDF rejection checks)",
            execute: async (input) => {
                const text = await probeReport(ctx, load);
                await ctx.session.synthetic({
                    sessionID: input.sessionID,
                    text,
                    description: "spec probe",
                    resume: false,
                });
            },
        });
    });
}
async function showReport(ctx, load) {
    const { pack, path, error } = load();
    if (!pack)
        return renderPackProblem(path, error);
    let live;
    try {
        const models = await listCatalogModels(ctx);
        live = buildShowLive(pack, models.filter((model) => model.providerID === pack.providerID));
    }
    catch {
        live = undefined;
    }
    return renderShow(pack, live, PLUGIN_VERSION);
}
async function probeReport(ctx, load) {
    const { pack, path, error } = load();
    if (!pack)
        return renderPackProblem(path, error);
    try {
        const provider = await findGatewayProvider(ctx, pack.providerID);
        const baseURL = provider && typeof provider.settings.baseURL === "string" && provider.settings.baseURL.trim().length > 0
            ? provider.settings.baseURL.trim()
            : pack.baseURL;
        const apiKey = provider
            ? await resolveProviderCredential(ctx, { id: provider.id, settings: provider.settings }, (id) => id)
            : undefined;
        const report = await runProbe(pack, { baseURL, apiKey, timeoutMs: PROBE_TIMEOUT_MS });
        const credentialNote = apiKey ? "" : `> No credential found for \`${mdInline(pack.providerID)}\`; requests may be rejected.\n\n`;
        return credentialNote + renderProbeReport(report, pack);
    }
    catch (error) {
        return `Spec probe failed: ${error instanceof Error ? error.message : String(error)}`;
    }
}
async function findGatewayProvider(ctx, providerID) {
    try {
        const listInput = ctx.location ? { location: ctx.location } : undefined;
        const listed = await ctx.provider.list(listInput);
        return normalizeProviderList(listed).find((provider) => provider.id === providerID);
    }
    catch {
        return undefined;
    }
}
async function listCatalogModels(ctx) {
    const api = ctx.model;
    if (typeof api.list !== "function")
        return [];
    const raw = await api.list({ location: ctx.location });
    return normalizeModelList(raw);
}
