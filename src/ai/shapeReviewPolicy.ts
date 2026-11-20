import type { Geometry, SceneDocument, SceneNode } from '../domain/types';
import type { ObjectBlueprint } from '../domain/objectBlueprint';

/** Any closeup multi-feature reference plan needs the independent silhouette comparison.
 * The declared geometryApproach is a binding detail, not an escape hatch: complex products
 * (vehicles, appliances) are inherently multi-part, so requiring a mesh-declared form let
 * the model skip the comparison by declaring 'assembly' or 'primitive' and build boxes. */
export function needsReferenceSilhouette(plan: ObjectBlueprint, imageCount: number): boolean {
  return imageCount >= 2 && plan.detailLevel === 'closeup' && plan.features.length >= 4;
}

/** Opposite orthographic directions still show the same projection axes. */
export function hasComplementaryShapeViews(views: Iterable<string>): boolean {
  let first: string | undefined;
  for (const view of views) {
    const axis = view === 'back' ? 'front' : view === 'left' ? 'side' : view === 'bottom' ? 'top' : view;
    if (first !== undefined && first !== axis) return true;
    first = axis;
  }
  return false;
}

function sameGeometry(a: Geometry, b: Geometry) {
  if (a === b) return true;
  if (a.type === 'mesh' && b.type === 'mesh') {
    const equal = (x: number[], y: number[]) => x === y || (x.length === y.length && x.every((v, i) => v === y[i]));
    return equal(a.params.positions, b.params.positions) && equal(a.params.indices, b.params.indices);
  }
  return JSON.stringify(a) === JSON.stringify(b);
}

/** Only authored multi-part forms and custom meshes need the extra gate.
 * Material changes and placement of fixed assets use the ordinary review. */
export function shapeReviewTargets(base: SceneDocument, draft: SceneDocument) {
  const groupId = (node: SceneNode) => node.assemblyId ?? node.id;
  const authored = (node: SceneNode) => node.visible && node.geometry && !node.modelAsset;
  const previous = new Map(base.nodes.map(node => [node.id, node]));
  const current = new Set<string>();
  const groups = new Map<string, {id: string; name: string; count: number; custom: boolean; changed: boolean}>();
  for (const node of draft.nodes) {
    if (!authored(node)) continue;
    const id = groupId(node);
    let group = groups.get(id);
    if (!group) {
      group = {id, name: node.assemblyName ?? node.name, count: 0, custom: false, changed: false};
      groups.set(id, group);
    }
    current.add(node.id);
    group.count++;
    group.custom ||= node.geometry!.type === 'mesh' || !!node.modelingProgram;
    const old = previous.get(node.id);
    group.changed ||= !old?.visible || !old.geometry || old.parentId !== node.parentId ||
      !sameGeometry(old.geometry, node.geometry!) || JSON.stringify(old.transform) !== JSON.stringify(node.transform);
  }
  for (const node of base.nodes) {
    const group = groups.get(groupId(node));
    if (group && authored(node) && !current.has(node.id)) {
      group.changed = true;
      group.custom ||= node.geometry!.type === 'mesh' || !!node.modelingProgram;
    }
  }
  return [...groups.values()].filter(group => group.changed && (group.custom || group.count > 1));
}
