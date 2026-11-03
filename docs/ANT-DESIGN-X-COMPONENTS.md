# Ant Design X component integration

Reviewed against the official [component introduction](https://x.ant.design/components/introduce-cn/), [Sender](https://x.ant.design/components/sender-cn/), [Attachments](https://x.ant.design/components/attachments-cn/), [Think](https://x.ant.design/components/think-cn/), [ThoughtChain](https://x.ant.design/components/thought-chain-cn/) and [Actions](https://x.ant.design/components/actions-cn/) documentation. Installed version: 2.10.x.

| Surface | Component and integration |
| --- | --- |
| Home and assistant input | Sender's default input; removed the custom input slot components |
| Submit and cancel | Sender's supported SendButton / LoadingButton render API; keyboard submission remains owned by Sender |
| Input references | Sender.Header + controlled Attachments; library selection, cards, removal and image preview |
| Sent references | FileCard.List; names and metadata for files, built-in preview for images |
| Public work timeline | Native button header toggles grouped public explanations; no work-record counter, arrows, tool or model-round rows |
| Message list and reading position | Bubble.List; stable role configuration, native scroll anchoring, explicit streaming completion |
| Tool history / task record steps | ThoughtChain; actual loading, success, error and unfinished states |
| Result / queue actions | Actions with supported actionRender for semantic buttons, disabled state and keyboard support |
| Response footer | Copy action and repeated pending/applied outcome lines removed at user request; preview actions remain in the confirmation area |
| Welcome and suggestions | Welcome / Prompts |
| Conversation list | Conversations |
| Theme and locale | XProvider shared with Ant Design |

The same local reference pipeline still compresses images and retains the existing 100 MB per-file limit and no four-file cap. Attachments.beforeUpload returns Upload.LIST_IGNORE to prevent all automatic uploading; one batch is processed once. Persisted string references and runtime/model request behavior remain unchanged. Arbitrary files retain the explicit notice that only metadata is available; their bytes are not passed to vision models.

Public explanations are grouped by phase and exact repeats deduplicate. A native button status header controls one content region with aria-expanded/aria-controls, supports click/Enter/Space, and preserves user choice through live updates and completion. No count or arrow icon is displayed. Tool calls, model rounds, raw errors and synthesized technical progress stay hidden. Explanation timestamps are factual; ended prose is not accepted quality. Sender retains uploads, paste/drop, automatic reuse and scope controls without Reference settings.

Process entries retain the left-aligned Bubble.List role in request → process → assistant order. The disclosure is implemented directly instead of nesting Think and a second button, so one click actually hides or shows the content. Stop remains independently reachable.

X 2.10's attachment removal icons need accessible names and keyboard activation on the library's existing controls. Sender's exposed inputElement is named directly because this version forwards aria attributes to both its root and default input. No replacement textarea or send/stop implementation is needed.

Navigation, inspector editing and project operations use Ant Design. Sources requires actual source records; Suggestion requires a shortcut/mention model; audio/video controls require their respective capabilities. These do not currently have matching application data or behavior. Browser notifications are not enabled by this UI migration. The existing safe message text renderer keeps its established no-model-authored-HTML/remote-image behavior; X Markdown is a separate package.

Control styling now comes from the shared Pro v6 / Ant Design 6 theme: CSS variables, filled inputs, neutral borders, 6 px field radii and standard 32 px controls. Redundant viewport tool borders and conflicting Sender styles were removed. Floating menus/toolbars use subtle elevation; property color controls reflect the selected material. See [PRO-V6-MIGRATION.md](PRO-V6-MIGRATION.md) for the layout and business-component map.

Workbench object properties use the left editing bay with their own title, close control and width preference. The assistant has a separate right panel; opening either preserves the other panel and both drafts. At compact widths they stack. Active generation leaves property controls read-only.

Settings now use native Ant Design Tabs for general preferences, data, team connection and About. The sidebar footer retains settings and account controls; pending updates appear as a red dot in settings and About, including on the compact sidebar. Dismissing a release suppresses its popup for the session even during a running task; the dot remains until no newer release is available. Explicit task-end reminders still return after the task ends. Version details and update actions are presented once in the compact About panel, with the existing desktop/web update behavior preserved.

Validation (Node 24; set CHAT3D_BROWSER_PATH for browser checks if needed):

```sh
npm run build
node tests/chat-ui.mjs
node tests/studio-redesign.mjs
node tests/conversation-process.mjs
node tests/ant-design-x-browser.mjs
node tests/scenivo-v2-browser.mjs
node tests/settings-refresh.mjs
node tests/app-update.mjs
node tests/studio-account.mjs
node tests/settings-overview-browser.mjs
node tests/conversation-layout.mjs
node tests/canvas-studio.mjs
node tests/workbench-panels-browser.mjs
```

Browser checks use isolated profiles and synthetic conversation state; they do not call a real model. Screenshots and reports are saved under ignored artifacts directories.
