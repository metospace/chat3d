import type {ReactNode} from 'react';
import {ConfigProvider} from 'antd';
import {AccessibleModal as Modal} from './AccessibleModal';

/** Shared modal lifecycle: focus trap, Escape, scroll lock and focus restoration. */
export function PortalDialog({label,onClose,closable=true,width=480,className,describedBy,children}:{label:string;onClose:()=>void;closable?:boolean;width?:number;className?:string;describedBy?:string;children:ReactNode}){
  return <ConfigProvider button={{autoInsertSpace:false}}><Modal open title={<span style={{position:'absolute',width:1,height:1,overflow:'hidden',clipPath:'inset(50%)'}}>{label}</span>} footer={null} width={width} onCancel={onClose} closable={false} keyboard={closable} mask={{closable}} focusable={{focusTriggerAfterClose:true}} destroyOnHidden modalRender={modal=><div aria-describedby={describedBy}>{modal}</div>}><div className={`app-modal-content${className?' '+className:''}`}>{children}</div></Modal></ConfigProvider>;
}
