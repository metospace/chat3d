# Direct generation reference shape optimization

taskId: 2026-11-19-reference-shape
acceptanceRevision: 1
Project: D:/work/code/chat3d
Baseline HEAD: 4c5af60f26e83646f5bbf31b51283623eba657f9

User: “你开始优化吧”. Four SU7 reference views, direct generation, gpt-6.2-sol high; generated body proportions/curvature are visibly inadequate. Improve general reference-based direct modeling, not a hardcoded SU7 model.

Scope: src/ai modeling stage and reference comparison, supporting tests, brief documentation. Preserve all existing uncommitted edits (including untracked referenceComparison.ts). No model API calls using user credentials, no deployment or commit.

## Acceptance

- A1: Complex multi-reference silhouette-to-detail transition requires an independent reference-image comparison of the current silhouette, not only builder self-approval. Visible mismatch or unknown prevents detail build/patch before geometry execution, retaining valid draft; matching fresh evidence permits transition.
- A2: Silhouette comparison only examines the constructed primary form/proportions/major negative spaces. Missing decorative details/materials must not prevent normal silhouette work. Final detailed comparison still checks complete features and materials. Context is independent of builder verdict, includes original numbered reference images and current complementary frames.
- A3: Comparison cache identifies revision/component/stage or equivalent scope, so silhouette approval cannot be reused for final detailed acceptance and edits invalidate approval. Failed comparison cannot silently pass. Simple/no-reference tasks and unavailable rendering preserve existing behavior.
- A4: Improve actionable general modeling guidance for continuous complex products: reference landmarks and comparable views, shared section curves, primary body before trim; no fake deterministic fidelity score or car-only template.
- A5: Meaningful deterministic behavior tests cover mismatch, valid transition, stale/stage scope, incomplete silhouette and unchanged baseline reference workflow; TypeScript check passes. State explicitly these tests do not prove real SU7 reconstruction improvement.

## Baseline and validation

React/TypeScript/Three.js/Vite project. npm scripts and existing tests/reference-agent.mjs and tests/modeling-program*.mjs define checks. Many user edits already exist in AI, storage, UI and tests: never revert them. No AGENTS.md found in project. Host node initially v22.23.5 vs project expected 24; locate an existing Node 24 executable if possible without installation.

Source inspection found programStageBlock uses builder silhouette verdict; referenceFeatureTargets currently returns no targets while modelingProgram stage is silhouette. Independent comparison currently occurs at completion. Fix the early quality feedback gap, retaining final guard.

Developer owns implementation and behavioral tests. QA owns qa.json only. Root owns task.md/status.json. Deliver implementation plus independently verified PASS; paid-model fidelity benchmarking remains a stated limit.

## Developer handoff

Early stage checking is asynchronous in build and patch paths before new source execution. Independent silhouette comparison uses only form features and primary proportions/curvature/negative spaces; trim/materials remain for detailed comparison. Cache is scoped by component, stage, features, images, request, views and revision. Prompt adds reference landmarks and shared section curves/continuous boundaries. Existing final guard retained.

Node24 developer checks (all exit 0): tsc --noEmit; tests/reference-agent.mjs (8 tests, six build/patch × mismatch/unknown/invalid subcases); tests/modeling-program-browser.mjs (11); tests/reference-shape.mjs (9); tests/evidence-context.mjs (21); tests/modeling-program-draft.mjs. Browser required loopback outside sandbox; first denied navigation was environment-only. No user model requests made. Synthetic evidence does not measure actual SU7 fidelity.

Developer delivery SHA256:

- src/ai/modelingAgent.ts: FC6B59D5C5DBF564F972B00330310DC42AA242F112C09C4931A04E3499F1DDDE
- src/ai/referenceComparison.ts: 7F541C86515D318310EE7D2E69506F22396418DA0DCE42D86C0CBF0E116ED2D0
- src/ai/agentPrompt.ts: E86E4D48CA925F7B79C462A5BF8B5E75799566F15E3D28C3BDAF011D89E9885B
- tests/modeling-program-browser.mjs: E2022D385084F03B7FD2233C004DE8B7289EA4B1B521AA86E1E9690BDD4D08DE
- tests/reference-agent.mjs: 808AD43E33754E9F52F9281569E1816DAE11202C490FE3264EECBC8F812B6B80
- docs/REALISTIC-MODELING.md: 23285F5137C182CA8F96078CE2F1B0C9DB7E629B0D7C07EA76FE2D34128E4C72
