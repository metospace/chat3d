import type * as THREE from 'three';
import type {SceneDocument} from '../domain/types';

export interface ModelingProgramLimits {
  readonly sourceBytes:number;
  readonly resultBytes:number;
  readonly meshes:number;
  readonly materials:number;
  readonly vertices:number;
  readonly meshVertices:number;
  readonly indices:number;
  readonly totalIndices:number;
  readonly objects:number;
}
export const MODELING_PROGRAM_LIMITS:Readonly<ModelingProgramLimits>;
export function serializeModelingObject(three:typeof THREE,root:THREE.Object3D,limits?:ModelingProgramLimits):SceneDocument & {assemblyName:string};
