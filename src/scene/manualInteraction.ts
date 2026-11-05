import * as THREE from 'three';
import {buildPrimitiveGeometry} from './geometry';
import {assemblyBounds} from '../domain/assemblyEditing';
import {snapCoordinate} from '../domain/manualComposition';
import type {SceneNode,Vec3} from '../domain/types';
import type {SelectionChange} from '../domain/selectionProperties';

export interface CompositionInteraction {
 mode:'move'|'rotate'|'scale'|'orbit';
 nodes:SceneNode[];
 placement:SceneNode[]|null;
 snapStep:number;
 onPlace:(point:Vec3)=>void;
 onTransform:(change:SelectionChange)=>void;
 onCancel:()=>void;
}
export function groundPointAt(canvas:HTMLCanvasElement,camera:THREE.Camera,x:number,y:number,step=0):Vec3|null{
 const rect=canvas.getBoundingClientRect();if(!rect.width||!rect.height)return null;
 camera.updateMatrixWorld();const ray=new THREE.Raycaster();ray.setFromCamera(new THREE.Vector2((x-rect.left)/rect.width*2-1,1-(y-rect.top)/rect.height*2),camera);
 if(Math.abs(ray.ray.direction.y)<1e-5)return null;
 const point=ray.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0,1,0),0),new THREE.Vector3());
 return point&&Math.abs(point.x)<=10000&&Math.abs(point.z)<=10000?[snapCoordinate(point.x,step),0,snapCoordinate(point.z,step)]:null;
}
/** Runtime previews never modify the document. Only pointer-up emits one transaction. */
export class ManualInteraction {
 private config:CompositionInteraction|null=null;
 private ghost:THREE.Group|null=null;
 private ghostGeometry:THREE.BufferGeometry[]=[];
 private ghostMaterial=new THREE.MeshBasicMaterial({color:'#39a8ff',transparent:true,opacity:.48,depthWrite:false});
 private handles:THREE.Group|null=null;
 private handleGeometry:THREE.BufferGeometry|null=null;
 private handleMaterial=new THREE.MeshBasicMaterial({color:0x1677ff,depthTest:false,depthWrite:false});
 private point:THREE.Vector3|null=null;
 private center=new THREE.Vector3();
 private pivot=new THREE.Vector3();
 private gesture:{id:number;x:number;y:number;start:THREE.Vector3|null;change:SelectionChange|null;placement:boolean}|null=null;
 constructor(private canvas:HTMLCanvasElement,private scene:THREE.Scene,private camera:THREE.Camera,private meshes:()=>Map<string,{mesh:THREE.Mesh}>,private dirty:()=>void){
  canvas.addEventListener('pointerdown',this.down,true);canvas.addEventListener('pointermove',this.move,true);canvas.addEventListener('pointerup',this.up,true);canvas.addEventListener('pointercancel',this.cancelPointer,true);canvas.addEventListener('lostpointercapture',this.cancelPointer,true);canvas.addEventListener('pointerleave',this.leave,true);window.addEventListener('keydown',this.key);
 }
 get placing(){return !!this.config?.placement;}
 set(config:CompositionInteraction|null){
  this.cancelGesture();this.clearGhost();this.clearHandles();this.config=config;this.point=null;
  if(config?.nodes.length){const bounds=assemblyBounds(config.nodes);bounds.getCenter(this.center);this.pivot.set(this.center.x,bounds.min.y,this.center.z);}
  if(config?.placement){this.ghost=new THREE.Group();this.ghost.name='__manualPlacementPreview';const geometries=new Map<string,THREE.BufferGeometry>();for(const node of config.placement){if(!node.geometry||!node.visible)continue;const key=JSON.stringify(node.geometry);let geometry=geometries.get(key);if(!geometry){geometry=buildPrimitiveGeometry(node.geometry);geometries.set(key,geometry);this.ghostGeometry.push(geometry);}const mesh=new THREE.Mesh(geometry,this.ghostMaterial);mesh.position.fromArray(node.transform.position);mesh.quaternion.fromArray(node.transform.rotationQuaternion);mesh.scale.fromArray(node.transform.scale);this.ghost.add(mesh);}this.ghost.visible=false;this.scene.add(this.ghost);}
  if(config&&config.mode!=='orbit'&&config.nodes.length&&!config.placement){
   const bounds=assemblyBounds(config.nodes),size=bounds.getSize(new THREE.Vector3());
   const radius=Math.max(size.length()*.12,this.camera.position.distanceTo(this.center)*.018,.001);
   this.handles=new THREE.Group();this.handles.name='__manualTransformHandle';
   this.handles.position.set(this.center.x,bounds.max.y+radius*1.5,this.center.z);
   this.handleGeometry=config.mode==='rotate'?new THREE.TorusGeometry(radius,.18*radius,8,48):config.mode==='scale'?new THREE.BoxGeometry(radius*1.4,radius*1.4,radius*1.4):new THREE.OctahedronGeometry(radius);
   const handle=new THREE.Mesh(this.handleGeometry,this.handleMaterial);handle.name=config.mode;handle.renderOrder=10000;
   if(config.mode==='rotate')handle.rotation.x=Math.PI/2;
   this.handles.add(handle);this.scene.add(this.handles);
  }
  this.canvas.style.cursor=config?.placement?'crosshair':'';this.dirty();
 }
 private ray(x:number,y:number){const r=this.canvas.getBoundingClientRect();if(!r.width||!r.height)return null;this.camera.updateMatrixWorld();const ray=new THREE.Raycaster();ray.setFromCamera(new THREE.Vector2((x-r.left)/r.width*2-1,1-(y-r.top)/r.height*2),this.camera);return ray;}
 private ground(x:number,y:number){const ray=this.ray(x,y);if(!ray||Math.abs(ray.ray.direction.y)<1e-5)return null;const p=ray.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0,1,0),0),new THREE.Vector3());return p&&Math.abs(p.x)<=10000&&Math.abs(p.z)<=10000?p:null;}
 private stop(e:PointerEvent){e.preventDefault();e.stopImmediatePropagation();}
 private down=(e:PointerEvent)=>{
  const c=this.config;if(!c||e.button!==0||e.isPrimary===false||this.gesture||(!c.placement&&(e.shiftKey||e.ctrlKey||e.metaKey)))return;
  if(c.placement){this.updateGhost(e);this.gesture={id:e.pointerId,x:e.clientX,y:e.clientY,start:null,change:null,placement:true};}
  else{if(c.mode==='orbit'||!c.nodes.length)return;const ray=this.ray(e.clientX,e.clientY);if(!ray)return;this.scene.updateMatrixWorld(true);
   const handleHit=this.handles&&ray.intersectObjects(this.handles.children,false).length>0;
   if(!handleHit){
    const selectedIds=new Set(c.nodes.map(node=>node.id)),targets:THREE.Mesh[]=[];
    for(const {mesh} of this.meshes().values())if(mesh.visible&&selectedIds.has(mesh.userData.nodeId))targets.push(mesh);
    if(!ray.intersectObjects(targets,false).length)return;
   }
   const start=this.ground(e.clientX,e.clientY);if(c.mode==='move'&&!start)return;this.gesture={id:e.pointerId,x:e.clientX,y:e.clientY,start,change:null,placement:false};
  }this.stop(e);this.canvas.setPointerCapture?.(e.pointerId);
 };
 previewPlacementAt(clientX:number,clientY:number){this.updateGhost({clientX,clientY});return this.point?.toArray() as Vec3|undefined;}
 private updateGhost(e:Pick<PointerEvent,'clientX'|'clientY'>){if(!this.ghost||!this.config)return;this.point=this.ground(e.clientX,e.clientY);this.ghost.visible=!!this.point;if(this.point){this.point.x=snapCoordinate(this.point.x,this.config.snapStep);this.point.z=snapCoordinate(this.point.z,this.config.snapStep);this.ghost.position.copy(this.point);}this.dirty();}
 private move=(e:PointerEvent)=>{
  const c=this.config;if(!c)return;if(c.placement)this.updateGhost(e);
  const g=this.gesture;if(!g||g.id!==e.pointerId)return;this.stop(e);if(g.placement)return;
  if(Math.abs(e.clientX-g.x)+Math.abs(e.clientY-g.y)<3&&!g.change)return;
  let nodes:SceneNode[];
  if(c.mode==='scale'){const factor=Math.min(1000,Math.max(.001,Math.exp((e.clientX-g.x)*.01)));g.change={kind:'size',value:factor};nodes=c.nodes.map(n=>({...n,transform:{...n.transform,position:new THREE.Vector3(...n.transform.position).sub(this.pivot).multiplyScalar(factor).add(this.pivot).toArray() as Vec3,scale:n.transform.scale.map(v=>v*factor) as Vec3}}));}
  else if(c.mode==='rotate'){const yaw=snapCoordinate((e.clientX-g.x)*.5,c.snapStep>0?15:0);g.change={kind:'rotation',value:[0,yaw,0]};const q=new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0,1,0),yaw*Math.PI/180);nodes=c.nodes.map(n=>({...n,transform:{...n.transform,position:new THREE.Vector3(...n.transform.position).sub(this.pivot).applyQuaternion(q).add(this.pivot).toArray() as Vec3,rotationQuaternion:new THREE.Quaternion(...n.transform.rotationQuaternion).premultiply(q).normalize().toArray() as [number,number,number,number]}}));}
  else{const point=this.ground(e.clientX,e.clientY);if(!point||!g.start)return;const center=this.center;const dx=snapCoordinate(center.x+point.x-g.start.x,c.snapStep)-center.x,dz=snapCoordinate(center.z+point.z-g.start.z,c.snapStep)-center.z;g.change={kind:'position',value:[dx,0,dz]};nodes=c.nodes.map(n=>({...n,transform:{...n.transform,position:[n.transform.position[0]+dx,n.transform.position[1],n.transform.position[2]+dz]}}));}
  for(const n of nodes){const mesh=this.meshes().get(n.id)?.mesh;if(mesh){mesh.position.fromArray(n.transform.position);mesh.quaternion.fromArray(n.transform.rotationQuaternion);mesh.scale.fromArray(n.transform.scale);mesh.updateMatrixWorld();}}
  this.dirty();
 };
 private up=(e:PointerEvent)=>{const g=this.gesture,c=this.config;if(!g||!c||g.id!==e.pointerId)return;this.stop(e);const point=this.point?.toArray() as Vec3|undefined,change=g.change,click=Math.abs(e.clientX-g.x)+Math.abs(e.clientY-g.y)<5;this.cancelGesture();if(g.placement){if(click&&point)c.onPlace(point);}else if(change)c.onTransform(change);};
 cancel(){this.cancelGesture();}
 private restore(){for(const n of this.config?.nodes??[]){const mesh=this.meshes().get(n.id)?.mesh;if(mesh){mesh.position.fromArray(n.transform.position);mesh.quaternion.fromArray(n.transform.rotationQuaternion);mesh.scale.fromArray(n.transform.scale);mesh.updateMatrixWorld();}}this.dirty();}
 private cancelGesture(){const g=this.gesture;this.gesture=null;if(g&&!g.placement)this.restore();if(g&&this.canvas.hasPointerCapture?.(g.id))this.canvas.releasePointerCapture(g.id);}
 private cancelPointer=()=>this.cancelGesture();
 private leave=()=>{if(!this.gesture&&this.ghost){this.ghost.visible=false;this.point=null;this.dirty();}};
 private key=(e:KeyboardEvent)=>{if(e.key!=='Escape')return;if(this.gesture||this.config?.placement){e.preventDefault();this.cancelGesture();if(this.config?.placement)this.config.onCancel();}};
 private clearHandles(){if(this.handles)this.scene.remove(this.handles);this.handles=null;this.handleGeometry?.dispose();this.handleGeometry=null;}
 private clearGhost(){if(this.ghost)this.scene.remove(this.ghost);this.ghost=null;this.ghostGeometry.forEach(g=>g.dispose());this.ghostGeometry=[];}
 dispose(){this.cancelGesture();this.clearGhost();this.clearHandles();this.handleMaterial.dispose();this.ghostMaterial.dispose();this.canvas.removeEventListener('pointerdown',this.down,true);this.canvas.removeEventListener('pointermove',this.move,true);this.canvas.removeEventListener('pointerup',this.up,true);this.canvas.removeEventListener('pointercancel',this.cancelPointer,true);this.canvas.removeEventListener('lostpointercapture',this.cancelPointer,true);this.canvas.removeEventListener('pointerleave',this.leave,true);window.removeEventListener('keydown',this.key);}
}
