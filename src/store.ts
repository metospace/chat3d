import {validDashboardBinding,type DashboardBinding} from './domain/dashboard';
import {loadModelConfig,saveModelConfig} from './ai/modelConfigStorage';
export {loadModelConfig} from './ai/modelConfigStorage';
// 编辑器状态 — Zustand（React UI 外壳与 Three.js 视口共享的储物间）
// - SceneDocument 是唯一可信来源；UI 状态（选择/面板）与项目状态（几何/层级/材质）分开
// - 一次 AI 批量修改 = 一条历史记录；拖动手柄松开时提交一条
// - 历史条数与字节数双限制（方案第 6 节）
import { EXTRA_MATERIALS } from './domain/materials';
import type { AgentActivity } from './ai/modelingAgent';
import type {StopResult} from './domain/generationFailure';
import { create } from 'zustand';
import { applyBatch, cloneGeometry, Command, CommandBatch, CommandWithInverse, ExecutionResult } from './domain/commands';
import { Material, Quaternion, SceneDocument, SceneNode, SCHEMA_VERSION, Vec3 } from './domain/types';
import { makeId } from './util/ids';
import { AUTOSAVE_KEY, loadAutosave, serializeProject } from './domain/project';

// 方案第 7 节托管项目目录的默认材质：工业设备常见外观（喷漆、裸钢、橡胶、警示色）
const MAT_GRAY: Material = { id: 'mat_gray', baseColor: '#A5ABB4', roughness: 0.5, metalness: 0, clearcoat: 0.18, clearcoatRoughness: 0.3 }; // 喷漆铝灰
const MAT_BLUE: Material = { id: 'mat_blue', baseColor: '#3F6BA0', roughness: 0.5, metalness: 0, clearcoat: 0.18, clearcoatRoughness: 0.3 }; // 工业蓝漆
const MAT_DARK: Material = { id: 'mat_dark', baseColor: '#41474F', roughness: 0.55, metalness: 0, clearcoat: 0.12, clearcoatRoughness: 0.35 }; // 深灰钢（框架/型材）
const MAT_METAL: Material = { id: 'mat_metal', baseColor: '#B2B7BE', roughness: 0.32, metalness: 1 }; // 亮钢（裸露金属件）
const MAT_WHITE: Material = { id: 'mat_white', baseColor: '#D6D6CF', roughness: 0.5, metalness: 0, clearcoat: 0.15, clearcoatRoughness: 0.3 }; // 米白面板（柜体外壳）
const MAT_RUBBER: Material = { id: 'mat_rubber', baseColor: '#1A1D21', roughness: 0.95, metalness: 0.0 }; // 橡胶黑（轮胎/把手/脚垫）
const MAT_YELLOW: Material = { id: 'mat_yellow', baseColor: '#C8982E', roughness: 0.5, metalness: 0, clearcoat: 0.1, clearcoatRoughness: 0.3 }; // 警示黄（标识/护栏）

// 历史限制：条数与字节双计算（方案第 6 节）
const MAX_HISTORY_ENTRIES = 200;
const MAX_HISTORY_BYTES = 64 * 1024 * 1024; // 64MB

export function createInitialDoc(): SceneDocument {
  return {
    schemaVersion: SCHEMA_VERSION,
    materials: [MAT_GRAY, MAT_BLUE, MAT_DARK, MAT_METAL, MAT_WHITE, MAT_RUBBER, MAT_YELLOW, ...EXTRA_MATERIALS],
    projectId: makeId(),
    revision: 0,
    unit: 'm',
    upAxis: 'Y',
    assets: [],
    nodes: [],
  };
}

export type AiTaskStatus =
  | 'idle'
  | 'capturing' // 冻结 projectId/baseRevision/选择/相机基准
  | 'context' // 组织发送上下文
  | 'generating' // 模型生成中
  | 'validating' // 结构/引用/参数/预算校验
  | 'previewing' // 副本预演，等用户确认应用
  | 'applying' // 原子提交
  | 'error'
  | 'cancelled';

