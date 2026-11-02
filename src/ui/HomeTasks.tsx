import {useEffect,useState} from 'react';
import {ArrowRightIcon,ClockIcon} from '@radix-ui/react-icons';
import {getSessionEditor,switchSession,useWorkspaceStore} from '../workspace';
import {taskSummary} from './TaskQueue';
import {ProjectThumb} from './ProjectLibrary';
import {customerText} from '../domain/customerProgress';
import type {ModelAssetSummary} from '../domain/modelAssets';
import {StudioPanel} from './studio/StudioPanel';
import {StudioSectionHeader} from './studio/StudioSectionHeader';
import {StudioTextLink} from './studio/StudioTextLink';
export function HomeTasks({onOpen,onAll,items,disabled=false,hidden=false}:{onOpen:()=>void;onAll?:()=>void;items:ModelAssetSummary[];disabled?:boolean;hidden?:boolean}){
 const sessions=useWorkspaceStore(s=>s.sessions);const [now,setNow]=useState(Date.now()),[error,setError]=useState('');
 const tasks=sessions.filter(s=>!s.deletedAt).map(session=>({session,...taskSummary(session)})).filter(t=>t.group==='running'||t.group==='review').sort((a,b)=>Number(b.group==='running')-Number(a.group==='running')||b.session.createdAt-a.session.createdAt);
 const running=tasks.some(t=>t.group==='running');
 useEffect(()=>{if(!running||hidden)return;setNow(Date.now());const timer=setInterval(()=>setNow(Date.now()),1000);return()=>clearInterval(timer);},[running,hidden]);
 if(!tasks.length)return null;
 return <StudioPanel className="home-current-tasks" aria-labelledby="home-tasks-title"><StudioSectionHeader id="home-tasks-title" title="当前任务" count={tasks.length} actions={onAll?<StudioTextLink disabled={disabled} onClick={onAll}>查看全部任务 <ArrowRightIcon/></StudioTextLink>:undefined}/>
 <div className="home-task-rows">{tasks.slice(0,3).map(({session,group,label})=>{const live=getSessionEditor(session.id)?.getState(),snap=session.snapshot;const messages=live?.messages??snap.messages;const run=[...messages].reverse().find(m=>m.run)?.run;const activity=live?.lastRun??snap.lastRun;const start=run?.startedAt??activity?.timings?.[0]?.startedAt;const seconds=start===undefined?undefined:Math.max(0,Math.floor((now-start)/1000));return <article className={'home-task-row is-'+group} key={session.id}><div className="home-task-thumb"><ProjectThumb src={session.sceneThumbnail??items.find(a=>a.id===session.assetSource?.id)?.thumbnail} name={session.title} kind={session.moduleKind??'scene'}/></div><div className="home-task-info"><h3 title={session.title}>{session.title}</h3><span className={'home-task-status is-'+group}>{label}</span><p>{group==='review'?'预览已准备好，请检查并确认':customerText(activity?.title,'正在处理模型')}</p>{group==='running'&&<small><ClockIcon/>{seconds===undefined?'执行中':`已运行 ${Math.floor(seconds/60)} 分 ${seconds%60} 秒`}</small>}</div><button type="button" className="home-task-action" disabled={disabled} aria-label={`打开首页任务 ${session.title}`} onClick={()=>{if(switchSession(session.id)){setError('');onOpen();}else setError('请先处理工作区保存异常');}}>{group==='review'?'查看预览':'查看任务'}<ArrowRightIcon/></button></article>;})}</div>
 {tasks.length>3&&<p className="home-task-more">另有 {tasks.length-3} 个任务，可在“查看全部任务”中切换。</p>}{error&&<p role="alert" className="resource-error">{error}</p>}
 </StudioPanel>;
}
