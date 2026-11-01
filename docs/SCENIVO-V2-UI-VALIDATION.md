# Scenivo V2 local UI validation

V2 addresses the four screenshot defects described by the parent after personally viewing the originals. It keeps a single complete result reading flow, separates only outstanding checks, removes chat avatar/name/time decoration, and makes the composer compact. Scene context now occupies a row beneath the canvas tool rail. Inspector numeric fields use the Ant InputNumber border rather than a second border on their internal input. The scale tab explicitly says 等比缩放.

Active processing has one readable stage with elapsed time and a rotating indicator. Saved explanations and completed tool steps remain expandable; empty completed disclosures are omitted while stored run history remains intact. Reduced motion uses a static outlined marker with the same readable stage. Existing preview confirmation, queues, cancellation, restore, undo and conversation boundaries remain in place.

Chat presentation is maintained in the component styles. The obsolete inner result scrolling rule and broad inspector input border rule were removed from product.css. The active ThoughtChain item was removed because it repeated the stage already shown in the process heading. No message/model result text is rewritten in storage.

## Evidence

Run `node tests/scenivo-v2-browser.mjs` to reproduce the real-app browser fixtures. It starts local Vite and Chromium, aborts nonlocal network requests, and injects representative conversation states into the app stores. The configured long model identity is a fixture; no model calls are made. `artifacts/product-redesign-v2/report.json` records 24 passing checks, 37 screenshots and no browser errors.

The result fixture has twelve detailed Chinese paragraphs and separate known issues. Start and end captures demonstrate the main transcript scrolling, without nested result scrolling or horizontal overflow. Both light and dark themes cover 1920×900, 1440×900 and 1280×720. Existing width constraints are preserved: narrow panel is 360 px; wide is 600 / 540 / 380 px respectively. The measured inner chat widths are 344 / 584 px at 1920, 344 / 524 px at 1440, and 344 / 364 px at 1280. “Wide” at 1280 is the existing bounded maximum, not a claim of a 600 px panel. The populated composer measures 180 px including scope, model/quality controls and keyboard hint, down from the intermediate 216 px.

Separate captures cover waiting, streamed explanation, tool activity, queued message, pending confirmation, applied result, failure, stop, reference image and expanded known issues. Inspector screenshots cover both themes. Normal-motion checks compare the indicator's computed transform between two frames for wait/stream/tool. Reduced-motion checks assert animation is absent while the tool stage remains readable. Title/tool-rail rectangles do not intersect in the result matrix.

The implementing agent visually inspected final result start/end, preview, queue, tool/reduced-motion and inspector captures. The parent separately compares these against the originals. Screenshot inspection supplements the automated bounds/scroll/animation checks; it does not establish performance on physical GPUs.

## Validation

- Production `npm run build`: passed, including TypeScript, Vite, worker, team server and team web builds.
- `tests/chat-ui.mjs`: 45 passing checks, all API calls mocked; includes preview/refinement atomicity, undo/redo, restore, queue edits/removal/undo, cancellation, references and streamed content.
- `tests/conversation-layout.mjs`: 8 passing checks; resizing and panel switching preserve draft and active tasks.
- `tests/parallel-conversation-ui.mjs`: 4 passing checks; mocked conversation isolation, remount and cancellation.
- `tests/conversation-process.mjs`: 4 passing legacy process checks.
- `tests/glb-interaction-browser.mjs`: 30 passing checks with no browser errors; generated geometry and synthetic GLB orbit, move/rotate/scale handles, undo, Escape, pointer release, session replacement and modal gesture blocking.
- `tests/scenivo-v2-browser.mjs`: 24 passing checks with no browser errors.

Old UI assertions were updated to require the separate outstanding-checks disclosure, two-row composer, and readable wait stage. Assertions for empty completed process disclosures now verify omission while preserving exact stored run history and request counts; history preservation was not removed from testing.

## Scope and unavailable references

Original Library IDs: libfile_d96c9088c2ac8191a4e1192c5f979a49, libfile_37403a4e0e44819192ed9761cd4b045c, libfile_b0a66532182c8191bc33b3e16a465ad8, libfile_1f3183c0d06481918f5fe702266adf8c.

`prepare_materialize` succeeded and supplied signed transfers. The documented helper returned `library file transfer failed: download failed` both normally and with explicit network additional permission, including a reprepare attempt. No local image bytes were obtained and this implementing agent did not view the originals. This is a failed transfer, not an approval denial or an uncertain external write. The parent personally viewed the four originals and supplied the defect descriptions used for this work. No unsupported transfer retry was made.

All work is local. No push, GitHub Actions, deployment, paid/real model, SSO or live team service action was performed. User-original GLB behavior, Windows installer/runtime, hardware GPU performance, SSO, and real-model quality remain unverified. Synthetic GLB and software WebGL evidence must not be presented as those checks. The parent owns the independent V2 delivery archive and new Library upload.
