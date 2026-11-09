import {useEffect,useState} from 'react';
import {Button,Popover} from 'antd';
import {MagicWandIcon,ChevronDownIcon} from '@radix-ui/react-icons';
import {useEditorStore} from '../store';
import './realistic-modeling.css';
const active=new Set(['capturing','context','generating','validating','applying']);
export function GenerationMethodPicker({onConfigure,forNewProject=false,blenderModeling=false,onBlenderModelingChange}:{onConfigure?:()=>void;forNewProject?:boolean;blenderModeling?:boolean;onBlenderModelingChange?:(value:boolean)=>void}){
 const cfg=useEditorStore(s=>s.aiConfig),status=useEditorStore(s=>s.aiStatus);
 const locked=!forNewProject&&active.has(status);
 const [open,setOpen]=useState(false);useEffect(()=>{if(locked)setOpen(false);},[locked]);
 const chooseMethod=(blender:boolean)=>{if(!forNewProject&&active.has(useEditorStore.getState().aiStatus))return;onBlenderModelingChange?.(blender);setOpen(false);};
 // antd cannot emit menuitemradio roles, so the popup content carries the radio semantics itself.
 return <Popover
  open={open}
  onOpenChange={next=>{if(locked)return;if(next&&!cfg){onConfigure?.();return;}setOpen(next)}}
  trigger={['click']}
  placement="topLeft"
  destroyOnHidden
  content={<div className="generation-method-picker-menu" role="menu" aria-label="生成方式" aria-hidden={locked||undefined}>
   <div role="group" aria-label="生成方式">
   <span className="generation-menu-heading" role="presentation">生成方式</span>
   {([[false,'直接生成','在工作台直接构建可编辑模型'],[true,'Blender 生成','本机 Blender 建模，结果回到工作台']] as const).map(([value,label,hint])=><div key={label} role="menuitemradio" aria-checked={blenderModeling===value} aria-label={label} tabIndex={0} className="generation-method-picker-option" onClick={()=>chooseMethod(value)} onKeyDown={event=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();chooseMethod(value);}}}><div><strong>{label}</strong><small>{hint}</small></div></div>)}
   </div>
   {blenderModeling&&<p className="generation-method-warning">将在本机自动执行 Python，仅用于可信输入。</p>}
  </div>}>
  <Button
   type="text"
   className="generation-method-picker-trigger"
   disabled={locked}
   aria-label={`生成方式，当前${blenderModeling?'Blender 生成':'直接生成'}`}
   title={locked?'本轮生成方式已锁定':blenderModeling?'Blender 生成':'直接生成'}
   onKeyDown={event=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();event.currentTarget.click();}}}>
   <MagicWandIcon/><span>{blenderModeling?'Blender 生成':'直接生成'}</span><ChevronDownIcon/>
  </Button>
 </Popover>;
}