export interface MessageRun {
  mode?:'demo'|'single'|'pi'; startedAt:number; endedAt?:number; status:'running'|'preview'|'completed'|'failed'|'stopped'; activity?:AgentActivity;
  stopResult?:StopResult;
}
export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  text: string;
  batch?: CommandBatch; // assistant 附带的命令批（预览态）
  error?: string;
  images?: string[];
  outcome?: 'applied' | 'discarded' | 'superseded';
  run?: MessageRun;
  queuedTask?: {status:'waiting'|'prepared'|'cancelled'};
  steering?: {runId:string;status:'queued'|'received'|'interrupted'};
  createdAt: number;
}

export interface HistoryEntry {
  id?:string;createdAt?:number;source?:'manual'|'ai';
  summary: string;
  applied: CommandWithInverse[]; // before/after 快照
  docAfter: SceneDocument;
  createdMaterialIds?: string[]; // Only this history entry's new materials; legacy entries stay compatible.
  dashboardBefore?:{value:DashboardBinding|undefined};
  bytes: number;
}

export interface EditorState {
  viewportStatus: 'starting'|'ready'|'error';
  // 项目状态（进入核心命令历史）
  doc: SceneDocument;
  past: HistoryEntry[];
  future: HistoryEntry[];
  dirty: boolean; // 尚未下载项目文件
  autosaveError: string | null;
  replaceProject: (doc: SceneDocument) => boolean;
  markSaved: () => void;
  setDashboard:(binding:DashboardBinding|undefined)=>{ok:boolean;error?:string};

  composerText: string;
  composerImages: string[];
  lastRun: AgentActivity | null;
  setComposerText: (text:string)=>void;
  setComposerImages: (images:string[])=>void;
  setLastRun: (activity:AgentActivity|null)=>void;
  // 会话状态（不进项目历史）
  selection: string[];
  messages: ChatMessage[];
  aiStatus: AiTaskStatus;
  pendingBatch: CommandBatch | null; // 预览中的批次
  pendingResult: ExecutionResult | null; // 预演结果：确认后原样提交（新建节点 ID 与预览一致）
  previewDoc: SceneDocument | null; // 预览期间驱动视口/面板的副本
  aiConfig: ModelConfig | null; // 模型 API 配置（baseURL / apiKey / model / useMock）
  setAiConfig: (cfg: ModelConfig | null) => void;
  aiError: string | null;

  // 应用偏好
  displayUnit: 'm' | 'cm' | 'mm';

  // 动作
  applyCommandBatch: (ops: Command[], summary: string) => { ok: boolean; error?: string };
  deleteSelection: () => {ok:boolean;error?:string};
  confirmPending: () => void;
  discardPending: () => void;
  undo: () => void;
  redo: () => void;
  select: (ids: string[] | null) => void;
  addUserMessage: (text: string, images?: string[]) => string;
  updateMessageRun: (id:string,patch:Partial<MessageRun>)=>void;
  addAssistantMessage: (text: string, batch?: CommandBatch, error?: string) => void;
  setAiStatus: (s: AiTaskStatus) => void;
  setPendingBatch: (batch: CommandBatch | null) => void;
  setPendingResult: (r: ExecutionResult | null) => void;
  setPreviewDoc: (d: SceneDocument | null) => void;
  setAiError: (e: string | null) => void;
}

function entryBytes(applied: CommandWithInverse[]): number {
  return JSON.stringify(applied).length;
}

function pushHistory(past: HistoryEntry[], entry: HistoryEntry): HistoryEntry[] {
  let next = [...past, entry];
  while (next.length > MAX_HISTORY_ENTRIES) next.shift();
  let total = next.reduce((s, e) => s + e.bytes, 0);
  while (total > MAX_HISTORY_BYTES && next.length > 1) {
    const removed = next.shift();
    if (!removed) break;
    total -= removed.bytes;
  }
  return next;
}

import type { ModelConfig } from './ai/provider';

const restoredProject = loadAutosave();
const EDIT_LOCKED = new Set<AiTaskStatus>(['capturing', 'context', 'generating', 'validating', 'previewing', 'applying']);

