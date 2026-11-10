import {useEffect,useRef,useState,useSyncExternalStore} from 'react';
import {Button} from 'antd';
import {ArrowRightIcon,ChevronUpIcon,Cross1Icon,ExitIcon,LockClosedIcon,PersonIcon} from '@radix-ui/react-icons';
import {getTeamSession,getTeamSessionStatus,logoutTeamSession,subscribeTeamSession} from '../../domain/teamLibrary';
import {TeamSessionLogin} from '../TeamTransferDialog';
import {PortalDialog} from '../kit/PortalDialog';
import {PopoverPanel} from '../kit/PopoverPanel';

export function StudioAccount({disabled,loginOpen,onLoginOpenChange,onTeam}:{disabled:boolean;loginOpen:boolean;onLoginOpenChange:(open:boolean)=>void;onTeam:()=>void}){
 const client=useSyncExternalStore(subscribeTeamSession,getTeamSession,getTeamSession);
 const sessionStatus=useSyncExternalStore(subscribeTeamSession,getTeamSessionStatus,getTeamSessionStatus);
 const [busy,setBusy]=useState(false),[error,setError]=useState(''),[menuOpen,setMenuOpen]=useState(false);const triggerRef=useRef<HTMLButtonElement>(null);
 const user=client?.user;
 const role=user?.role==='admin'?'团队管理员':user?.role==='viewer'?'只读成员':'团队成员';
 useEffect(()=>{if(user)setError('');},[user]);
 useEffect(()=>{if(!user)setMenuOpen(false);},[user]);
 async function signOut(){setBusy(true);setError('');setMenuOpen(false);try{await logoutTeamSession();}catch{if(!getTeamSession()?.user)setError('已退出本机账户，服务端注销暂未完成。');}finally{setBusy(false);}}
 // antd flattens element children but wraps a fragment in a single span, so the trigger
 // receives the avatar, the copy and the chevron as an array of siblings.
 const identity=[
  <span key="avatar" className={`studio-account-avatar${user?' is-connected':''}`} aria-hidden="true">{user?Array.from(user.name.trim())[0]||<PersonIcon/>:<PersonIcon/>}</span>,
  <span key="copy" className="studio-account-copy"><strong>{user?.name||(sessionStatus==='restoring'?'正在恢复账户':sessionStatus==='expired'?'登录已过期':'登录账户')}</strong><small>{user?`${role} · 已登录`:'访问团队库'}</small></span>,
  user?<ChevronUpIcon key="chevron" className="studio-account-chevron"/>:<ArrowRightIcon key="chevron" className="studio-account-chevron"/>,
 ];
 // antd menus render their own role=menuitem list; this popup carries the menu itself so it
 // unmounts the moment an item is chosen instead of waiting for a leave motion.
 return <>
  {user
   ?<><Button ref={triggerRef} type="text" className="studio-account-trigger" disabled={disabled||busy} aria-label={`账户菜单：${user.name}`} aria-haspopup="menu" aria-expanded={menuOpen} onClick={()=>setMenuOpen(open=>!open)} onKeyDown={event=>{if(event.key==='Enter'||event.key===' '||event.key==='ArrowDown'){event.preventDefault();setMenuOpen(true);}}}>{identity}</Button>
     <PopoverPanel anchor={triggerRef} open={menuOpen} onClose={()=>setMenuOpen(false)} label="账户菜单">
      <div className="studio-account-menu" role="menu" aria-label="账户菜单">
       <p className="studio-account-menu-label">{user.name} · {role}</p>
       <button type="button" role="menuitem" className="studio-account-menu-item" onClick={()=>{setMenuOpen(false);onTeam();}}><PersonIcon/>查看团队库</button>
       <div className="studio-account-menu-divider" role="separator"/>
       <button type="button" role="menuitem" className="studio-account-menu-item" disabled={busy} onClick={()=>void signOut()}><ExitIcon/>退出登录</button>
      </div>
     </PopoverPanel></>
   :<Button type="text" className="studio-account-trigger" disabled={disabled||busy} aria-label="登录账户" onClick={()=>{setError('');onLoginOpenChange(true);}}>{identity}</Button>}
  {error&&<p className="studio-account-error" role="alert">{error}</p>}
  {loginOpen&&!user&&<PortalDialog label="登录，连接你的团队" onClose={()=>onLoginOpenChange(false)} width={440} className="studio-login-dialog">
   <div className="studio-login-heading"><span className="studio-login-symbol" aria-hidden="true"><LockClosedIcon/></span><Button type="text" aria-label="关闭账户登录" onClick={()=>onLoginOpenChange(false)}><Cross1Icon/></Button></div>
   <h2 className="app-modal-title">登录，连接你的团队</h2>
   <p className="app-modal-description">访问所属团队的资产与场景，让创作成果与同事共享。</p>
   {sessionStatus==='expired'&&<p className="studio-login-expired" role="status">团队登录已过期，请重新授权。本地项目与未发送内容均已保留。</p>}
   <TeamSessionLogin/>
   <p className="studio-login-scope">账户登录用于访问团队库和看板库。AI 模型服务在「设置 → 模型与执行」中单独配置。</p>
   <div className="studio-login-local"><strong>本地创作始终可用</strong><p>无需登录即可创建、编辑和保存本地项目。登录不会自动上传你的内容。</p><Button type="text" onClick={()=>onLoginOpenChange(false)}>继续使用本地资源<ArrowRightIcon/></Button></div>
  </PortalDialog>}
 </>;
}
