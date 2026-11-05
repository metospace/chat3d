import {useEffect,useState} from 'react';
import './blender-result.css';

const files=[['blend','.blend'],['glb','.glb'],['render','.png']] as const;

type Result={name:string;blend:Blob;glb:Blob;render:Blob};

export function BlenderResult({result}:{result:Result}){
  const [links,setLinks]=useState<{result:Result;urls:Record<(typeof files)[number][0],string>}|null>(null);
  useEffect(()=>{
    const urls={blend:URL.createObjectURL(result.blend),glb:URL.createObjectURL(result.glb),render:URL.createObjectURL(result.render)};
    setLinks({result,urls});
    return()=>{for(const url of Object.values(urls))URL.revokeObjectURL(url);};
  },[result]);
  const urls=links?.result===result?links.urls:null;
  const filename=result.name.replace(/\.(blend|glb|png)$/i,'').replace(/[\\/:*?"<>|\u0000-\u001f]/g,'_').trim()||'blender-model';
  return <section className="adx-blender-result" aria-label="最新 Blender 建模结果">
    <strong>最新 Blender 建模结果 · {result.name}</strong>
    <p>若主工作台中有可编辑预览，请应用后继续编辑；下方原始文件与渲染仅供辅助参考。</p>
    <details className="adx-blender-auxiliary" key={urls?.blend??'loading'}>
      <summary>原始文件与 Blender 渲染</summary>
      <div className="adx-blender-actions">
        {urls&&files.map(([key,ext])=><a key={key} href={urls[key]} download={filename+ext}>下载 {ext}</a>)}
      </div>
      {urls&&<img className="adx-blender-render" src={urls.render} alt="Blender 原始渲染（辅助参考）" loading="lazy"/>}
      <p>原始文件仅在当前会话中保留。</p>
    </details>
  </section>;
}
