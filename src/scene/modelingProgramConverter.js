/* Runs inside the disposable modeling worker. No scene JSON/GLB intermediate. */
export const MODELING_PROGRAM_LIMITS = Object.freeze({sourceBytes:262144,resultBytes:24*1024*1024,meshes:1000,materials:100,vertices:500000,meshVertices:200000,indices:600000,totalIndices:1500000,objects:4096});

export function serializeModelingObject(THREE,root,limits=MODELING_PROGRAM_LIMITS) {
  if(!(root instanceof THREE.Object3D))throw Error('建模程序必须返回 THREE.Object3D / Group / Mesh');
  const nodes=[],materials=[],materialIds=new Map(),materialValues=new Map(),seen=new Set();
  let vertexTotal=0,indexTotal=0;
  const finite=(values,label)=>{if(values.some(v=>!Number.isFinite(v)))throw Error(label+'包含非有限数字');};
  const materialId=material=>{
    if(materialIds.has(material))return materialIds.get(material);
    if(!(material instanceof THREE.MeshStandardMaterial)||material.isShaderMaterial||material.isRawShaderMaterial)throw Error('仅支持 MeshStandardMaterial / MeshPhysicalMaterial PBR 材质');
    if(Object.values(material).some(value=>value?.isTexture))throw Error('建模程序暂不支持贴图，请使用 PBR 颜色和物理属性');
    if(material.onBeforeCompile!==THREE.Material.prototype.onBeforeCompile||material.customProgramCacheKey!==THREE.Material.prototype.customProgramCacheKey)throw Error('不支持自定义着色器');
    if(material.vertexColors||material.wireframe||material.flatShading||material.side===THREE.BackSide||material.blending!==THREE.NormalBlending||material.polygonOffset||!material.depthTest||!material.depthWrite||!material.colorWrite||material.clippingPlanes?.length)throw Error('材质包含无法保留的渲染选项');
    if(material.isMeshPhysicalMaterial&&(material.anisotropy!==0||material.iridescence!==0||material.sheen!==0||material.dispersion!==0||material.specularIntensity!==1||material.specularColor.getHex()!==0xffffff||material.attenuationDistance!==Infinity))throw Error('物理材质包含当前文档无法保留的属性');
    const id='program-material-'+materials.length;
    const value={id,baseColor:'#'+material.color.getHexString(),roughness:material.roughness,metalness:material.metalness,opacity:material.opacity,transparent:material.transparent,doubleSided:material.side===THREE.DoubleSide,alphaTest:material.alphaTest,emissive:'#'+material.emissive.getHexString(),emissiveIntensity:material.emissiveIntensity};
    if(material.isMeshPhysicalMaterial)for(const key of ['clearcoat','clearcoatRoughness','transmission','thickness','ior'])value[key]=material[key];
    finite(Object.values(value).filter(v=>typeof v==='number'),'材质');
    const key=JSON.stringify({...value,id:undefined});
    if(materialValues.has(key)){const existing=materialValues.get(key);materialIds.set(material,existing);return existing;}
    if(materials.length>=limits.materials)throw Error('模型超过100种 PBR 材质预算');
    materials.push(value);materialIds.set(material,id);materialValues.set(key,id);return id;
  };
  // Iterate explicitly: a hostile/accidentally cyclic or deeply nested graph must not
  // overflow recursive Object3D traversal before its object budget is enforced.
  const stack=[{object:root,parentMatrix:new THREE.Matrix4(),visible:true}];
  while(stack.length){
    const {object,parentMatrix,visible:parentVisible}=stack.pop();
    if(!(object instanceof THREE.Object3D)||seen.has(object))throw Error('建模对象层级无效或包含循环');
    seen.add(object);if(seen.size>limits.objects)throw Error('建模对象数量超出预算');
    if(object.animations.length||object.isSkinnedMesh||object.isInstancedMesh||object.isBatchedMesh||object.isLine||object.isPoints||object.isSprite||object.isLight||object.isCamera)throw Error('仅支持静态普通网格，不支持骨骼、实例、动画、线、点、灯光或相机');
    if(!object.isMesh&&!object.isGroup&&!object.isScene&&object.type!=='Object3D')throw Error('不支持此建模对象类型');
    if(object.matrixAutoUpdate)object.updateMatrix();
    finite(object.matrix.elements,'局部变换');
    const world=new THREE.Matrix4().multiplyMatrices(parentMatrix,object.matrix);
    finite(world.elements,'世界变换');
    if(world.elements[3]!==0||world.elements[7]!==0||world.elements[11]!==0||world.elements[15]!==1||Math.abs(world.determinant())<1e-12)throw Error('模型变换必须是非奇异仿射变换');
    const visible=parentVisible&&object.visible;
    for(let i=object.children.length-1;i>=0;i--)stack.push({object:object.children[i],parentMatrix:world,visible});
    if(!object.isMesh)continue;
    const geometry=object.geometry;
    if(!(geometry instanceof THREE.BufferGeometry)||Object.keys(geometry.morphAttributes).length)throw Error('仅支持无形变的 BufferGeometry 网格');
    if(Object.keys(geometry.attributes).some(key=>!['position','normal','uv'].includes(key)))throw Error('网格包含无法保留的顶点属性（仅支持 position / normal / uv）');
    const position=geometry.getAttribute('position'),normal=geometry.getAttribute('normal'),uv=geometry.getAttribute('uv');
    if(!position||position.itemSize!==3||position.count<3||position.count>limits.meshVertices||!Number.isInteger(position.count))throw Error('网格顶点无效或超过20万顶点预算');
    if(normal&&(normal.itemSize!==3||normal.count!==position.count)||uv&&(uv.itemSize!==2||uv.count!==position.count))throw Error('网格法线或 UV 数量无效');
    const count=geometry.index?geometry.index.count:position.count;
    if(!Number.isInteger(count)||!count||count%3||count>limits.indices||geometry.index&&geometry.index.itemSize!==1)throw Error('网格三角索引无效或超过预算');
    if(geometry.drawRange.start!==0||geometry.drawRange.count!==Infinity&&geometry.drawRange.count!==count)throw Error('不支持部分 drawRange，请返回完整网格');
    const indices=new Array(count);
    for(let i=0;i<count;i++){const index=geometry.index?geometry.index.getX(i):i;if(!Number.isInteger(index)||index<0||index>=position.count)throw Error('网格三角索引越界');indices[i]=index;}
    const meshMaterials=Array.isArray(object.material)?object.material:[object.material];
    if(!meshMaterials.length)throw Error('网格缺少材质');
    // Validate even unused materials: unsupported content must never silently vanish.
    const ids=meshMaterials.map(materialId);
    const groups=Array.isArray(object.material)?geometry.groups:[{start:0,count,materialIndex:0}];
    if(!groups.length)throw Error('多材质网格必须定义完整 geometry.groups');
    const ordered=[...groups].sort((a,b)=>a.start-b.start);let end=0;
    for(const group of ordered){if(!Number.isInteger(group.start)||!Number.isInteger(group.count)||group.start!==end||group.count<=0||group.start%3||group.count%3||!Number.isInteger(group.materialIndex??0)||!ids[group.materialIndex??0])throw Error('材质分组必须完整覆盖三角形且不能重叠');end+=group.count;}
    if(end!==count)throw Error('材质分组未完整覆盖网格');
    if(nodes.length+groups.length>limits.meshes)throw Error('模型超过1000个可编辑网格部件预算');
    vertexTotal+=position.count*groups.length;indexTotal+=count;
    if(vertexTotal>limits.vertices||indexTotal>limits.totalIndices)throw Error('模型超过总顶点或三角形预算');
    const p=new THREE.Vector3(),q=new THREE.Quaternion(),s=new THREE.Vector3();world.decompose(p,q,s);
    const rebuilt=new THREE.Matrix4().compose(p,q,s);
    const bake=rebuilt.elements.some((value,i)=>Math.abs(value-world.elements[i])>1e-8*Math.max(1,Math.abs(world.elements[i])));
    const normalMatrix=new THREE.Matrix3().getNormalMatrix(world),v=new THREE.Vector3();
    const positions=[],normals=[],uvs=[];
    for(let i=0;i<position.count;i++){
      v.fromBufferAttribute(position,i);if(bake)v.applyMatrix4(world);positions.push(v.x,v.y,v.z);
      if(normal){v.fromBufferAttribute(normal,i);if(bake)v.applyMatrix3(normalMatrix).normalize();normals.push(v.x,v.y,v.z);}
      if(uv)uvs.push(uv.getX(i),uv.getY(i));
    }
    finite(positions,'网格坐标');finite(normals,'网格法线');finite(uvs,'网格 UV');
    if(positions.some(v=>Math.abs(v)>10000)||normals.some(v=>Math.abs(v)>1.001)||uvs.some(v=>Math.abs(v)>10000))throw Error('网格属性超出文档范围');
    if(bake&&world.determinant()<0)for(let i=0;i<indices.length;i+=3)[indices[i+1],indices[i+2]]=[indices[i+2],indices[i+1]];
    const transform=bake?{position:[0,0,0],rotationQuaternion:[0,0,0,1],scale:[1,1,1]}:{position:p.toArray(),rotationQuaternion:q.normalize().toArray(),scale:s.toArray()};
    finite([...transform.position,...transform.rotationQuaternion,...transform.scale],'网格变换');
    if(typeof object.name!=='string'||object.name.length>200)throw Error('部件名称必须不超过200字符');
    for(const group of groups)nodes.push({id:'program-node-'+nodes.length,parentId:null,kind:'primitive',name:object.name||'网格部件'+(nodes.length+1),visible,materialId:ids[group.materialIndex??0],geometry:{type:'mesh',params:{positions,indices:indices.slice(group.start,group.start+group.count),...(normal?{normals}:{}),...(uv?{uvs}:{})}},transform});
  }
  if(!nodes.length)throw Error('建模程序没有返回可编辑三角网格');
  if(typeof root.name!=='string'||root.name.length>200)throw Error('模型名称必须不超过200字符');
  return {schemaVersion:1,projectId:'program-document',revision:0,unit:'m',upAxis:'Y',nodes,materials,assets:[],assemblyName:root.name||'程序模型'};
}
