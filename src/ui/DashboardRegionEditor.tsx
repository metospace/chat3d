import {useEffect,useId,useLayoutEffect,useRef,useState} from 'react';
import type {KeyboardEvent,PointerEvent} from 'react';
import type {DashboardRegion} from '../domain/dashboard';
import './dashboard-region-editor.css';

type Direction='move'|'n'|'ne'|'e'|'se'|'s'|'sw'|'w'|'nw';
type Drag={pointerId:number;target:HTMLElement;direction:Direction;start:DashboardRegion;clientX:number;clientY:number;width:number;height:number};
const handles:{direction:Exclude<Direction,'move'>;label:string}[]=[
  {direction:'n',label:'调整三维区域上边'},
  {direction:'ne',label:'调整三维区域右上角'},
  {direction:'e',label:'调整三维区域右边'},
  {direction:'se',label:'调整三维区域右下角'},
  {direction:'s',label:'调整三维区域下边'},
  {direction:'sw',label:'调整三维区域左下角'},
  {direction:'w',label:'调整三维区域左边'},
  {direction:'nw',label:'调整三维区域左上角'},
];
const clamp=(value:number,min:number,max:number)=>Math.max(min,Math.min(max,value));
function transformRegion(start:DashboardRegion,direction:Direction,dx:number,dy:number):DashboardRegion {
  if(direction==='move')return {...start,x:clamp(start.x+dx,0,100-start.width),y:clamp(start.y+dy,0,100-start.height)};
  let left=start.x,top=start.y,right=start.x+start.width,bottom=start.y+start.height;
  if(direction.includes('w'))left=clamp(left+dx,0,right-5);
  if(direction.includes('e'))right=clamp(right+dx,left+5,100);
  if(direction.includes('n'))top=clamp(top+dy,0,bottom-5);
  if(direction.includes('s'))bottom=clamp(bottom+dy,top+5,100);
  return {x:left,y:top,width:right-left,height:bottom-top};
}

function releasePointer(drag:Drag) {
  if(drag.target.hasPointerCapture(drag.pointerId))drag.target.releasePointerCapture(drag.pointerId);
}

