import {useLayoutEffect,type ComponentRef,type RefObject} from 'react';
import {Sender} from '@ant-design/x';

/** Sender 2.x forwards aria props to both root and input. Name its exposed default input only. */
export function useSenderLabel(ref:RefObject<ComponentRef<typeof Sender>|null>,label:string){
 useLayoutEffect(()=>{ref.current?.inputElement?.setAttribute('aria-label',label);},[ref,label]);
}
