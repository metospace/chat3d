import {Channel, invoke, isTauri} from '@tauri-apps/api/core';
import {create} from 'zustand';
import {APP_VERSION, classifyUpdaterError, deriveUpdateView, publicUpdateError, reduceUpdateProgress, type ReleaseNotice, type UpdateProgressEvent, type UpdateProgressState, type UpdateView} from './appUpdate';
import {cleanNotes, isNewerVersion, parseVersion} from '../../shared/app-version.mjs';
import {DOWNLOAD_PROBE_BYTES, candidateDownloadUrls, installerTotalBytes, platformMirrorList, sameDownloadUrl, selectFastestDownloadUrl, type DownloadProbeSample} from '../../shared/update-mirrors.mjs';
import {relaunch} from '@tauri-apps/plugin-process';
import {flushWorkspace,useWorkspaceStore,anySessionRunning} from '../workspace';

const DISMISS_KEY = 'chat3d.update.dismissed';
const REMIND_KEY = 'chat3d.update.remind';
const CHECK_INTERVAL = 30 * 60 * 1000;
const STARTUP_CHECK_DELAY = 1500;
const FAILURE_RETRY_DELAYS = [15_000, 60_000, 3 * 60_000];
const VISIBILITY_FAILURE_BACKOFF = 30_000;

interface AppUpdateState {
  busy: boolean;
  dirty: boolean;
  release: ReleaseNotice | null;
  dismissed: string | null;
  remind: string | null;
  phase: 'idle' | 'installing' | 'installed' | 'failed';
  progress: string;
  progressMetrics: UpdateProgressState | null;
  error: string;
  checking: boolean;
  checkMessage: string;
  panelOpen: boolean;
}

const stored = (key: string) => {
  try { return sessionStorage.getItem(key); } catch { return null; }
};
const remember = (key: string, value: string | null) => {
  try { if (value) sessionStorage.setItem(key, value); else sessionStorage.removeItem(key); } catch { /* 隐私模式仍可完成本次选择 */ }
};

export const useAppUpdate = create<AppUpdateState>(() => ({
  busy: false, dirty: false, release: null, dismissed: stored(DISMISS_KEY), remind: stored(REMIND_KEY),
  phase: 'idle', progress: '', progressMetrics: null, error: '', checking: false, checkMessage: '',
  panelOpen: false,
}));

export function hasPendingAppUpdate(state: AppUpdateState = useAppUpdate.getState()) {
  return !!(state.release && isNewerVersion(state.release.version, APP_VERSION));
}

export function openAppUpdatePanel() {
  useAppUpdate.setState({panelOpen: true});
}

export function closeAppUpdatePanel() {
  useAppUpdate.setState({panelOpen: false});
}

export function setAppUpdateContext(input: {busy: boolean; dirty: boolean}) {
  useAppUpdate.setState(input);
}

export function appUpdateView(state: AppUpdateState = useAppUpdate.getState()): UpdateView {
  return deriveUpdateView({...state, current: APP_VERSION});
}

export function dismissUpdate() {
  const version = useAppUpdate.getState().release?.version;
  if (!version) return;
  remember(DISMISS_KEY, version); remember(REMIND_KEY, null);
  useAppUpdate.setState({dismissed: version, remind: null, phase: 'idle', error: ''});
}

export function remindUpdateAfterTask() {
  const version = useAppUpdate.getState().release?.version;
  if (!version) return;
  remember(DISMISS_KEY, version); remember(REMIND_KEY, version);
  useAppUpdate.setState({dismissed: version, remind: version, phase: 'idle', error: ''});
}

async function fetchWebRelease(): Promise<ReleaseNotice | null> {
  const response = await fetch('/api/version', {cache: 'no-store', headers: {accept: 'application/json'}});
  if (response.status === 404) return null;
  if (!response.ok) throw new Error('更新检查失败');
  const data = await response.json() as {version?: unknown; notes?: unknown};
  const parsed = parseVersion(typeof data?.version === 'string' ? data.version : '');
  if (!parsed) throw new Error('更新信息无效');
  return {version: parsed.version, notes: cleanNotes(typeof data.notes === 'string' ? data.notes : '')};
}

async function fetchDesktopRelease(): Promise<ReleaseNotice | null> {
  const {check} = await import('@tauri-apps/plugin-updater');
  const update = await check();
  if (!update) return null;
  const parsed = parseVersion(update.version);
  if (!parsed) throw new Error('更新信息无效');
  return {version: parsed.version, notes: cleanNotes(update.body ?? '')};
}

let inflight = false;
let lastCheck = 0;
let lastFailure = 0;
let failureStreak = 0;
let checksStarted = false;
let retryTimer: number | null = null;
const FAILURE_BACKOFF = 5 * 60 * 1000;
const VISIBLE_RECHECK_GAP = 2 * 60 * 1000;

