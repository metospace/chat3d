import * as THREE from 'three';
import type {SurfaceDetail,TextureMap} from '../domain/textures';
import {validateImageDataUrl} from '../domain/textures';
export const materialReady=new WeakMap<THREE.Material,Promise<void>>();
const pixelCache=new Map<string,{normal:Uint8Array;rough:Uint8Array}>();
export function proceduralMaps(surface:SurfaceDetail){
 const N=128,tau=Math.PI*2;
 let pixels=pixelCache.get(surface.preset);
 if(!pixels){
  const normal=new Uint8Array(N*N*4),rough=new Uint8Array(N*N*4);
  const noise=(x:number,y:number)=>{x=(x%N+N)%N;y=(y%N+N)%N;const value=Math.sin(x*12.9898+y*78.233)*43758.5453;return value-Math.floor(value);};
  const height=(x:number,y:number)=>{const n=noise(x,y)-.5;switch(surface.preset){
   case 'brushed_metal':return .2*Math.sin(tau*y/8)+n*.025;
   case 'fabric':return .16*(Math.sin(tau*x/8)+Math.sin(tau*y/8))+n*.025;
   case 'wood':return .2*Math.sin(tau*y/32+1.4*Math.sin(tau*x/N))+n*.035;
   case 'rubber':return n*.10;
   case 'powder_coat':return n*.07;
   default:return n*.18;
  }};
  for(let y=0;y<N;y++)for(let x=0;x<N;x++){
   const i=(y*N+x)*4,dx=(height(x+1,y)-height(x-1,y))*.5,dy=(height(x,y+1)-height(x,y-1))*.5;
   const length=Math.hypot(dx,dy,1);
   normal.set([Math.round(127.5-dx/length*127.5),Math.round(127.5-dy/length*127.5),Math.round(127.5+127.5/length),255],i);
   // A roughness map multiplies the authored factor. Keep it near neutral
   // instead of making every preset substantially smoother and shinier.
   const r=Math.round(235+noise(x,y)*20);rough.set([r,r,r,255],i);
  }
  pixels={normal,rough};pixelCache.set(surface.preset,pixels);
 }
 const make=(data:Uint8Array)=>{const texture=new THREE.DataTexture(data,N,N,THREE.RGBAFormat);texture.wrapS=texture.wrapT=THREE.RepeatWrapping;texture.repeat.set(...surface.repeat);texture.magFilter=THREE.LinearFilter;texture.minFilter=THREE.LinearMipmapLinearFilter;texture.generateMipmaps=true;texture.needsUpdate=true;return texture;};
 return {normal:make(pixels.normal),rough:make(pixels.rough)};
}
const images=new Map<string,Promise<HTMLImageElement>>();
export function embeddedTexture(t:TextureMap,color:boolean){validateImageDataUrl(t.dataUrl);const texture=new THREE.Texture();texture.colorSpace=color?THREE.SRGBColorSpace:THREE.NoColorSpace;const wrap={repeat:THREE.RepeatWrapping,clamp:THREE.ClampToEdgeWrapping,mirror:THREE.MirroredRepeatWrapping};texture.wrapS=wrap[t.wrapS??'repeat'];texture.wrapT=wrap[t.wrapT??'repeat'];texture.repeat.set(...(t.repeat??[1,1]));texture.offset.set(...(t.offset??[0,0]));texture.rotation=t.rotation??0;texture.flipY=false;
 let promise=images.get(t.dataUrl);
 if(!promise){
  if(typeof Image==='undefined')promise=Promise.reject(Error('当前环境无法解码图片贴图'));
  else{const image=new Image();image.src=t.dataUrl;promise=image.decode().then(()=>image,()=>{throw Error('贴图图片解码失败');});}
  images.set(t.dataUrl,promise);if(images.size>32)images.delete(images.keys().next().value!);
 }
 const ready=promise.then(image=>{texture.image=image;texture.needsUpdate=true;});return {texture,ready};
}
export function disposeMaterialTextures(m:THREE.Material){const material=m as THREE.MeshStandardMaterial;for(const key of ['map','normalMap','roughnessMap','metalnessMap','emissiveMap','aoMap'] as const)material[key]?.dispose();m.dispose();}
