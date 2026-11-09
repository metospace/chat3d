import {useEffect,useState} from 'react';
import type {DashboardPackage} from '../../shared/dashboard-package.mjs';
import type {DashboardBinding} from '../domain/dashboard';
import {buildDashboardPreview} from '../scene/dashboardRuntime';
import './dashboard.css';

export interface DashboardPresentationProps {
  pack:DashboardPackage;
  binding:DashboardBinding;
  sceneHtml?:string;
}

export function DashboardPresentation({pack,binding,sceneHtml}:DashboardPresentationProps) {
  const [preview,setPreview]=useState<{pack:DashboardPackage;html:string}|null>(null);
  const [failure,setFailure]=useState<{pack:DashboardPackage;message:string}|null>(null);
  const [loaded,setLoaded]=useState(false);
  useEffect(()=>{
    let active=true;
    setPreview(null);setFailure(null);setLoaded(false);
    void buildDashboardPreview(pack,sceneHtml?{binding,sceneHtml}:undefined).then(result=>{
      if(!active)return;
      setPreview({pack,html:result.html});
    }).catch((error:unknown)=>{
      if(active)setFailure({pack,message:error instanceof Error?error.message:String(error)});
    });
    return ()=>{active=false;};
  },[pack,binding,sceneHtml]);
  const current=preview?.pack===pack?preview:null;
  const error=failure?.pack===pack?failure.message:null;
  const composition=sceneHtml?'integrated':'preview';
  return <section className={`dashboard-presentation dashboard-presentation--${composition}`} aria-label={binding.name||'看板预览'} aria-busy={!error&&(!current||!loaded)}>
    {current&&<iframe key={current.html} className="dashboard-template-frame" title={`${binding.name||'看板'} — 集成看板`} srcDoc={current.html} sandbox="allow-scripts" referrerPolicy="no-referrer" onLoad={()=>setLoaded(true)}/>}
    {error?<div className="dashboard-preview-status dashboard-preview-status--error" role="alert"><strong>无法预览看板</strong><span>{error}</span></div>:(!current||!loaded)&&<div className="dashboard-preview-status" role="status">正在载入看板…</div>}
  </section>;
}
