# opencode-model-specs

Companion plugin for [OpenCode](https://opencode.ai) 2.x on an OpenAI-compatible gateway.

Discovery plugins tell OpenCode *which* models exist. This plugin adds the **verified specs** for
them — corrected context limits, input modalities, tool support and selectable thinking tiers —
and two slash commands to inspect the applied state (`/specs:show`) and re-verify the gateway
(`/specs:probe`).

The specs are not baked into the plugin: they live in a **spec pack** you maintain and point the
plugin at (see [The pack](#the-pack)). Everything in a pack is meant to be verified live against
the gateway with raw API probes, on the date recorded in each spec. Unverified values are not
guesses — they are absent (and reported as such).

## What it does

For every model of the pack's provider that is listed in the pack, the plugin overlays:

| field | what | why |
|---|---|---|
| `limit.context/input/output` | corrected token limits | gateways commonly advertise one generous number for every model; the real caps differ |
| `capabilities.input` | input modalities the client can deliver (`text`/`image`) | OpenCode drops video attachments before send — declaring video would show a dead affordance in the model picker |
| `capabilities.tools` | verified tool support | recorded in the pack — the probe does not re-test tool calling |
| `variants` | one variant per accepted thinking tier, forwarding `body.reasoning_effort` | selectable per chat as `provider/model#tier` |

It **never edits your configuration and never persists anything** — the overlay lives in memory
and is re-applied on every catalog reload. Models outside the pack, and every other provider, are
untouched. Floating aliases (a `chat` alias the gateway may re-point) are best left out of the
pack: pinning specs to them would freeze stale values.

## Commands

- **`/specs:show`** — renders the configured pack and the *applied* live catalog state (per
  model: limit, variants, inputs, disabled flag).
- **`/specs:probe`** — read-only live verification of the gateway against the pack (a couple of
  dozen tiny requests; up to 4 models are probed concurrently). For each model it checks:
  - presence in `GET /models`
  - `reasoning_effort` enforcement (does the gateway reject unknown values?) and **every pack tier
    is exercised with a real request** (a tier the gateway rejects with HTTP 400/422 is a finding;
    any other non-2xx status — auth, 404, 429, 5xx — leaves the tier unverifiable, never rejected)
  - a minimal serving round-trip
  - **undeclared-modality rejection**: a real audio part (tiny WAV) and a real PDF part are sent —
    while the pack does not declare them, the gateway must reject both; a served part is drift
  - `GET /model/info` adverts (limits and modality flags) against the recorded snapshot

  Findings: `missing-model`, `tier-rejected`, `enforcement-drift`, `serving-failed`,
  `tier-unverifiable`, `modality-unverifiable` (error) and `advert-changed`,
  `undeclared-accepted` (info — the gateway's behavior moved since the pack was recorded).

Both commands render their report into the session as a **display-only notice** (a synthetic inbox
item with `resume: false`): the agent is *not* woken and no tokens are spent. Run `/specs:probe`
after any gateway change to re-verify the pack. Without a pack the plugin is inert — both commands
explain how to configure one.

## Install

Prerequisites: OpenCode 2.x with an OpenAI-compatible provider configured (base URL + credential
via `/connect`, or `settings.apiKey`), discovered models materialized (e.g. by
[opencode-models-discovery](https://github.com/yuhp/opencode-models-discovery)), and a spec pack
(see below).

```jsonc
// ~/.config/opencode/opencode.jsonc — global plugins array
"plugins": [
  "opencode-models-discovery@2.0.0-rc.2",      // or your own discovery setup
  "file:///C:/path/to/opencode-model-specs"    // local checkout (a plain absolute path also works)
]
```

then `opencode service restart`.

Notes:

- Keep the checkout built (`npm run build`) — directory plugins load `dist/` as-is.
- The repo root ships `server.js`, the entrypoint OpenCode's loader expects for directory
  plugins (`<directory>/server`). Keep it in the checkout.
- Once the package is pushed/published you can instead use `opencode plugin add <package or
  git specifier>`; `opencode plugin add file:...` is rejected by the CLI by design.

## The pack

The pack is a JSON file with your gateway's verified model specs. The plugin reads it from, in
order:

1. the file named by `$OPENCODE_MODEL_SPECS_PACK`, when set;
2. `$XDG_CONFIG_HOME/opencode/model-specs.json` when `XDG_CONFIG_HOME` is set, otherwise
   `~/.config/opencode/model-specs.json` — the directory OpenCode uses for `opencode.json`.

`pack.example.json` in this repo is a complete, valid example. Top level:

| field | type | meaning |
|---|---|---|
| `providerID` | string | the provider id in OpenCode (the one discovery materializes models under) |
| `baseURL` | string | the gateway's OpenAI-compatible base URL (`https://…/v1`); `/specs:probe` falls back to it |
| `verifiedAt` | string | ISO date of the last full verification |
| `models` | array | one entry per model, see below |

Each `models[]` entry:

| field | type | meaning |
|---|---|---|
| `id` | string | gateway model id (unique within the pack) |
| `backing` | string | human-readable backing model |
| `tools` | boolean | whether the model serves tool calling |
| `input` | array | modalities OpenCode should declare — only `text` + `image` are deliverable by 2.x clients |
| `limit` | object | `{ context, input, output }` corrected token limits (`input <= context`) |
| `tiers` | array | accepted `reasoning_effort` values, exposed as selectable variants (empty = no variants) |
| `defaultTier` | string? | the tier the gateway uses when `reasoning_effort` is absent — it is not required to be one of `tiers` (omit if unverified) |
| `enforcement` | string | how the gateway treats unknown values: `validated` (HTTP 400/422 listing supported values), `permissive` (accepted and ignored) or `inert` (no reasoning support) |
| `advert` | object | `{ vision, video, inputLimit, outputLimit }` snapshot of `GET /model/info` at verification time |
| `verifiedAt` | string | ISO date of this model's verification |
| `notes` | string? | free text rendered by `/specs:show` |

### Writing a pack

1. Create the file with `providerID`, `baseURL` and one entry per model — `pack.example.json` is
   a good starting shape.
2. Run the live verifier: `npm run test:live` (see below). It probes the gateway and prints a
   report; adjust the pack until it reports no findings, then bump `verifiedAt`.
3. In a chat session, `/specs:probe` re-verifies the same way on demand and `/specs:show` shows
   what was applied.

Caveats worth knowing:

- **Tiers must be real.** A tier the gateway accepts but ignores (e.g. `none` on an
  always-thinking model) should be omitted — exposing it would be a lie in the picker.
- **Modalities must be deliverable.** OpenCode 2.x transmits text + PNG/JPEG/GIF/WebP only;
  video/PDF/audio attachments are silently dropped before the gateway sees them. Even when the
  gateway API verifies video, declaring it would show up as a dead affordance — re-add it once a
  client can actually send video.
- **Audio and PDF rejection** is re-tested by `/specs:probe` with real requests on every run: if
  the gateway starts serving a modality the pack does not declare, the finding is
  `undeclared-accepted` (info) — re-verify and declare it if real.
- A pack that fails to parse never breaks the catalog: the transform logs the problem and skips
  the overlay; `/specs:show` and `/specs:probe` render the parse error.

### Updating the pack

1. Run `npm run test:live` (reads the live gateway, prints a report).
2. Adjust the pack for any findings and bump `verifiedAt`.
3. `npm test` (offline suite), then `npm run test:live` again until it reports no findings.
4. With `OPENCODE_MODEL_SPECS_CAPTURE=1` the raw `/models`, `/model/info` payloads and the probe
   report are written to `test/fixtures/live/` (gitignored) for diffing.

## Development

```powershell
npm install
npm run build        # tsc -> dist/ (dist/ is committed so git installs need no toolchain)
npm run typecheck    # src + tests
npm test             # offline suite (stubbed HTTP; never touches real gateways)
npm run test:live    # live verification (set OPENCODE_MODEL_SPECS_LIVE=1, see below)
```

After changing sources, run `npm run build` **and commit `dist/`** together with the sources —
git-based installs consume `dist/` as-is (opencode's installer does not build plugins).

For tooling, the package also exports `loadPack`, `parsePack` and `PACK_ENV_VAR`.

The live test verifies the configured pack and resolves a credential for the probe on its own
(first match wins):

1. `OPENCODE_MODEL_SPECS_API_KEY`
2. the active credential for the pack's `providerID` in `~/.local/share/opencode/opencode.db`
3. `~/.local/share/opencode/auth.json` (legacy)

The value is only ever used as a `Bearer` header — never logged, written or asserted on.
`OPENCODE_MODEL_SPECS_BASE_URL` overrides the pack's `baseURL` for the test run. Note that
`/specs:probe` resolves the credential through the host instead (provider `settings.apiKey` and
integration connections), so the test's credential may differ from the one a session would use.

## Design notes

- The apply transform only writes `capabilities.tools`, `capabilities.input`, `limit` and
  `variants`; `enabled`, `name`, `cost`, `output` modalities etc. are left alone.
- Variants are a full replacement (one row per accepted tier). That is deliberate: the pack is
  the single source of truth, so a stale config entry cannot survive.
- The probe performs real requests per tier rather than trusting the error message's enum: the
  gateway may validate `reasoning_effort` at two layers (a request enum and the model's chat
  template), and only a behavioral check catches template-level rejections.
- **Only HTTP 400/422 are verdicts.** Every other non-2xx status (auth failures, 404, 408, 429,
  5xx, network errors) is a *non-verdict*: tier and modality checks stay `unverifiable` — a broken
  key or a transient gateway outage can never masquerade as "tiers rejected" or a clean sweep.
- A 2xx only counts as acceptance when the body is a completions payload (`choices`), so a
  redirecting proxy that answers 200 with an HTML login page cannot read as "tier accepted" or
  "undeclared modality accepted".
- A `GET /models` payload with no usable model list is reported as *unavailable* (the presence
  check is skipped for that run) instead of claiming every model is missing. An explicitly empty
  `data` array is a real empty list: every pack model then reports as missing.
- The undeclared-modality check enforces the other direction of the pack: modalities the pack does
  not declare (`audio`, `pdf`) must be rejected. Video is deliberately not included — a pack may
  omit video for client-side reasons, so "must be rejected" would be a false invariant.
- Report rendering treats pack strings, file paths and error text as untrusted: newlines and
  control characters are collapsed, and table cells additionally escape `|` and `\` so no value
  can forge report structure.
- Read-only by construction: no config writes, no state files. The only file the plugin reads is
  the pack.

## Credits / license

MIT. The provider credential resolution logic in `src/credentials.ts` is adapted from
[opencode-models-discovery](https://github.com/yuhp/opencode-models-discovery) (MIT, copyright
yuhp) — see `LICENSE`.
