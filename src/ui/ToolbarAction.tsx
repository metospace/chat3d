import type {ReactNode} from 'react';
import {Button,Tooltip} from 'antd';
export function ToolbarAction({label,help,disabled=false,disabledReason,pressed,onPress,children}:{label:string;help:string;disabled?:boolean;disabledReason?:string;pressed?:boolean;onPress:()=>void;children:ReactNode}){
 const explanation=disabled&&disabledReason?`${label}：${disabledReason}`:`${label}：${help}`;
 return <Tooltip title={explanation} trigger={['hover','focus']} mouseEnterDelay={0.18}><div className="canvas-tool-help" title={explanation} tabIndex={disabled?0:undefined} aria-label={disabled?explanation:undefined}><Button type="text" aria-label={label} aria-pressed={pressed} disabled={disabled} onClick={onPress}>{children}</Button></div></Tooltip>;
}