export function DashboardRegionEditor({region,onChange,disabled=false}:{region:DashboardRegion;onChange:(value:DashboardRegion)=>void;disabled?:boolean}) {
  const rootRef=useRef<HTMLDivElement>(null);
  const viewportRef=useRef<HTMLDivElement>(null);
  const moveRef=useRef<HTMLButtonElement>(null);
  const dragRef=useRef<Drag|null>(null);
  const draftRef=useRef<DashboardRegion>({...region});
  const [draft,setDraft]=useState<DashboardRegion>(()=>({...region}));
  const [viewport,setViewport]=useState({left:0,top:0,width:0,height:0});
  const [dragging,setDragging]=useState(false);
  const helperId=useId();

  function updateDraft(value:DashboardRegion) {
    draftRef.current=value;
    setDraft(value);
  }

  function cancelDrag() {
    const drag=dragRef.current;
    if(!drag)return;
    dragRef.current=null;
    updateDraft(drag.start);
    setDragging(false);
    releasePointer(drag);
  }

  useLayoutEffect(()=>{
    const root=rootRef.current;
    const host=root?.parentElement;
    if(!root||!host)return;
    const measure=()=>{
      const width=root.clientWidth,height=root.clientHeight;
      const scale=Math.min(width/1920,height/1080);
      const boardWidth=1920*scale,boardHeight=1080*scale;
      setViewport(previous=>{
        const next={left:(width-boardWidth)/2,top:(height-boardHeight)/2,width:boardWidth,height:boardHeight};
        return previous.left===next.left&&previous.top===next.top&&previous.width===next.width&&previous.height===next.height?previous:next;
      });
    };
    measure();
    const observer=new ResizeObserver(measure);
    observer.observe(host);
    return ()=>observer.disconnect();
  },[]);

  useLayoutEffect(()=>{
    const drag=dragRef.current;
    if(drag){dragRef.current=null;releasePointer(drag);setDragging(false);}
    const value={x:region.x,y:region.y,width:region.width,height:region.height};
    draftRef.current=value;
    setDraft(value);
  },[region.x,region.y,region.width,region.height]);

  useEffect(()=>{
    if(!disabled)return;
    const drag=dragRef.current;
    if(drag){
      dragRef.current=null;
      draftRef.current=drag.start;
      setDraft(drag.start);
      setDragging(false);
      releasePointer(drag);
    }
  },[disabled]);

  useEffect(()=>()=>{
    const drag=dragRef.current;
    dragRef.current=null;
    if(drag)releasePointer(drag);
  },[]);

  function startDrag(event:PointerEvent<HTMLElement>,direction:Direction) {
    if(disabled||dragRef.current||event.button!==0||!event.isPrimary)return;
    const bounds=viewportRef.current?.getBoundingClientRect();
    if(!bounds||bounds.width<=0||bounds.height<=0)return;
    event.preventDefault();
    event.stopPropagation();
    if(event.currentTarget instanceof HTMLButtonElement)event.currentTarget.focus();
    else moveRef.current?.focus();
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current={pointerId:event.pointerId,target:event.currentTarget,direction,start:{...draftRef.current},clientX:event.clientX,clientY:event.clientY,width:bounds.width,height:bounds.height};
    setDragging(true);
  }

  function pointerRegion(event:PointerEvent<HTMLElement>,drag:Drag) {
    return transformRegion(drag.start,drag.direction,(event.clientX-drag.clientX)/drag.width*100,(event.clientY-drag.clientY)/drag.height*100);
  }

  function movePointer(event:PointerEvent<HTMLElement>) {
    const drag=dragRef.current;
    if(disabled||!drag||drag.pointerId!==event.pointerId)return;
    event.stopPropagation();
    updateDraft(pointerRegion(event,drag));
  }

  function finishPointer(event:PointerEvent<HTMLElement>) {
    const drag=dragRef.current;
    if(!drag||drag.pointerId!==event.pointerId)return;
    event.stopPropagation();
    if(disabled){cancelDrag();return;}
    const value=pointerRegion(event,drag);
    dragRef.current=null;
    updateDraft(value);
    setDragging(false);
    releasePointer(drag);
    if(value.x!==drag.start.x||value.y!==drag.start.y||value.width!==drag.start.width||value.height!==drag.start.height)onChange(value);
  }

  function cancelPointer(event:PointerEvent<HTMLElement>) {
    if(dragRef.current?.pointerId===event.pointerId)cancelDrag();
  }

  function keyboardChange(event:KeyboardEvent<HTMLElement>,direction:Direction) {
    if(disabled||dragRef.current)return;
    const step=event.shiftKey?5:1;
    let dx=0,dy=0;
    if(event.key==='ArrowLeft')dx=-step;
    else if(event.key==='ArrowRight')dx=step;
    else if(event.key==='ArrowUp')dy=-step;
    else if(event.key==='ArrowDown')dy=step;
    else return;
    event.preventDefault();
    event.stopPropagation();
    const value=transformRegion(draftRef.current,direction,dx,dy);
    if(value.x===draftRef.current.x&&value.y===draftRef.current.y&&value.width===draftRef.current.width&&value.height===draftRef.current.height)return;
    updateDraft(value);
    onChange(value);
  }

  const pointerHandlers={onPointerMove:movePointer,onPointerUp:finishPointer,onPointerCancel:cancelPointer,onLostPointerCapture:cancelPointer};
  return <div ref={rootRef} className={`dashboard-region-editor${dragging?' dashboard-region-editor--dragging':''}`} aria-label="编辑三维区域" aria-disabled={disabled} onKeyDown={event=>{
    if(event.key==='Escape'&&dragRef.current){event.preventDefault();event.stopPropagation();cancelDrag();}
  }}>
    <div ref={viewportRef} className="dashboard-region-editor__viewport" style={{left:viewport.left,top:viewport.top,width:viewport.width,height:viewport.height}}>
      <div className="dashboard-region-editor__selection" style={{left:`${draft.x}%`,top:`${draft.y}%`,width:`${draft.width}%`,height:`${draft.height}%`}} onPointerDown={event=>startDrag(event,'move')} {...pointerHandlers}>
        <button ref={moveRef} type="button" className="dashboard-region-editor__move" aria-label="拖动三维区域" aria-describedby={helperId} disabled={disabled} onPointerDown={event=>startDrag(event,'move')} onKeyDown={event=>keyboardChange(event,'move')} {...pointerHandlers}>拖动三维区域</button>
        <span className="dashboard-region-editor__values">x {draft.x.toFixed(1)}% · y {draft.y.toFixed(1)}% · w {draft.width.toFixed(1)}% · h {draft.height.toFixed(1)}%</span>
        {handles.map(({direction,label})=><button key={direction} type="button" className={`dashboard-region-editor__handle dashboard-region-editor__handle--${direction}`} aria-label={label} aria-describedby={helperId} disabled={disabled} onPointerDown={event=>startDrag(event,direction)} onKeyDown={event=>keyboardChange(event,direction)} {...pointerHandlers}/>)}
      </div>
    </div>
    <span id={helperId} className="dashboard-region-editor__help">拖动区域或边角调整位置和大小；聚焦拖动或缩放手柄后，方向键每次调整 1%，Shift + 方向键调整 5%。拖动时按 Esc 取消。</span>
  </div>;
}
