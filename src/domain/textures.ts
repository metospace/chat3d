export const MAX_TEXTURE_EDGE=4096;
export const MAX_TEXTURE_BYTES=2*1024*1024;
export const MAX_TEXTURE_SOURCE_BYTES=16*1024*1024;
export const SURFACE_PRESETS=['brushed_metal','powder_coat','rubber','fabric','wood','concrete'] as const;
export interface SurfaceDetail {preset:typeof SURFACE_PRESETS[number];repeat:[number,number];strength:number}
export interface TextureMap {dataUrl:string;repeat?:[number,number];offset?:[number,number];rotation?:number;wrapS?:'repeat'|'clamp'|'mirror';wrapT?:'repeat'|'clamp'|'mirror'}
export type TextureMaps=Partial<Record<'baseColor'|'normal'|'roughness'|'metalness'|'emissive'|'occlusion',TextureMap>>;
export function readEmbeddedTexture(value:string,maxBytes:number){
 if(typeof value!=='string'||value.length>Math.max(3*1024*1024,Math.ceil(maxBytes/3)*4+32))throw Error(`单张贴图需不超过${maxBytes/1024/1024}MB`);const m=/^data:image\/(png|jpeg);base64,([A-Za-z0-9+/]+={0,2})$/.exec(value);if(!m)throw Error('贴图仅接受内嵌PNG/JPEG，不能引用网址或SVG');let bytes:Uint8Array;try{bytes=Uint8Array.from(atob(m[2]),c=>c.charCodeAt(0));}catch{throw Error('贴图Base64无效');}if(bytes.length>maxBytes)throw Error(`单张贴图需不超过${maxBytes/1024/1024}MB`);let w=0,h=0;
 if(m[1]==='png'){if(bytes.length<33||[137,80,78,71,13,10,26,10].some((v,i)=>bytes[i]!==v))throw Error('PNG头无效');const view=new DataView(bytes.buffer);w=view.getUint32(16);h=view.getUint32(20);}
 else{if(bytes[0]!==255||bytes[1]!==216)throw Error('JPEG头无效');let i=2;while(i+8<bytes.length){if(bytes[i++]!==255)continue;let marker=bytes[i++];while(marker===255)marker=bytes[i++];if(marker===217||marker===218)break;if(marker>=208&&marker<=215)continue;const len=(bytes[i]<<8)|bytes[i+1];if(len<2||i+len>bytes.length)break;if([192,193,194,195,197,198,199,201,202,203,205,206,207].includes(marker)){h=(bytes[i+3]<<8)|bytes[i+4];w=(bytes[i+5]<<8)|bytes[i+6];break;}i+=len;}}
 if(w<1||h<1)throw Error(`贴图像素必须在1–${MAX_TEXTURE_EDGE}范围`);return {width:w,height:h,bytes,mime:m[1] as 'png'|'jpeg'};
}
export function validateImageDataUrl(value:string){
 const image=readEmbeddedTexture(value,MAX_TEXTURE_BYTES);
 if(image.width>MAX_TEXTURE_EDGE||image.height>MAX_TEXTURE_EDGE)throw Error(`贴图像素必须在1–${MAX_TEXTURE_EDGE}范围`);
 return {width:image.width,height:image.height,bytes:image.bytes.length};
}
export function validateTextureMaps(maps:TextureMaps):string[]{const errors:string[]=[];if(!maps||typeof maps!=='object'||Array.isArray(maps))return ['贴图配置无效'];for(const [key,t] of Object.entries(maps)){if(!['baseColor','normal','roughness','metalness','emissive','occlusion'].includes(key)||!t){errors.push('贴图类型无效');continue;}try{validateImageDataUrl(t.dataUrl);}catch(e){errors.push((e as Error).message);}for(const p of ['repeat','offset'] as const)if(t[p]!==undefined&&(!Array.isArray(t[p])||t[p]!.length!==2||t[p]!.some(v=>!Number.isFinite(v)||Math.abs(v)>100)))errors.push('贴图UV变换无效');if(t.rotation!==undefined&&!Number.isFinite(t.rotation))errors.push('贴图旋转无效');for(const p of ['wrapS','wrapT'] as const)if(t[p]!==undefined&&!['repeat','clamp','mirror'].includes(t[p]!))errors.push('贴图包裹方式无效');}return errors;}
export function validateSurface(s:SurfaceDetail):boolean{return !!s&&SURFACE_PRESETS.includes(s.preset)&&Array.isArray(s.repeat)&&s.repeat.length===2&&s.repeat.every(v=>Number.isFinite(v)&&v>0&&v<=100)&&Number.isFinite(s.strength)&&s.strength>=0&&s.strength<=1;}
