# Conversation-generated motion

Animation is a program attached to the editable scene, not a preset workshop. Ask the model to animate existing objects, or create independent moving parts and animate them in the same command batch. Model output is validated data: it cannot run JavaScript, fetch URLs or read files.

## Interaction

1. Describe the motion, route, dwell times and relationships. Conversation editing defaults to the entire scene. Highlighted objects are references, not a scope restriction. Explicit local-only instructions remain authoritative; unambiguous selected-object requests retain hard transaction guards.
2. The agent identifies actual part IDs and creates animation tracks, then samples and visually reviews the result. Ambiguous object/route intent may still require clarification.
3. Play the pending preview with play/pause, reset,0.25–4× speed and timeline scrub. Confirm to save it as one undoable edit, or discard it.
4. Continue conversationally: slower, longer station dwell, reverse direction, change sequence, or remove motion. No manual action-library setup is required.

Playback is local deterministic math with no per-frame model/token calls. It never writes animated poses into base scene transforms. Geometry edits, session changes and generation reset/pause playback to prevent stale-state editing. Project JSON, autosave and sessions preserve animation programs. GLB currently exports static geometry only; it does not contain these animation tracks.

Manual copies/arrays and assembly copies include animation in the same undoable transaction: track IDs, target IDs and internal follow sources are remapped; rotation pivots follow the copy offset. An external follow source must be selected too. Moving, rotating and uniformly scaling animated objects rebase pivots, axes and displacement keyframes/expressions. Partial shared-track transforms and external follow dependencies reject the entire edit rather than silently altering other objects. Nonuniform scaling of rotation animation is rejected. Existing expression/track/binding budgets still apply after transformation.

## Generic supported channels

- `position`: world-space offset from each target's original position, keyframed vector values
- `rotation`: angle in degrees around an explicit world-space axis and pivot, relative to base transform
- `scale`: positive vector multipliers on the base scale
- `visibility`: stepped boolean keyframes
- `follow`: follow the source object's transform delta from start to end, preserving initial world placement and retaining the release offset afterward. No binding cycles or more than16 dependency levels

Several tracks run in parallel. Timing plus repeated values expresses sequence, hold and reciprocation; the program can loop. Each target has at most one track per channel. To animate a whole assembly rigidly, target all its member IDs, not only the anchor. Position and rotation can combine; rotation is applied about the pivot before world translation offsets, then follow transform is applied. Following non-rigid scaling is not a physical attachment solver.

## New motion without new application code

Position/scale vectors and rotation angles can use bounded expression ASTs instead of keyframes. Leaves are numbers, `t` (seconds) and `pi`. Operators: add, sub, mul, div, mod, sin, cos, abs, min, max, clamp, gt, lt and if. Expression evaluation has no JavaScript/string execution, recursion beyond depth8, external access, user-defined loops or dynamic imports. Limits:64 nodes per expression,128 tracks,128 keyframes per track,2048 total target bindings, duration up to3600 seconds. Invalid/overflowing runtime values stop playback and restore base poses; they do not corrupt the document.

This supports generated circles, spirals, oscillation and conditional timing without scene-specific templates. It does not provide arbitrary untrusted script plugins, rigid-body physics, collision avoidance, conveyor-contact mechanics, inverse kinematics, skinning/mocap, cloth/liquid deformation or real production simulation. The model must disclose unsupported effects rather than claiming them delivered.

## Verification boundaries

The AI `preview_animation` tool evaluates distinct timeline samples and captures up to three rendered frames. It requires a subsequent visual review before an animation-changing preview is submitted. This is sampled checking, not proof that every intermediate frame is collision-free or visually correct. Repeated-frame false no-progress behavior remains guarded by the revised scope/view-aware review accounting.

Automated tests cover deterministic paths/holds, rotations, scale/visibility, expression bounds, follow/release, invalid references/cycles, scope including dependent followers, project roundtrip, undo/redo, CPU mesh updates/reset, UI controls and mocked agent preview/submit flow. Browser visual QA, live-provider generation quality and native-binary validation are separate and are not represented by these tests.

## Direct animation tool and generation diagnostics

The agent now exposes `configure_animation` as a native structured tool rather than relying only on discovering setAnimation inside generic edit commands. It uses the same validated transaction and scope guards. Per-turn instructions identify whether to plan, configure, preview, review or submit. Historical assistant statements that the app is static-only are explicitly marked obsolete. When a task stalls, the error and task history include the actual recent tool names and whether an animation program exists. The four-turn no-progress guard remains; no arbitrary motion is silently applied as a fallback.

## Multi-object reads and requirement priority

Current-revision component/node detail snapshots are retained separately (up to24 scopes), instead of replacing earlier component IDs whenever another component is read. Repeated reads of the same version/scope return a reuse hint; genuinely new detailed scopes count as bounded preparation progress. Tool traces show the requested component/node names. `read_scene` accepts assemblyId or nodeIds and rejects unknown arguments instead of silently returning an unrelated overview.

Short confirmations such as “开始吧” resolve against the latest substantive user request. Explicit user motion instructions can temporarily override an older placement-lock toggle for that request, with a visible notice; negative instructions and unambiguous local-only targets retain their protection. This is conservative language matching plus model interpretation, not a claim of perfect natural-language understanding. Latest user requirements outrank defaults and prior assistant assumptions, but validity, safe execution and resource bounds remain. Large goals should be completed in batches rather than rejected due to single-call capacity.
