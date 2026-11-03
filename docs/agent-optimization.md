# Agent optimization, 2026-10-07

## Scope

Keep pi-agent-core and the canonical scene document. Reduce redundant model context without weakening edit scope, atomic commands, cancellation, or visual evidence requirements. This change does not add default parallel agents or change credentials.

## Implemented

- Numeric per-tool input/output sizes, registered tool names, repeated-input markers at the same scene revision and steering epoch, request/first-content timestamps, application/model/policy metadata, and CI source commit.
- Explicit usage states: reported, provider-confirmed zero, and unknown. SDK default zero cannot prove zero usage. Cached input is included once in both per-request and aggregate counts.
- Redacted diagnostic export remains format v1 and additive. No raw arguments, errors, scene contents, images or credentials are exported.
- Atomic edit receipts describe affected component anchors, changed parts, removed IDs, material changes and animation-change flags. They explicitly mark omitted unchanged state and truncated changed-part detail. Canonical geometry is not modified by receipt generation.
- Long scene reads and the initial scene context preserve every node ID, name and transform while omitting large shape descriptions. Explicit node-ID reads retain precise shape descriptions. This is a description budget, not a token guarantee or hard total-context cap.
- Asset and connection tool schemas are loaded on demand, or automatically for existing asset/connection state or relevant intent. Editing and verification tools remain available; omitted groups can be enabled explicitly.
- Existing atomic batches, failed-batch correction, revision-bound duplicate checks, scoped editing, pose preservation, evidence freshness and bounded component parallelism remain in place.
- When command-parameter recovery exhausts its two automatic continuation turns, the agent emits a stopped-correction notice, clears recovery state, and ends normally while preserving prior valid results and the atomic tool-failure event. An entirely rejected batch returns zero operations rather than throwing solely because correction stopped; unknown numeric values are not guessed.

## Reproducible offline checks

Run `npm test` and `npm run build`.

`node scripts/analyze-run.mjs PATH_TO_DIAGNOSTICS.json` produces a numeric local report. It does not send the input to a model or any remote service. Request-window throughput is not decoding speed; accumulated durations may overlap for concurrent work.

`node tests/context-receipts.mjs` checks deterministic response-size changes, current IDs/transforms, material-only edits, removals, explicit detail retrieval, and animation flags. Its synthetic 800-node / one-edit scenario compares serialized scene characters. Do not translate that percentage into token, latency, cost or visual-quality improvements.

## Live acceptance still required

Freeze the task, initial scene, reference assets, provider/model, quality mode, model settings and application commit. Alternate baseline and candidate for at least five paired trials per selected core case within an explicitly approved usage budget. Test single asset generation, scope-preserving edits, articulated imported assets, large repeated scenes, concurrent sessions and interruption/recovery.

Measure end-to-end time, request count, input/output/cache tokens, missing usage, failures, tool-result volume, and result correctness. Preserve output artifacts and actual rendered views. Do not accept a speedup caused by fewer requested objects, missing detail, skipped checks or incomplete results. Use medians and spread rather than the fastest run. First-pass targets are 30% lower input tokens and 20% lower median elapsed time without lower required-quality pass rate; they are not measured gains yet.

No real model service has been called during this implementation. This change does not certify new collision, rigging or visual-quality capabilities. If quality or scope checks regress, revert the individual optimization commit and retain the diagnostic improvements.

## Paired-run report

`node scripts/compare-agent-runs.mjs manifest.json` reads local diagnostic files only. The manifest has a `records` array in execution order. Each record supplies `caseId`, `variant` (`baseline`/`candidate`), `file` (relative diagnostic path), `fixtureHash` and `settingsHash` (SHA-256 identifiers of the frozen inputs/configuration), and `accepted` (the externally verified result). No credentials belong in this manifest.

The report requires at least five equally sized, interleaved trials, equal fixture/settings hashes and model identity, complete usage/timings and accepted results. It reports observed median/range and targets, but explicitly does not independently prove the supplied hashes, visual acceptance or statistical significance. Keep the actual model/scene artifacts and render evidence alongside the private manifest.
