import { withStockMaterials } from './materials';
import { SceneDocument, SCHEMA_VERSION, validateDocument } from './types';
import {validPublishedCategoryPath} from './teamCategories';

export const MAX_PROJECT_BYTES = 400 * 1024 * 1024;
export const MAX_TEAM_SCENE_BYTES = 500 * 1024 * 1024;
export const PROJECT_SIZE_LIMIT = `${MAX_PROJECT_BYTES / (1024 * 1024)} MiB`;
export const TEAM_SCENE_SIZE_LIMIT = `${MAX_TEAM_SCENE_BYTES / (1024 * 1024)} MiB`;
const projectSizeError = (bytes: number) => `项目文件超过 ${bytes / (1024 * 1024)} MiB`;
export const PROJECT_SIZE_ERROR = projectSizeError(MAX_PROJECT_BYTES);
export const AUTOSAVE_KEY = 'chat3d.project.autosave.v1';

// 项目文件不包含模型 API 地址、密钥或聊天附件。
export function serializeProject(doc: SceneDocument, overflowMessage?: string, maxBytes = MAX_PROJECT_BYTES, teamCategoryPath?: string[]): string {
  if (teamCategoryPath !== undefined && !validPublishedCategoryPath(teamCategoryPath)) throw new Error('团队分类路径无效');
  const scene: SceneDocument = {
    schemaVersion: doc.schemaVersion, projectId: doc.projectId, revision: doc.revision,
    unit: doc.unit, upAxis: doc.upAxis, nodes: doc.nodes, materials: doc.materials,
    assets: doc.assets, ...(doc.animation?{animation:doc.animation}:{}), ...(doc.viewState ? { viewState: doc.viewState } : {}),
  };
  // Compact JSON keeps whitespace from consuming the portable byte budget.
  const output = JSON.stringify({ format: 'chat3d-project', version: 1, scene, ...(teamCategoryPath !== undefined ? {teamCategoryPath} : {}) });
  if (output.length > maxBytes || new TextEncoder().encode(output).length > maxBytes) throw new Error(overflowMessage ?? `${projectSizeError(maxBytes)}，请精简贴图或拆分场景后导出`);
  return output;
}

export interface ParsedProjectFile {doc:SceneDocument;teamCategoryPath?:string[]}
export function parseProjectFile(text: string, maxBytes = MAX_PROJECT_BYTES): ParsedProjectFile {
  if (text.length > maxBytes || new TextEncoder().encode(text).length > maxBytes) throw new Error(projectSizeError(maxBytes));
  let value: unknown;
  try { value = JSON.parse(text); } catch { throw new Error('项目文件不是有效 JSON'); }
  const pack = value as { format?: unknown; version?: unknown; scene?: SceneDocument; teamCategoryPath?: unknown } | null;
  if (!pack || pack.format !== 'chat3d-project' || pack.version !== 1 || !pack.scene) throw new Error('不支持的项目文件格式或版本');
  if (pack.teamCategoryPath !== undefined && !validPublishedCategoryPath(pack.teamCategoryPath)) throw new Error('团队分类路径无效');
  const doc = pack.scene;
  if (doc.schemaVersion !== SCHEMA_VERSION || typeof doc.projectId !== 'string' || !doc.projectId || !Number.isSafeInteger(doc.revision) || doc.revision < 0 || doc.unit !== 'm' || doc.upAxis !== 'Y') throw new Error('项目标识、版本、单位或坐标系无效');
  if (!Array.isArray(doc.nodes) || !Array.isArray(doc.materials) || !Array.isArray(doc.assets)) throw new Error('项目列表结构无效');
  if (doc.assets.length) throw new Error('此版本尚不支持导入外部模型资产');
  const required: Record<string, string[]> = {sectionLoft:[],profileSweep:[],loft:[],sweepTube:[],mesh:[],lathe:[],profile:[],capsule:['radius','length'],frame:['width','height','depth','thickness'],tube:['outerRadius','innerRadius','height'],trapezoid:['widthTop','widthBottom','height','depth'],roundedPlate:['width','height','depth','cornerRadius'],box:['width','height','depth'],sphere:['radius'],cylinder:['radiusTop','radiusBottom','height'],cone:['radius','height'],plane:['width','depth']};
  try {
    for (const n of doc.nodes) {
      if (!n || n.kind !== 'primitive' || !n.geometry || !required[n.geometry.type] || typeof n.visible !== 'boolean' || !n.transform || !Array.isArray(n.transform.scale)) throw new Error('存在不支持或不完整的节点');
      if (n.parentId !== null) throw new Error('此版本尚不支持导入分组层级');
      const params = n.geometry.params as unknown as Record<string, number>;
      if (!params || required[n.geometry.type].some((k) => !Number.isFinite(params[k]))) throw new Error('几何体缺少必要尺寸');
    }
    const errors = validateDocument(doc);
    if (errors.length) throw new Error(errors.map((e) => e.message).join('；'));
  } catch (e) { throw new Error(`项目校验失败：${e instanceof Error ? e.message : '数据结构无效'}`); }
  return {doc:withStockMaterials(structuredClone(doc)),...(pack.teamCategoryPath !== undefined ? {teamCategoryPath:[...pack.teamCategoryPath]} : {})};
}

export function parseProject(text: string, maxBytes = MAX_PROJECT_BYTES): SceneDocument {
  return parseProjectFile(text,maxBytes).doc;
}

export function loadAutosave(): { doc: SceneDocument | null; error: string | null } {
  if (typeof localStorage === 'undefined') return { doc: null, error: null };
  try {
    const raw = localStorage.getItem(AUTOSAVE_KEY);
    return { doc: raw ? parseProject(raw) : null, error: null };
  } catch { return { doc: null, error: '本地恢复副本无法读取，已保留原数据。请打开已下载的项目文件。' }; }
}
