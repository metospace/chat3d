import {useEffect,useRef,useState,type DragEvent} from 'react';
import {Alert,AutoComplete,Button,Input,Modal,Progress,Select} from 'antd';
import {Cross2Icon,FileIcon,UploadIcon} from '@radix-ui/react-icons';
import type {TeamClient} from '../domain/teamLibrary';
import type {DashboardItem} from '../domain/dashboard';
import {selectDashboardFiles,uploadDashboard,type DashboardSelection,type DashboardUploadProgress} from '../domain/dashboardUpload';
import {CategoryFolderIcon as FolderIcon} from './LibraryCategoryTree';
import {OperationProgress,nextProgressPaint} from './OperationProgress';

export function formatDashboardBytes(bytes:number) {
  if(bytes<1024)return `${bytes.toLocaleString()} B`;
  const units=['KiB','MiB','GiB','TiB'];
  let value=bytes/1024,index=0;
  while(value>=1024&&index<units.length-1){value/=1024;index++;}
  return `${value.toLocaleString(undefined,{maximumFractionDigits:value<10?2:1})} ${units[index]}`;
}

interface DroppedEntry {
  isFile:boolean;
  isDirectory:boolean;
  name:string;
  file:(success:(file:File)=>void,failure:(error:DOMException)=>void)=>void;
  createReader:()=>{readEntries:(success:(entries:DroppedEntry[])=>void,failure:(error:DOMException)=>void)=>void};
}

async function readDroppedEntry(entry:DroppedEntry,parent=''):Promise<File[]> {
  const path=parent?`${parent}/${entry.name}`:entry.name;
  if(entry.isFile){
    const file=await new Promise<File>((resolve,reject)=>entry.file(resolve,reject));
    Object.defineProperty(file,'webkitRelativePath',{value:path,configurable:true});
    return [file];
  }
  if(!entry.isDirectory)return [];
  const reader=entry.createReader(),files:File[]=[];
  while(true){
    const children=await new Promise<DroppedEntry[]>((resolve,reject)=>reader.readEntries(resolve,reject));
    if(!children.length)break;
    for(const child of children)files.push(...await readDroppedEntry(child,path));
  }
  return files;
}

interface Props {
  client:TeamClient;
  target?:DashboardItem;
  systems:string[];
  onClose:()=>void;
  onPublished:()=>void;
}

