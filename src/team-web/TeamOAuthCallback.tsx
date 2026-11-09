import {useEffect,useRef,useState} from 'react';
import {completeTeamOAuthCallbackPage,defaultTeamServiceBase} from '../domain/teamLibrary';
import {clearPlatformOAuthCallbackFromUrl,parsePlatformOAuthCallback} from '../domain/platformOAuth';
import '../ui/theme/legacy-tokens.css';
import './oauth-callback.css';

export default function TeamOAuthCallback(){
 const [callback]=useState(()=>parsePlatformOAuthCallback());
 const completion=useRef<Promise<unknown>|undefined>(undefined);
 const [status,setStatus]=useState<'waiting'|'success'|'error'>('waiting');
 const [error,setError]=useState('');
 useEffect(()=>{
  clearPlatformOAuthCallbackFromUrl();
  if(!callback){setError('此页面没有有效的授权结果，请返回原工作空间重新点击「登录授权」。');setStatus('error');return;}
  let alive=true;
  const pending=completion.current??=completeTeamOAuthCallbackPage(callback,{base:defaultTeamServiceBase()});
  void pending.then(()=>{if(alive)setStatus('success');},reason=>{if(alive){setError(reason instanceof Error?reason.message:'协同登录未完成');setStatus('error');}});
  return ()=>{alive=false;};
 },[callback]);
 return <main className="oauth-callback-page"><section className="oauth-callback-card" aria-label="协同登录结果">
  <p className="oauth-callback-brand">Scenivo</p>
  <h1>{status==='waiting'?'正在完成协同登录…':status==='success'?'登录授权已完成':'登录授权未完成'}</h1>
  {status==='waiting'&&<p role="status">正在安全兑换授权结果，请勿刷新此页。</p>}
  {status==='success'&&<p role="status">请返回发起登录的 Web 工作空间或客户端，登录状态会自动更新。此页可以关闭。</p>}
  {status==='error'&&<><p className="oauth-callback-error" role="alert">{error}</p><p>原项目和草稿不会清除。请返回原窗口重新授权，不要刷新并重复使用授权码。</p></>}
  {status!=='waiting'&&<a href="/team/">打开 Web 工作空间</a>}
 </section></main>;
}
