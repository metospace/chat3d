import packageInfo from '../../package.json';
import {compareVersions, isNewerVersion} from '../../shared/app-version.mjs';

export const APP_VERSION = packageInfo.version;
export const UPDATE_BUSY_STATUSES = ['capturing', 'context', 'generating', 'validating', 'applying', 'previewing'] as const;

export interface ReleaseNotice {version: string; notes: string}
export interface UpdateProgressEvent {event: 'Started' | 'Progress' | 'Finished'; data?: {contentLength?: number; chunkLength?: number}}
export interface UpdateProgressState {loaded: number; total: number | null; label: string}
export interface UpdateSessionSignal {id: string; deleted?: boolean; pending: boolean; wasRunning: boolean; dirty: boolean}

export type UpdateView =
  | {kind: 'hidden'}
  | {kind: 'busy'; version: string; notes: string; dirty: boolean}
  | {kind: 'ready'; version: string; notes: string; dirty: boolean; ended: boolean}
  | {kind: 'installing'; version: string; progress: string; percent: number | null; indeterminate: boolean}
  | {kind: 'installed'; version: string; progress: string; busy: boolean}
  | {kind: 'failed'; version: string; message: string};

export function blocksUpdate(status: string) {
  return (UPDATE_BUSY_STATUSES as readonly string[]).includes(status);
}

export function updateSignals(sessions: UpdateSessionSignal[], active: {id: string; status: string; dirty: boolean}) {
  let busy = blocksUpdate(active.status), dirty = active.dirty;
  for (const session of sessions) {
    if (session.deleted) continue;
    const status = session.id === active.id ? active.status : session.pending ? 'previewing' : session.wasRunning ? 'generating' : 'idle';
    if (blocksUpdate(status)) busy = true;
    if (session.id === active.id ? active.dirty : session.dirty) dirty = true;
  }
  return {busy, dirty};
}

export function deriveUpdateView(input: {
  current: string;
  release: ReleaseNotice | null;
  busy: boolean;
  dirty: boolean;
  dismissed: string | null;
  remind: string | null;
  phase: 'idle' | 'installing' | 'installed' | 'failed';
  progress: string;
  progressMetrics: UpdateProgressState | null;
  error: string;
}): UpdateView {
  const release = input.release && isNewerVersion(input.release.version, input.current) ? input.release : null;
  if (!release) return {kind: 'hidden'};
  if (input.phase === 'installing') {
    const display = formatInstallingProgress(input.progressMetrics, input.progress || '正在下载更新…');
    return {kind: 'installing', version: release.version, progress: display.label, percent: display.percent, indeterminate: display.indeterminate};
  }
  if (input.phase === 'installed') return {kind: 'installed', version: release.version, progress: input.progress || '更新已安装。', busy: input.busy};
  if (input.phase === 'failed') return {kind: 'failed', version: release.version, message: input.error || '更新没有完成。'};
  if (input.busy) return input.remind === release.version || input.dismissed === release.version ? {kind: 'hidden'} : {kind: 'busy', version: release.version, notes: release.notes, dirty: input.dirty};
  if (input.dismissed === release.version && input.remind !== release.version) return {kind: 'hidden'};
  return {kind: 'ready', version: release.version, notes: release.notes, dirty: input.dirty, ended: input.remind === release.version};
}

export function formatInstallingProgress(metrics: UpdateProgressState | null, fallbackLabel: string) {
  if (!metrics) return {label: fallbackLabel, percent: null as number | null, indeterminate: true};
  if (metrics.label.startsWith('正在安装')) return {label: metrics.label, percent: null, indeterminate: true};
  const percent = metrics.total && metrics.total > 0 ? Math.min(100, Math.floor(metrics.loaded / metrics.total * 100)) : null;
  return {label: metrics.label, percent, indeterminate: percent === null};
}

export function reduceUpdateProgress(state: UpdateProgressState, event: UpdateProgressEvent): UpdateProgressState {
  if (event.event === 'Started') {
    const total = event.data?.contentLength;
    return {loaded: 0, total: total && total > 0 ? total : null, label: '正在下载更新…'};
  }
  if (event.event === 'Progress') {
    const loaded = state.loaded + Math.max(0, event.data?.chunkLength ?? 0);
    const label = state.total ? `正在下载更新… ${Math.min(100, Math.floor(loaded / state.total * 100))}%` : '正在下载更新…';
    return {loaded, total: state.total, label};
  }
  return {...state, label: '正在安装更新…'};
}

export function classifyUpdaterError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error ?? '');
  return /does not have any endpoints set|plugin:updater|updater not found|unknown command/i.test(message) ? 'unconfigured' as const : 'failed' as const;
}

export function publicUpdateError(error: unknown) {
  if (classifyUpdaterError(error) === 'unconfigured') return '此安装包未配置自动更新。请从受信任的发布渠道获取新版本。';
  const raw = (error instanceof Error ? error.message : String(error ?? '')).replace(/\s+/g, ' ').trim().replace(/https?:\/\/\S+/g, '更新地址');
  return raw ? `更新没有完成：${raw.slice(0, 180)}` : '更新没有完成。请稍后重试，或从受信任的发布渠道安装。';
}

export {compareVersions, isNewerVersion};
