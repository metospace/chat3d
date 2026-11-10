import {ProCard,ProTable} from '@ant-design/pro-components';
import {AppUpdateSettings} from './AppUpdateNotice';
import {AppearanceSettings} from './Appearance';
import {Badge,Button,Input,Select,Tabs,Tag,Drawer} from 'antd';
import {taskSummary} from './TaskQueue';
import {useMemo,useState,type ReactNode} from 'react';
import {ActivityLogIcon,GearIcon,DownloadIcon} from '@radix-ui/react-icons';
import {useWorkspaceStore,switchSession,getSessionEditor} from '../workspace';
import {createEditorStore} from '../store';
import {TaskPanel} from './TaskPanel';
import {StudioPage} from './studio/StudioPage';
import {StudioPageHeader} from './studio/StudioPageHeader';
import {hasPendingAppUpdate,useAppUpdate} from '../domain/appUpdateClient';
import './studio/settings-overview.css';
export function TaskCenter({onOpen}:{onOpen:()=>void;locked:boolean}){
 const w=useWorkspaceStore(),[query,setQuery]=useState(''),[error,setError]=useState(''),[filter,setFilter]=useState('all');
 const [selectedId,setSelectedId]=useState('');
 const selected=w.sessions.find(session=>session.id===selectedId&&!session.deletedAt);
 const taskEditor=useMemo(()=>selected?(getSessionEditor(selected.id)??createEditorStore({...selected.snapshot,aiStatus:selected.snapshot.wasRunning?'generating':selected.snapshot.pendingBatch?'previewing':'idle'})):undefined,[selected?.id,selected?.snapshot]);
 const tasks=w.sessions.filter(s=>!s.deletedAt).map(s=>{const summary=taskSummary(s),waiting=s.snapshot.messages.some(m=>m.queuedTask?.status==='waiting');const status=summary.group==='running'?'running':summary.group==='review'?'review':waiting?'waiting':summary.label==='失败'?'failed':'completed';return {session:s,summary,status,waiting};}).filter(t=>t.summary.visible||t.waiting);
 const labels:Record<string,string>={all:'全部任务',waiting:'待处理',running:'执行中',review:'待确认',failed:'失败',completed:'已完成 / 已停止'};
 const projects=tasks.filter(t=>t.session.title.toLowerCase().includes(query.trim().toLowerCase())&&(filter==='all'||filter===t.status)).sort((a,b)=>b.session.updatedAt-a.session.updatedAt);
 return <StudioPage className="pro-task-page"><StudioPageHeader title="任务中心" description="跨项目查看生成进展。查看记录保持当前项目，进入项目后再继续操作。"/>
  <div className="task-center-summary"><span><i/>{tasks.filter(task=>task.status==='running').length} 个正在执行</span><span>{tasks.filter(task=>task.status==='review').length} 个待确认</span><span>{tasks.filter(task=>task.status==='waiting').length} 个待处理</span></div>
  <ProTable rowKey={row=>row.session.id} dataSource={projects} search={false} headerTitle="全部任务" pagination={{pageSize:8,showSizeChanger:false}} options={{reload:false,density:true,setting:true,fullScreen:true}} size="middle"
   toolBarRender={()=>[<Input key="query" aria-label="搜索任务项目" placeholder="搜索项目名称" value={query} onChange={event=>setQuery(event.target.value)} allowClear/>,<Select key="status" aria-label="任务状态" value={filter} onChange={setFilter} style={{width:160}} options={Object.entries(labels).map(([value,label])=>({value,label:label+` (${value==='all'?tasks.length:tasks.filter(task=>task.status===value).length})`}))}/>]}
   columns={[
    {title:'项目',dataIndex:'title',render:(_,row)=><Button type="link" className="pro-task-project" aria-pressed={selectedId===row.session.id} onClick={()=>setSelectedId(row.session.id)}>{row.session.title}</Button>},
    {title:'状态',dataIndex:'status',width:140,render:(_,row)=><Tag color={row.status==='failed'?'error':row.status==='review'?'warning':row.status==='running'?'processing':'default'}>{row.status==='completed'?row.summary.label:labels[row.status]}</Tag>},
    {title:'更新时间',dataIndex:'updated',valueType:'dateTime',width:190,render:(_,row)=>new Date(row.session.updatedAt).toLocaleString('zh-CN')},
    {title:'下一步',dataIndex:'next',render:(_,row)=>row.waiting?(row.status==='running'?'打开对话：可用时点“引导”送入当前任务':'打开对话：点“准备发送”，确认后发送'):row.status==='review'?'检查并确认预览':row.status==='failed'?'查看原因并重试':'查看执行记录'},
    {title:'操作',valueType:'option',width:180,render:(_,row)=><div className="pro-inline-actions"><Button type="link" onClick={()=>setSelectedId(row.session.id)}>查看记录</Button><Button type="link" onClick={()=>{if(switchSession(row.session.id))onOpen();else setError('请先处理工作区保存异常');}}>打开项目</Button></div>}
   ]} locale={{emptyText:tasks.length?'没有符合筛选条件的任务':'暂无任务，开始创作后会显示执行进展'}}/>
  {error&&<p role="alert">{error}</p>}
  <Drawer open={!!selected&&!!taskEditor} title={selected?.title??'任务详情'} onClose={()=>setSelectedId('')} size={520}>{taskEditor&&<TaskPanel editor={taskEditor} onConversation={()=>{if(selected&&switchSession(selected.id)){setSelectedId('');onOpen();}else setError('请先处理工作区保存异常');}}/>}</Drawer>
 </StudioPage>;

}
export function StudioSettings({onModel,onBackup,onHistory,onAssets,onTeam}:{onModel:()=>void;onBackup:()=>void;onAssets:()=>void;onHistory:()=>void;onTeam?:()=>void}){
 const updatePending=useAppUpdate(hasPendingAppUpdate);
 const section=(title:string,children:ReactNode)=><ProCard className="settings-section" title={<h2>{title}</h2>}>{children}</ProCard>;
 return <StudioPage className="settings-page settings-overview">
  <StudioPageHeader title="设置" description="管理创作偏好、数据与应用。"/>
  <Tabs className="settings-category-tabs" aria-label="设置分类" items={[
   {key:'general',label:'通用',children:section('通用',<>
    <div className="settings-option"><span className="settings-option-icon"><GearIcon/></span><div><h3>外观</h3><p>选择浅色、深色或跟随系统</p></div><AppearanceSettings/></div>
    <div className="settings-option"><span className="settings-option-icon"><GearIcon/></span><div><h3>模型与执行</h3><p>连接模型服务，调整生成方式与任务预算</p></div><Button onClick={onModel}>模型配置</Button></div>
   </>)},
   {key:'data',label:'数据管理',children:<>{section('数据管理',<>
    <div className="settings-option"><span className="settings-option-icon"><DownloadIcon/></span><div><h3>备份与恢复</h3><p>导出项目与文字对话；恢复时新增项目，保留原件</p></div><Button onClick={onBackup}>管理项目备份</Button></div>
    <div className="settings-option"><span className="settings-option-icon"><ActivityLogIcon/></span><div><h3>项目与回收站</h3><p>查找旧项目，恢复已删除的内容</p></div><Button onClick={onHistory}>管理项目</Button></div>
    <div className="settings-option"><span className="settings-option-icon"><DownloadIcon/></span><div><h3>资产版本与备份</h3><p>导出可复用资产及其版本历史</p></div><Button onClick={onAssets}>管理资产备份</Button></div>
   </>)}<p className="settings-data-note">项目保存在当前应用中，网页版保存在当前浏览器。工作区备份不包含模型密钥、参考图片及撤销记录，清理数据或更换设备前请先备份。</p></>},
   ...(onTeam?[{key:'team',label:'团队连接',children:section('团队连接',<div className="settings-option"><span className="settings-option-icon"><GearIcon/></span><div><h3>团队服务与账户</h3><p>登录后访问团队资源，本地项目由你手动发布</p></div><Button onClick={onTeam}>管理团队连接</Button></div>)}]:[]),
   {key:'about',label:<span className="settings-about-tab">关于{updatePending&&<Badge status="error" title="有新版本可用"/>}</span>,children:<AppUpdateSettings/>}
  ]}/>
 </StudioPage>;
}
