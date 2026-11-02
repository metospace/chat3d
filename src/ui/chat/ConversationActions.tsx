import {Actions} from '@ant-design/x';
import {Button} from 'antd';
import type {ReactNode} from 'react';

export type ConversationAction={key:string;label:string;ariaLabel?:string;icon?:ReactNode;disabled?:boolean;danger?:boolean;primary?:boolean;onClick:()=>void};
/** Actions owns the list; its supported renderer supplies native keyboard-operable buttons. */
export function ConversationActions({items,className}:{items:ConversationAction[];className?:string}){
 return <Actions className={className} items={items.map(item=>({key:item.key,label:item.label,
  actionRender:()=> <Button key={item.key} size="small" type={item.primary?'primary':'text'} disabled={item.disabled}
   aria-label={item.ariaLabel} danger={item.danger} icon={item.icon} onClick={item.onClick}>{item.label}</Button>}))}/>;
}
