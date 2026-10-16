import type { Plugin } from "@opencode/plugin";
import { type PackLookup } from "./specs.js";
export declare const SHOW_COMMAND = "specs:show";
export declare const PROBE_COMMAND = "specs:probe";
/**
 * Server-side slash commands. `/specs:show` renders the configured pack and the
 * applied catalog state; `/specs:probe` verifies the gateway against the pack.
 * Both are read-only and render into the session via `session.synthetic` with
 * `resume: false`, so the report is displayed WITHOUT waking the agent (no
 * model turn is started by showing a report).
 *
 * `load` is injectable so tests never depend on machine state.
 */
export declare function registerSpecCommands(ctx: Plugin.Context, load?: () => PackLookup): Promise<void>;
