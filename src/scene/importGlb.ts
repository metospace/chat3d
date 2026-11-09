import {prepareGlbTextures,packGlb} from './glbTextures';
import {GLTFLoader} from 'three/examples/jsm/loaders/GLTFLoader.js';
import {LoadingManager,Mesh,MeshStandardMaterial,MeshPhysicalMaterial,Color,Vector3,Quaternion,Matrix3,Matrix4,SkinnedMesh,InstancedMesh,BufferGeometry} from 'three';
import type {SceneDocument,Material,Vec3,Quaternion as Q} from '../domain/types';
import {validateDocument} from '../domain/types';
import {makeId} from '../util/ids';
import {withStockMaterials} from '../domain/materials';
import {PHYSICAL_MATERIAL_KEYS} from '../domain/physicalMaterial';

export const MAX_GLB_BYTES=512*1024*1024;
export const GLB_SIZE_ERROR=`GLB文件不能超过${MAX_GLB_BYTES/1024/1024} MiB`;
export function assertGlbSize(size:number):void{if(size>MAX_GLB_BYTES)throw Error(GLB_SIZE_ERROR);}
export function inspectGlbBytes(data:ArrayBuffer){
 assertGlbSize(data.byteLength);if(data.byteLength<20)throw Error('GLB文件头不完整');const view=new DataView(data);
 if(view.getUint32(0,true)!==0x46546c67||view.getUint32(4,true)!==2||view.getUint32(8,true)!==data.byteLength)throw Error('仅支持完整的GLB 2.0文件');
 let offset=12,json:any=null,bin:Uint8Array|undefined;
 while(offset<data.byteLength){if(offset+8>data.byteLength)throw Error('GLB块头损坏');const length=view.getUint32(offset,true),kind=view.getUint32(offset+4,true);offset+=8;if(length%4||offset+length>data.byteLength)throw Error('GLB块范围无效');if(kind===0x4e4f534a){if(json)throw Error('GLB包含重复JSON块');json=JSON.parse(new TextDecoder().decode(new Uint8Array(data,offset,length)));}if(kind===0x004e4942){if(bin)throw Error('重复二进制块');bin=new Uint8Array(data,offset,length);}offset+=length;}
 if(!json||json.asset?.version!=='2.0')throw Error('GLB缺少2.0场景');
 if((json.buffers??[]).some((b:any)=>b.uri)||json.buffers?.length>1)throw Error('模型必须自包含，不能引用外部缓冲文件');

 if(json.skins?.length)throw Error('当前不导入骨骼角色，请先烘焙为静态可分部件模型');
 if((json.extensionsRequired??[]).some((n:string)=>!['KHR_materials_unlit','KHR_materials_ior','KHR_materials_specular','KHR_materials_emissive_strength','KHR_texture_transform','KHR_materials_clearcoat','KHR_materials_transmission','KHR_materials_volume'].includes(n)))throw Error('模型包含当前不支持的必需扩展或压缩，请导出普通GLB');
 const prepared=prepareGlbTextures(json,bin);return {hasAnimation:!!json.animations?.length,hasTextures:!!json.images?.length,json:prepared.clean,materialMaps:prepared.materials,bin};
}
export type GlbImportStage='checking'|'parsing'|'converting'|'validating';
export async function importGlb(data:ArrayBuffer,name:string,onStage?:(stage:GlbImportStage)=>void|Promise<void>):Promise<{doc:SceneDocument;warnings:string[]}>{
 await onStage?.('checking');const info=inspectGlbBytes(data);const manager=new LoadingManager();manager.setURLModifier(()=>{throw Error('导入不允许请求外部资源');});const loader=new GLTFLoader(manager);await onStage?.('parsing');const gltf=await loader.parseAsync(info.hasTextures?packGlb(info.json,info.bin):data,'');
 const doc:SceneDocument={schemaVersion:1,projectId:makeId(),revision:0,unit:'m',upAxis:'Y',nodes:[],materials:[],assets:[]};const materials=new Map<string,string>(),assemblies=new Map<string,string>();
 let singularMeshes=0;
 const materialId=(m:MeshStandardMaterial)=>{if(materials.has(m.uuid))return materials.get(m.uuid)!;const id=makeId();const material:Material={id,baseColor:'#'+(m.color??new Color('#a5abb4')).getHexString(),roughness:m.roughness??.55,metalness:m.metalness??0,opacity:m.opacity??1,transparent:m.transparent,doubleSided:m.side===2,alphaTest:m.alphaTest,vertexColors:m.vertexColors};if(m instanceof MeshPhysicalMaterial){for(const key of PHYSICAL_MATERIAL_KEYS)material[key]=m[key];material.specularColor='#'+m.specularColor.getHexString();}const association=gltf.parser.associations.get(m) as {materials?:number}|undefined;const imported=association?.materials!==undefined?info.materialMaps[association.materials]:undefined;if(imported&&Object.keys(imported.maps).length){material.maps=imported.maps;material.normalScale=imported.normalScale;}if(m.emissive){material.emissive='#'+m.emissive.getHexString();material.emissiveIntensity=m.emissiveIntensity??1;}doc.materials.push(material);materials.set(m.uuid,id);return id;};
 try{
  await onStage?.('converting');
  // GLTFLoader decomposes node.matrix into TRS, which can lose shear or yield NaNs at zero scale.
  gltf.scene.traverse(o=>{const association=gltf.parser.associations.get(o) as {nodes?:number}|undefined,matrix=association?.nodes===undefined?undefined:info.json.nodes?.[association.nodes]?.matrix;if(matrix===undefined)return;if(!Array.isArray(matrix)||matrix.length!==16||!matrix.every((v:unknown)=>typeof v==='number'&&Number.isFinite(v))||matrix[3]!==0||matrix[7]!==0||matrix[11]!==0||matrix[15]!==1)throw Error('模型节点矩阵必须是有限仿射变换');o.matrix.fromArray(matrix);o.matrixAutoUpdate=false;});
  gltf.scene.updateMatrixWorld(true);gltf.scene.traverseVisible(o=>{
  if(!(o instanceof Mesh))return;if(o instanceof SkinnedMesh||o instanceof InstancedMesh||Object.keys(o.geometry.morphAttributes).length)throw Error('当前只接受普通静态网格，不接受骨骼、实例或形变网格');
  const g=o.geometry as BufferGeometry;const position=g.getAttribute('position');if(!position)return;
  const world=o.matrixWorld,determinant=world.determinant();if(!world.elements.every(Number.isFinite)||!Number.isFinite(determinant))throw Error('模型变换包含非有限数据或计算溢出');
  const singular=determinant===0,p=new Vector3(),q=new Quaternion(),s=new Vector3(1,1,1);let bake=singular;
  if(singular)singularMeshes++;else{world.decompose(p,q,s);const rebuilt=new Matrix4().compose(p,q,s);bake=rebuilt.elements.some((v,i)=>Math.abs(v-world.elements[i])>1e-8*Math.max(1,Math.abs(world.elements[i])));}
  const normalMatrix=bake&&!singular?new Matrix3().getNormalMatrix(world):null,v=new Vector3();
  const pos:number[]=[],normal:number[]=[],uvs:number[]=[];const attr=singular?undefined:g.getAttribute('normal'),uv=g.getAttribute('uv'),r=(x:number)=>Math.round(x*100000)/100000;for(let i=0;i<position.count;i++){v.fromBufferAttribute(position,i);if(bake)v.applyMatrix4(world);pos.push(r(v.x),r(v.y),r(v.z));if(attr){v.fromBufferAttribute(attr,i);if(normalMatrix)v.applyNormalMatrix(normalMatrix);normal.push(r(v.x),r(v.y),r(v.z));}if(uv)uvs.push(r(uv.getX(i)),r(uv.getY(i)));}
  const color=g.getAttribute('color'),colors:number[]=[];if(color){if(color.itemSize!==3&&color.itemSize!==4)throw Error('网格顶点色需为RGB或RGBA');for(let i=0;i<color.count;i++){colors.push(color.getX(i),color.getY(i),color.getZ(i));if(color.itemSize===4)colors.push(color.getW(i));}}
  const indices=g.index?Array.from(g.index.array):Array.from({length:position.count},(_,i)=>i);const mats=Array.isArray(o.material)?o.material:[o.material];const groups=Array.isArray(o.material)&&g.groups.length?g.groups:[{start:0,count:indices.length,materialIndex:0}];
  if(bake&&determinant<0)for(let i=0;i<indices.length;i+=3)[indices[i+1],indices[i+2]]=[indices[i+2],indices[i+1]];
  // Preserve a meaningful top-level collection when available, otherwise one named assembly.
  let parent=o;while(parent.parent&&parent.parent!==gltf.scene)parent=parent.parent as Mesh;const groupName=parent!==o&&parent.name?parent.name:o.name.includes('|')?o.name.split('|')[0].replace(/_+$/,'').trim():name.replace(/\.glb$/i,'');const assemblyId=assemblies.get(groupName)??makeId();assemblies.set(groupName,assemblyId);
  if(bake){p.set(0,0,0);q.identity();s.set(1,1,1);}
  for(const group of groups){const m=mats[group.materialIndex??0] as MeshStandardMaterial;if(!m)throw Error('网格材质索引无效');const id=makeId();doc.nodes.push({id,parentId:null,kind:'primitive',assemblyId,assemblyName:groupName,name:o.name||`网格部件${doc.nodes.length+1}`,visible:true,materialId:materialId(m),geometry:{type:'mesh',params:{positions:pos,indices:indices.slice(group.start,group.start+group.count),...(attr?{normals:normal}:{}),...(uv?{uvs}:{}),...(color?{colors,colorItemSize:color.itemSize as 3|4}:{})}},transform:{position:p.toArray() as Vec3,rotationQuaternion:q.normalize().toArray() as Q,scale:s.toArray() as Vec3}});
  }
 });if(!doc.nodes.length)throw Error('模型没有可导入的三角网格');await onStage?.('validating');const errors=validateDocument(doc);if(errors.length)throw errors[0];return {doc:withStockMaterials(doc),warnings:['导入单位按米处理，请核对尺寸；保留网格部件、第一套UV与内嵌PNG/JPEG贴图，未将模型认定为工程精确尺寸。',...(singularMeshes?[`已保留并烘焙 ${singularMeshes} 个含零缩放等退化变换的网格；法线按烘焙后的几何重算，压成线或点的三角形没有可见面积，未恢复原厚度。`]:[]),...(info.hasAnimation?['原GLB动画未导入；可在工作台重新设置部件运动。']:[])]};}
 finally{gltf.scene.traverse(o=>{if(o instanceof Mesh){o.geometry.dispose();for(const m of Array.isArray(o.material)?o.material:[o.material])m.dispose();}});}
}
