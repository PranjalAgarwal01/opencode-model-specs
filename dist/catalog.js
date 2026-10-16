/**
 * Defensive normalizers for plugin-host API responses.
 *
 * The host returns lists either as arrays or as `{ data: [...] }`, and provider
 * entries may be wrapped as `{ provider: {...} }`. Normalizing keeps the plugin
 * tolerant across minor SDK versions without spreading casts through the code.
 */
function arrayOrData(value) {
    if (Array.isArray(value))
        return value;
    if (value && typeof value === "object" && Array.isArray(value.data)) {
        return value.data;
    }
    return [];
}
function asRecord(value) {
    return value && typeof value === "object" && !Array.isArray(value) ? value : undefined;
}
export function normalizeProviderList(value) {
    const providers = [];
    for (const entry of arrayOrData(value)) {
        const record = asRecord(entry);
        if (!record)
            continue;
        const wrapped = asRecord(record.provider);
        const candidate = wrapped ?? record;
        const id = candidate.id;
        if (typeof id !== "string" || id.length === 0)
            continue;
        const settings = asRecord(candidate.settings) ?? {};
        providers.push({
            id,
            ...(typeof candidate.name === "string" ? { name: candidate.name } : {}),
            settings,
        });
    }
    return providers;
}
export function normalizeModelList(value) {
    const models = [];
    for (const entry of arrayOrData(value)) {
        const record = asRecord(entry);
        if (!record)
            continue;
        const id = record.id;
        if (typeof id !== "string" || id.length === 0)
            continue;
        const capabilities = asRecord(record.capabilities);
        const limit = asRecord(record.limit);
        const variants = Array.isArray(record.variants) ? record.variants : undefined;
        models.push({
            id,
            ...(typeof record.providerID === "string" ? { providerID: record.providerID } : {}),
            ...(typeof record.name === "string" ? { name: record.name } : {}),
            ...(typeof record.enabled === "boolean" ? { enabled: record.enabled } : {}),
            ...(capabilities
                ? {
                    capabilities: {
                        ...(typeof capabilities.tools === "boolean" ? { tools: capabilities.tools } : {}),
                        ...(Array.isArray(capabilities.input)
                            ? { input: capabilities.input.filter((item) => typeof item === "string") }
                            : {}),
                    },
                }
                : {}),
            ...(limit
                ? {
                    limit: {
                        ...(typeof limit.context === "number" ? { context: limit.context } : {}),
                        ...(typeof limit.input === "number" ? { input: limit.input } : {}),
                        ...(typeof limit.output === "number" ? { output: limit.output } : {}),
                    },
                }
                : {}),
            ...(variants
                ? {
                    variants: variants.flatMap((variant) => {
                        const item = asRecord(variant);
                        return item && typeof item.id === "string" ? [{ id: item.id }] : [];
                    }),
                }
                : {}),
        });
    }
    return models;
}
