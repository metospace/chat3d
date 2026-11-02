import {InstancedMesh, Matrix4, Mesh, MeshPhysicalMaterial, Scene, type BufferGeometry, type Material} from 'three';

export const INSTANCE_BATCH_MIN = 16;
interface Batch {sources: Mesh[]; mesh: InstancedMesh}

/** Rendering-only batches. Stable source meshes remain available to picking,
 * rectangle ID passes, manual edits, selection bounds and export. */
export class InstancedRender {
  private batches: Batch[] = [];
  private matrix = new Matrix4();
  private previous = new Matrix4();
  private sceneInverse = new Matrix4();

  constructor(private scene: Scene) {}

  rebuild(sources: Mesh[]): void {
    this.dispose();
    const geometries = new Map<BufferGeometry, Map<Material, Map<string, Mesh[]>>>();
    for (const source of sources) {
      const material = source.material;
      // Transparent surfaces retain individual depth sorting.
      if (Array.isArray(material) || material.transparent || material.opacity < 1 || (material instanceof MeshPhysicalMaterial && material.transmission > 0)) continue;
      let materials = geometries.get(source.geometry);
      if (!materials) geometries.set(source.geometry, materials = new Map());
      let settings = materials.get(material);
      if (!settings) materials.set(material, settings = new Map());
      const key = [source.castShadow, source.receiveShadow, source.renderOrder, source.layers.mask].join(':');
      const group = settings.get(key) ?? [];
      group.push(source); settings.set(key, group);
    }
    for (const materials of geometries.values()) for (const settings of materials.values()) for (const sources of settings.values()) {
      if (sources.length < INSTANCE_BATCH_MIN) continue;
      const first = sources[0];
      const mesh = new InstancedMesh(first.geometry, first.material as Material, sources.length);
      mesh.name = '__instanceBatch';
      mesh.castShadow = first.castShadow; mesh.receiveShadow = first.receiveShadow;
      mesh.renderOrder = first.renderOrder; mesh.layers.mask = first.layers.mask;
      mesh.visible = false; mesh.count = 0;
      this.scene.add(mesh); this.batches.push({sources, mesh});
    }
  }

  /** The substitution lasts only for the synchronous draw, including failures. */
  render(draw: () => void): void {
    const hidden: Mesh[] = [];
    this.scene.updateWorldMatrix(true, false);
    this.sceneInverse.copy(this.scene.matrixWorld).invert();
    try {
      for (const {sources, mesh} of this.batches) {
        let count = 0, changed = false;
        for (const source of sources) {
          if (!source.visible) continue;
          source.updateWorldMatrix(true, false);
          this.matrix.multiplyMatrices(this.sceneInverse, source.matrixWorld);
          // InstancedMesh does not support mirrored matrices. Keep these sources ordinary.
          if (this.matrix.determinant() <= 0) continue;
          mesh.getMatrixAt(count, this.previous);
          // GPU storage is Float32; compare in that precision to avoid uploading
          // unchanged rotations on every camera redraw.
          if (!this.matrix.elements.every((value, i) => Math.fround(value) === this.previous.elements[i])) {
            mesh.setMatrixAt(count, this.matrix); changed = true;
          }
          count++; hidden.push(source); source.visible = false;
        }
        changed ||= mesh.count !== count;
        mesh.count = count; mesh.visible = count > 0;
        if (changed) {
          mesh.instanceMatrix.needsUpdate = true;
          mesh.computeBoundingBox(); mesh.computeBoundingSphere();
        }
      }
      draw();
    } finally {
      for (const source of hidden) source.visible = true;
      for (const {mesh} of this.batches) mesh.visible = false;
    }
  }

  dispose(): void {
    for (const {mesh} of this.batches) {
      this.scene.remove(mesh);
      mesh.dispose(); // Shared source geometry, materials and textures remain owned by Viewport.
    }
    this.batches = [];
  }
}