export const createEditorStore = (initial: Partial<EditorState> = {}) => create<EditorState>((set, get) => ({
  viewportStatus:'starting',
  composerText:'',composerImages:[],lastRun:null,
  setComposerText:(composerText)=>set({composerText}),setComposerImages:(composerImages)=>set({composerImages}),setLastRun:(lastRun)=>set({lastRun}),
  doc: createInitialDoc(),
  past: [],
  future: [],
  dirty: false,
  autosaveError: null,
  replaceProject: (doc) => {
    if (EDIT_LOCKED.has(get().aiStatus)) return false;
    set({doc: structuredClone(doc), past: [], future: [], dirty: false, selection: [], messages: [], composerText:'',composerImages:[],lastRun:null, pendingBatch: null, pendingResult: null, previewDoc: null, aiStatus: 'idle', aiError: null});
    return true;
  },
  markSaved: () => set({ dirty: false }),
  setDashboard:(binding)=>{
    const state=get();if(EDIT_LOCKED.has(state.aiStatus))return {ok:false,error:'请先完成或放弃当前操作'};
    if(binding!==undefined&&!validDashboardBinding(binding))return {ok:false,error:'看板接入配置无效'};
    const doc={...state.doc,revision:state.doc.revision+1};if(binding)doc.dashboard=structuredClone(binding);else delete doc.dashboard;
    const entry:HistoryEntry={id:makeId(),createdAt:Date.now(),source:'manual',summary:binding?'接入看板 '+binding.name:'移除看板',applied:[],docAfter:doc,dashboardBefore:{value:state.doc.dashboard},bytes:JSON.stringify(binding??null).length};
    set({doc,past:pushHistory(state.past,entry),future:[],dirty:true});return {ok:true};
  },
  selection: [],
  messages: [],
  aiStatus: 'idle',
  pendingBatch: null,
  pendingResult: null,
  previewDoc: null,
  aiConfig: null,

  setAiConfig: (cfg) => {
    set({ aiConfig: cfg });
    saveModelConfig(cfg);
  },
  aiError: null,
  displayUnit: 'm',

  // 手动编辑（属性面板/对象树）的单一提交入口：原子替换，进历史
  // 预览期间冻结：AI 事务未确认前不能动手改基线
  applyCommandBatch: (ops: Command[], summary: string) => {
    const state = get();
    if (EDIT_LOCKED.has(state.aiStatus)) return { ok: false, error: '请先完成、取消或放弃当前 AI 操作' };
    const result = applyBatch(state.doc, { operations: ops });
    if (result.errors.length > 0) {
      return { ok: false, error: result.errors.map((e) => e.message).join('; ') };
    }
    const survivingIds=new Set(result.doc.nodes.map(n=>n.id));
    const entry: HistoryEntry = {
      id:makeId(),createdAt:Date.now(),source:'manual',
      summary,
      applied: result.applied,
      docAfter: result.doc,
      createdMaterialIds: result.doc.materials.filter(m=>!state.doc.materials.some(old=>old.id===m.id)).map(m=>m.id),
      bytes: entryBytes(result.applied),
    };
    set({
      doc: result.doc,
      selection: state.selection.filter(id=>survivingIds.has(id)),
      past: pushHistory(state.past, entry),
      future: [],
      dirty: true,
      pendingBatch: null,
      aiStatus: 'idle',
    });
    return { ok: true };
  },

  deleteSelection: () => {
    const state=get();
    const existingIds=new Set(state.doc.nodes.map(n=>n.id));
    const ids=[...new Set(state.selection.filter(id=>existingIds.has(id)))];
    if(!ids.length)return {ok:false,error:'请先选中要删除的场景对象'};
    return state.applyCommandBatch([{op:'delete',targetIds:ids}],`删除选中的 ${ids.length} 个场景零件`);
  },

  // AI 事务确认：直接采用预演结果对象，不重跑 applyBatch
  // → 预览看到什么，提交就是什么；新建节点 ID 在预览/正式态完全一致
  confirmPending: () => {
    const { pendingBatch, pendingResult } = get();
    if (!pendingBatch || !pendingResult || get().aiStatus !== 'previewing') return;
    // 防御：预览期间若文档被其他途径改动（界面已禁编辑，理论上走不到）
    if (get().doc.revision !== pendingBatch.baseRevision || get().doc.projectId !== pendingBatch.projectId || pendingResult.doc.projectId !== pendingBatch.projectId) {
      set({
        aiError: '场景在预览期间已变更，预览作废',
        aiStatus: 'error',
        pendingBatch: null,
        pendingResult: null,
        previewDoc: null,
      });
      return;
    }
    const entry: HistoryEntry = {
      id:makeId(),createdAt:Date.now(),source:'ai',
      summary: pendingBatch.summary,
      applied: pendingResult.applied,
      docAfter: pendingResult.doc,
      createdMaterialIds: pendingResult.doc.materials.filter(m=>!get().doc.materials.some(old=>old.id===m.id)).map(m=>m.id),
      bytes: entryBytes(pendingResult.applied),
    };
    set((s) => ({
      messages: s.messages.map(m => m.batch?.requestId === pendingBatch.requestId ? {...m, outcome: 'applied' as const} : m),
      doc: pendingResult.doc,
      selection: s.selection.filter(id=>pendingResult.doc.nodes.some(n=>n.id===id)),
      past: pushHistory(s.past, entry),
      future: [],
      dirty: true,
      pendingBatch: null,
      pendingResult: null,
      previewDoc: null,
      aiStatus: 'idle',
      aiError: null,
    }));
  },

  discardPending: () => {
    if (['capturing','context','generating','validating','applying'].includes(get().aiStatus)) return;
    set(s => ({ messages: s.messages.map(m => m.batch?.requestId === s.pendingBatch?.requestId && m.batch ? {...m, outcome: 'discarded' as const} : m), pendingBatch: null, pendingResult: null, previewDoc: null, aiStatus: 'idle', aiError: null }));
  },

  undo: () => {
    const { past, future, doc, aiStatus } = get();
    if (EDIT_LOCKED.has(aiStatus)) return; // 预览期间冻结历史，避免基线漂移
    if (past.length === 0) return;
    const entry = past[past.length - 1];
    const restored = restoreFromBefore(doc, entry);
    const survivingIds=new Set(restored.nodes.map(n=>n.id));
    set({
      doc: restored,
      selection: get().selection.filter(id=>survivingIds.has(id)),
      past: past.slice(0, -1),
      future: [...future, entry],
      dirty: true,
    });
  },

  redo: () => {
    const { past, future, doc, aiStatus } = get();
    if (EDIT_LOCKED.has(aiStatus)) return;
    if (future.length === 0) return;
    const entry = future[future.length - 1];
    const survivingIds=new Set(entry.docAfter.nodes.map(n=>n.id));
    set({
      doc: { ...structuredClone(entry.docAfter), revision: doc.revision + 1 },
      selection: get().selection.filter(id=>survivingIds.has(id)),
      past: [...past, entry],
      future: future.slice(0, -1),
      dirty: true,
    });
  },

  select: (ids) => set({ selection: ids ?? [] }),

  addUserMessage: (text, images) => {
    const msg: ChatMessage = { id: makeId(), role: 'user', text, images, createdAt: Date.now() };
    set((s) => ({ messages: [...s.messages, msg] }));
    return msg.id;
  },
  updateMessageRun:(id,patch)=>set(s=>({messages:s.messages.map(m=>m.id===id?{...m,run:{startedAt:m.createdAt,status:'running',...m.run,...patch}}:m)})),

  addAssistantMessage: (text, batch, error) => {
    const msg: ChatMessage = {
      id: makeId(),
      role: 'assistant',
      text,
      batch,
      error,
      createdAt: Date.now(),
    };
    set((s) => ({ messages: [...s.messages, msg] }));
  },

  setAiStatus: (s) => set({ aiStatus: s }),
  setPendingBatch: (batch) => set({ pendingBatch: batch }),
  setPendingResult: (r) => set({ pendingResult: r }),
  setPreviewDoc: (d) => set({ previewDoc: d }),
  setAiError: (e) => set({ aiError: e }),
  ...initial,
}));
export type EditorStore = ReturnType<typeof createEditorStore>;
// This public store projects the currently viewed conversation. Background controllers
// hold an independent store, never this navigation-dependent object.
export const useEditorStore = createEditorStore({doc:restoredProject.doc??createInitialDoc(),dirty:!!restoredProject.doc,autosaveError:restoredProject.error,aiConfig:loadModelConfig()});

