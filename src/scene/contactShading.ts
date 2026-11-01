import {HalfFloatType,Mesh,Object3D,WebGLRenderTarget,type Camera,type Material,type MeshPhysicalMaterial,type Scene,type WebGLRenderer} from 'three';
import {EffectComposer} from 'three/examples/jsm/postprocessing/EffectComposer.js';
import {RenderPass} from 'three/examples/jsm/postprocessing/RenderPass.js';
import {GTAOPass} from 'three/examples/jsm/postprocessing/GTAOPass.js';
import {OutputPass} from 'three/examples/jsm/postprocessing/OutputPass.js';

export function excludeFromContactShadows(object:Object3D):boolean{
 if(object.userData.noAO||object.name==='__manualPlacementPreview')return true;
 if(!(object instanceof Mesh))return false;
 const materials:Material[]=Array.isArray(object.material)?object.material:[object.material];
 return materials.some(m=>m.transparent||m.opacity<.999||(m as MeshPhysicalMaterial).transmission>0);
}
export class ContactPass extends GTAOPass{
 override render(renderer:WebGLRenderer,writeBuffer:WebGLRenderTarget,readBuffer:WebGLRenderTarget,deltaTime=0,maskActive=false):void{
  // RenderPass already captured full colour. Hide transparent surfaces only in
  // AO's geometry pass so glass never becomes an opaque occluding plate.
  const visibility=new Map<Object3D,boolean>(),override=this.scene.overrideMaterial;
  this.scene.traverse(object=>{visibility.set(object,object.visible);if(excludeFromContactShadows(object))object.visible=false;});
  try{super.render(renderer,writeBuffer,readBuffer,deltaTime,maskActive);}finally{
   visibility.forEach((visible,object)=>{object.visible=visible;});this.scene.overrideMaterial=override;
  }
 }
}
/** Optional half-resolution AO, kept out of the editable scene and exported
 * material data. OutputPass applies tone mapping and sRGB exactly once. */
export class ContactShading{
 private composer:EffectComposer;private ao:ContactPass;private output:OutputPass;private scenePass:RenderPass;
 private sizeKey='';
 private radius=.1;
 constructor(renderer:WebGLRenderer,scene:Scene,camera:Camera){
  const target=new WebGLRenderTarget(1,1,{type:HalfFloatType,samples:Math.min(4,renderer.capabilities.maxSamples)});
  this.composer=new EffectComposer(renderer,target);this.scenePass=new RenderPass(scene,camera);
  this.ao=new ContactPass(scene,camera);this.ao.blendIntensity=.45;
  this.ao.updateGtaoMaterial({radius:.1,thickness:.03,distanceFallOff:1,samples:8});
  this.output=new OutputPass();this.composer.addPass(this.scenePass);this.composer.addPass(this.ao);this.composer.addPass(this.output);
 }
 setSize(width:number,height:number,pixelRatio:number){
  const key=[width,height,pixelRatio].join(':');if(key===this.sizeKey)return;this.sizeKey=key;
  this.composer.setPixelRatio(pixelRatio);this.composer.setSize(width,height);
  this.ao.setSize(Math.max(1,Math.ceil(width*pixelRatio*.5)),Math.max(1,Math.ceil(height*pixelRatio*.5)));
 }
 setSceneScale(size:number){
  const radius=Math.min(.25,Math.max(.001,size*.035));if(radius===this.radius)return;this.radius=radius;
  this.ao.updateGtaoMaterial({radius,thickness:radius*.3});
 }
 render(){this.composer.render(0);}
 dispose(){
  this.ao.dispose();this.ao.gtaoMaterial.dispose();this.ao.blendMaterial.dispose();
  this.scenePass.dispose();this.output.dispose();this.composer.dispose();
 }
}
