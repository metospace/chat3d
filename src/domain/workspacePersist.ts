export type WorkspaceStorageTier = 'normal' | 'strip-images' | 'omit-trashed';

interface PersistedSnapshot {
  doc: unknown;
  messages: { images?: string[] }[];
  selection: string[];
  dirty: boolean;
  composerText: string;
  composerImages: string[];
  lastRun: unknown;
  pendingBatch: unknown;
  pendingResult: unknown;
  wasRunning: boolean;
}

export interface PersistableWorkspaceSession {
  deletedAt: number | null;
  sceneThumbnail?: string;
  snapshot: PersistedSnapshot;
}

const PERSISTED_SNAPSHOT_FIELDS = [
  'doc',
  'messages',
  'selection',
  'dirty',
  'composerText',
  'composerImages',
  'lastRun',
  'pendingBatch',
  'pendingResult',
  'wasRunning',
] as const;

/** Undo stacks are session-local only; durable storage matches portable backups (no past/future). */
export function snapshotFieldsForStorage(): readonly string[] {
  return PERSISTED_SNAPSHOT_FIELDS;
}

function stripMessageImages<T extends { images?: string[] }>(message: T): T {
  if (!message.images?.length) return message;
  const { images: _removed, ...rest } = message;
  return rest as T;
}

function prepareSnapshot(
  snapshot: PersistedSnapshot,
  tier: WorkspaceStorageTier,
): Record<string, unknown> {
  const next: Record<string, unknown> = {
    doc: snapshot.doc,
    messages:
      tier !== 'normal'
        ? snapshot.messages.map(stripMessageImages)
        : snapshot.messages,
    selection: snapshot.selection,
    dirty: snapshot.dirty,
    composerText: snapshot.composerText,
    composerImages: tier !== 'normal' ? [] : snapshot.composerImages,
    lastRun: snapshot.lastRun,
    pendingBatch: snapshot.pendingBatch,
    pendingResult: snapshot.pendingResult,
    wasRunning: snapshot.wasRunning,
  };
  return next;
}

export function prepareSessionsForStorage<T extends PersistableWorkspaceSession>(
  sessions: T[],
  tier: WorkspaceStorageTier,
): T[] {
  const kept =
    tier === 'omit-trashed'
      ? sessions.filter((session) => !session.deletedAt)
      : sessions;
  return kept.map((session) => ({
    ...session,
    sceneThumbnail:
      typeof session.sceneThumbnail === 'string' &&
      session.sceneThumbnail.length > 160_000
        ? undefined
        : session.sceneThumbnail,
    snapshot: prepareSnapshot(session.snapshot, tier) as unknown as T['snapshot'],
  }));
}

export function storageReclaimNotice(tier: WorkspaceStorageTier): string | null {
  if (tier === 'strip-images') {
    return '本地空间不足：已跳过参考图写入，文字与场景几何仍会保存。建议下载工作台备份。';
  }
  if (tier === 'omit-trashed') {
    return '本地空间不足：已跳过参考图及回收站中的会话数据以释放空间。未删除的会话文字与场景仍会保存。建议下载工作台备份。';
  }
  return null;
}

export function isQuotaExceededError(error: unknown): boolean {
  return (
    (error instanceof DOMException && error.name === 'QuotaExceededError') ||
    (error instanceof Error && /quota|空间不足|空间已满|QuotaExceeded/i.test(error.message))
  );
}

export async function requestDurableBrowserStorage(): Promise<void> {
  try {
    const storage = navigator.storage;
    if (storage?.persist) await storage.persist();
  } catch {
    /* Best-effort; persistence still works when the browser grants quota. */
  }
}
