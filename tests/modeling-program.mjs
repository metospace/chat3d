import assert from 'node:assert/strict';
import * as THREE from 'three';
import {createServer} from 'vite';
import {MODELING_PROGRAM_LIMITS,serializeModelingObject} from '../src/scene/modelingProgramConverter.js';

const server=await createServer({server:{middlewareMode:true},appType:'custom'});
const material=()=>new THREE.MeshStandardMaterial({color:'#6699bb',metalness:.4,roughness:.3});
const mesh=()=>new THREE.Mesh(new THREE.BoxGeometry(1,2,3),material());
let passed=0;
const test=(name,fn)=>{fn();passed++;console.log('PASS',name);};
try{
  const {validateDocument}=await server.ssrLoadModule('/src/domain/types.ts');
  test('curved meshes retain editable names, normals, UV and one coherent assembly name',()=>{
    const root=new THREE.Group();root.name='Curved assembly';
    const a=new THREE.Mesh(new THREE.TorusGeometry(.8,.1,8,24),material());a.name='Curved rim';
    const b=new THREE.Mesh(new THREE.LatheGeometry([new THREE.Vector2(.2,0),new THREE.Vector2(.4,.5),new THREE.Vector2(.1,1)],24),material());b.name='Turned shell';
    root.add(a,b);const result=serializeModelingObject(THREE,root);
    assert.equal(result.nodes.length,2);assert.equal(result.assemblyName,'Curved assembly');assert.deepEqual(result.nodes.map(n=>n.name),['Curved rim','Turned shell']);
    assert.equal(result.materials.length,1);assert.ok(result.nodes.every(n=>n.geometry.params.normals.length&&n.geometry.params.uvs.length));assert.deepEqual(validateDocument(result),[]);
  });
  test('parent transforms and reflected nonuniform scales survive world conversion',()=>{
    const root=new THREE.Group();root.position.set(2,3,-1);root.rotation.y=.6;root.scale.set(-2,1,3);
    const child=mesh();child.position.set(.2,.3,.4);root.add(child);root.updateMatrixWorld(true);
    const result=serializeModelingObject(THREE,root),node=result.nodes[0],actual=new THREE.Matrix4().compose(new THREE.Vector3(...node.transform.position),new THREE.Quaternion(...node.transform.rotationQuaternion),new THREE.Vector3(...node.transform.scale));
    actual.elements.forEach((v,i)=>assert.ok(Math.abs(v-child.matrixWorld.elements[i])<1e-8));assert.deepEqual(validateDocument(result),[]);
  });
  test('nested rotation under nonuniform scale bakes shear without geometry loss',()=>{
    const root=new THREE.Group();root.scale.set(-2,1,3);root.position.set(1,2,3);
    const child=mesh();child.rotation.z=.4;child.position.x=.8;root.add(child);root.updateMatrixWorld(true);
    const result=serializeModelingObject(THREE,root),node=result.nodes[0],params=node.geometry.params;
    assert.deepEqual(node.transform.scale,[1,1,1]);
    const expected=new THREE.Vector3().fromBufferAttribute(child.geometry.attributes.position,0).applyMatrix4(child.matrixWorld);
    assert.ok(expected.distanceTo(new THREE.Vector3(...params.positions.slice(0,3)))<1e-7);
    assert.deepEqual(params.indices.slice(0,3),[child.geometry.index.getX(0),child.geometry.index.getX(2),child.geometry.index.getX(1)]);assert.deepEqual(validateDocument(result),[]);
  });
  test('material groups keep triangles and PBR physical factors',()=>{
    const geometry=new THREE.BoxGeometry(1,1,1),physical=new THREE.MeshPhysicalMaterial({color:'#abcdef',clearcoat:.5,clearcoatRoughness:.2,transmission:.25,thickness:.2,ior:1.4,transparent:true,opacity:.7});
    const result=serializeModelingObject(THREE,new THREE.Mesh(geometry,Array.from({length:6},()=>physical)));
    assert.equal(result.nodes.length,6);assert.equal(result.nodes.reduce((sum,n)=>sum+n.geometry.params.indices.length,0),geometry.index.count);
    for(const key of ['clearcoat','clearcoatRoughness','transmission','thickness','ior','transparent','opacity'])assert.equal(result.materials[0][key],physical[key]);assert.deepEqual(validateDocument(result),[]);
  });
  test('unsupported scene content is rejected, including hidden nodes',()=>{
    const unsupported=[new THREE.SkinnedMesh(new THREE.BoxGeometry(),material()),new THREE.InstancedMesh(new THREE.BoxGeometry(),material(),2),new THREE.Line(new THREE.BufferGeometry(),new THREE.LineBasicMaterial()),new THREE.Points(),new THREE.Sprite(),new THREE.DirectionalLight(),new THREE.PerspectiveCamera()];
    for(const object of unsupported){object.visible=false;const root=new THREE.Group();root.add(mesh(),object);assert.throws(()=>serializeModelingObject(THREE,root));}
    const morph=mesh();morph.geometry.morphAttributes.position=[morph.geometry.attributes.position.clone()];assert.throws(()=>serializeModelingObject(THREE,morph),/形变/);
    const textured=mesh();textured.material.map=new THREE.Texture();assert.throws(()=>serializeModelingObject(THREE,textured),/贴图/);
    const shader=mesh();shader.material=new THREE.ShaderMaterial();assert.throws(()=>serializeModelingObject(THREE,shader),/PBR/);
    const custom=mesh();custom.material.onBeforeCompile=()=>{};assert.throws(()=>serializeModelingObject(THREE,custom),/着色器/);
  });
  test('malformed buffers, groups and matrices fail atomically',()=>{
    const cases=[m=>m.geometry.attributes.position.setX(0,NaN),m=>m.geometry.setIndex([0,1,99999]),m=>m.position.x=Infinity,m=>m.scale.y=0,m=>m.geometry.setDrawRange(0,3),m=>m.geometry.setAttribute('color',new THREE.Float32BufferAttribute(new Array(72).fill(1),3))];
    for(const corrupt of cases){const root=new THREE.Group(),valid=mesh(),invalid=mesh();corrupt(invalid);root.add(valid,invalid);assert.throws(()=>serializeModelingObject(THREE,root));assert.equal(root.children.length,2);assert.equal(valid.parent,root);}
    const grouped=mesh();grouped.material=[material()];grouped.geometry.clearGroups();grouped.geometry.addGroup(0,3,0);assert.throws(()=>serializeModelingObject(THREE,grouped),/覆盖/);
  });
  test('component, object, vertex and material budgets reject explicitly',()=>{
    assert.throws(()=>serializeModelingObject(THREE,mesh(),{...MODELING_PROGRAM_LIMITS,meshes:0}),/部件预算/);
    assert.throws(()=>serializeModelingObject(THREE,mesh(),{...MODELING_PROGRAM_LIMITS,objects:0}),/对象数量/);
    assert.throws(()=>serializeModelingObject(THREE,mesh(),{...MODELING_PROGRAM_LIMITS,vertices:3}),/总顶点/);
    assert.throws(()=>serializeModelingObject(THREE,mesh(),{...MODELING_PROGRAM_LIMITS,materials:0}),/材质预算/);
  });
  test('641 separate named meshes are not collapsed or blocked by the former 512-node limit',()=>{
    const root=new THREE.Group(),geometry=new THREE.BoxGeometry(.01,.01,.01),shared=material();root.name='Repeated mechanical parts';
    for(let i=0;i<641;i++){const part=new THREE.Mesh(geometry,shared);part.name='Mechanical part';part.position.x=i*.01;root.add(part);}
    const result=serializeModelingObject(THREE,root);assert.equal(result.nodes.length,641);assert.equal(new Set(result.nodes.map(n=>n.id)).size,641);assert.deepEqual(validateDocument(result),[]);
  });
  console.log(`${passed} modeling program converter checks passed`);
}finally{await server.close();}
