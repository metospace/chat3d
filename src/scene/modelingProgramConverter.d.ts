import type * as THREE from 'three';
import type {SceneDocument} from '../domain/types';

export function serializeModelingObject(three:typeof THREE,root:THREE.Object3D):SceneDocument & {assemblyName:string};
