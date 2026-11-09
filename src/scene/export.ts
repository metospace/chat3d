import {materialReady,disposeMaterialTextures} from './surfaceTextures';
import {createSceneMaterial} from './material';
import * as THREE from 'three';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';
import { SceneDocument } from '../domain/types';
import { buildPrimitiveGeometry } from './geometry';

function* exportSceneParts(doc:SceneDocument,scene:THREE.Scene,shareGeometry:boolean){
  const materialCache=new Map<string,THREE.MeshStandardMaterial>(),geometryCache=new Map<string,THREE.BufferGeometry>();
  const materials=new Map(doc.materials.map(material=>[material.id,material]));
  for(const n of doc.nodes){
    if(!n.visible)continue;
    if(n.kind!=='primitive'||!n.geometry||n.parentId!==null)throw new Error('当前场景导出仅支持无分组的基础模型');
    const key=shareGeometry?JSON.stringify(n.geometry):undefined;
    const cached=key===undefined?undefined:geometryCache.get(key),geometry=cached??buildPrimitiveGeometry(n.geometry);
    let material:THREE.MeshStandardMaterial;
    try{const key=JSON.stringify([n.materialId,n.label]);material=materialCache.get(key)??createSceneMaterial(n.materialId?materials.get(n.materialId):undefined,n.label);materialCache.set(key,material);}catch(error){if(!cached)geometry.dispose();throw error;}
    if(key!==undefined&&!cached)geometryCache.set(key,geometry);
    const mesh=new THREE.Mesh(geometry,material);
    mesh.name=n.name;mesh.userData={connection:n.connection,nodeId:n.id,assemblyId:n.assemblyId,assemblyName:n.assemblyName,label:n.label,sceneRole:n.sceneRole,planKey:n.planKey,zone:n.zone};mesh.position.fromArray(n.transform.position);mesh.quaternion.fromArray(n.transform.rotationQuaternion);mesh.scale.fromArray(n.transform.scale);scene.add(mesh);
    yield;
  }
}
function exportSceneRoot(doc:SceneDocument){const scene=new THREE.Scene();scene.name='Scenivo';scene.userData={unit:doc.unit,projectId:doc.projectId};return scene;}
export function buildExportScene(doc:SceneDocument):THREE.Scene{
  const scene=exportSceneRoot(doc);
  try{for(const _ of exportSceneParts(doc,scene,false)){/* Synchronous GLB/export callers. */}return scene;}catch(error){disposeExportScene(scene);throw error;}
}
/** HTML shares immutable buffers for identical shapes and yields between construction batches. */
export async function buildHtmlExportScene(doc:SceneDocument,onProgress?:(completed:number,total:number)=>void):Promise<THREE.Scene>{
  return buildExportSceneAsync(doc,true,onProgress);
}
async function buildExportSceneAsync(doc:SceneDocument,shareGeometry:boolean,onProgress?:(completed:number,total:number)=>void):Promise<THREE.Scene>{
  const scene=exportSceneRoot(doc),total=doc.nodes.filter(node=>node.visible).length;let completed=0,last=performance.now();
  try{for(const _ of exportSceneParts(doc,scene,shareGeometry)){completed++;if(performance.now()-last>=12){onProgress?.(completed,total);const {promise,resolve}=Promise.withResolvers<void>();setTimeout(resolve,0);await promise;last=performance.now();}}onProgress?.(completed,total);return scene;}catch(error){disposeExportScene(scene);throw error;}
}
export async function prepareExportMaterials(scene:THREE.Scene):Promise<void> {
  const pending:Promise<void>[]=[];
  scene.traverse(object=>{if(object instanceof THREE.Mesh)for(const material of Array.isArray(object.material)?object.material:[object.material]){const ready=materialReady.get(material);if(ready)pending.push(ready);}});
  const results=await Promise.allSettled(pending);
  for(const result of results)if(result.status==='rejected')throw result.reason;
}
export function disposeExportScene(scene:THREE.Scene):void {
  const geometries=new Set<THREE.BufferGeometry>(),materials=new Set<THREE.Material>();
  scene.traverse(object=>{if(object instanceof THREE.Mesh){geometries.add(object.geometry);for(const material of Array.isArray(object.material)?object.material:[object.material])materials.add(material);}});
  geometries.forEach(geometry=>geometry.dispose());materials.forEach(disposeMaterialTextures);
}
/** GLTFExporter's metallic/roughness packing draws image sources onto a canvas;
 * raw DataTexture images must first become drawable images. Keep this export
 * conversion separate from viewport textures and their pixel caches. */
function prepareGlbImages(scene:THREE.Scene):void {
  // Leave non-browser exporters their original image sources. Server adapters
  // can supply their own canvas implementation; untextured GLBs need none.
  if(typeof document==='undefined'||typeof ImageData==='undefined')return;
  const converted=new Map<THREE.Texture,THREE.Texture>();
  scene.traverse(object=>{
    if(!(object instanceof THREE.Mesh))return;
    for(const material of Array.isArray(object.material)?object.material:[object.material]){
      for(const key of ['map','normalMap','roughnessMap','metalnessMap','emissiveMap','aoMap'] as const){
        const texture=material[key];if(!(texture instanceof THREE.DataTexture))continue;
        let imageTexture=converted.get(texture);
        if(!imageTexture){
          const {data,width,height}=texture.image;
          if(!data)throw new Error('程序纹理缺少像素数据');
          const canvas=document.createElement('canvas');canvas.width=width;canvas.height=height;
          const context=canvas.getContext('2d');if(!context)throw new Error('无法转换程序纹理');
          context.putImageData(new ImageData(new Uint8ClampedArray(data),width,height),0,0);
          imageTexture=new THREE.CanvasTexture(canvas);imageTexture.copy(texture);
          imageTexture.source=new THREE.Source(canvas);imageTexture.needsUpdate=true;
          converted.set(texture,imageTexture);
        }
        material[key]=imageTexture;
      }
    }
  });
  converted.forEach((_replacement,texture)=>texture.dispose());
}
export interface GlbExportProgress {stage:'geometry'|'textures'|'packing';completed?:number;total?:number}
export async function exportGlb(doc: SceneDocument,onProgress?:(progress:GlbExportProgress)=>void): Promise<ArrayBuffer> {
  if (!doc.nodes.some((n)=>n.visible)) throw new Error('没有可导出的可见对象');
  const scene=await buildExportSceneAsync(doc,false,(completed,total)=>onProgress?.({stage:'geometry',completed,total}));
  try {
    onProgress?.({stage:'textures'});
    await prepareExportMaterials(scene);
    prepareGlbImages(scene);
    onProgress?.({stage:'packing'});
    const result=await new GLTFExporter().parseAsync(scene,{binary:true,onlyVisible:true});
    if (!(result instanceof ArrayBuffer)) throw new Error('GLB 导出结果格式错误');
    return result;
  } finally {
    disposeExportScene(scene);
  }
}
