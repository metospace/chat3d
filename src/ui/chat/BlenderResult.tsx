import {useEffect,useState} from 'react';
import type {BlenderResult as Result} from '../../scene/blenderModeling';
import './blender-result.css';

const files=[['blend','.blend'],['glb','.glb'],['render','.png']] as const;

export function BlenderResult({result}:{result:Result}){
  const [links,setLinks]=useState<{result:Result;urls:Record<(typeof files)[number][0],string>}|null>(null);
  useEffect(()=>{
    const urls={blend:URL.createObjectURL(result.blend),glb:URL.createObjectURL(result.glb),render:URL.createObjectURL(result.render)};
    setLinks({result,urls});
    return()=>{for(const url of Object.values(urls))URL.revokeObjectURL(url);};
  },[result]);
  const urls=links?.result===result?links.urls:null;
  const filename=result.name.replace(/\.(blend|glb|png)$/i,'').replace(/[\\/:*?"<>|\u0000-\u001f]/g,'_').trim()||'blender-model';
  const review=result.review;
  const status=!review||review.status==='pending'?'待视觉复核':review.status==='issues'?'存在已知问题':'已完成视觉复核';
  return <section className="adx-blender-result" aria-label="最新 Blender 建模结果">
    <strong>最新 Blender 建模结果 · {result.name}</strong>
    <p role="status">{status}{review?` · ${review.version}`:''}</p>
    <p>视觉复核仅表示查看 Blender 渲染，不代表工程验收或工作台导入质量验收；工作台预览仍需确认后应用。</p>
    {review?.observations&&<p>{review.observations}</p>}
    {!!review?.issues.length&&<ul aria-label="Blender 已知问题">{review.issues.map((issue,index)=><li key={index}>{issue}</li>)}</ul>}
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
