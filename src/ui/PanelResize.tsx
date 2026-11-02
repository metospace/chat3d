import {useEffect,useState} from 'react';

/** Optional local preferences never block opening or editing a project. */
export function usePanelWidth(name:string,initial:number,min:number,max:number){
 const clamp=(value:number)=>Math.max(min,Math.min(max,Number.isFinite(value)?value:initial));
 const [width,setWidth]=useState(()=>{try{const value=localStorage.getItem(`scenivo.panel.${name}`);return value?clamp(Number(value)):initial;}catch{return initial;}});
 useEffect(()=>{try{localStorage.setItem(`scenivo.panel.${name}`,String(width));}catch{/* Browser can deny preference storage. */}},[name,width]);
 return [width,(value:number)=>setWidth(clamp(value))] as const;
}
export function PanelResize({label,width,min,max,side,onChange}:{label:string;width:number;min:number;max:number;side:'left'|'right';onChange:(width:number)=>void}){
 return <div className={`panel-resizer panel-resizer-${side}`} role="separator" tabIndex={0} aria-label={label} aria-orientation="vertical" aria-valuemin={min} aria-valuemax={max} aria-valuenow={width}
 onPointerDown={e=>{e.preventDefault();e.currentTarget.setPointerCapture(e.pointerId);}}
 onPointerMove={e=>{if(!e.currentTarget.hasPointerCapture(e.pointerId))return;const bounds=e.currentTarget.parentElement!.getBoundingClientRect();onChange(side==='right'?e.clientX-bounds.left:bounds.right-e.clientX);}}
 onPointerUp={e=>{if(e.currentTarget.hasPointerCapture(e.pointerId))e.currentTarget.releasePointerCapture(e.pointerId);}}
 onKeyDown={e=>{if(!['ArrowLeft','ArrowRight','Home','End'].includes(e.key))return;e.preventDefault();onChange(e.key==='Home'?min:e.key==='End'?max:width+(e.key==='ArrowRight'?1:-1)*(side==='right'?16:-16));}}/>;
}
