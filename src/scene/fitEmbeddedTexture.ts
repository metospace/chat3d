import {decode as decodeJpeg,encode as encodeJpeg} from 'jpeg-js';
import {decode as decodePng,encode as encodePng,convertIndexedToRgb} from 'fast-png';
import {MAX_TEXTURE_EDGE,MAX_TEXTURE_BYTES,MAX_TEXTURE_SOURCE_BYTES,readEmbeddedTexture,validateImageDataUrl} from '../domain/textures';

function dataUrl(bytes:Uint8Array,mime:string){let text='';for(let i=0;i<bytes.length;i+=32768)text+=String.fromCharCode(...bytes.subarray(i,i+32768));return `data:image/${mime};base64,${btoa(text)}`;}

/** Explicit opt-in import fitting; default imports preserve original image bytes. */
export async function fitEmbeddedTexture(value:string):Promise<string>{
 const source=readEmbeddedTexture(value,MAX_TEXTURE_SOURCE_BYTES);
 const scale=Math.min(1,MAX_TEXTURE_EDGE/Math.max(source.width,source.height));
 if(scale===1&&source.bytes.length<=MAX_TEXTURE_BYTES){validateImageDataUrl(value);return value;}
 const width=Math.max(1,Math.floor(source.width*scale)),height=Math.max(1,Math.floor(source.height*scale));
 // Sample directly into the fitted RGBA buffer, including packed/16-bit PNGs.
 let sample:(x:number,y:number,c:number)=>number;
 try{
  if(source.mime==='png'){
   const png=decodePng(source.bytes),indexed=png.palette?convertIndexedToRgb(png):undefined;
   const channels=indexed?png.palette![0].length:png.channels,data=indexed??png.data,depth=indexed?8:png.depth;
   const raw=(x:number,y:number,c:number)=>depth<8?((data[y*Math.ceil(png.width*channels*depth/8)+Math.floor((x*channels+c)*depth/8)]>>(8-depth-((x*channels+c)*depth%8)))&((1<<depth)-1)):data[(y*png.width+x)*channels+c];
   sample=(x,y,c)=>{const alpha=channels===2||channels===4;if(c===3&&!alpha){const transparent=png.transparency;if(transparent&&transparent.every((v,i)=>raw(x,y,i)===v))return 0;return 255;}const channel=c===3?channels-1:channels<=2?0:c;return Math.round(raw(x,y,channel)*255/((1<<depth)-1));};
  }else{
   const jpeg=decodeJpeg(source.bytes,{useTArray:true,formatAsRGBA:true});
   sample=(x,y,c)=>jpeg.data[(y*jpeg.width+x)*4+c];
  }
 }catch{throw Error('贴图图片解码失败，无法缩放或压缩');}
 const data=new Uint8Array(width*height*4);let opaque=true;
 for(let y=0;y<height;y++)for(let x=0;x<width;x++){
  const sx=Math.min(source.width-1,Math.floor((x+.5)*source.width/width)),sy=Math.min(source.height-1,Math.floor((y+.5)*source.height/height)),offset=(y*width+x)*4;
  for(let c=0;c<4;c++)data[offset+c]=sample(sx,sy,c);
  if(data[offset+3]!==255)opaque=false;
 }
 const png=encodePng({width,height,data,channels:4});
 if(png.length<=MAX_TEXTURE_BYTES){const fitted=dataUrl(png,'png');validateImageDataUrl(fitted);return fitted;}
 // JPEG cannot preserve alpha: never silently flatten transparent textures.
 if(opaque){
  let canvas:HTMLCanvasElement|undefined,context:CanvasRenderingContext2D|null=null;
  if(typeof document!=='undefined'){
   canvas=document.createElement('canvas');canvas.width=width;canvas.height=height;context=canvas.getContext('2d');
   if(!context)throw Error('贴图压缩失败：无法创建图片画布');
   context.putImageData(new ImageData(new Uint8ClampedArray(data.buffer),width,height),0,0);
  }
  for(const quality of [90,80,65,50,35,20,10]){
   const fitted=canvas?canvas.toDataURL('image/jpeg',quality/100):dataUrl(encodeJpeg({width,height,data},quality).data,'jpeg');
   if(readEmbeddedTexture(fitted,MAX_TEXTURE_SOURCE_BYTES).bytes.length<=MAX_TEXTURE_BYTES){validateImageDataUrl(fitted);return fitted;}
  }
 }
 throw Error('贴图压缩后仍无法降至16 MiB以内，请减少图片细节或透明通道后重试');
}
