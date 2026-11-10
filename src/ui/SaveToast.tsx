import {useEffect} from 'react';
import {Button} from 'antd';
import {CheckCircledIcon,Cross1Icon,ExclamationTriangleIcon,InfoCircledIcon} from '@radix-ui/react-icons';
import './save-toast.css';
export const isLibrarySaveNotice=(text:string)=>/^(资产已保存到资产库|场景已保存到场景库)/.test(text);
export function SaveToast({message,onClose,duration=5000,tone='success'}:{message:string;onClose:()=>void;duration?:number;tone?:'success'|'error'|'info'}){
 useEffect(()=>{if(duration<=0)return;const timer=setTimeout(onClose,duration);return()=>clearTimeout(timer);},[message,onClose,duration]);
 const Icon=tone==='error'?ExclamationTriangleIcon:tone==='info'?InfoCircledIcon:CheckCircledIcon;
 return <div className={`library-save-toast is-${tone}`} role={tone==='error'?'alert':'status'}><Icon aria-hidden="true"/><span>{message}</span><Button type="text" className="library-save-close" aria-label="关闭保存提示" icon={<Cross1Icon/>} onClick={onClose}/></div>;
}