// 从 before 快照恢复文档（撤销）
// - before 里有快照的节点：回写旧值（保留原 ID、父子、参数、材料）
// - after 里有但 before 里没有的节点：删除（即撤销创建）
function restoreFromBefore(doc: SceneDocument, entry: HistoryEntry): SceneDocument {
  if(entry.dashboardBefore){const restored={...doc,revision:doc.revision+1};if(entry.dashboardBefore.value)restored.dashboard=structuredClone(entry.dashboardBefore.value);else delete restored.dashboard;return restored;}
  let nodes = doc.nodes.map(cloneSnapshot);
  let animation=doc.animation;
  // 逐条反向还原，避免同一节点多次编辑覆盖批次最初状态。
  // 创建后再编辑的节点先还原编辑，再由创建操作的逆操作删除。
  for (const item of [...entry.applied].reverse()) {
    if(Object.prototype.hasOwnProperty.call(item.before,'animation'))animation=structuredClone(item.before.animation??undefined);
    const before = new Map(item.before.nodes.map((n) => [n.id, n]));
    const afterIds = new Set(item.after.nodes.map((n) => n.id));
    nodes = nodes.filter((n) => !afterIds.has(n.id) || before.has(n.id));
    if(item.before.nodeIndices){
      nodes=nodes.filter(n=>!before.has(n.id));
      const indices=item.before.nodeIndices;
      for(const n of [...item.before.nodes].sort((a,b)=>(indices[a.id]??0)-(indices[b.id]??0)))nodes.splice(Math.min(indices[n.id]??nodes.length,nodes.length),0,cloneSnapshot(n));
      continue;
    }
    const existing = new Set(nodes.map((n) => n.id));
    nodes = nodes.map((n) => before.has(n.id) ? cloneSnapshot(before.get(n.id)!) : n);
    for (const n of item.before.nodes) {
      if (!existing.has(n.id)) nodes.push(cloneSnapshot(n));
    }
  }
  const created=new Set(entry.createdMaterialIds??[]),used=new Set(nodes.map(n=>n.materialId));
  const materials=doc.materials.filter(m=>!created.has(m.id)||used.has(m.id));
  const restored={...doc,nodes,materials,revision:doc.revision+1};if(animation)restored.animation=animation;else delete restored.animation;return restored;
}

