import {useEffect,useLayoutEffect,useRef,useState,type ReactNode,type RefObject} from 'react';
import {createPortal} from 'react-dom';

/**
 * A popup anchored under a trigger, rendered through a portal we own.
 *
 * antd's Popover keeps its content mounted while the leave motion settles, which under
 * jsdom never happens, so "the option disappears once chosen" would not hold. This panel
 * unmounts the moment `open` flips, and still closes on Escape or an outside press.
 */
export function PopoverPanel({anchor,open,onClose,label,children}:{anchor:RefObject<HTMLElement|null>;open:boolean;onClose:()=>void;label?:string;children:ReactNode}){
 const panelRef=useRef<HTMLDivElement>(null);
 const [position,setPosition]=useState<{top:number;left:number;width:number}>();
 useLayoutEffect(()=>{
  if(!open)return;
  const place=()=>{
   const rect=anchor.current?.getBoundingClientRect();
   if(!rect)return;
   const width=Math.max(rect.width,200);
   const left=Math.max(8,Math.min(rect.left,window.innerWidth-width-8));
   const below=rect.bottom+6,bottom=window.innerHeight-8;
   const top=below+320>bottom?Math.max(8,rect.top-326):below;
   setPosition({top,left,width});
  };
  place();
  window.addEventListener('resize',place);window.addEventListener('scroll',place,true);
  return ()=>{window.removeEventListener('resize',place);window.removeEventListener('scroll',place,true);};
 },[open,anchor]);
 useEffect(()=>{
  if(!open)return;
  const onPointer=(event:MouseEvent)=>{
   const target=event.target as Node|null;
   if(panelRef.current?.contains(target)||anchor.current?.contains(target))return;
   onClose();
  };
  const onKey=(event:KeyboardEvent)=>{if(event.key==='Escape'){event.stopPropagation();onClose();}};
  document.addEventListener('mousedown',onPointer,true);
  document.addEventListener('keydown',onKey);
  return ()=>{document.removeEventListener('mousedown',onPointer,true);document.removeEventListener('keydown',onKey);};
 },[open,onClose,anchor]);
 if(!open)return null;
 return createPortal(
  <div ref={panelRef} className="app-popover-panel" role="dialog" aria-label={label} style={{top:position?.top??0,left:position?.left??0,minWidth:position?.width}}>{children}</div>,
  document.body,
 );
}
