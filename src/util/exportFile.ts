import {isTauri,invoke} from '@tauri-apps/api/core';

export type ExportKind='html'|'glb'|'json'|'zip';
export type ExportContents=string|ArrayBuffer;
export type ExportContentsFactory=()=>Promise<ExportContents>;

/** Native cancellation skips generation; browser downloads are not verified writes. */
export async function exportFile(contents:ExportContents|ExportContentsFactory,kind:ExportKind,filename:string):Promise<string|null>{
 if(isTauri()){
  const token=await invoke<string|null>('select_export_destination',{kind,filename});
  if(token===null)return null;
  try{
   const value=typeof contents==='function'?await contents():contents;
   const body=typeof value==='string'?new TextEncoder().encode(value):value;
   const path=await invoke<string>('commit_export_file',body,{headers:{'x-export-token':token}});
   return '已保存到：'+path;
  }catch(error){
   // Release even when generation or IPC fails, without hiding the original error.
   try{await invoke('cancel_export_destination',{token});}catch{/* Native tokens also expire. */}
   throw error;
  }
 }
 const value=typeof contents==='function'?await contents():contents;
 const type={html:'text/html;charset=utf-8',glb:'model/gltf-binary',json:'application/json',zip:'application/zip'}[kind];
 const url=URL.createObjectURL(new Blob([value],{type}));
 const link=document.createElement('a');
 try{link.href=url;link.download=filename;document.body.appendChild(link);link.click();return '已发起下载，请检查浏览器下载';}
 finally{link.remove();window.setTimeout(()=>URL.revokeObjectURL(url),1000);}
}
