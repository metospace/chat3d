import {useEffect,useRef,useState} from 'react';
import {Button,Input,Tag} from 'antd';
import {CubeIcon,LayersIcon,MagnifyingGlassIcon,LockClosedIcon,PersonIcon,DesktopIcon} from '@radix-ui/react-icons';
import {TeamClient,beginTeamAuthorization,completeTeamOAuthCallbackPage,defaultTeamServiceBase,rememberTeamServiceBase,resumeTeamFromPlatformAuth,type TeamItem,type TeamVersion} from '../domain/teamLibrary';
import {parsePlatformOAuthCallback,showTeamPasswordLogin} from '../domain/platformOAuth';
import {assetDocument,parseModelAsset} from '../domain/modelAssets';
import {parseProject} from '../domain/project';
import {captureLibraryThumbnail} from '../scene/libraryThumbnail';
import {downloadTeamCopyFile} from '../domain/teamCopyExport';
import {BrandMark} from '../ui/BrandMark';

export function TeamWebApp(){
 const address=defaultTeamServiceBase()||window.location.origin;
 const [kind,setKind]=useState<'asset'|'scene'>('asset'),[teamUser,setTeamUser]=useState(''),[teamPassword,setTeamPassword]=useState(''),[client,setClient]=useState<TeamClient>(),[rows,setRows]=useState<TeamItem[]>([]),[query,setQuery]=useState(''),[busy,setBusy]=useState(false),[notice,setNotice]=useState(''),[preview,setPreview]=useState<TeamVersion>(),[image,setImage]=useState(''),[waiting,setWaiting]=useState(false);
 const lock=useRef(false);
 const debugPassword=showTeamPasswordLogin();
 const [oauthCallback]=useState(()=>parsePlatformOAuthCallback());
 const isOAuthCallback=/\/team\/sso\/callback\/?$/.test(window.location.pathname)||Boolean(oauthCallback);
 const callbackCompletion=useRef<Promise<TeamClient>|undefined>(undefined);
 const [callbackDone,setCallbackDone]=useState(false);
 useEffect(()=>{
  if(!isOAuthCallback||!oauthCallback)return;
  let alive=true;
  setWaiting(true);setNotice('');setCallbackDone(false);
  // Exchange once so the desktop can claim by state; do NOT enter the portal team library here.
  const completion=callbackCompletion.current??=completeTeamOAuthCallbackPage(oauthCallback,{base:address});
  void completion.then(()=>{if(alive)setCallbackDone(true);}).catch(e=>{if(alive)setNotice(e instanceof Error?e.message:'协同登录失败');}).finally(()=>{if(alive)setWaiting(false);});
  return ()=>{alive=false;};
 },[isOAuthCallback,address,oauthCallback]);
 useEffect(()=>{if(client||!address||isOAuthCallback)return;let alive=true;void resumeTeamFromPlatformAuth(address).then(async next=>{if(!alive||!next)return;setClient(next);try{setRows(await next.list(kind));}catch{/* keep form */}});return ()=>{alive=false;};},[address,client,kind,isOAuthCallback]);
 const kindLabel=kind==='asset'?'资产':'场景';
 async function run(fn:()=>Promise<void>){if(lock.current)return;lock.current=true;setBusy(true);setNotice('');try{await fn();}catch(e){setNotice(e instanceof Error?e.message:'操作失败，可重试');}finally{lock.current=false;setBusy(false);}}
 if(isOAuthCallback){
  const title=waiting?'正在完成协同登录…':callbackDone?'协同登录已完成，请返回应用':notice?'协同登录未完成':'协同登录';
  const hint=callbackDone?'':'可关闭本页并返回 Scenivo；桌面端会自动完成登录。';
  return <div className="team-web-shell"><main className="team-web-main"><section className="team-login-card"><h2>{title}</h2>{hint&&<p>{hint}</p>}{notice&&<p className="team-error" role="alert">{notice}</p>}{!!notice&&!waiting&&<p className="team-security-note">请返回 Scenivo，重新点击「登录授权」后再试。</p>}</section></main></div>;
 }
 return <div className="team-web-shell">
 <header className="team-web-header"><BrandMark/><div><strong>Scenivo</strong><span>团队库 · 浏览器轻量版</span></div></header>
 <main className="team-web-main resource-page team-web-page">
 <header className="resource-heading team-web-heading"><div><span className="resource-eyebrow">公司共享</span><h1>浏览公司共享的 3D {kindLabel}</h1><p>登录后可搜索、预览固定版本，并下载可在桌面 Scenivo 导入的副本包。本页不提供 AI 生成或在线编辑；发布请在桌面客户端「团队」页完成。</p></div></header>
 {client&&<div className="resource-toolbar team-web-kind-bar"><div className="resource-segments team-web-kind" role="group" aria-label="内容类型"><Button aria-pressed={kind==='asset'} onClick={()=>void run(async()=>{setKind('asset');setPreview(undefined);setImage('');if(client)setRows(await client.list('asset',query));})}><CubeIcon/>团队资产</Button><Button aria-pressed={kind==='scene'} onClick={()=>void run(async()=>{setKind('scene');setPreview(undefined);setImage('');if(client)setRows(await client.list('scene',query));})}><LayersIcon/>团队场景</Button></div></div>}
 <div className="team-panel team-web-panel">
 {!client?<section className="team-auth-layout team-web-auth">
 <div className="team-auth-intro">
 <p className="team-auth-eyebrow">浏览器轻量版</p>
 <h2>登录团队服务</h2>
 <p>与桌面端相同的团队库内容，适合快速查阅与下载导入包。</p>
 <ul className="team-auth-points">
 <li><DesktopIcon aria-hidden/> 下载包可在桌面 Scenivo 导入</li>
 <li><PersonIcon aria-hidden/> 使用公司协同账号授权</li>
 <li><LockClosedIcon aria-hidden/> 关闭页面后需重新授权（可记住协同令牌）</li>
 </ul>
 </div>
 <form className="team-login-card" onSubmit={e=>{e.preventDefault();void run(async()=>{setWaiting(true);try{const next=await beginTeamAuthorization({base:address});setClient(next);setRows(await next.list(kind));}finally{setWaiting(false);}});}}>
 <header><h3>登录团队库</h3><p>点击登录授权，在协同平台完成登录后自动返回。</p></header>
 <div className="team-login-actions"><Button htmlType="submit" disabled={busy}>{busy||waiting?'等待协同登录…':'登录授权'}</Button></div>
 {waiting&&!notice&&<p className="team-security-note">已打开协同登录，请在浏览器完成授权后回到本页。</p>}
 {debugPassword&&<>
 <label className="team-field"><span className="team-field-label">团队账号</span><Input aria-label="团队账号" autoComplete="username" value={teamUser} onChange={e=>setTeamUser(e.target.value)} disabled={busy}/></label>
 <label className="team-field"><span className="team-field-label">团队密码</span><Input aria-label="团队密码" type="password" autoComplete="current-password" value={teamPassword} onChange={e=>setTeamPassword(e.target.value)} disabled={busy}/></label>
 <div className="team-login-actions"><Button htmlType="button" disabled={busy} onClick={()=>void run(async()=>{const next=new TeamClient(address);await next.login(teamUser,teamPassword);rememberTeamServiceBase(next.base);setTeamPassword('');setClient(next);setRows(await next.list(kind));})}>使用团队密码登录</Button></div>
 </>}
 </form>
 </section>:<div className="team-workspace">
 <header className="team-session-bar team-web-session"><div><strong>{client.user?.name}</strong><span className="team-session-meta"><Tag variant="filled">{client.user?.role}</Tag> · 已连接</span></div><Button disabled={busy} onClick={()=>void run(async()=>{try{await client.logout();}finally{setClient(undefined);setRows([]);setPreview(undefined);setImage('');}})}>退出</Button></header>
 <form className="team-search-bar team-web-search" onSubmit={e=>{e.preventDefault();void run(async()=>setRows(await client.list(kind,query)));}}><Input className="team-search-input" aria-label="搜索团队库" value={query} onChange={e=>setQuery(e.target.value)} placeholder="搜索名称、说明" prefix={<MagnifyingGlassIcon/>}/><Button disabled={busy}>搜索</Button></form>
 <div className={`team-browser resource-browser team-web-browser ${preview?'has-detail':''}`}>
 <section className="team-results-wrap"><div className="team-results-heading resource-results-heading"><span>团队{kindLabel}</span><span>{rows.length} 项结果</span></div>
 <div className="team-results team-web-results">{rows.length===0?<div className="team-empty-state"><p className="team-empty">暂无匹配内容。</p></div>:rows.map(row=><article key={row.id} className="team-result-card"><div className="team-result-body"><strong>{row.name}</strong><Tag variant="filled">v{row.version}</Tag>{row.description&&<p>{row.description}</p>}</div><Button disabled={busy} onClick={()=>void run(async()=>{const value=await client.read(row);const doc=value.kind==='asset'?assetDocument(parseModelAsset(JSON.stringify(value.payload))):parseProject(JSON.stringify(value.payload));setPreview(value);setImage('');setImage((await captureLibraryThumbnail(doc)).image);})}>预览</Button></article>)}</div></section>
 {preview&&<aside className="team-preview team-web-preview" aria-label="预览"><div className="team-preview-head"><h3>{preview.name}</h3><Button type="text" aria-label="关闭预览" onClick={()=>{setPreview(undefined);setImage('');}}>关闭</Button></div><p className="team-preview-version">v{preview.version}</p>{image?<img src={image} alt={`${preview.name} 预览`}/>:<div className="team-preview-placeholder">正在生成预览…</div>}<p className="team-preview-copy">下载副本后，在桌面 Scenivo 导入：资产 JSON → 资产库「模型资产库」；场景文件 → 工作台「打开项目」。</p><Button disabled={busy} onClick={()=>void run(async()=>setNotice(downloadTeamCopyFile(preview)))}>下载桌面导入包</Button></aside>}
 </div>
 </div>}
 {(notice||busy)&&<p className={`team-status team-web-notice${notice?' is-notice':''}`} role="status">{busy?'处理中…':notice}</p>}
 </div>
 </main>
 <footer className="team-web-footer resource-footer"><span>数据保存在公司团队服务；会话关闭后需重新登录。</span></footer>
 </div>;
}
