# Pro v6 UI migration

The UI follows the [Pro v6 release](https://github.com/ant-design/ant-design-pro/issues/11734) and the official template's ProComponents 3 dependency. `@ant-design/pro-components` is pinned to `3.1.14-2`, alongside the existing React 19, Ant Design 6 and Ant Design X 2 stack.

This is a theme, layout and business-component migration. Vite, Tauri, the modeling runtime and persisted project formats remain in place; the project has not moved to the Umi Max scaffold.

| Surface | Components |
| --- | --- |
| Navigation and manager shell | ProLayout, native responsive menu and collapse |
| Page headings | PageContainer / PageHeader |
| Home | StatisticCard, ProCard, ProList |
| Resource library | ProCard grid, ProTable list, existing category and detail workflows |
| Resource metadata | ProForm, ProFormText, ProFormTextArea |
| Tasks | ProTable with status filtering, pagination, column settings and density |
| Settings and team pages | PageContainer, ProCard, native Ant Design Tabs |
| AI conversation | Existing real Ant Design X Bubble, Think, Sender and Attachments |

The shared theme enables CSS variables and filled inputs, uses standard 32px controls and 6px field radii, and keeps light / dark / system preference support. The canvas retains its editor-specific geometry: object properties on the left and the independent assistant on the right.

Asset versions, model geometry, categories, local backups, team login guards and the update notification lifecycle continue to use their existing domain implementations. Guests retain local access; team access requires a successful authenticated session. The login UI uses the configured domain.

## Verification

Use Node 24. UI integration checks include:

```sh
npm run build
node tests/studio-redesign.mjs
node tests/library-metadata-ui.mjs
node tests/studio-account.mjs
node tests/settings-refresh.mjs
node tests/pro-v6-browser.mjs
node tests/workbench-panels-browser.mjs
npm run test:streaming-ui
```

Browser scripts create isolated synthetic local fixtures and block remote requests. Screenshots and reports are written to `artifacts/ant-design-x/`. They verify resource metadata persistence without changing geometry, manager navigation, preserved drafts, themes and responsive layout. They do not validate a live model response or production SSO.

The Node/jsdom test helper redirects ProComponents' published CommonJS import of `antd/es/locale/zh_CN` to its equivalent CommonJS locale entry. This test-only Node resolution hook does not affect the production Vite configuration or browser code.

## Streaming progress

The conversation controller processes every model event, while publishing complete activity snapshots to the React view at most once per 50 ms. A buffered SSE read can otherwise synchronously notify external-store subscribers hundreds of times before the browser gets another task. Completion, failure and stop flush the latest snapshot immediately and clear pending notifications. Model commands, checkpoint persistence and timeout activity still process each event.

`test:streaming-ui` checks burst coalescing, final-state preservation and cancellation. Its isolated browser fixture exercises 2,000 buffered progress events through the real conversation controller, a long conversation, preview application, and stopping a second run. It uses synthetic model events and makes no model API requests.
