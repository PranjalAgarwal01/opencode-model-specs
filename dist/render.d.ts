import type { CatalogModel } from "./catalog.js";
import type { ProbeReport } from "./probe.js";
import { type SpecPack } from "./specs.js";
/** Pack strings are user data: keep them on one line so they cannot forge report sections. */
export declare function mdInline(value: string): string;
export interface ShowLiveModel {
    readonly id: string;
    readonly found: boolean;
    readonly enabled?: boolean;
    readonly limit?: {
        readonly context?: number;
        readonly input?: number;
        readonly output?: number;
    };
    readonly variants?: readonly string[];
    readonly input?: readonly string[];
}
export declare function buildShowLive(pack: SpecPack, models: readonly CatalogModel[]): ShowLiveModel[];
/** Rendered by both commands when no pack is configured or the pack file is unusable. */
export declare function renderPackProblem(path: string, error?: string): string;
export declare function renderShow(pack: SpecPack, live: readonly ShowLiveModel[] | undefined, pluginVersion: string): string;
export declare function renderProbeReport(report: ProbeReport, pack: SpecPack): string;
