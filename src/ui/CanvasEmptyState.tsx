import {useEffect,useState} from 'react';
import {Button} from 'antd';
import {CubeIcon,ChatBubbleIcon,UploadIcon,ArrowRightIcon} from '@radix-ui/react-icons';
import {useEditorStore} from '../store';
import {activityProgress} from '../domain/customerProgress';
import './canvas-empty-state.css';

type Props={busy:boolean;asset:boolean;onConversation:()=>void;onAssets:()=>void;onImport:()=>void;onTask:()=>void};
export function CanvasEmptyState({busy,asset,onConversation,onAssets,onImport,onTask}:Props){
 const activity=useEditorStore(s=>s.lastRun);
 const [now,setNow]=useState(Date.now());
 useEffect(()=>{if(!busy)return;const timer=setInterval(()=>setNow(Date.now()),1000);return()=>clearInterval(timer);},[busy]);
 const progress=activityProgress(activity,busy,now);
 const title=busy?(activity?.phase==='building'||activity?.phase==='repairing'?'正在构建首个模型':'正在准备你的模型'):asset?'让想法变成三维模型':'从这里搭建三维场景';
 return <div className={`canvas-empty-state ${busy?'is-generating':''}`}>
  <section className="canvas-empty-content" aria-label={busy?'首个模型生成进度':'空画布'}>
   <div className="canvas-empty-illustration" aria-hidden="true"><span className="canvas-empty-orbit"/><span className="canvas-empty-cube"><CubeIcon/></span></div>
   <span className="canvas-empty-eyebrow">{busy?'AI 建模进行中':'三维创作空间'}</span>
   <h2>{title}</h2>
   <p>{busy?'首批模型返回后会自动显示在这里。你可以在 AI 助手中继续补充要求。':'描述你想创建的模型，或导入已有资源开始编辑。'}</p>
   {busy?<>
    <div className="canvas-empty-live" role="status"><span className="canvas-empty-live-dot"/>{progress.phase||progress.modelState?progress.label:'正在准备建模请求'}</div>
    <div className="canvas-empty-actions"><Button type="primary" onClick={onTask}>查看任务进度 <ArrowRightIcon/></Button><Button type="text" onClick={onConversation}>补充要求</Button></div>
    <small>模型尚未返回 · 当前画布为空，并非加载失败</small>
   </>:<>
    <div className="canvas-empty-actions"><Button type="primary" onClick={onConversation} icon={<ChatBubbleIcon/>}>描述想法</Button><Button onClick={onImport} icon={<UploadIcon/>}>导入 GLB</Button></div>
    <Button className="canvas-empty-library" type="link" onClick={onAssets}>从本地资产开始 <ArrowRightIcon/></Button>
   </>}
  </section>
 </div>;
}
