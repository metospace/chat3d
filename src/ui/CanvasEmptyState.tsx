import {Button} from 'antd';
import {CubeIcon,ChatBubbleIcon,UploadIcon,ArrowRightIcon} from '@radix-ui/react-icons';
import './canvas-empty-state.css';

type Props={busy:boolean;asset:boolean;onConversation:()=>void;onAssets:()=>void;onImport:()=>void;onTask:()=>void};
export function CanvasEmptyState({busy,asset,onConversation,onAssets,onImport,onTask}:Props){
 return <div className={`canvas-empty-state ${busy?'is-generating':''}`}>
  <section className="canvas-empty-content" aria-label={busy?'首个模型生成进度':'空画布'}>
   <div className="canvas-empty-illustration" aria-hidden="true"><span className="canvas-empty-orbit"/><span className="canvas-empty-cube"><CubeIcon/></span></div>
   <span className="canvas-empty-eyebrow">{busy?'AI 建模进行中':'三维创作空间'}</span>
   <h2>{busy?'模型生成进行中':asset?'让想法变成三维模型':'从这里搭建三维场景'}</h2>
   <p>{busy?'生成结果会载入工作台；具体进度和执行控制在 AI 助手中。':'描述你想创建的模型，或导入已有资源开始编辑。'}</p>
   {busy?<>
    <div className="canvas-empty-actions"><Button type="primary" onClick={onTask}>查看任务进度 <ArrowRightIcon/></Button><Button type="text" onClick={onConversation}>补充要求</Button></div>
    <small>模型尚未返回 · 当前画布为空，并非加载失败</small>
   </>:<>
    <div className="canvas-empty-actions"><Button type="primary" onClick={onConversation} icon={<ChatBubbleIcon/>}>描述想法</Button><Button onClick={onImport} icon={<UploadIcon/>}>导入 GLB</Button></div>
    <Button className="canvas-empty-library" type="link" onClick={onAssets}>从本地资产开始 <ArrowRightIcon/></Button>
   </>}
  </section>
 </div>;
}