function clearRetryTimer() {
  if (retryTimer == null) return;
  window.clearTimeout(retryTimer);
  retryTimer = null;
}

function scheduleFailedCheckRetry() {
  if (typeof window === 'undefined') return;
  clearRetryTimer();
  const delay = FAILURE_RETRY_DELAYS[Math.min(failureStreak - 1, FAILURE_RETRY_DELAYS.length - 1)] ?? FAILURE_BACKOFF;
  retryTimer = window.setTimeout(() => {
    retryTimer = null;
    void checkForAppUpdate({reason: 'retry'});
  }, delay);
}

function shouldSkipAutoCheck(reason: 'startup' | 'interval' | 'visible' | 'retry' | 'manual', now: number) {
  if (reason === 'manual' || reason === 'retry') return false;
  if (reason === 'interval') {
    if (lastCheck && now - lastCheck < CHECK_INTERVAL) return true;
    if (lastFailure && now - lastFailure < FAILURE_BACKOFF) return true;
    return false;
  }
  // startup / visible: allow sooner after failures so a cold start is not stuck for 5 minutes
  if (lastFailure && now - lastFailure < VISIBILITY_FAILURE_BACKOFF) return true;
  if (reason === 'visible' && lastCheck && now - lastCheck < VISIBLE_RECHECK_GAP) return true;
  return false;
}

export async function checkForAppUpdate(options?: {manual?: boolean; reason?: 'startup' | 'interval' | 'visible' | 'retry' | 'manual'}) {
  const reason = options?.reason ?? (options?.manual ? 'manual' : 'interval');
  const manual = options?.manual === true || reason === 'manual';
  const state = useAppUpdate.getState();
  if (state.phase === 'installing' || inflight) return;
  const now = Date.now();
  if (!manual && shouldSkipAutoCheck(reason, now)) return;
  inflight = true;
  if (manual) useAppUpdate.setState({checking: true, checkMessage: '正在检查更新…'});
  try {
    let release: ReleaseNotice | null = null;
    let unconfigured = false;
    if (isTauri()) {
      try { release = await fetchDesktopRelease(); }
      catch (error) {
        if (classifyUpdaterError(error) === 'unconfigured') unconfigured = true;
        else throw error;
      }
    } else release = await fetchWebRelease();
    const newer = release && isNewerVersion(release.version, APP_VERSION) ? release : null;
    const current = useAppUpdate.getState();
    useAppUpdate.setState({
      release: newer,
      checking: false,
      phase: current.phase === 'failed' || current.phase === 'idle' ? 'idle' : current.phase,
      error: '',
      checkMessage: manual
        ? unconfigured
          ? '此安装包未配置自动更新。请从受信任的发布渠道获取新版本，不要运行来历不明的安装包。'
          : newer ? `发现新版本 ${newer.version}` : `已是当前版本 ${APP_VERSION}`
        : current.checkMessage,
    });
    lastCheck = Date.now();
    lastFailure = 0;
    failureStreak = 0;
    clearRetryTimer();
  } catch (error) {
    lastFailure = Date.now();
    failureStreak += 1;
    if (manual) useAppUpdate.setState({checking: false, checkMessage: classifyUpdaterError(error) === 'unconfigured' ? '此安装包未配置自动更新。请从受信任的发布渠道获取新版本，不要运行来历不明的安装包。' : '暂时无法检查更新。请确认网络后再试。'});
    else scheduleFailedCheckRetry();
  } finally {
    inflight = false;
    if (manual) useAppUpdate.setState({checking: false});
  }
}

function shouldRetryPrimary(error: unknown) {
  const message = (error instanceof Error ? error.message : String(error ?? '')).toLowerCase();
  return !/failed to install|authentication failed|invalid updater binary|temp directory|binary for the current target|not on the same mount/.test(message);
}

async function probeInstallerUrl(url: string, timeoutMs: number): Promise<DownloadProbeSample> {
  const started = Date.now();
  const failed = (status = 0): DownloadProbeSample => ({status, bytes: 0, elapsedMs: Math.max(1, Date.now() - started), totalBytes: null, contentType: null});
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const {fetch} = await import('@tauri-apps/plugin-http');
    const response = await fetch(url, {
      method: 'GET',
      headers: {Range: `bytes=0-${DOWNLOAD_PROBE_BYTES - 1}`, Accept: 'application/octet-stream'},
      connectTimeout: timeoutMs,
      signal: controller.signal,
    });
    const status = response.status;
    const contentType = response.headers.get('content-type');
    const totalBytes = installerTotalBytes(status, response.headers);
    if (status !== 200 && status !== 206) {
      await response.body?.cancel();
      return {status, bytes: 0, elapsedMs: Math.max(1, Date.now() - started), totalBytes, contentType};
    }
    const reader = response.body?.getReader();
    if (!reader) return {status, bytes: 0, elapsedMs: Math.max(1, Date.now() - started), totalBytes, contentType};
    let bytes = 0;
    while (bytes < DOWNLOAD_PROBE_BYTES) {
      const {done, value} = await reader.read();
      if (done) break;
      bytes += value?.byteLength ?? 0;
    }
    await reader.cancel().catch(() => undefined);
    return {status, bytes, elapsedMs: Math.max(1, Date.now() - started), totalBytes, contentType};
  } catch {
    return failed();
  } finally {
    clearTimeout(timer);
  }
}

