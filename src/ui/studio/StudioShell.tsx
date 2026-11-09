import {useEffect,useRef,useState,useSyncExternalStore,type ReactNode} from 'react';
import {Badge,Breadcrumb,Button,Tooltip} from 'antd';
import {ProLayout,type MenuDataItem} from '@ant-design/pro-components';
import {GearIcon,HomeIcon,CubeIcon,LayersIcon,PersonIcon,ClockIcon,LockClosedIcon,ExclamationTriangleIcon} from '@radix-ui/react-icons';
import {getTeamSession,getTeamSessionStatus,restoreRememberedTeamSession,subscribeTeamSession} from '../../domain/teamLibrary';
import {StudioAccount} from './StudioAccount';
import {BrandMark} from '../BrandMark';
import {AppearanceMenu,useAppearance} from '../Appearance';
import {hasPendingAppUpdate,useAppUpdate} from '../../domain/appUpdateClient';
import {TaskQueue} from '../TaskQueue';
import './pro-v6.css';
export type StudioNavPage='home'|'workbench'|'asset'|'scene'|'team'|'dashboards'|'tasks'|'settings';
const NAV=[{page:'home',name:'项目工作台',label:'首页',icon:<HomeIcon/>},{page:'asset',name:'资产库',label:'资产库',icon:<CubeIcon/>},{page:'scene',name:'场景库',label:'场景库',icon:<LayersIcon/>},{page:'dashboards',name:'看板接入',label:'看板接入',icon:<LayersIcon/>},{page:'tasks',name:'任务中心',label:'任务记录',icon:<ClockIcon/>},{page:'team',name:'团队资源',label:'团队库',icon:<PersonIcon/>}] as const;
const LABELS:Record<StudioNavPage,string>={home:'项目工作台',asset:'资产库',scene:'场景库',workbench:'工作台',team:'团队资源',dashboards:'看板接入',tasks:'任务中心',settings:'设置'};
export function StudioShell({activePage,onNavigate,disabled,taskQueueRequest,onTaskOpen,onTaskHistory,children}:{activePage:StudioNavPage;onNavigate:(page:StudioNavPage)=>void;disabled:boolean;taskQueueRequest:number;onTaskOpen:()=>void;onTaskHistory:()=>void;children?:(workbenchUtilities:ReactNode)=>ReactNode}){
 const client=useSyncExternalStore(subscribeTeamSession,getTeamSession,getTeamSession),sessionStatus=useSyncExternalStore(subscribeTeamSession,getTeamSessionStatus,getTeamSessionStatus);
 const updatePending=useAppUpdate(hasPendingAppUpdate),{resolved}=useAppearance();
 const [loginOpen,setLoginOpen]=useState(false),[collapsed,setCollapsed]=useState(false);
 const loginDestination=useRef<'team'|'current'>('current'),previousClient=useRef(client);
 const workbench=activePage==='workbench';
 function requestLogin(destination:'team'|'current'='current'){loginDestination.current=destination;setLoginOpen(true);}
 useEffect(()=>{void restoreRememberedTeamSession();},[]);
 useEffect(()=>{if(client?.user&&loginOpen){setLoginOpen(false);if(loginDestination.current==='team')onNavigate('team');}if(previousClient.current&&!client&&activePage==='team')onNavigate('home');previousClient.current=client;},[client,loginOpen,activePage,onNavigate]);
 const account=<StudioAccount disabled={disabled} loginOpen={loginOpen} onLoginOpenChange={open=>open?requestLogin():setLoginOpen(false)} onTeam={()=>onNavigate('team')}/>;
 const expiryAction=sessionStatus==='expired'&&(workbench
  ?<Tooltip title="团队登录已过期，点击重新授权"><Button type="text" className="workbench-team-expired" aria-label="重新登录团队账户" icon={<ExclamationTriangleIcon/>} onClick={()=>requestLogin()}/></Tooltip>
  :<Button type="text" aria-label="重新登录团队账户" icon={<ExclamationTriangleIcon/>} onClick={()=>requestLogin()}><span role="status">团队登录已过期</span></Button>);
 const utilities=<div className="studio-global-utilities pro-studio-utilities">{expiryAction}<TaskQueue openRequest={taskQueueRequest} disabled={disabled} onOpen={onTaskOpen} onHistory={onTaskHistory}/><AppearanceMenu/></div>;
 const routes:MenuDataItem[]=NAV.map(item=>({path:'/'+item.page,name:item.name,icon:item.icon,page:item.page,accessibleLabel:item.label}));
 return <>
  {workbench&&<div hidden>{account}</div>}
  <ProLayout className="pro-studio-layout" title="Scenivo" logo={<span className="pro-brand-mark"><BrandMark/></span>} layout="mix" splitMenus={false}
   navTheme={resolved==='dark'?'realDark':'light'} contentWidth="Fluid" fixedHeader fixSiderbar siderWidth={224}
   collapsed={collapsed} onCollapse={setCollapsed} breakpoint="lg" locale="zh-CN" pageTitleRender={false}
   location={{pathname:'/'+activePage}} route={{path:'/',routes:[{path:'/workspace',name:'工作空间',type:'group',children:routes.filter(item=>['home','tasks'].includes(item.page))},{path:'/resources',name:'资源管理',type:'group',children:routes.filter(item=>['asset','scene','team','dashboards'].includes(item.page))}]}}
   menu={{locale:false,type:"group",defaultOpenAll:true}} menuProps={{'aria-label':'主导航',theme:'light'}}
   onMenuHeaderClick={()=>onNavigate('home')}
   menuItemRender={(item,dom)=>{const page=item.page as StudioNavPage;return <Button type="text" className="pro-studio-menu-link" aria-label={item.accessibleLabel} aria-current={activePage===page?'page':undefined} disabled={disabled} title={page==='team'&&!client?.user?'登录以访问团队资源':item.name} onClick={()=>page==='team'&&!client?.user?requestLogin('team'):page==='tasks'?onTaskHistory():onNavigate(page)}>{dom}{page==='team'&&!client?.user&&<LockClosedIcon className="pro-menu-lock"/>}</Button>;}}
   menuExtraRender={()=>collapsed?null:<span className="pro-studio-caption">本地工作空间</span>}
   menuFooterRender={()=> <div className="studio-sidebar-footer pro-studio-footer" data-collapsed={collapsed}><Button type="text" aria-label="设置" className="pro-settings-link" aria-current={activePage==='settings'?'page':undefined} disabled={disabled} onClick={()=>onNavigate('settings')}><GearIcon/>{!collapsed&&<span>设置</span>}{updatePending&&<Badge status="error" className="studio-settings-update" title="有新版本可用"/>}</Button>{account}</div>}
   headerContentRender={()=> <Breadcrumb items={[{title:'本地工作空间'},{title:LABELS[activePage]}]}/>}
   actionsRender={workbench?undefined:()=>[utilities]} avatarProps={false} footerRender={false}
   token={{header:{heightLayoutHeader:56},sider:{menuHeight:42,paddingInlineLayoutMenu:12,paddingBlockLayoutMenu:8,colorTextMenu:'var(--sc-ink-muted)',colorTextMenuSelected:'var(--sc-accent)',colorTextMenuItemHover:'var(--sc-ink)',colorBgMenuItemSelected:'var(--sc-accent-soft)'}}}
   contentStyle={{padding:0,minWidth:0,height:workbench?'100%':undefined}}>
   {children?.(workbench?utilities:null)}
  </ProLayout>
 </>;
}
export function StudioMain({children}:{children:ReactNode}){return <section className="studio-main pro-studio-main">{children}</section>;}
