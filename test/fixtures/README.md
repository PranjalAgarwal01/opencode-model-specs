# Test fixtures

`live/` holds raw capture payloads from a live verification run. It is **generated and
gitignored** — per-deployment data, useful locally for diffing gateway behavior when a pack is
re-verified, but never part of the repo:

```powershell
$env:OPENCODE_MODEL_SPECS_LIVE=1; $env:OPENCODE_MODEL_SPECS_CAPTURE=1; npm run test:live
```

It contains the raw `/models` and `/model/info` payloads plus the probe report, captured from a
real gateway. The credential is never written to disk here — only used as a Bearer header at
request time.

The offline suite (`npm test`) does not read these files.
