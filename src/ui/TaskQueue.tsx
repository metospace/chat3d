import {useEffect,useState} from 'react';
import {Button,Drawer,Input,Modal} from 'antd';
import {ActivityLogIcon,Cross1Icon,ArrowRightIcon} from '@radix-ui/react-icons';
import {getSessionEditor,switchSession,useWorkspaceStore,type WorkspaceSession} from '../workspace';
import {conversationController} from '../runtime/conversationController';
import './task-queue.css';

export function taskSummary(session:WorkspaceSession){
 const live=getSessionEditor(session.id)?.getState(),s=session.snapshot;
 const run=[...s.messages].reverse().find(m=>m.run)?.run;
 const status=live?.aiStatus;
 const running=live?['capturing','context','generating','validating','applying'].includes(status!):s.wasRunning;
 const review=!!(live?.pendingBatch??s.pendingBatch);
 const label=running?'运行中':review?'待确认':status==='error'||run?.status==='failed'?'失败':status==='cancelled'||run?.status==='stopped'?'已停止':'已结束';
 return {group:running?'running':review?'review':'ended',label,visible:running||review||!!s.lastRun||!!run};
}

export function TaskQueue({onOpen,onHistory,disabled=false,openRequest=0}:{onOpen:()=>void;onHistory:()=>void;disabled?:boolean;openRequest?:number}){
 const w=useWorkspaceStore();
 const [open,setOpen]=useState(false),[query,setQuery]=useState(''),[error,setError]=useState('');
 const [filter,setFilter]=useState<'all'|'running'|'review'|'ended'>('all');
 useEffect(()=>{if(openRequest){setOpen(true);setError('');}},[openRequest]);
 const [stop,setStop]=useState<{id:string;title:string;runId:string|null}|null>(null);
 const tasks=w.sessions.filter(s=>!s.deletedAt).map(s=>({session:s,...taskSummary(s)})).filter(t=>t.visible);
 const running=tasks.filter(t=>t.group==='running').length,review=tasks.filter(t=>t.group==='review').length;
 const shown=tasks.filter(t=>t.session.title.toLowerCase().includes(query.trim().toLowerCase())&&(filter==='all'||t.group===filter));
 const close=()=>{setOpen(false);setError('');};
 return <><Button type="text" className="global-task-trigger" aria-label="任务" title={`${running} 个运行中，${review} 个待确认`} disabled={disabled} onClick={()=>setOpen(true)}><ActivityLogIcon/><span className="global-task-label">任务</span>{running>0&&<span className="global-task-count" aria-label={`${running} 个运行中`}>{running}</span>}</Button>
  <Drawer open={open} onClose={close} placement="right" width={440} className="global-task-drawer" closable={false} title="任务队列" extra={<Button type="text" aria-label="关闭任务队列" icon={<Cross1Icon/>} onClick={close}/>} styles={{body:{display:'flex',flexDirection:'column',gap:14,padding:'18px 20px'},header:{padding:'18px 20px 10px'}}}>
   <p className="global-task-summary">{running} 个运行中 · {review} 个待确认</p>
   <Input aria-label="搜索任务" placeholder="搜索任务名称" value={query} onChange={e=>setQuery(e.target.value)}/>
   <div className="global-task-filters" role="group" aria-label="筛选任务">{([['all','全部'],['running','运行中'],['review','待确认'],['ended','已结束']] as const).map(([value,label])=><Button key={value} type="text" aria-pressed={filter===value} onClick={()=>setFilter(value)}>{label}</Button>)}</div>
   {error&&<p role="alert">{error}</p>}
   <div className="global-task-list">
    {(['running','review','ended'] as const).map(group=>{const items=shown.filter(t=>t.group===group).sort((a,b)=>b.session.updatedAt-a.session.updatedAt);if(!items.length)return null;return <section key={group} aria-label={{running:'运行中任务',review:'待确认任务',ended:'已结束任务'}[group]}><h3>{{running:'运行中',review:'待确认',ended:'已结束'}[group]} <span>{items.length}</span></h3>{items.map(({session:s,label})=><article key={s.id} className={`global-task-item ${s.id===w.activeId?'is-current':''}`}><button type="button" className="global-task-open" aria-label={`打开任务 ${s.title}`} aria-current={s.id===w.activeId?'true':undefined} disabled={disabled||!!w.error} onClick={()=>{if(!switchSession(s.id)){setError('无法切换，请先处理工作区保存异常');return;}setOpen(false);onOpen();}}><strong>{s.title}</strong><small><span className={`global-task-state is-${group}`}>{label}</span>{s.id===w.activeId?' · 当前任务':''} · {s.moduleKind==='asset'?'资产':'场景'}</small></button>{group==='running'&&<Button size="small" aria-label={`停止任务 ${s.title}`} onClick={()=>{const editor=getSessionEditor(s.id);if(editor)setStop({id:s.id,title:s.title,runId:conversationController(editor).ui.getState().runMessageId});}}>停止</Button>}<ArrowRightIcon aria-hidden="true"/></article>)}</section>;})}
    {!shown.length&&<p className="global-task-empty">{query?'没有匹配的任务':'暂无执行任务，开始建模后会显示在这里'}</p>}
   </div>
   <footer className="global-task-footer"><span>切换任务不会停止后台执行</span><Button onClick={()=>{setOpen(false);onHistory();}}>全部执行记录</Button></footer>
  </Drawer>
  <Modal open={!!stop} onCancel={()=>setStop(null)} footer={null} closable={false} title={null} width={420}><div role="alertdialog" aria-label="停止这个任务？" className="stop-confirm"><h3>停止这个任务？</h3><p>停止“{stop?.title}”当前生成，其他任务继续执行。已保存的项目和聊天会保留。</p><div className="dialog-actions"><Button onClick={()=>setStop(null)}>继续执行</Button><Button danger onClick={()=>{if(stop){const editor=getSessionEditor(stop.id);if(editor){const controller=conversationController(editor);if(controller.ui.getState().runMessageId===stop.runId)controller.cancel();else setError('任务状态已变化，请重新选择要停止的任务');}}setStop(null);}}>确认停止</Button></div></div></Modal>
 </>;
}
