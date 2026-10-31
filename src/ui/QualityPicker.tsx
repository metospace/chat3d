import {useEffect,useState} from 'react';
import {Button,Popover} from 'antd';
import {LightningBoltIcon,MagicWandIcon,ChevronDownIcon} from '@radix-ui/react-icons';
import {useEditorStore} from '../store';
const active=new Set(['capturing','context','generating','validating','applying']);
export function QualityPicker({onConfigure,forNewProject=false}:{onConfigure?:()=>void;forNewProject?:boolean}){
 const cfg=useEditorStore(s=>s.aiConfig),status=useEditorStore(s=>s.aiStatus);
 const locked=!forNewProject&&active.has(status);
 const [open,setOpen]=useState(false);useEffect(()=>{if(locked)setOpen(false);},[locked]);
 const quality=cfg?.generationQuality==='fast'?'fast':'fine',single=cfg?.agentMode==='single';
 const choose=(value:string)=>{const s=useEditorStore.getState();if(!forNewProject&&active.has(s.aiStatus))return;if(!s.aiConfig){onConfigure?.();return;}s.setAiConfig({...s.aiConfig,generationQuality:value==='fast'?'fast':'fine'});setOpen(false);};
 // antd cannot emit menuitemradio roles, so the popup content carries the radio semantics itself.
 const options=[['fast','快速生成','快速','主体与关键结构优先，减少细节打磨'],['fine','精细生成','精细',single?'更完整的建模要求；无多轮复核':'更充分的细节、视角检查与修正']] as const;
 return <Popover
  open={open}
  onOpenChange={next=>{if(locked)return;if(next&&!cfg){onConfigure?.();return;}setOpen(next)}}
  trigger={['click']}
  placement="topLeft"
  destroyOnHidden
  content={<div className="quality-picker-menu" role="menu" aria-label="生成档位" aria-hidden={locked||undefined}>
   {options.map(([value,aria,label,hint])=><div key={value} role="menuitemradio" aria-checked={quality===value} aria-label={aria} tabIndex={0} className="quality-picker-option" onClick={()=>choose(value)} onKeyDown={event=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();choose(value);}}}><div><strong>{label}</strong><small>{hint}</small></div></div>)}
  </div>}>
  <Button
   type="text"
   className="quality-picker-trigger"
   disabled={locked}
   aria-label={`生成档位，当前${quality==='fast'?'快速':'精细'}`}
   title={locked?'本轮生成档位已锁定':quality==='fast'?'快速：优先主体与关键结构':single?'单次兼容：精细建模要求（无多轮复核）':'精细：更充分的细节与多视角检查'}
   onKeyDown={event=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();event.currentTarget.click();}}}>
   {quality==='fast'?<LightningBoltIcon/>:<MagicWandIcon/>}<span>{quality==='fast'?'快速':'精细'}</span><ChevronDownIcon/>
  </Button>
 </Popover>;
}
