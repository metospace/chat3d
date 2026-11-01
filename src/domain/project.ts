import { withStockMaterials } from './materials';
import { SceneDocument, SCHEMA_VERSION, validateDocument } from './types';

export const MAX_PROJECT_BYTES = 20 * 1024 * 1024;
export const AUTOSAVE_KEY = 'chat3d.project.autosave.v1';

// 项目文件不包含模型 API 地址、密钥或聊天附件。
export function serializeProject(doc: SceneDocument): string {
  const scene: SceneDocument = {
    schemaVersion: doc.schemaVersion, projectId: doc.projectId, revision: doc.revision,
    unit: doc.unit, upAxis: doc.upAxis, nodes: doc.nodes, materials: doc.materials,
    assets: doc.assets, ...(doc.animation?{animation:doc.animation}:{}), ...(doc.viewState ? { viewState: doc.viewState } : {}),
  };
  // Compact JSON keeps whitespace from consuming the portable byte budget.
  const output=JSON.stringify({ format: 'chat3d-project', version: 1, scene });if(new TextEncoder().encode(output).length>MAX_PROJECT_BYTES)throw Error('项目文件超过20MB，请精简贴图或拆分场景后导出');return output;
}

export function parseProject(text: string): SceneDocument {
  if (new TextEncoder().encode(text).length > MAX_PROJECT_BYTES) throw new Error('项目文件超过 20 MB');
  let value: unknown;
  try { value = JSON.parse(text); } catch { throw new Error('项目文件不是有效 JSON'); }
  const pack = value as { format?: unknown; version?: unknown; scene?: SceneDocument } | null;
  if (!pack || pack.format !== 'chat3d-project' || pack.version !== 1 || !pack.scene) throw new Error('不支持的项目文件格式或版本');
  const doc = pack.scene;
  if (doc.schemaVersion !== SCHEMA_VERSION || typeof doc.projectId !== 'string' || !doc.projectId || !Number.isSafeInteger(doc.revision) || doc.revision < 0 || doc.unit !== 'm' || doc.upAxis !== 'Y') throw new Error('项目标识、版本、单位或坐标系无效');
  if (!Array.isArray(doc.nodes) || !Array.isArray(doc.materials) || !Array.isArray(doc.assets)) throw new Error('项目列表结构无效');
  if (doc.assets.length) throw new Error('此版本尚不支持导入外部模型资产');
  const required: Record<string, string[]> = {profileSweep:[],loft:[],sweepTube:[],mesh:[],lathe:[],profile:[],capsule:['radius','length'],frame:['width','height','depth','thickness'],tube:['outerRadius','innerRadius','height'],trapezoid:['widthTop','widthBottom','height','depth'],roundedPlate:['width','height','depth','cornerRadius'],box:['width','height','depth'],sphere:['radius'],cylinder:['radiusTop','radiusBottom','height'],cone:['radius','height'],plane:['width','depth']};
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
  return withStockMaterials(structuredClone(doc));
}

export function loadAutosave(): { doc: SceneDocument | null; error: string | null } {
  if (typeof localStorage === 'undefined') return { doc: null, error: null };
  try {
    const raw = localStorage.getItem(AUTOSAVE_KEY);
    return { doc: raw ? parseProject(raw) : null, error: null };
  } catch { return { doc: null, error: '本地恢复副本无法读取，已保留原数据。请打开已下载的项目文件。' }; }
}
