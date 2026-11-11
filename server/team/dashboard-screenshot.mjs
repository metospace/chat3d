import {inflateSync,deflateSync} from 'node:zlib';
import {createHash} from 'node:crypto';
import {fail} from './dashboard-files.mjs';

export const MAX_SCREENSHOT_BYTES=8*1024*1024;
const crcTable=Uint32Array.from({length:256},(_,index)=>{let value=index;for(let bit=0;bit<8;bit++)value=value&1?0xedb88320^(value>>>1):value>>>1;return value>>>0;});
function crc32(bytes){let crc=0xffffffff;for(const byte of bytes)crc=crcTable[(crc^byte)&255]^(crc>>>8);return (crc^0xffffffff)>>>0;}
function pngChunk(type,data){const chunk=Buffer.alloc(data.length+12);chunk.writeUInt32BE(data.length);chunk.write(type,4,'ascii');data.copy(chunk,8);chunk.writeUInt32BE(crc32(chunk.subarray(4,-4)),chunk.length-4);return chunk;}
/** Bounded PNG pixel decoding, using only built-in Node codecs available in the existing runtime. */
export function screenshotPng(base64){
 if(typeof base64!=='string'||!base64.length||base64.length>Math.ceil(MAX_SCREENSHOT_BYTES/3)*4||base64.length%4||!/^[A-Za-z0-9+/]*={0,2}$/.test(base64))fail(400,'截图必须为不超过 8 MiB 的 PNG');
 const input=Buffer.from(base64,'base64');
 if(input.length>MAX_SCREENSHOT_BYTES||input.toString('base64')!==base64||input.length<45||input.subarray(0,8).toString('hex')!=='89504e470d0a1a0a')fail(400,'只接受 PNG 截图，不接受 SVG、脚本或其他文件');
 const width=input.readUInt32BE(16),height=input.readUInt32BE(20),color=input[25],channels=({0:1,2:3,4:2,6:4})[color];
 if(width<320||height<180||width>7680||height>4320||width*height>16777216||input[24]!==8||!channels||input[26]!==0||input[27]!==0||input[28]!==0)fail(400,'截图须为 320×180 至 7680×4320、最多 1600 万像素的非交错 8 位 PNG');
 const compressed=[];let offset=8,ended=false,header=false,dataEnded=false;
 while(offset<input.length){
  if(offset+12>input.length)fail(400,'PNG 数据不完整');
  const length=input.readUInt32BE(offset),end=offset+12+length,type=input.toString('ascii',offset+4,offset+8);
  if(end>input.length||!/^[A-Za-z]{4}$/.test(type)||!header&&(type!=='IHDR'||length!==13)||header&&type==='IHDR'||['acTL','fcTL','fdAT','tRNS'].includes(type))fail(400,'PNG 结构无效或包含不支持的动画/透明色表');
  if(crc32(input.subarray(offset+4,end-4))!==input.readUInt32BE(end-4))fail(400,'PNG CRC 校验失败');
  if(type==='IHDR')header=true;
  else if(type==='IDAT'){if(dataEnded)fail(400,'PNG 像素块必须连续');compressed.push(input.subarray(offset+8,end-4));}
  else if(type==='IEND'){if(length||end!==input.length)fail(400,'PNG 尾部无效');ended=true;}
  else if(!/^[a-z]/.test(type))fail(400,'不支持的 PNG 关键数据块');
  if(compressed.length&&type!=='IDAT')dataEnded=true;
  offset=end;if(ended)break;
 }
 if(!ended||!compressed.length)fail(400,'PNG 数据不完整');
 try{
  const stride=width*channels,rowBytes=stride+1,expected=height*rowBytes,expanded=inflateSync(Buffer.concat(compressed),{maxOutputLength:expected});
  if(expanded.length!==expected)fail(400,'PNG 像素数据不完整');
  // Reconstruct each scanline in place, then emit canonical filter-zero rows. No metadata is retained.
  for(let y=0;y<height;y++){
   const row=y*rowBytes,filter=expanded[row];if(filter>4)fail(400,'PNG 像素过滤器无效');
   for(let x=0;x<stride;x++){
    const position=row+1+x,left=x>=channels?expanded[position-channels]:0,up=y?expanded[position-rowBytes]:0,upperLeft=y&&x>=channels?expanded[position-rowBytes-channels]:0;
    let predictor=0;
    if(filter===1)predictor=left;
    else if(filter===2)predictor=up;
    else if(filter===3)predictor=(left+up)>>>1;
    else if(filter===4){const p=left+up-upperLeft,a=Math.abs(p-left),b=Math.abs(p-up),c=Math.abs(p-upperLeft);predictor=a<=b&&a<=c?left:b<=c?up:upperLeft;}
    expanded[position]=(expanded[position]+predictor)&255;
   }
   expanded[row]=0;
  }
  const bytes=Buffer.concat([input.subarray(0,8),pngChunk('IHDR',input.subarray(16,29)),pngChunk('IDAT',deflateSync(expanded)),pngChunk('IEND',Buffer.alloc(0))]);
  if(bytes.length>MAX_SCREENSHOT_BYTES)fail(400,'净化后的截图超过 8 MiB');
  return {bytes,width,height,sha256:createHash('sha256').update(bytes).digest('hex')};
 }catch(error){if(error.status)throw error;fail(400,'PNG 无法完整解码');}
}
