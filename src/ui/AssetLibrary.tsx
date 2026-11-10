import {categoryMatches} from '../domain/libraryCategories';
import {manualAssetCommand} from '../domain/manualComposition';
import {CategoryPicker,useLibraryCategories} from './LibraryMetadataDialog';
import {categoryLabel} from '../domain/libraryCategories';
import {Button,Checkbox,Input,InputNumber,Select} from 'antd';
import {AssetInspection} from './AssetInspection';
import {PortalDialog} from './kit/PortalDialog';
import {OperationProgress,nextProgressPaint} from './OperationProgress';
import {useEffect,useRef,useState} from 'react';
import {useEditorStore} from '../store';
import {MAX_ASSET_BYTES,ASSET_SIZE_ERROR,assetVersionSourceIssue,assetDocument,createModelAsset,parseModelAssetFile,selectedAssetNodes,type AssetCategory,type ModelAssetVersion,type ModelAssetSummary} from '../domain/modelAssets';
import {assertAssetLibraryBackupSize,listModelAssets,readModelAsset,saveModelAsset,exportAssetLibraryText,importAssetLibraryDetailed} from '../domain/modelAssetStorage';
import {captureLibraryThumbnail} from '../scene/libraryThumbnail';
import {makeId} from '../util/ids';
import {acquirePublishedCategory} from '../domain/teamCategories';
export function AssetLibrary({onClose,intent='manage',targetName,initialImportFile}:{onClose:()=>void;intent?:'manage'|'insert';targetName?:string;initialImportFile?:File}){
 const doc=useEditorStore(s=>s.doc),selection=useEditorStore(s=>s.selection);
 const [mode,setMode]=useState<'use'|'save'>('use');
 const [versionAsset,setVersionAsset]=useState<ModelAssetVersion|null>(null);
 const [versionTarget,setVersionTarget]=useState(''),[confirmVersion,setConfirmVersion]=useState(false);
 const [loading,setLoading]=useState(true),[loadError,setLoadError]=useState(''),[items,setItems]=useState<ModelAssetSummary[]>([]),[selected,setSelected]=useState<ModelAssetVersion|null>(null);
 const [query,setQuery]=useState(''),[filter,setFilter]=useState('全部'),[name,setName]=useState(''),[category,setCategory]=useState<AssetCategory>('其他'),[front,setFront]=useState<ModelAssetVersion['front']>('+Z');
 const [position,setPosition]=useState<[number,number,number]>([0,0,0]),[yaw,setYaw]=useState(0),[busy,setBusy]=useState(false),[notice,setNotice]=useState(''),[error,setError]=useState('');
 const [progress,setProgress]=useState({title:'处理资产数据',stage:'准备数据'});
 const {categories,error:categoryError}=useLibraryCategories(items.map(a=>a.category));
 const file=useRef<HTMLInputElement>(null),alive=useRef(true),busyRef=useRef(false),loadSequence=useRef(0);
 const importedFile=useRef<File|undefined>(undefined);
 useEffect(()=>{if(!initialImportFile||importedFile.current===initialImportFile)return;importedFile.current=initialImportFile;void importFile(initialImportFile);},[initialImportFile]);
 const picked=selectedAssetNodes(doc,selection),target=items.find(i=>i.id===versionTarget),sourceLabel=[...new Set(selectedAssetNodes(doc,selection).map(n=>n.assemblyName??n.name))].join('、'),latest=selected?items.find(i=>i.id===selected.id):undefined;
 useEffect(()=>{setConfirmVersion(false);},[doc.revision,selection.join('|'),versionTarget]);
 useEffect(()=>{let active=true;setVersionAsset(null);setConfirmVersion(false);if(target)void readModelAsset(target.id,target.version).then(asset=>{if(active)setVersionAsset(asset);}).catch(e=>{if(active)setError(e.message);});return()=>{active=false;};},[target?.id,target?.version]);
 const versionIssue=versionAsset?assetVersionSourceIssue(picked,versionAsset):undefined;
 async function loadAssets(){setLoading(true);setLoadError('');try{const rows=await listModelAssets();if(alive.current)setItems(rows);}catch(e){if(alive.current)setLoadError(e instanceof Error?e.message:'读取资产失败');}finally{if(alive.current)setLoading(false);}}
 useEffect(()=>{alive.current=true;void loadAssets();return()=>{alive.current=false;loadSequence.current++;};},[]);
 async function showStage(stage:string){if(alive.current)setProgress(current=>({...current,stage}));await nextProgressPaint();}
 async function run(action:()=>Promise<void>,title='资产检查与保存',stage='准备数据'){if(busyRef.current)return;busyRef.current=true;loadSequence.current++;setBusy(true);setProgress({title,stage});setError('');setNotice('');try{await nextProgressPaint();await action();}catch(e){if(alive.current)setError(e instanceof Error?e.message:'操作失败');}finally{busyRef.current=false;if(alive.current)setBusy(false);}}
 async function choose(id:string,version:number){const seq=++loadSequence.current;setSelected(null);setError('');try{const a=await readModelAsset(id,version);if(alive.current&&seq===loadSequence.current){setSelected(a);}}catch(e){if(alive.current&&seq===loadSequence.current)setError(e instanceof Error?e.message:'读取失败');}}
 async function save(asVersion=false){await run(async()=>{
  const snapshot=structuredClone(useEditorStore.getState().doc),ids=[...useEditorStore.getState().selection];const current=asVersion?target:undefined;if(asVersion&&(!current||!confirmVersion||!versionAsset||versionAsset.id!==current.id||versionAsset.version!==current.version))throw Error('请明确选择目标资产并确认新版本');
  const source=selectedAssetNodes(snapshot,ids);if(asVersion){const issue=assetVersionSourceIssue(source,versionAsset!);if(issue)throw Error(issue);}
  const asset=createModelAsset(snapshot,ids,{name:current?current.name:name,category:current?current.category:category,front:current?versionAsset!.front:front,...(current?{id:current.id,version:current.version+1}:{})});let thumbnailMissing=false,thumbnailNotice='';
  await showStage('生成缩略图');try{const preview=await captureLibraryThumbnail(assetDocument(asset));asset.thumbnail=preview.image;thumbnailNotice=preview.notice;}catch{thumbnailMissing=true;}
  await showStage('写入库');await saveModelAsset(asset,current?.version??0);await showStage('更新列表');const rows=await listModelAssets();if(!alive.current)return;setItems(rows);setSelected(asset);setMode('use');setVersionTarget('');setConfirmVersion(false);setNotice(`资产已保存到资产库：${asset.name} v${asset.version}。质量仍待验收。${asset.externalConnectionsRemoved?`已移除 ${asset.externalConnectionsRemoved} 条库外连接，插入后需重新绑定。`:''}${thumbnailMissing?'缩略图暂不可用，几何数据已保留。':thumbnailNotice}`);
 },asVersion?'保存资产新版本':'保存新资产');}
 function insert(){if(!selected)return;void run(async()=>{const s=useEditorStore.getState();if(['capturing','context','generating','validating','previewing','applying'].includes(s.aiStatus))throw Error('请先结束生成或处理预览');const result=s.applyCommandBatch([manualAssetCommand({...selected,name:latest?.name??selected.name},position,yaw)],`插入资产 ${selected.name} v${selected.version}`);if(!result.ok)throw Error(result.error||'插入失败');if(intent==='insert')onClose();setNotice(`已插入固定版本 v${selected.version}，可以撤销。资产原件不受场景编辑影响；接触、占位与画面仍需检查。`);},'插入资产','准备场景数据');}
 async function importFile(f:File){await run(async()=>{
  assertAssetLibraryBackupSize(f.size);const text=await f.text();await showStage('校验导入');
  if(JSON.parse(text)?.format==='chat3d-asset-library'){
   await showStage('校验备份并写入库');const {count,categoryConflicts}=await importAssetLibraryDetailed(text);await showStage('更新列表');const rows=await listModelAssets();if(!alive.current)return;setItems(rows);setNotice(`已恢复 ${count} 项资产及其版本到资产库，未覆盖原件；验收需重新确认。${categoryConflicts.length?` 分类名称存在差异：${categoryConflicts.join('；')}。`:''}`);return;
  }
  if(f.size>MAX_ASSET_BYTES)throw Error(ASSET_SIZE_ERROR);const {asset:source,teamCategoryPath}=parseModelAssetFile(text);await showStage('写入库');const category=teamCategoryPath===undefined?source.category:await acquirePublishedCategory('asset',teamCategoryPath)??'其他';const asset={...source,category,id:makeId(),version:1,createdAt:new Date().toISOString()};await saveModelAsset(asset);await showStage('更新列表');const rows=await listModelAssets();if(!alive.current)return;setItems(rows);setSelected(asset);setName(asset.name);setCategory(asset.category);setFront(asset.front);setNotice(`已导入到资产库：${asset.name} v1。未覆盖已有资产，质量仍待验收。`);
 },'导入资产或恢复资产库','读取文件');}
 function download(){if(!selected)return;const asset=selected;void run(async()=>{const text=JSON.stringify(asset);await showStage('请求下载');const url=URL.createObjectURL(new Blob([text],{type:'application/json'})),a=document.createElement('a');a.href=url;a.download=`${asset.name.replace(/[\\/:*?"<>|]/g,'_')}-v${asset.version}.chat3d-asset.json`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);setNotice('已发起资产文件下载，请确认已保存；该文件不含模型服务密钥或聊天。');},'导出资产版本');}
 const visible=items.filter(i=>(query.trim()||categoryMatches(categories,i.category,filter))&&`${i.name} ${categoryLabel(categories,i.category)} ${i.purpose??''}`.toLowerCase().includes(query.trim().toLowerCase()));
 const input='w-full rounded border asset-field px-3 py-2 text-sm';
 return <PortalDialog label={intent==='insert'?'引用资产':'模型资产库'} onClose={onClose} closable={!busy} width={1080} className="asset-management-module"><h2 className="app-modal-title">{intent==='insert'?'引用资产':'模型资产库'}</h2><p className="app-modal-description">{intent==='insert'?`添加到：${targetName??'当前项目'}。选择固定版本，插入后可撤销。`:'版本、导入与备份。资产保存在当前浏览器，不会自动跨设备同步。'}</p>
  {busy&&<OperationProgress title={progress.title} stage={progress.stage}/>}
  {intent==='manage'&&<div className="flex gap-2 mt-4" aria-label="资产操作"><Button className="asset-button" aria-pressed={mode==='use'} onClick={()=>setMode('use')}>使用资产</Button><Button className="asset-button" aria-pressed={mode==='save'} onClick={()=>{setMode('save');if(!name.trim())setName(sourceLabel.slice(0,80));}}>保存选中模型</Button></div>}
  <div className="asset-library-layout"><section className="space-y-3">
   <div className="flex gap-2"><Input aria-label="搜索模型资产" className={input} placeholder="搜索名称、分类或用途" value={query} onChange={e=>setQuery(e.target.value)}/><CategoryPicker label="资产分类筛选" value={filter} onChange={setFilter} categories={[{value:"全部",label:"全部",revision:0},...categories]}/></div>
   <div className="asset-card-grid">{visible.map(a=><Button key={a.id} disabled={busy} className={`asset-card ${selected?.id===a.id?'selected':''}`} onClick={()=>void choose(a.id,a.version)}>{a.thumbnail?<img src={a.thumbnail} alt={`${a.name} 几何缩略图`}/>:<div className="asset-placeholder">暂无缩略图</div>}<strong>{a.name}</strong><span>{categoryLabel(categories,a.category)} · v{a.version} · {a.parts} 个零件</span><small>固定版本 · 可查看验收</small></Button>)}</div>
   {loading&&<p role="status">正在读取资产…</p>}{loadError&&<p role="alert" className="asset-error">读取资产失败：{loadError} <Button onClick={()=>void loadAssets()}>重新加载</Button></p>}{!loading&&!loadError&&!visible.length&&<p className="text-sm asset-note">{items.length?'没有匹配的资产':'资产库为空。可在工作台生成或导入模型后点“保存资产”入库，也可以从已有场景选中部件保存。'}</p>}
   {intent==='manage'&&<><Button disabled={busy} className="asset-button" onClick={()=>void run(async()=>{const text=await exportAssetLibraryText();await showStage('请求下载');const url=URL.createObjectURL(new Blob([text],{type:'application/json'})),link=document.createElement('a');link.href=url;link.download='模型资产库备份.json';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);setNotice('已发起整个资产库版本备份下载，请检查浏览器下载列表；尚未确认文件落盘。备份不含密钥，迁移后需重新验收。');},'备份整个资产库','打包备份')}>备份整个资产库</Button>
   <Button disabled={busy} onClick={()=>file.current?.click()} className="asset-button">导入资产 JSON / 资产库备份</Button><input ref={file} type="file" accept=".json,.chat3d-asset.json" hidden onChange={e=>{const f=e.target.files?.[0];e.target.value='';if(f)void importFile(f);}}/></>}
  </section><section className="space-y-3 rounded-lg border asset-divider p-4">
   {mode==='save'&&<><h3>保存选中元素</h3><p className="text-sm asset-info">来源模型：{sourceLabel||'尚未选择'} · {picked.length} 个零件</p><p className="text-xs asset-note">选中组件中的一个零件会包含整个组件。目前包含 {picked.length} 个零件。原点统一到模型底面中心，单位米，Y向上；外部连接不随资产带入。</p>
   <label className="block">资产名称<Input aria-label="资产名称" className={input} maxLength={80} value={name} onChange={e=>setName(e.target.value)}/></label>
   <div className="flex gap-2"><label>分类<CategoryPicker label="保存资产分类" value={category} onChange={setCategory} categories={categories}/></label><label>模型正面<Select aria-label="资产正面" style={{width:"100%"}} value={front} onChange={setFront} options={['+Z','-Z','+X','-X'].map(value=>({value,label:value}))}/></label></div>
   <div className="flex flex-wrap gap-2"><Button className="asset-button primary" disabled={busy||!picked.length||!name.trim()} onClick={()=>void save(false)}>保存为新资产</Button></div><details><summary>更新已有资产版本</summary><label className="block mt-2">目标资产<Select aria-label="新版本目标资产" style={{width:"100%"}} value={versionTarget} onChange={value=>{setVersionTarget(value);setConfirmVersion(false);}} options={[{value:"",label:"请选择要更新的资产"},...items.map(item=>({value:item.id,label:`${item.name} · 当前 v${item.version}`}))]}/></label>{target&&<><p className="text-sm mt-2">将“{sourceLabel}”保存为“{target.name}”的新版本 v{target.version+1}。旧版本保留，新版本沿用目标资产名称与分类。</p><label className="flex gap-2 mt-2"><Checkbox aria-label="确认新版本目标" disabled={busy||!versionAsset} checked={confirmVersion} onChange={e=>setConfirmVersion(e.target.checked)}/>我已核对来源模型与目标资产</label></>}<Button className="asset-button mt-2" disabled={busy||!picked.length||!name.trim()||!target||!confirmVersion||!versionAsset||!!versionIssue} onClick={()=>void save(true)}>保存为所选资产新版本</Button>{target&&versionIssue&&<p role="alert" className="asset-warn text-xs mt-2">选中模型来自另一资产，请保存为新资产。</p>}</details></>}
   {mode==='use'&&!selected&&<p className="text-sm asset-note">选择左侧资产，查看模型并插入场景。</p>}
   {mode==='use'&&selected&&<><h3>{latest?.name??selected.name}</h3>{latest?.name!==selected.name&&<p className="text-xs asset-note">此版本保存时的名称：{selected.name}</p>}<p className="text-xs asset-note">{selected.size.map(n=>n.toFixed(3)).join(' × ')} m · 正面 {selected.front} · 验收记录见下方。缩略图仅作形体预览，不支持材质验收。</p>
    <label>使用版本<Select aria-label="插入资产版本" style={{width:"100%"}} disabled={busy} value={selected.version} onChange={value=>void choose(selected.id,value)} options={Array.from({length:latest?.version??selected.version},(_,i)=>({value:i+1,label:`v${i+1}`}))}/></label>
    <div className="flex gap-2"><Button className="asset-button primary" disabled={busy} onClick={insert}>插入场景</Button><Button className="asset-button" disabled={busy} onClick={download}>下载该版本</Button></div>
    <details><summary>放置位置与角度（默认原点，单位米）</summary><div className="flex gap-2">{(['X','Y','Z'] as const).map((axis,i)=><label key={axis}>{axis}<InputNumber style={{width:"100%"}} aria-label={`资产插入${axis}`} step={0.1} value={position[i]} onChange={value=>{if(value!==null)setPosition(p=>p.map((n,k)=>k===i?value:n) as [number,number,number]);}}/></label>)}</div>
    <label>旋转角度<InputNumber style={{width:"100%"}} aria-label="资产插入角度" value={yaw} onChange={value=>{if(value!==null)setYaw(value);}}/></label>
    </details><p className="text-xs asset-note">新增版本不会自动改变已有场景实例。插入后可独立修改，并使用撤销恢复。</p>
    <AssetInspection key={`${selected.id}:${selected.version}`} asset={selected} busy={busy} run={run} onContract={async contract=>{await showStage('读取当前版本');const rows=await listModelAssets(),head=rows.find(x=>x.id===selected.id);if(!head||head.version!==selected.version)throw Error('请先选择最新版本再保存连接点');await showStage('准备数据');const next={...structuredClone(selected),version:head.version+1,createdAt:new Date().toISOString(),contract};await showStage('写入库');await saveModelAsset(next,head.version);await showStage('更新列表');setItems(await listModelAssets());setSelected(next);setNotice('用途和连接点已保存为新版本，旧版本与旧验收记录保持不变');}}/>
   </>}
  </section></div>
  {(error||categoryError)&&<p role="alert" className="mt-3 asset-error">{error||categoryError}</p>}{notice&&<p role="status" className="mt-3 asset-info">{notice}</p>}
  <div className="mt-4 flex justify-end"><Button className="asset-button" disabled={busy} onClick={onClose}>{busy?'处理中…':'关闭'}</Button></div>
 </PortalDialog>;
}
