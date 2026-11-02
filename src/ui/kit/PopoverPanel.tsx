import {useLayoutEffect,useRef,useState,type ReactNode,type RefObject} from 'react';
import {createPortal} from 'react-dom';

/** Anchored non-modal popup with keyboard navigation and focus restoration. */
export function PopoverPanel({anchor,open,onClose,label,children}:{anchor:RefObject<HTMLElement|null>;open:boolean;onClose:()=>void;label?:string;children:ReactNode}){
 const panelRef=useRef<HTMLDivElement>(null);
 const closeRef=useRef(onClose);closeRef.current=onClose;
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
 useLayoutEffect(()=>{
  if(!open)return;
  const onPointer=(event:MouseEvent)=>{
   const target=event.target as Node|null;
   if(panelRef.current?.contains(target)||anchor.current?.contains(target))return;
   closeRef.current();
  };
  const trigger=anchor.current,panel=panelRef.current;
  const focusable=()=>Array.from(panelRef.current?.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),[role="menuitem"],[role="menuitemcheckbox"],[tabindex="0"]')??[]);
  (focusable()[0]??panelRef.current)?.focus();
  const onKey=(event:KeyboardEvent)=>{
   if(event.defaultPrevented)return;
   if(event.key==='Escape'){event.preventDefault();event.stopPropagation();closeRef.current();trigger?.focus();return;}
   if(event.key==='Tab'){trigger?.focus();closeRef.current();return;}
   const items=focusable();const current=items.indexOf(document.activeElement as HTMLElement);
   if(!items.length||!['ArrowDown','ArrowUp','Home','End'].includes(event.key)||(document.activeElement?.tagName==='INPUT'&&!['ArrowDown','ArrowUp'].includes(event.key)))return;
   event.preventDefault();items[event.key==='Home'?0:event.key==='End'?items.length-1:(current+(event.key==='ArrowDown'?1:-1)+items.length)%items.length]?.focus();
  };
  document.addEventListener('mousedown',onPointer,true);
  document.addEventListener('keydown',onKey);
  return ()=>{if(panel?.contains(document.activeElement))trigger?.focus();document.removeEventListener('mousedown',onPointer,true);document.removeEventListener('keydown',onKey);};
 },[open,anchor]);
 if(!open)return null;
 return createPortal(
  <div ref={panelRef} className="app-popover-panel" tabIndex={-1} role="dialog" aria-label={label} style={{top:position?.top??0,left:position?.left??0,minWidth:position?.width}}>{children}</div>,
  document.body,
 );
}