function cloneSnapshot(n: SceneNode): SceneNode {
  return {
    ...n,
    transform: {
      position: [...n.transform.position] as Vec3,
      rotationQuaternion: [...n.transform.rotationQuaternion] as Quaternion,
      scale: [...n.transform.scale] as Vec3,
    },
    geometry: n.geometry ? cloneGeometry(n.geometry) : undefined,
  };
}

// 预览期间用预演副本驱动视口与面板（所见即所得）；确认/放弃后自动回到真实文档
export function useDisplayDoc() {
  return useEditorStore((s) => s.previewDoc ?? s.doc);
}

// Once the IndexedDB workspace is authoritative, do not duplicate large mesh scenes into the small localStorage quota.
let workspacePersistenceActive=false;
export function setWorkspacePersistenceActive(active:boolean){workspacePersistenceActive=active;if(active&&useEditorStore.getState().autosaveError?.startsWith('自动恢复副本保存失败'))useEditorStore.setState({autosaveError:null});}
// 只保存已提交场景；预览、密钥、聊天内容不会进入恢复副本。
useEditorStore.subscribe((state, previous) => {
  if (workspacePersistenceActive || state.doc === previous.doc || typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(AUTOSAVE_KEY, serializeProject(state.doc));
    if (state.autosaveError) useEditorStore.setState({ autosaveError: null });
  } catch {
    useEditorStore.setState({ autosaveError: '自动恢复副本保存失败（空间不足或存储被禁用），请下载项目文件备份。' });
  }
});