async function downloadCheckedUpdate(update: {downloadAndInstall: (onEvent: (event: UpdateProgressEvent) => void) => Promise<void>}, onProgress: (progress: UpdateProgressState) => void) {
  let progress: UpdateProgressState = {loaded: 0, total: null, label: '正在下载更新…'};
  await update.downloadAndInstall(event => {
    progress = reduceUpdateProgress(progress, event);
    onProgress(progress);
  });
}

async function downloadMirroredUpdate(rid: number, url: string, onProgress: (progress: UpdateProgressState) => void) {
  const channel = new Channel<UpdateProgressEvent>();
  let progress: UpdateProgressState = {loaded: 0, total: null, label: '正在下载更新…'};
  channel.onmessage = event => {
    progress = reduceUpdateProgress(progress, event);
    onProgress(progress);
  };
  await invoke('download_and_install_mirrored_update', {rid, url, onEvent: channel});
}

async function installDesktopUpdate(onProgress: (progress: UpdateProgressState) => void) {
  const {check} = await import('@tauri-apps/plugin-updater');
  const update = await check();
  if (!update || !isNewerVersion(update.version, APP_VERSION)) throw new Error('没有可安装的新版本');
  const downloadPrimary = () => downloadCheckedUpdate(update, onProgress);
  let primary = '';
  try { primary = await invoke<string>('update_download_url', {rid: update.rid}); }
  catch { await downloadPrimary(); return; }
  const candidates = candidateDownloadUrls(primary, platformMirrorList(update.rawJson, primary));
  let chosen = primary;
  if (candidates.length > 1) {
    onProgress({loaded: 0, total: null, label: '正在选择较快的下载线路…'});
    chosen = await selectFastestDownloadUrl(candidates, probeInstallerUrl);
  }
  if (!chosen || sameDownloadUrl(chosen, primary)) { await downloadPrimary(); return; }
  try { await downloadMirroredUpdate(update.rid, chosen, onProgress); }
  catch (error) {
    if (!shouldRetryPrimary(error)) throw error;
    await downloadPrimary();
  }
}

export async function relaunchInstalledUpdate() {
  if (useAppUpdate.getState().busy || anySessionRunning()) return;
  try {
    await flushWorkspace();
    const workspace=useWorkspaceStore.getState();
    if(!workspace.ready||workspace.saving||workspace.error)throw Error('工作区尚未保存成功，请先下载工作台备份并处理保存异常，再重启');
    if(useAppUpdate.getState().busy||anySessionRunning())return;
    await relaunch();
  } catch(error) {
    const message=publicUpdateError(error);useAppUpdate.setState({phase:'installed',progress:`已就绪，尚未重启。${message}`,error:message});
  }
}

export async function applyAppUpdate() {
  const state = useAppUpdate.getState();
  if (state.busy || state.phase === 'installing' || !state.release) return;
  if (!isTauri()) { window.location.reload(); return; }
  const initial: UpdateProgressState = {loaded: 0, total: null, label: '正在下载更新…'};
  useAppUpdate.setState({phase: 'installing', progress: initial.label, progressMetrics: initial, error: ''});
  try {
    await installDesktopUpdate(progress => useAppUpdate.setState({progress: progress.label, progressMetrics: progress}));
    if (useAppUpdate.getState().busy) {
      useAppUpdate.setState({phase: 'installed', progress: '已就绪，重启生效。'});
      return;
    }
    useAppUpdate.setState({phase: 'installed', progress: '正在重启以完成更新…'});
    await relaunchInstalledUpdate();
  } catch (error) {
    useAppUpdate.setState({phase: 'failed', error: publicUpdateError(error), progress: '', progressMetrics: null});
  }
}

export function startAppUpdateChecks() {
  if (checksStarted || typeof window === 'undefined') return;
  checksStarted = true;
  window.setTimeout(() => void checkForAppUpdate({reason: 'startup'}), STARTUP_CHECK_DELAY);
  window.setInterval(() => void checkForAppUpdate({reason: 'interval'}), CHECK_INTERVAL);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') void checkForAppUpdate({reason: 'visible'});
  });
  window.addEventListener('focus', () => {
    void checkForAppUpdate({reason: 'visible'});
  });
}
