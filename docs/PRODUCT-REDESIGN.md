# Scenivo product UI and GLB interaction

This change is based on `feat/ant-design-x-chat` at `0b280fb37852fd7880c45b31c9b3c24cf0fc3fc5`. It keeps project, asset, conversation, backup and team storage formats unchanged.

## UI architecture

- Navigation: creation space, resource library (assets/scenes), tasks, team; settings and account remain at the bottom.
- `src/ui/theme/designTokens.ts` supplies the shared Ant Design, Ant Design X and CSS semantic palette. `src/ui/theme/product.css` consolidates the former layered global styles. `ui-system.css` remains used by the separate team web application.
- Home provides continue/recent content and one new-project menu: describe, import GLB, or blank project. Enter sends, Shift+Enter inserts a line; IME composition does not submit.
- Resources retain grid/list, categories, search, sort, fixed asset versions, team publishing, trash and backup flows. Failed reads have a retry state distinct from an empty library.
- Object and property panel widths are keyboard/pointer adjustable and saved as local UI preferences. Properties and the assistant share the right dock. At 1280px and below the active panel gets priority; mobile copy identifies desktop editing requirements.
- `AccessibleModal` retains Ant's real modal lifecycle and adds boundary Tab wrapping plus focus restoration when a caller conditionally unmounts the dialog. No production animation or focus behavior is disabled for jsdom.
- Common fields use Ant InputNumber, Select, ColorPicker, Checkbox and Segmented. Chat retains Bubble, Sender, Welcome, Prompts and ThoughtChain. Conversations handles the session list; FileCard handles nonimage reference metadata. The existing attachment pipeline retains compression, limits and persistence; a second Attachments upload pipeline was not introduced.
- HeroUI runtime dependencies and global styles were removed after verifying no source imports. Radix icons remain; Radix Themes remains a development dependency for existing test fixtures.

## Canvas controls

Every session starts in Browse. Left drag rotates the camera, right drag pans, wheel zooms; clicking selects without switching modes. Explicit Move/Rotate/Scale actions display a blue handle above the selection. Object surfaces and empty canvas remain available for camera navigation in those modes.

The move handle edits the horizontal plane, rotation edits yaw, and scale is uniform. The property panel provides numeric XYZ movement/rotation and scale. Handle previews never mutate the saved document; release creates one undo transaction. Escape/cancellation restores the original transforms. New project IDs reframe the viewport, including tiny, large and offset geometry. Compatibility previews clearly identify that they cannot rotate in real time.

## Local validation

Use Node 24:

```sh
npm ci
npm test
npm run test:team
npm run build
CHAT3D_BROWSER_PATH=/usr/bin/chromium npm run test:product-ui
CHAT3D_BROWSER_PATH=/usr/bin/chromium npm run test:glb-interaction
```

The browser scripts use local synthetic geometry and block or avoid real model calls. The product script writes screenshots and reports under `artifacts/product-redesign/`; GLB interaction tests compare imported GLB and generated geometry. SwiftShader execution is functional coverage, not a physical GPU performance benchmark.

Two formerly missing team test files were restored with transport and resource authorization checks. Material tests now reflect the base branch's pre-existing physical glazing while checking legacy alpha-material preservation. No authentication, permissions or signing configuration was changed.

## Delivery limits

A browser runtime/source bundle is not a Windows installer. Windows NSIS installation and installed-app smoke checks require a Windows host or the existing `windows-desktop.yml` workflow. The workflow can be dispatched on a pushed feature branch; no main merge is needed. Push and workflow dispatch are separate approval steps and were not performed as part of local implementation. Real model generation, user-provided GLB compatibility, live team SSO and hardware GPU performance require separate verification.
