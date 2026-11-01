import {useEffect,useRef,type ReactNode} from 'react';
import {createPortal} from 'react-dom';
import {ConfigProvider} from 'antd';

/**
 * A tiny self-managed dialog. antd's `Modal` and Radix's `Dialog` both drag in a motion
 * runtime that does not settle under jsdom, so the few dialogs that host heavy content
 * (team sign-in forms) use this plain portal instead: no animation, one focusable panel,
 * the same dialog semantics the tests assert.
 *
 * The provider pins `autoInsertSpace` off so two-character labels such as 取消 stay
 * verbatim even when the dialog is rendered outside the app theme (as tests do).
 */
export function PortalDialog({label,onClose,closable=true,width=480,className,describedBy,children}:{label:string;onClose:()=>void;closable?:boolean;width?:number;className?:string;describedBy?:string;children:ReactNode}){
  const panelRef=useRef<HTMLDivElement>(null);
  useEffect(()=>{panelRef.current?.focus();},[]);
  useEffect(()=>{
    if(!closable)return;
    const onKey=(event:KeyboardEvent)=>{if(event.key==='Escape'){event.stopPropagation();onClose();}};
    document.addEventListener('keydown',onKey);
    return ()=>document.removeEventListener('keydown',onKey);
  },[closable,onClose]);
  return createPortal(
    <div className="app-modal-backdrop" onMouseDown={event=>{if(closable&&event.target===event.currentTarget)onClose();}}>
      <div ref={panelRef} className={`app-modal-panel${className?' '+className:''}`} role="dialog" aria-modal="true" aria-label={label} aria-describedby={describedBy} style={{maxWidth:width}} tabIndex={-1}>
        <ConfigProvider button={{autoInsertSpace:false}}>{children}</ConfigProvider>
      </div>
    </div>,
    document.body,
  );
}
