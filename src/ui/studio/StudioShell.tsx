import {Fragment,useEffect,useRef,useState,useSyncExternalStore,type ReactNode} from 'react';
import {Button} from 'antd';
import {GearIcon,HomeIcon,CubeIcon,LayersIcon,PersonIcon,CursorArrowIcon,RowsIcon,ChevronRightIcon,ClockIcon,LockClosedIcon,ExclamationTriangleIcon} from '@radix-ui/react-icons';
import {getTeamSession,getTeamSessionStatus,restoreRememberedTeamSession,subscribeTeamSession} from '../../domain/teamLibrary';
import {StudioAccount} from './StudioAccount';
import {BrandMark} from '../BrandMark';
import {AppearanceMenu} from '../Appearance';
import {AppUpdateNavEntry} from '../AppUpdateNotice';
import {TaskQueue} from '../TaskQueue';

export type StudioNavPage = 'home' | 'workbench' | 'asset' | 'scene' | 'team' | 'tasks' | 'settings';
const NAV_ITEMS=[
  {page:'home',label:'创作首页',accessibleLabel:'首页',icon:HomeIcon},
  {page:'workbench',label:'建模工作台',accessibleLabel:'建模工作台',icon:CursorArrowIcon},
  {page:'asset',label:'资产库',accessibleLabel:'资产库',icon:CubeIcon,section:'本地资源'},
  {page:'scene',label:'场景库',accessibleLabel:'场景库',icon:LayersIcon},
  {page:'team',label:'团队资源',accessibleLabel:'团队库',icon:PersonIcon,section:'团队协作'},
] as const;
const PAGE_LABELS:Record<StudioNavPage,string>={home:'创作首页',asset:'资产库',scene:'场景库',workbench:'建模工作台',team:'团队资源',tasks:'任务记录',settings:'设置'};
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
   <div className="studio-navigation-caption">创作</div>
   <div className="navigation-pages studio-shell-nav" role="navigation" aria-label="工作室页面">
    {NAV_ITEMS.map(item=>{const {page,label,accessibleLabel,icon:Icon}=item;const needsLogin=page==='team'&&!client?.user;return <Fragment key={page}>{'section' in item&&<div className="studio-navigation-caption">{item.section}</div>}<Button type="text" className="studio-nav-item" title={needsLogin?'登录以访问团队资源':label} aria-label={accessibleLabel} disabled={disabled} aria-current={activePage===page?'page':undefined} onClick={()=>needsLogin?requestLogin('team'):onNavigate(page)}><Icon/><span>{label}</span>{needsLogin&&<LockClosedIcon className="studio-nav-lock" aria-hidden="true"/>}</Button></Fragment>;})}
   </div>
   <div className="studio-navigation-caption">管理</div>
   <div className="navigation-pages studio-shell-nav studio-management-nav">
    <Button type="text" className="studio-nav-item" aria-label="任务记录" disabled={disabled} aria-current={activePage==='tasks'?'page':undefined} onClick={onTaskHistory}><ClockIcon/><span>任务记录</span></Button>
    <Button type="text" className="studio-nav-item" aria-label="设置" disabled={disabled} aria-current={activePage==='settings'?'page':undefined} onClick={()=>onNavigate('settings')}><GearIcon/><span>设置</span></Button>
   </div>
   <div className="studio-sidebar-footer"><AppUpdateNavEntry disabled={disabled} layout="sidebar"/><StudioAccount disabled={disabled} loginOpen={loginOpen} onLoginOpenChange={open=>open?requestLogin():setLoginOpen(false)} onTeam={()=>onNavigate('team')}/></div>
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
