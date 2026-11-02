import {useState} from 'react';
import {Button,Drawer,Tag,Tabs,Empty,Alert} from 'antd';
import {ProCard} from '@ant-design/pro-components';
import type {SceneChange} from '../../domain/editScope';
import type {CommandBatch} from '../../domain/commands';
import type {SceneDocument} from '../../domain/types';
import {CHECK_GUIDES,previewChecks,type PreviewCheckKind} from '../../domain/previewChecks';
import {MessageAttachments} from './ReferenceAttachments';
import {ConversationActions} from './ConversationActions';
type Props={batch:CommandBatch;changes:SceneChange[];document:SceneDocument;before:boolean;viewportReady:boolean;referenceImages:string[];onCompare:()=>void;onApply:()=>void;onContinue:()=>void;onDiscard:()=>void;onLocate:(ids:string[])=>void;onPrepareChecks:(text:string)=>void};
export function PreviewDecision({batch,changes,document,before,viewportReady,referenceImages,onCompare,onApply,onContinue,onDiscard,onLocate,onPrepareChecks}:Props){
 const [panel,setPanel]=useState<'checks'|'changes'|null>(null);
 const checks=previewChecks(batch.qualityIssues??[],batch.summary);
 const groups=[...new Set(checks.map(check=>check.kind))];
 const needsReview=!!checks.length||batch.incomplete||!viewportReady;
 function locate(text:string){const matches=document.nodes.filter(node=>(node.assemblyName&&text.includes(node.assemblyName))||text.includes(node.name)).map(node=>node.id);if(matches.length){setPanel(null);onLocate(matches);}}
 const relatedIds=(text:string)=>document.nodes.filter(node=>(node.assemblyName&&text.includes(node.assemblyName))||text.includes(node.name)).map(node=>node.id);
 const prepare=()=>{const text='请核对当前预览，保留未涉及的对象和布局。'+(referenceImages.length?'对照最近的参考图，先用接近原图的视角核对外轮廓与比例，再用侧视和近景核对关键结构、连接及材质。':'根据已明确的需求，核对当前结构、尺寸、连接及材质。')+'逐项说明实际检查依据；存在差异时局部修正，证据不足的项目保持待核对，不要声称通过。\n'+checks.map((check,index)=>`${index+1}. ${check.text}`).join('\n');setPanel(null);onPrepareChecks(text);};
 const checkContent=<div className="preview-check-panel">
  <Alert type="info" showIcon title="应用修改会写入项目，不代表核对通过。" description="以下是已有记录中的差异或未完成检查。可按说明查看模型，也可将核对要求放入输入框，确认后交给 AI 检查。"/>
  {!viewportReady&&<Alert type="warning" showIcon title="实时三维画面不可用" description="当前无法完成材质与多视角验收，请先恢复三维视图。"/>}
  {!!referenceImages.length&&<section className="preview-reference"><h3>本轮沿用的参考图</h3><p>点击图片放大，先对齐观察方向，再比较轮廓与部件关系。</p><MessageAttachments values={referenceImages}/></section>}
  {groups.map((kind:PreviewCheckKind)=><ProCard key={kind} title={CHECK_GUIDES[kind].title} size="small" className="preview-check-group"><ul>{checks.filter(check=>check.kind===kind).map(check=><li key={check.id}><Tag color={check.reportedDifference?'warning':'default'}>{check.reportedDifference?'已报告差异':'需复核'}</Tag><span>{check.text}</span>{!!relatedIds(check.text).length&&<Button type="link" size="small" onClick={()=>locate(check.text)}>定位相关组件</Button>}</li>)}</ul><div className="preview-check-method"><strong>如何检查</strong><p>{CHECK_GUIDES[kind].method}</p><small>{CHECK_GUIDES[kind].limit}</small></div></ProCard>)}
  {!checks.length&&<Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={needsReview?'当前只有“尚未完成验收”的状态，没有逐项检查记录。可生成核对指令，请 AI 返回具体依据。':'没有记录待核对项。这不等于人工或工程验收已通过。'}/>}
 </div>;
 return <><section className="adx-preview decision-review" role="region" aria-label="预览确认"><ProCard size="small" title={batch.taskStatus==='partial'?'已保留阶段草稿':'检查本次修改'} extra={<Tag color="default">尚未应用</Tag>}>
  <div className="decision-change-summary"><span>新增 <strong>{changes.filter(change=>change.kind==='added').length}</strong></span><span>调整 <strong>{changes.filter(change=>change.kind==='modified').length}</strong></span><span>移除 <strong>{changes.filter(change=>change.kind==='removed').length}</strong></span></div>
  <div className="decision-review-toolbar"><div className="decision-review-links"><Button size="small" type="text" onClick={onCompare}>{before?'查看修改后':'查看修改前'}</Button><Button size="small" type="text" onClick={()=>setPanel('changes')}>变更清单</Button>{needsReview&&<Button size="small" type="text" className="decision-check-trigger" onClick={()=>setPanel('checks')}>待核对项{checks.length?` · ${checks.length}`:''}</Button>}</div><ConversationActions className="adx-preview-actions" items={[{key:'continue',label:'继续调整',onClick:onContinue},{key:'discard',label:'放弃修改',onClick:onDiscard},{key:'apply',label:'应用修改',primary:true,disabled:before,onClick:onApply}]}/></div>
  {before&&<p className="decision-before-note">当前显示修改前，切回修改后才能应用。</p>}
  {!viewportReady&&<p className="decision-before-note">实时三维画面不可用，当前预览尚未完成视觉核对。</p>}
 </ProCard></section>
 <Drawer open={panel!==null} onClose={()=>setPanel(null)} title="本次修改检查" size={520} mask={false} rootClassName="preview-review-drawer" footer={<div className="preview-review-footer"><span>核对指令需你确认发送后才执行</span><Button type="primary" onClick={prepare}>生成核对指令</Button></div>}>
 <Tabs activeKey={panel??'checks'} onChange={key=>setPanel(key as 'checks'|'changes')} items={[{key:'checks',label:`待核对项${checks.length?` (${checks.length})`:''}`,children:checkContent},{key:'changes',label:`变更清单 (${changes.length})`,children:<div className="preview-change-list">{changes.map(change=><div key={change.id}><div><Tag>{change.kind==='added'?'新增':change.kind==='removed'?'移除':'调整'}</Tag><strong>{change.name}</strong><small>{change.fields.join('、')}</small></div><Button type="link" size="small" disabled={!document.nodes.some(node=>node.id===change.id)} onClick={()=>{setPanel(null);onLocate([change.id]);}}>定位</Button></div>)}</div>}]} />
 </Drawer></>;
}
