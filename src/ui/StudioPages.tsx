import {AppUpdateSettings} from './AppUpdateNotice';
import {AppearanceSettings} from './Appearance';
import {Button,Input} from 'antd';
import {useState} from 'react';
import {ActivityLogIcon,GearIcon,DownloadIcon} from '@radix-ui/react-icons';
import {useWorkspaceStore,switchSession} from '../workspace';
import {TaskPanel} from './TaskPanel';
import {StudioPage} from './studio/StudioPage';
import {StudioPageHeader} from './studio/StudioPageHeader';
export function TaskCenter({onOpen}:{onOpen:()=>void;locked:boolean}){const w=useWorkspaceStore(),[query,setQuery]=useState(''),[error,setError]=useState('');const projects=w.sessions.filter(s=>!s.deletedAt&&(s.snapshot.lastRun||s.snapshot.messages.some(m=>m.run))).filter(s=>s.title.toLowerCase().includes(query.toLowerCase()));return <StudioPage className="task-center"><StudioPageHeader eyebrow="项目执行历史" title="任务记录" description="按项目查看实际执行过程、用量与修改结果。" icon={<ActivityLogIcon/>}/><div className="task-center-layout"><aside><Input size="large" aria-label="搜索任务项目" placeholder="搜索项目名称" value={query} onChange={e=>setQuery(e.target.value)}/>{projects.map(s=><Button key={s.id} className="task-project-btn" disabled={!!w.error} aria-pressed={w.activeId===s.id} onClick={()=>{if(!switchSession(s.id))setError('请先处理工作区保存异常');}}><strong>{s.title}</strong><small>{s.snapshot.wasRunning?'正在执行':s.snapshot.pendingBatch?'待确认预览':'查看执行记录'}</small></Button>)}{!projects.length&&<p className="resource-muted">暂无匹配任务。执行一次建模后，记录会出现在这里。</p>}{error&&<p role="alert">{error}</p>}</aside><section><h2 className="task-project-title">{w.sessions.find(s=>s.id===w.activeId)?.title}</h2><TaskPanel onConversation={onOpen}/></section></div></StudioPage>;}
export function StudioSettings({onModel,onBackup,onHistory}:{onModel:()=>void;onBackup:()=>void;onAssets:()=>void;onHistory:()=>void}){return <StudioPage className="settings-page settings-refresh">
 <StudioPageHeader eyebrow="偏好与管理" title="设置" description="让 Scenivo 按你的习惯工作。"/>
 <div className="settings-groups"><section className="settings-group"><header><h2>通用</h2><p>外观和建模服务</p></header><div className="settings-row"><span className="settings-icon"><GearIcon/></span><div><h3>外观</h3><p>选择浅色、深色或跟随系统</p></div><AppearanceSettings/></div><div className="settings-row"><span className="settings-icon"><GearIcon/></span><div><h3>模型与执行</h3><p>连接模型服务，调整生成方式与任务预算</p></div><Button type="primary" onClick={onModel}>模型配置</Button></div></section>
 <section className="settings-group"><header><h2>数据管理</h2><p>备份项目，找回历史内容</p></header><div className="settings-row"><span className="settings-icon"><DownloadIcon/></span><div><h3>备份与恢复</h3><p>导出项目与对话，或从备份新增项目</p></div><Button onClick={onBackup}>管理项目备份</Button></div><div className="settings-row"><span className="settings-icon"><ActivityLogIcon/></span><div><h3>项目与回收站</h3><p>查找旧项目，恢复已删除的内容</p></div><Button onClick={onHistory}>管理项目</Button></div></section><AppUpdateSettings/></div>
 <p className="settings-storage-note">数据保存在当前设备，不会自动同步。清理应用数据或更换设备前，请先备份。资产的导入与备份在资产库中管理。</p>
 </StudioPage>;}
