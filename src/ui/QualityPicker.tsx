import {useEffect,useState} from 'react';
import {Button,Popover} from 'antd';
import {LightningBoltIcon,MagicWandIcon,ChevronDownIcon} from '@radix-ui/react-icons';
import {useEditorStore} from '../store';
import './realistic-modeling.css';
const active=new Set(['capturing','context','generating','validating','applying']);
export function QualityPicker({onConfigure,forNewProject=false,blenderModeling=false,onBlenderModelingChange}:{onConfigure?:()=>void;forNewProject?:boolean;blenderModeling?:boolean;onBlenderModelingChange?:(value:boolean)=>void}){
 const cfg=useEditorStore(s=>s.aiConfig),status=useEditorStore(s=>s.aiStatus);
 const locked=!forNewProject&&active.has(status);
 const [open,setOpen]=useState(false);useEffect(()=>{if(locked)setOpen(false);},[locked]);
 const quality=cfg?.generationQuality==='fast'?'fast':'fine',single=cfg?.agentMode==='single';
 const choose=(value:string)=>{const s=useEditorStore.getState();if(!forNewProject&&active.has(s.aiStatus))return;if(!s.aiConfig){onConfigure?.();return;}s.setAiConfig({...s.aiConfig,generationQuality:value==='fast'?'fast':'fine'});setOpen(false);};
 const chooseMethod=(blender:boolean)=>{if(!forNewProject&&active.has(useEditorStore.getState().aiStatus))return;onBlenderModelingChange?.(blender);setOpen(false);};
 // antd cannot emit menuitemradio roles, so the popup content carries the radio semantics itself.
 const options=[['fast','快速生成','快速','主体与关键结构优先，减少细节打磨'],['fine','精细生成','精细',blenderModeling?'更完整的形体、部件与材质要求':single?'更完整的建模要求；无多轮复核':'更充分的细节、视角检查与修正']] as const;
 return <Popover
  open={open}
  onOpenChange={next=>{if(locked)return;if(next&&!cfg){onConfigure?.();return;}setOpen(next)}}
  trigger={['click']}
  placement="topLeft"
  destroyOnHidden
  content={<div className="quality-picker-menu" role="menu" aria-label="生成档位" aria-hidden={locked||undefined}>
   <div role="group" aria-label="细节档位">
   <span className="generation-menu-heading" role="presentation">细节档位</span>
   {options.map(([value,aria,label,hint])=><div key={value} role="menuitemradio" aria-checked={quality===value} aria-label={aria} tabIndex={0} className="quality-picker-option" onClick={()=>choose(value)} onKeyDown={event=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();choose(value);}}}><div><strong>{label}</strong><small>{hint}</small></div></div>)}
   </div>
   <div className="generation-menu-divider" role="separator"/>
   <div role="group" aria-label="生成方式">
   <span className="generation-menu-heading" role="presentation">生成方式</span>
   {([[false,'直接生成','在工作台直接构建可编辑模型'],[true,'Blender 生成','本机 Blender 建模，结果回到工作台']] as const).map(([value,label,hint])=><div key={label} role="menuitemradio" aria-checked={blenderModeling===value} aria-label={label} tabIndex={0} className="quality-picker-option" onClick={()=>chooseMethod(value)} onKeyDown={event=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();chooseMethod(value);}}}><div><strong>{label}</strong><small>{hint}</small></div></div>)}
   </div>
   {blenderModeling&&<p className="generation-method-warning">将在本机自动执行 Python，仅用于可信输入。</p>}
  </div>}>
  <Button
   type="text"
   className="quality-picker-trigger"
   disabled={locked}
   aria-label={`生成档位，当前${quality==='fast'?'快速':'精细'}`}
   aria-description={`生成方式：${blenderModeling?'Blender 生成':'直接生成'}`}
   title={locked?'本轮生成档位已锁定':quality==='fast'?'快速：优先主体与关键结构':single?'单次兼容：精细建模要求（无多轮复核）':'精细：更充分的细节与多视角检查'}
   onKeyDown={event=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();event.currentTarget.click();}}}>
   {quality==='fast'?<LightningBoltIcon/>:<MagicWandIcon/>}<span>{quality==='fast'?'快速':'精细'} · {blenderModeling?'Blender 生成':'直接生成'}</span><ChevronDownIcon/>
  </Button>
 </Popover>;
}
