import {EyeOpenIcon,EyeNoneIcon,ChevronDownIcon,ChevronRightIcon} from '@radix-ui/react-icons';
import {useMemo,useState,type MouseEvent} from 'react';
import {Button,Input} from 'antd';
import { useDisplayDoc, useEditorStore } from '../store';
import type {SceneNode} from '../domain/types';
export function ObjectTree(){
 const doc=useDisplayDoc(),selection=useEditorStore(s=>s.selection),select=useEditorStore(s=>s.select),apply=useEditorStore(s=>s.applyCommandBatch);
 const [expanded,setExpanded]=useState<Set<string>>(new Set()),[query,setQuery]=useState(''),[error,setError]=useState('');
 const groups=useMemo(()=>{const map=new Map<string,SceneNode[]>();for(const n of doc.nodes){const key=n.assemblyId??n.id;if(!map.has(key))map.set(key,[]);map.get(key)!.push(n);}return [...map.entries()].map(([id,nodes])=>({id,nodes,title:nodes[0].assemblyName??(nodes[0].assemblyId?nodes[0].name.split(' · ')[0]:nodes[0].name),zone:nodes[0].zone})).sort((a,b)=>a.title.localeCompare(b.title,'zh'));},[doc]);
 const shown=groups.filter(g=>(g.title+' '+g.zone+' '+g.nodes.map(n=>n.name).join(' ')).toLowerCase().includes(query.toLowerCase()));
 const choose=(ids:string[],event:MouseEvent)=>{
  if(!event.shiftKey&&!event.ctrlKey&&!event.metaKey){select(ids);return;}
  const selected=new Set(selection),all=ids.every(id=>selected.has(id));
  for(const id of ids)if(all)selected.delete(id);else selected.add(id);
  select([...selected]);
 };
 const row=(n:SceneNode)=><div key={n.id} className={`object-tree-row${selection.includes(n.id)?' is-selected':''}${n.visible?'':' is-hidden'}`}><Button type="text" className="object-tree-name" title={`${n.visible?'':'已隐藏；'}点击选择，Shift / Ctrl / ⌘ 点击可多选`} aria-pressed={selection.includes(n.id)} onClick={event=>choose([n.id],event)}>{n.name}</Button>{!n.visible&&<span className="object-tree-hidden-label">已隐藏</span>}<Button type="text" size="small" className="object-tree-eye" aria-label={`${n.visible?'隐藏':'显示'} ${n.name}`} aria-pressed={!n.visible} title={n.visible?'仅隐藏此部件，背后的其他部件仍会显示':'此部件已隐藏，点击重新显示'} icon={n.visible?<EyeOpenIcon/>:<EyeNoneIcon/>} onClick={()=>{const r=apply([{op:'setVisibility',targetId:n.id,visible:!n.visible}],`${n.visible?'隐藏':'显示'} ${n.name}`);setError(r.ok?'':r.error??'无法修改可见性，请稍后重试');}}/></div>;
 return <div className="object-tree"><div className="object-tree-title">场景组件 · {groups.length} 组 / {doc.nodes.length} 零件</div><Input aria-label="搜索场景组件" className="object-tree-search" value={query} onChange={e=>setQuery(e.target.value)} placeholder="查找设备、区域或零件"/>{error&&<p role="alert">{error}</p>}<div className="object-tree-body">{!shown.length&&<p className="object-tree-empty">{doc.nodes.length?'没有匹配的组件':'空场景，可从对话或沙盘预览开始'}</p>}{shown.map(g=>g.nodes.length===1?row(g.nodes[0]):<div key={g.id} className="object-tree-group"><div className={`object-tree-group-head${g.nodes.every(n=>selection.includes(n.id))?' is-selected':''}`}><Button type="text" size="small" className="object-tree-caret" aria-label={`${expanded.has(g.id)?'收起':'展开'} ${g.title}`} icon={expanded.has(g.id)?<ChevronDownIcon/>:<ChevronRightIcon/>} onClick={()=>setExpanded(old=>{const s=new Set(old);if(s.has(g.id))s.delete(g.id);else s.add(g.id);return s;})}/><Button type="text" aria-label={`选择组件 ${g.title}`} className="object-tree-group-name" title="选择整个组件；Shift / Ctrl / ⌘ 点击可多选" aria-pressed={g.nodes.every(n=>selection.includes(n.id))} onClick={event=>choose(g.nodes.map(n=>n.id),event)}><span className="object-tree-group-title">{g.title}</span>{g.zone&&<span className="object-tree-zone">{g.zone}</span>}</Button><span className="object-tree-count">{g.nodes.length}</span></div>{expanded.has(g.id)&&<div className="object-tree-children">{g.nodes.map(row)}</div>}</div>)}</div></div>;
}
