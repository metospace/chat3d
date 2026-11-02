import {useEffect,useRef,type KeyboardEvent} from 'react';
import {Modal as AntModal,type ModalProps} from 'antd';

/** Keep Ant's modal lifecycle and wrap Tab at the browser's document boundary.
 * rc-dialog's focusin recovery cannot intercept focus moving to browser chrome. */
export function cycleDialogFocus(event:KeyboardEvent<HTMLDivElement>){
  if(event.key!=='Tab'||event.defaultPrevented||!event.currentTarget.contains(event.target as Node))return;
  const items=Array.from(event.currentTarget.querySelectorAll<HTMLElement>('button,input,select,textarea,a[href],[tabindex]')).filter(element=>element.tabIndex>=0&&!element.matches(':disabled,[aria-disabled="true"]')&&element.getClientRects().length>0);
  const first=items[0],last=items[items.length-1];
  if(first&&((event.shiftKey&&document.activeElement===first)||(!event.shiftKey&&document.activeElement===last))){event.preventDefault();(event.shiftKey?last:first).focus();}
}

/** Conditional mounting can skip Ant's exit animation and focus restoration. */
function useDialogFocusReturn(open:boolean,restore:boolean){
  const trigger=useRef<HTMLElement|null>(null),wasOpen=useRef(false),mounted=useRef(false),shouldRestore=useRef(restore);
  shouldRestore.current=restore;
  if(open&&!wasOpen.current)trigger.current=typeof document==='undefined'?null:document.activeElement as HTMLElement|null;
  wasOpen.current=open;
  useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;queueMicrotask(()=>{if(!mounted.current&&shouldRestore.current&&trigger.current?.isConnected)trigger.current.focus({preventScroll:true});});};},[]);
}

export function AccessibleModal({modalRender,focusable,focusTriggerAfterClose,...props}:ModalProps){
  const restore=focusable?.focusTriggerAfterClose??focusTriggerAfterClose??true;
  useDialogFocusReturn(props.open??false,restore);
  return <AntModal {...props} focusable={{...focusable,focusTriggerAfterClose:restore}} modalRender={node=><div onKeyDown={focusable?.trap===false?undefined:cycleDialogFocus}>{modalRender?modalRender(node):node}</div>}/>;
}
