import {downloadJson} from '../util/downloadJson';
import {useRef,useState} from 'react';
import {Button,Modal} from 'antd';
import {DownloadIcon,UploadIcon,Cross1Icon} from '@radix-ui/react-icons';
import {exportWorkspaceBackup,importWorkspaceBackup} from '../workspace';
export function WorkspaceTools({onClose}:{onClose:()=>void}){
 const [notice,setNotice]=useState(''),[error,setError]=useState(''),[busy,setBusy]=useState(false);const input=useRef<HTMLInputElement>(null);const busyRef=useRef(false);
 async function run(action:()=>Promise<void>){if(busyRef.current)return;busyRef.current=true;setBusy(true);setNotice('');setError('');try{await action();}catch(e){setError(e instanceof Error?e.message:String(e));}finally{busyRef.current=false;setBusy(false);}}
 return <Modal open onCancel={()=>{if(!busyRef.current)onClose();}} footer={null} closable={false} width={640} title={<h2 className="backup-title">备份与恢复</h2>} className="backup-dialog" mask={{closable:!busy}} keyboard={!busy}>
  <Button type="text" className="backup-close" aria-label="关闭备份与恢复" disabled={busy} icon={<Cross1Icon/>} onClick={onClose}/>
  <p className="backup-lede">保存一份副本，或将已有备份恢复为新项目。</p>
  <div className="backup-actions"><section><span className="settings-icon"><DownloadIcon/></span><h3>导出项目</h3><p>保存所有未删除项目、动画、对话和草稿。</p><Button disabled={busy} onClick={()=>void run(async()=>{setNotice(await downloadJson(exportWorkspaceBackup(),'workspace'));})}>下载工作台备份</Button></section><section><span className="settings-icon"><UploadIcon/></span><h3>从备份恢复</h3><p>新增项目，不覆盖当前已有内容。</p><Button disabled={busy} onClick={()=>input.current?.click()}>导入备份为新会话</Button></section></div>
  <input ref={input} type="file" accept=".json" hidden onChange={e=>{const f=e.target.files?.[0];e.target.value='';if(!f)return;void run(async()=>{if(f.size>50*1024*1024)throw Error('文件超过50MB');const count=importWorkspaceBackup(await f.text());setNotice(`已新增 ${count} 个会话，原会话未覆盖`);});}}/>
  <div className="settings-info">备份包含聊天文字，分享前请检查敏感内容。不包含参考图、撤销历史或模型密钥；恢复后需重新配置模型。未确认的模型会另存为草稿副本。</div>
  {busy&&<p role="status">正在处理，请稍候…</p>}{notice&&<p role="status" className="settings-success">{notice}</p>}{error&&<p role="alert" className="settings-error">{error}</p>}
  <footer className="settings-module-footer"><Button disabled={busy} onClick={onClose}>关闭</Button></footer>
 </Modal>;
}
