# Structured generation validation and recovery

This fix uses synthetic recipes, not a replay of the reported user task. The original request and complete tool trace were unavailable. No production data, paid model calls, or deployment was used.

## Behavior

- Structured tools expose the supported geometry variants and their parameter names instead of `geometry: Any`. Sweep tubes require `segments` (8–128) and `radialSegments` (8–32). `tubularSegments` is rejected, not silently translated or accepted as a new geometry feature. Relational geometry validation still checks real shapes.
- A compact repeat can use 1–1,000 instances. A feature can bind all 1,000 real nodes, including after save/restore and local feature repair. The old 100-per-repeat and 128-per-feature limits were representation limits below the existing structured expansion budget; they did not protect a smaller total geometry budget. Expansion still creates every requested node with the original spacing and a single component identity.
- Schema validation runs before the runner's execution hooks. Schema failures are now cached too, and their tool results include a failed ID for targeted retry. The duplicated `Received arguments` recipe is omitted from this error result. Runtime failures retain their existing cache path.
- Retry applies up to eight field corrections to the cached recipe and revalidates the complete tool schema before domain validation and atomic scene commit. Replacing only a part's `geometry.params` can remove a misspelled field without resending the whole recipe. Corrections are cumulative. Reaching geometry validation after fixing a schema failure counts as bounded recovery progress; repeating the same invalid call does not.

## Limits retained

Structured recipes still allow at most 100 distinct part definitions, 1,000 expanded parts, and 100 MiB of estimated expanded recipe data. The general assembly path retains its 2,000-total-part cap. Larger requests must be split along genuine component boundaries within existing scene/task budgets; the code neither truncates counts nor automatically fragments a continuous object. A single structured component beyond these limits remains unsupported.

Feature plans retain their existing 16-feature and 128-binding-object limits. Each feature binding still checks unique IDs belonging to the actual component. The per-feature node limit is now 1,000. Other unrelated limits, including pose-joint limits, are unchanged.

Two targeted retries per cached failure, cache size and patch-size limits, scene-revision/task/blueprint invalidation, identity and edit-scope protection, cancellation, three consecutive failing turns without progress, and four stagnant turns remain enforced. Geometry finiteness, dimensions, geometry-method matching, scene budgets, and atomic rollback remain required. Geometry success is not visual acceptance.

## Verification

Synthetic tests cover 160 repeated parts without count reduction; all feature IDs and restored metadata; local repair preserving other nodes; the wrong sweep field followed by a params-only correction; cumulative schema-to-domain recovery; the 1,000-part boundary and 100 MiB rejection; invalid retries leaving existing scenes untouched; and three unchanged failing turns stopping without edits. Existing tests cover stale scope/identity, retry exhaustion, cancellation, geometric rejection, and atomic rollback.

Verified on 2026-10-26, Node 24.19.0, based on main `fd1487d86929abf6fc4fcd23f9649a218a406007`:

- Focused: 41 structured-component checks, 114 mocked agent-loop checks, 5 free-assembly checks, and 4 semantic-blueprint checks passed.
- `npm test`: exit 0, 970 PASS lines, through the final compare-agent-runs tests.
- `npm run test:team`: exit 0, 21 PASS lines.
- `npx tsc --noEmit`: exit 0.
- `npm run build`: exit 0, including Vite, worker, and team builds.
- `git diff --check`: passed. `docs/LINUX-DEPLOYMENT.md` is unchanged.

The aggregate run included the recovery tests. A final test-only correction switched its preview callback assertion to the actual `onPreview` hook; all 41 structured tests were rerun successfully, verifying no preview before successful correction and exactly one after it. Earlier test runs exposed obsolete 100-repeat expectations and assertions mistaking geometry-schema field names for raw mesh arrays; those assertions now distinguish schemas from actual array payloads.

Non-fatal output included Vite HMR-port warnings during tests and existing large-chunk/ineffective-dynamic-import build warnings. Dependency installation first failed because the default npm cache was outside the writable environment; installing with `/tmp/chat3d-npm-cache` succeeded without changing the lockfile.

Untested: the unavailable original request, live model behavior, browser/GPU rendering at maximum resource budgets, and Windows installer execution. Tests use mocked model/rendering calls and do not establish visual quality of a generated object.

## Final integration verification

The first normal push was rejected because main advanced to `41938725dbb5b7b5f58d96e3dd3312646eab9ba6` (update notifications). The scoped commit was rebased without conflicts, retaining that change and the Linux deployment guide. Dependencies were reinstalled from the new lockfile. On the combined main, `npx tsc --noEmit`, `npm run build`, and `npm run test:team` all exited 0. The aggregate initially hit a chat UI callback timeout while the build ran concurrently; the isolated chat UI suite passed all 43 checks, and a serial full `npm test` rerun exited 0, including the newly added upstream app-update tests and all 41 recovery checks. No unrelated UI assertions or timeouts were changed.
