import {importGlb} from './importGlb';
import type {BlenderResult} from './blenderModeling';
import type {Command} from '../domain/commands';

/** Adapt Blender's exported meshes to editable nodes; never regenerate shape or material. */
export async function blenderWorkbenchCommands(result:BlenderResult,signal?:AbortSignal):Promise<{operations:Command[];warnings:string[]}> {
 signal?.throwIfAborted();
 const {doc,warnings}=await importGlb(await result.glb.arrayBuffer(),result.name+'.glb');
 signal?.throwIfAborted();
 const used=new Set(doc.nodes.map(node=>node.materialId));
 return {operations:[{op:'importManualComponent',nodes:doc.nodes,materials:doc.materials.filter(material=>used.has(material.id))}],warnings};
}