export function DashboardUploadDialog({client,target,systems,onClose,onPublished}:Props) {
  const [name,setName]=useState(target?.name??'');
  const [description,setDescription]=useState(target?.description??'');
  const [system,setSystem]=useState(target?.system??'');
  const [entry,setEntry]=useState('');
  const [selection,setSelection]=useState<DashboardSelection>();
  const [preparing,setPreparing]=useState(false);
  const [preparationStage,setPreparationStage]=useState('正在读取与检查源码');
  const [uploading,setUploading]=useState(false);
  const [dragging,setDragging]=useState(false);
  const [error,setError]=useState('');
  const [progress,setProgress]=useState<DashboardUploadProgress>();
  const [touched,setTouched]=useState({name:false,system:false});
  const fileInput=useRef<HTMLInputElement>(null),folderInput=useRef<HTMLInputElement>(null);
  const controller=useRef<AbortController|undefined>(undefined);
  const preparation=useRef(0),locked=useRef(false);
  const retry=useRef<{identity:string;key:string}|undefined>(undefined);
  const selectionRevision=useRef(0);
  const busy=preparing||uploading;
  useEffect(()=>()=>{preparation.current++;controller.current?.abort();},[]);

  function changed(){retry.current=undefined;setError('');setProgress(undefined);}
  async function prepare(files:File[],kind:'file'|'folder') {
    if(locked.current)return;
    const current=++preparation.current;
    changed();setPreparing(true);setPreparationStage('正在读取与检查源码');
    try{
      await nextProgressPaint();
      if(current!==preparation.current)return;
      const next=await selectDashboardFiles(files,kind);
      if(current!==preparation.current)return;
      selectionRevision.current++;
      setSelection(next);
      setEntry(previous=>next.entries.includes(previous)?previous:next.entries.includes(target?.entry??'')?target!.entry:next.entries[0]??'');
      setName(previous=>previous.trim()?previous:next.name.replace(/\.(zip|html?)$/i,'').slice(0,80));
    }catch(reason){
      if(current===preparation.current){
        setSelection(undefined);setEntry('');
        setError(reason instanceof Error?reason.message:String(reason));
      }
    }
    finally{if(current===preparation.current)setPreparing(false);}
  }
  function reset(){
    changed();preparation.current++;selectionRevision.current++;
    setSelection(undefined);setEntry('');
    if(fileInput.current)fileInput.current.value='';
    if(folderInput.current)folderInput.current.value='';
  }
  function removeFile(path:string) {
    if(!selection)return;
    const files=selection.files.filter(value=>value.path!==path);
    if(!files.length){reset();return;}
    changed();selectionRevision.current++;
    const entries=selection.entries.filter(value=>value!==path);
    setSelection({...selection,files,entries,totalBytes:files.reduce((total,value)=>total+value.file.size,0)});
    if(!entries.includes(entry))setEntry(entries[0]??'');
  }
  async function drop(event:DragEvent<HTMLDivElement>) {
    event.preventDefault();setDragging(false);
    if(busy||locked.current)return;
    const entries=Array.from(event.dataTransfer.items).map(item=>item.webkitGetAsEntry() as unknown as DroppedEntry|null).filter((value):value is DroppedEntry=>value!==null);
    if(entries.some(value=>value.isDirectory)){
      const current=++preparation.current;
      changed();setPreparing(true);setPreparationStage('正在扫描拖放目录与读取文件');
      try{
        await nextProgressPaint();
        if(current!==preparation.current)return;
        const files:File[]=[];
        for(const value of entries)files.push(...await readDroppedEntry(value));
        if(current===preparation.current)await prepare(files,'folder');
      }catch(reason){if(current===preparation.current){setError(reason instanceof Error?reason.message:String(reason));setPreparing(false);}}
    }else await prepare(Array.from(event.dataTransfer.files),'file');
  }

  const nameError=!name.trim()?'请填写模板名称':name.trim().length>80?'模板名称最多 80 个字符':'';
  const systemError=!system.trim()?'请填写或选择所属系统':system.trim().length>80?'所属系统最多 80 个字符':'';
  const entryError=selection&&!selection.entries.includes(entry)?'请选择源码中的 HTML 入口文件':'';
  const valid=!!selection&&selection.files.length>0&&!nameError&&!systemError&&!entryError&&!!entry;
  async function publish() {
    if(locked.current)return;
    setTouched({name:true,system:true});
    if(!valid||!selection)return;
    const metadata={name:name.trim(),description:description.trim(),system:system.trim(),entry,itemId:target?.id,expectedVersion:target?.version??0};
    const identity=JSON.stringify({...metadata,selectionRevision:selectionRevision.current});
    if(retry.current?.identity!==identity)retry.current={identity,key:crypto.randomUUID()};
    const abort=new AbortController();controller.current=abort;locked.current=true;
    setUploading(true);setError('');setProgress({phase:'uploading',loaded:0,total:selection.totalBytes,fileName:''});
    try{
      await uploadDashboard(client,selection,{...metadata,key:retry.current.key},setProgress,abort.signal);
      onPublished();
    }catch(reason){
      if(abort.signal.aborted)retry.current=undefined;
      setError(abort.signal.aborted?'上传已取消，已保留所选源码和填写内容。可重新发布。':reason instanceof Error?reason.message:String(reason));
    }finally{locked.current=false;controller.current=undefined;setUploading(false);setProgress(undefined);}
  }

  return <Modal open className="dashboard-upload-modal" width={920} title={target?'发布看板新版':'上传看板模板'} onCancel={onClose} closable={!busy} maskClosable={!busy} keyboard={!busy} footer={
    <div className="dashboard-upload-footer">
      <span>{target?`将基于 v${target.version} 发布独立新版本`:'发布后，团队成员可查看、导出和接入场景'}</span>
      <div>{uploading?<Button onClick={()=>controller.current?.abort()}>取消上传</Button>:<Button disabled={preparing} onClick={onClose}>取消</Button>}<Button type="primary" loading={uploading} disabled={!valid||busy} onClick={()=>void publish()}>{target?'发布新版':'发布模板'}</Button></div>
    </div>
  }>
    <p className="dashboard-dialog-intro">选择 HTML、ZIP 或完整源码文件夹。源码与说明、配置文件原样保留；预览仅运行所选 HTML 入口及其浏览器资源。</p>
    {target&&<Alert type="info" showIcon title="已有场景继续使用原固定版本，不会被新版覆盖。"/>}
    <div className="dashboard-upload-layout">
      <section className="dashboard-upload-source" aria-labelledby="dashboard-source-title">
        <div className="dashboard-section-heading"><h3 id="dashboard-source-title">1. 选择源码</h3>{selection&&<Button type="text" size="small" disabled={busy} onClick={reset}>清空选择</Button>}</div>
        <input ref={fileInput} className="dashboard-hidden-input" aria-label="看板源码文件" type="file" accept=".html,.htm,.zip" disabled={busy} onChange={event=>{const files=Array.from(event.currentTarget.files??[]);event.currentTarget.value='';if(files.length)void prepare(files,'file');}}/>
        <input ref={folderInput} className="dashboard-hidden-input" aria-label="看板源码文件夹" type="file" {...{webkitdirectory:'',directory:''}} multiple disabled={busy} onChange={event=>{const files=Array.from(event.currentTarget.files??[]);event.currentTarget.value='';if(files.length)void prepare(files,'folder');}}/>
        {preparing&&<OperationProgress title="准备看板源码" stage={preparationStage} detail="正在检查文件路径与 HTML 入口，完成后即可填写信息并发布。"/>}
        <div className={`dashboard-drop-zone${dragging?' is-dragging':''}${busy?' is-busy':''}`} onDragOver={event=>{event.preventDefault();if(!busy)setDragging(true);}} onDragLeave={event=>{if(!event.currentTarget.contains(event.relatedTarget as Node|null))setDragging(false);}} onDrop={event=>void drop(event)} aria-busy={preparing}>
          <span className="dashboard-upload-symbol"><UploadIcon/></span>
          <strong>{preparing?`${preparationStage}…`:'将源码文件或文件夹拖放到这里'}</strong>
          <p>保留 JS、CSS、图片等资源的相对目录结构</p>
          <div className="dashboard-file-choices"><Button icon={<FileIcon/>} disabled={busy} onClick={()=>fileInput.current?.click()}>选择文件</Button><Button icon={<FolderIcon/>} disabled={busy} onClick={()=>folderInput.current?.click()}>选择文件夹</Button></div>
          <span className="dashboard-field-hint">文件支持 .html / .htm / .zip；文件夹可选择嵌套 HTML 入口</span>
        </div>
        {selection&&<div className="dashboard-selection">
          <div className="dashboard-selection-summary"><span className="dashboard-source-icon">{selection.kind==='folder'?<FolderIcon/>:<FileIcon/>}</span><div><strong title={selection.name}>{selection.name}</strong><span>{selection.files.length.toLocaleString()} 个文件 · {formatDashboardBytes(selection.totalBytes)}</span></div></div>
          <ul className="dashboard-file-list" aria-label="所选源码文件">
            {selection.files.map(value=><li key={value.path}>
              <span title={value.path}>{value.path}</span>
              <span>{formatDashboardBytes(value.file.size)}</span>
              <Button type="text" size="small" icon={<Cross2Icon/>} aria-label={`移除 ${value.path}`} disabled={busy} onClick={()=>removeFile(value.path)}/>
            </li>)}
          </ul>
        </div>}
        <p className="dashboard-environment-note">不设固定业务总大小上限；实际容量取决于浏览器、网络、磁盘及代理。README、配置、Vue/TypeScript 等源码可以一起保存，不在服务端执行。需构建的工程请同时包含 dist/build，并选择其中的 HTML 入口；请勿上传密钥等敏感文件。</p>
      </section>
      <section className="dashboard-upload-details" aria-labelledby="dashboard-details-title">
        <div className="dashboard-section-heading"><h3 id="dashboard-details-title">2. 模板信息</h3></div>
        <div className="dashboard-field">
          <label htmlFor="dashboard-upload-name">模板名称 <span aria-hidden="true">*</span></label>
          <Input id="dashboard-upload-name" aria-label="看板模板名称" autoFocus value={name} maxLength={80} showCount disabled={busy}
            status={touched.name&&nameError?'error':undefined} aria-invalid={touched.name&&!!nameError}
            aria-describedby={touched.name&&nameError?'dashboard-name-error':undefined}
            onBlur={()=>setTouched(previous=>({...previous,name:true}))}
            onChange={event=>{changed();setName(event.target.value);}}/>
          {touched.name&&nameError&&<span id="dashboard-name-error" className="dashboard-field-error">{nameError}</span>}
        </div>
        <div className="dashboard-field">
          <label htmlFor="dashboard-upload-system">所属系统 <span aria-hidden="true">*</span></label>
          <AutoComplete id="dashboard-upload-system" aria-label="看板所属系统" value={system}
            options={Array.from(new Set(['WMS','MES',...systems])).sort().map(value=>({value}))}
            filterOption={(input,option)=>(option?.value??'').toLowerCase().includes(input.toLowerCase())}
            disabled={busy} status={touched.system&&systemError?'error':undefined}
            onBlur={()=>setTouched(previous=>({...previous,system:true}))}
            onChange={value=>{changed();setSystem(value);}}
            placeholder="选择已有系统，或输入自定义系统" aria-invalid={touched.system&&!!systemError}
            aria-describedby={touched.system&&systemError?'dashboard-system-error':'dashboard-system-hint'}/>
          <span id="dashboard-system-hint" className="dashboard-field-hint">可直接输入 ERP、园区运营等自定义名称，最多 80 个字符</span>
          {touched.system&&systemError&&<span id="dashboard-system-error" className="dashboard-field-error">{systemError}</span>}
        </div>
        <div className="dashboard-field">
          <label htmlFor="dashboard-upload-entry">HTML 入口 <span aria-hidden="true">*</span></label>
          <Select id="dashboard-upload-entry" aria-label="看板入口路径" value={entry||undefined}
            options={(selection?.entries??[]).map(value=>({value,label:value}))} showSearch optionFilterProp="label"
            placeholder={selection?'请选择 HTML 入口':'选择源码后自动识别'} disabled={busy||!selection}
            status={entryError?'error':undefined} onChange={value=>{changed();setEntry(value);}}
            aria-invalid={!!entryError} aria-describedby="dashboard-entry-hint"/>
          {entryError?<span id="dashboard-entry-hint" className="dashboard-field-error">{entryError}</span>:
            <span id="dashboard-entry-hint" className="dashboard-field-hint">优先识别 dist/build 入口；源码工程的 index.html 不一定能直接运行</span>}
        </div>
        <div className="dashboard-field">
          <label htmlFor="dashboard-upload-description">描述 <span className="dashboard-optional">选填</span></label>
          <Input.TextArea id="dashboard-upload-description" aria-label="看板模板描述" value={description} rows={4}
            maxLength={2000} showCount disabled={busy} onChange={event=>{changed();setDescription(event.target.value);}}
            placeholder="说明模板用途、适用场景或版本变化"/>
        </div>
      </section>
    </div>
    {error&&<Alert className="dashboard-upload-error" type={error.startsWith('上传已取消')?'warning':'error'} showIcon role="alert" title={error}/>}
    {uploading&&progress?.phase==='processing'&&<OperationProgress title="发布看板模板" stage="上传完成，正在校验并发布" detail="服务端正在处理源码和保存版本，请勿关闭此窗口。"/>}
    {uploading&&progress?.phase==='uploading'&&<div className="dashboard-upload-progress" role="status" aria-live="polite">
      <div><div className="dashboard-progress-heading"><strong>正在上传源码</strong><span>{formatDashboardBytes(progress.loaded)} / {formatDashboardBytes(progress.total)}</span></div>{progress.total>0?<Progress percent={Math.min(100,Math.floor(progress.loaded/progress.total*100))} showInfo={false}/>:<progress aria-label="源码上传进度"/>}<p title={progress.fileName}>{progress.fileName||'正在建立上传会话…'}</p><span className="dashboard-field-hint">进度仅计入服务端已确认保存的字节</span></div>
    </div>}
  </Modal>;
}
