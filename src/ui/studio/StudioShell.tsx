import {Fragment,useEffect,useRef,useState,useSyncExternalStore,type ReactNode} from 'react';
import {Button} from 'antd';
import {GearIcon,HomeIcon,CubeIcon,LayersIcon,PersonIcon,RowsIcon,ChevronRightIcon,ClockIcon,LockClosedIcon,ExclamationTriangleIcon} from '@radix-ui/react-icons';
import {getTeamSession,getTeamSessionStatus,restoreRememberedTeamSession,subscribeTeamSession} from '../../domain/teamLibrary';
import {StudioAccount} from './StudioAccount';
import {BrandMark} from '../BrandMark';
import {AppearanceMenu} from '../Appearance';
import {AppUpdateNavEntry} from '../AppUpdateNotice';
import {TaskQueue} from '../TaskQueue';

export type StudioNavPage = 'home' | 'workbench' | 'asset' | 'scene' | 'team' | 'tasks' | 'settings';
const NAV_ITEMS=[
  {page:'home',label:'创作空间',accessibleLabel:'首页',icon:HomeIcon},
  {page:'asset',label:'资源库',accessibleLabel:'资源库',icon:CubeIcon},
  {page:'tasks',label:'任务',accessibleLabel:'任务记录',icon:ClockIcon},
  {page:'team',label:'团队',accessibleLabel:'团队库',icon:PersonIcon},
] as const;
const PAGE_LABELS:Record<StudioNavPage,string>={home:'创作空间',asset:'资源库 / 资产',scene:'资源库 / 场景',workbench:'工作台',team:'团队',tasks:'任务',settings:'设置'};
export function StudioShell({activePage,onNavigate,disabled,taskQueueRequest,onTaskOpen,onTaskHistory}:{activePage:StudioNavPage;onNavigate:(page:StudioNavPage)=>void;disabled:boolean;taskQueueRequest:number;onTaskOpen:()=>void;onTaskHistory:()=>void}){
 const client=useSyncExternalStore(subscribeTeamSession,getTeamSession,getTeamSession);
 const sessionStatus=useSyncExternalStore(subscribeTeamSession,getTeamSessionStatus,getTeamSessionStatus);
 const [loginOpen,setLoginOpen]=useState(false);
 const loginDestination=useRef<'team'|'current'>('current'),previousClient=useRef(client);
 function requestLogin(destination:'team'|'current'='current'){loginDestination.current=destination;setLoginOpen(true);}
 useEffect(()=>{void restoreRememberedTeamSession();},[]);
 useEffect(()=>{
  if(client?.user&&loginOpen){setLoginOpen(false);if(loginDestination.current==='team')onNavigate('team');}
  if(previousClient.current&&!client&&activePage==='team')onNavigate('home');
  previousClient.current=client;
 },[client,loginOpen,activePage,onNavigate]);
 return <>
  <nav className="app-navigation studio-shell" aria-label="主导航" hidden={activePage==='workbench'}>
   <div className="app-brand studio-shell-brand"><BrandMark/><div><strong>Scenivo</strong><small>三维创作工作空间</small></div></div>
   <div className="navigation-pages studio-shell-nav" aria-label="工作室页面">
    {NAV_ITEMS.map(({page,label,accessibleLabel,icon:Icon})=>{
     const needsLogin=page==='team'&&!client?.user;
     const selected=activePage===page||(page==='asset'&&activePage==='scene');
     return <Fragment key={page}><Button type="text" className="studio-nav-item" title={needsLogin?'登录以访问团队资源':label} aria-label={accessibleLabel} disabled={disabled} aria-current={selected?'page':undefined} onClick={()=>needsLogin?requestLogin('team'):page==='tasks'?onTaskHistory():onNavigate(page)}><Icon/><span>{label}</span>{needsLogin&&<LockClosedIcon className="studio-nav-lock" aria-hidden="true"/>}</Button>{page==='asset'&&(activePage==='asset'||activePage==='scene')&&<div className="studio-resource-navigation" role="group" aria-label="资源类型">
    <Button type="text" disabled={disabled} aria-label="资产库" aria-current={activePage==='asset'?'page':undefined} onClick={()=>onNavigate('asset')}><CubeIcon/><span>资产</span></Button>
    <Button type="text" disabled={disabled} aria-label="场景库" aria-current={activePage==='scene'?'page':undefined} onClick={()=>onNavigate('scene')}><LayersIcon/><span>场景</span></Button>
   </div>}</Fragment>;
    })}
   </div>

   <div className="studio-sidebar-footer"><div className="studio-shell-nav"><Button type="text" className="studio-nav-item" aria-label="设置" disabled={disabled} aria-current={activePage==='settings'?'page':undefined} onClick={()=>onNavigate('settings')}><GearIcon/><span>设置</span></Button></div><AppUpdateNavEntry disabled={disabled} layout="sidebar"/><StudioAccount disabled={disabled} loginOpen={loginOpen} onLoginOpenChange={open=>open?requestLogin():setLoginOpen(false)} onTeam={()=>onNavigate('team')}/></div>
  </nav>
  <header className={`studio-global-header ${activePage==='workbench'?'workbench-global-header':''}`}>
   {activePage!=='workbench'&&<div className="studio-breadcrumb"><RowsIcon/><span/>工作空间<ChevronRightIcon/><strong>{PAGE_LABELS[activePage]}</strong></div>}
   <div className="studio-global-utilities">{sessionStatus==='expired'&&<Button type="text" className="studio-session-expired" aria-label="重新登录团队账户" title="团队登录已过期，本地项目仍可继续编辑" onClick={()=>requestLogin()}><ExclamationTriangleIcon/><span role="status">团队登录已过期</span></Button>}<TaskQueue openRequest={taskQueueRequest} disabled={disabled} onOpen={onTaskOpen} onHistory={onTaskHistory}/><AppearanceMenu/></div>
  </header>
 </>;
}
export function StudioMain({children}:{children:ReactNode}){
 return <section className="studio-main studio-shell-main">{children}</section>;
}
