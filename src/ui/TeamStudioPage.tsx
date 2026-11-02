import {Button} from 'antd';
import {CubeIcon,LayersIcon,Share1Icon} from '@radix-ui/react-icons';
import {useState,useSyncExternalStore} from 'react';
import {getTeamSession,subscribeTeamSession} from '../domain/teamLibrary';
import {TeamLibraryPane} from './TeamLibraryPane';
import {StudioPage} from './studio/StudioPage';
import {StudioPageHeader} from './studio/StudioPageHeader';

export function TeamStudioPage({onCopied}:{onCopied?:()=>void}){
 const client=useSyncExternalStore(subscribeTeamSession,getTeamSession,getTeamSession),[kind,setKind]=useState<'asset'|'scene'>('asset');
 return <StudioPage className="resource-page team-studio-page" aria-label="团队共享">
 <StudioPageHeader eyebrow="协作资源" title="团队库" description="按需共享已保存资源。手动获取固定版本，关联更新始终保留旧副本，不自动同步本地草稿。" icon={<Share1Icon aria-hidden/>}/>
 {client&&<div className="resource-toolbar team-studio-toolbar"><div className="resource-segments" role="group" aria-label="团队库类型"><Button aria-pressed={kind==='asset'} onClick={()=>setKind('asset')}><CubeIcon/>团队资产</Button><Button aria-pressed={kind==='scene'} onClick={()=>setKind('scene')}><LayersIcon/>团队场景</Button></div></div>}
 <section className="team-studio-body"><TeamLibraryPane kind={kind} onCopied={onCopied}/></section>
 <footer className="resource-footer team-studio-footer"><span>团队原件保存在公司服务；本机保存独立副本与版本关联。所有发布和更新都需要手动确认。</span></footer>
 </StudioPage>;
}
