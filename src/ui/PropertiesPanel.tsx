import {selectionPropertyCommands} from '../domain/selectionProperties';
import {Button,Input,InputNumber,ColorPicker,Select} from 'antd';
import {boundsFor} from '../domain/sceneQuality';
import {focusSceneObjects} from '../scene/focus';
import {useMemo,useState} from 'react';
import { Geometry, type SceneDocument, type SceneNode } from '../domain/types';
import {assemblyBounds,transformedAssembly} from '../domain/assemblyEditing';
import {Vector3} from 'three';
import type {AppearancePatch, Command} from '../domain/commands';
import { useDisplayDoc, useEditorStore } from '../store';

const geometryNames:Record<string,string>={box:'长方体',sphere:'球体',cylinder:'圆柱体',cone:'圆锥体',plane:'平面',roundedPlate:'圆角板',capsule:'胶囊体',frame:'框架',tube:'空心管',trapezoid:'梯形体'};
const parameterNames:Record<string,string>={width:'宽度',height:'高度',depth:'深度',length:'长度',radius:'半径',radiusTop:'顶部半径',radiusBottom:'底部半径',outerRadius:'外半径',innerRadius:'内半径',widthTop:'顶部宽度',widthBottom:'底部宽度',thickness:'厚度',bevelRadius:'倒角半径',cornerRadius:'圆角半径',holeRadius:'孔半径',widthSegments:'横向分段数',heightSegments:'纵向分段数',depthSegments:'深度分段数',radialSegments:'圆周分段数'};
const parameterLabel=(key:string)=>(parameterNames[key]??key)+(key.endsWith('Segments')?'':'（米）');
function FocusObject({doc,node}:{doc:SceneDocument;node:SceneNode}){const ready=useEditorStore(s=>s.viewportStatus==='ready');return <Button className="prop-focus-btn" disabled={!ready} title={ready?undefined:'三维未就绪，请使用软件检查的选中近景'} onClick={()=>focusSceneObjects(node.assemblyId?doc.nodes.filter(n=>n.assemblyId===node.assemblyId).map(n=>n.id):[node.id])}>{node.assemblyId?'聚焦当前设备':'聚焦选中对象'}</Button>;}

// 属性面板：精确尺寸、位置。空值/非法输入不能提交（方案第 8 节）
export function PropertiesPanel() {
  const [error,setError]=useState('');
  const doc = useDisplayDoc();
  const selection = useEditorStore((s) => s.selection);
  const applyCommandBatch = useEditorStore((s) => s.applyCommandBatch);
  const status=useEditorStore(s=>s.aiStatus);
  const locked=['capturing','context','generating','validating','applying','previewing'].includes(status);
  const lockNotice=locked?<p role="status" className="prop-notice is-warn">{status==='previewing'?'当前是待确认预览。请先在对话区点击“应用修改”，再修改属性；也可以放弃预览。':'模型正在生成，请先等待完成或停止生成，再修改属性。'}</p>:null;

  const node = selection.length > 0 ? doc.nodes.find((n) => n.id === selection[0]) : undefined;

  if (!node) {
    return (
      <div className="properties-panel">
        <div className="prop-heading">属性</div>
        <div className="prop-empty">点击场景或对象列表中的零件，即可修改颜色、尺寸与位置</div>
      </div>
    );
  }

  if(selection.length>1){
    const ids=new Set(selection);const members=doc.nodes.filter(n=>ids.has(n.id));const assembly=node.assemblyId;
    const same=!!assembly&&members.every(n=>n.assemblyId===assembly)&&members.length===doc.nodes.filter(n=>n.assemblyId===assembly).length;
    return <div className="properties-panel is-scrollable"><h3 className="prop-title">{same?node.assemblyName??'组件':'多选对象'}</h3>{lockNotice}{error&&<p role="alert" className="prop-notice is-warn">{error}</p>}{status==='previewing'&&<Button type="primary" className="prop-confirm-btn" onClick={()=>useEditorStore.getState().confirmPending()}>应用当前草稿并编辑属性</Button>}<FocusObject doc={doc} node={node}/><p className="prop-hint">已选 {members.length} 个零件。外观修改只影响所选范围，可撤销。</p>
      <fieldset disabled={locked} className="prop-fieldset">{same&&<div className="prop-grid prop-grid-2">{([['左移 1m',[-1,0,0]],['右移 1m',[1,0,0]],['前移 1m',[0,0,1]],['后移 1m',[0,0,-1]]] as const).map(([title,value])=><Button key={title} className="prop-btn" onClick={()=>{const r=applyCommandBatch([{op:'translateAssembly',targetId:node.id,value:[...value]}],title);if(!r.ok)setError(r.error??'修改失败');}}>{title}</Button>)}</div>}
      {same&&<AssemblyTransformEditor nodes={members} wholeAssembly/>}
      <AppearanceEditor key={members.map(n=>n.id+':'+n.materialId).join('|')} doc={doc} nodes={members}/></fieldset>
      <p className="prop-hint">展开对象树后选择单个零件，可编辑它的尺寸与位置。</p></div>;
  }
  const isPrimitive = node.kind === 'primitive' && node.geometry;
  const g = node.geometry;
  // 几何参数与实际包围尺寸并示（方案第 8 节：避免「宽 1m、缩放 2 倍」造成误解）
  const bbox = g ? geomBbox(g) : null;
  const effectiveW = bbox ? bbox[0] * node.transform.scale[0] : 0;
  const effectiveH = bbox ? bbox[1] * node.transform.scale[1] : 0;
  const effectiveD = bbox ? bbox[2] * node.transform.scale[2] : 0;

  const commit = (op: 'rename' | 'translate', payload: Record<string, unknown>) => {
    const r = applyCommandBatch([{ op, targetId: node.id, ...payload } as never], `修改 ${node.name}`);
    if (!r.ok && r.error) setError(r.error??'修改失败'); // 如：预览待确认期间编辑被拒绝
  };

  return (
    <div className="properties-panel">
      <div className="prop-heading">属性</div>
      {lockNotice}{error&&<p role="alert" className="prop-notice is-warn">{error}</p>}{status==='previewing'&&<Button type="primary" className="prop-confirm-btn" onClick={()=>useEditorStore.getState().confirmPending()}>应用当前草稿并编辑属性</Button>}
      <FocusObject doc={doc} node={node}/>
      <fieldset disabled={locked} className="prop-fieldset prop-fieldset-main">
        {/* 名称 */}
        <div className="prop-field">
          <label className="prop-label">名称</label>
          <Input
            type="text" aria-label="对象名称"
            key={`${node.id}:${node.name}`}
            defaultValue={node.name}
            onBlur={(e) => {
              const v = e.target.value.trim();
              if (v && v !== node.name) commit('rename', { name: v });
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
            }}
            className="prop-input"
          />
        </div>

        {/* 位置（世界，米）*/}
        <div className="prop-field">
          <label className="prop-label">位置 X / Y / Z（米）</label>
          <div className="prop-grid prop-grid-3">
            {node.transform.position.map((v, i) => (
              <InputNumber
                key={`${node.id}:${i}:${v}`}
                aria-label={`位置 ${['X','Y','Z'][i]}（米）`}
                step={0.05}
                defaultValue={Number(v.toFixed(3))}
                onBlur={(e) => {
                  const nv = parseFloat(e.target.value);
                  if (!Number.isFinite(nv)) return; // 非法输入不提交
                  const pos = [...node.transform.position] as [number, number, number];
                  pos[i] = nv;
                  commit('translate', { space: 'world', mode: 'set', value: pos });
                }}
                className="prop-input"
              />
            ))}
          </div>
        </div>

        {/* 几何参数 */}
        {isPrimitive && g && (
          <div className="prop-field">
            <label className="prop-label">尺寸参数（{geometryNames[g.type]??g.type}）</label>
            <div className="prop-param-list">
              {Object.entries(g.params).filter(([,v])=>typeof v==='number').map(([k, v]) => (
                <div key={k} className="prop-param-row">
                  <span className="prop-param-name">{parameterLabel(k)}</span>
                  <InputNumber aria-label={parameterLabel(k)} key={`${node.id}:${k}:${v}`} defaultValue={v} className="prop-input" onBlur={e=>{const value=Number(e.target.value);if(!e.target.value.trim()||!Number.isFinite(value)){e.target.value=String(v);return;}if(value===v)return;const geometry={...g,params:{...g.params,[k]:value}} as Geometry;const r=applyCommandBatch([{op:'updateParameters',targetId:node.id,geometry}],`修改 ${node.name} ${k}`);if(!r.ok){setError(r.error??'修改失败');e.target.value=String(v);}}} onKeyDown={e=>{if(e.key==='Enter')e.currentTarget.blur();}}/>
                </div>
              ))}
            </div>
          </div>
        )}

        {g&&(g.type==='profileSweep'||g.type==='loft'||g.type==='sweepTube')&&<p className="prop-hint">连续曲面模型；可通过对话调整截面或路径，位置、缩放和材质仍可编辑。</p>}
        {g&&(g.type==='profile'||g.type==='lathe')&&<p className="prop-hint">轮廓包含 {g.params.points.length} 个控制点；可通过对话修改轮廓，位置、缩放和材质仍可直接编辑。</p>}
        {g?.type==='mesh'&&<p className="prop-hint">导入网格：{g.params.positions.length/3} 顶点，{g.params.indices.length/3} 三角形。支持部件移动、旋转、缩放和材质修改；不支持通过尺寸字段重建拓扑。</p>}
        {/* 实际包围尺寸 */}
        {bbox && (
          <div className="prop-field">
            <label className="prop-label">实际包围尺寸（含缩放，米）</label>
            <div className="prop-bbox">
              <div>宽 X：{effectiveW.toFixed(3)}</div>
              <div>高 Y：{effectiveH.toFixed(3)}</div>
              <div>深 Z：{effectiveD.toFixed(3)}</div>
            </div>
          </div>
        )}

        <AssemblyTransformEditor key={node.id} nodes={[node]}/>
        <AppearanceEditor key={node.id+':'+node.materialId} doc={doc} nodes={[node]}/>
      </fieldset>
    </div>
  );
}

function AssemblyTransformEditor({nodes,wholeAssembly=false}:{nodes:SceneNode[];wholeAssembly?:boolean}){
 const [angles,setAngles]=useState(['0','0','0']),[factor,setFactor]=useState('1'),[error,setError]=useState('');
 const bounds=useMemo(()=>assemblyBounds(nodes),[nodes]);const size=bounds.getSize(new Vector3());
 const apply=()=>{
  if(angles.some(v=>!v.trim()||!Number.isFinite(Number(v)))||!factor.trim()||!Number.isFinite(Number(factor))){setError('请输入有效的角度和缩放倍数');return;}
  const rotationDegrees=angles.map(Number) as [number,number,number],scaleFactor=Number(factor);
  if(rotationDegrees.every(v=>v===0)&&scaleFactor===1){setError('没有需要应用的变换');return;}
  let command:Command;try{command=wholeAssembly?{op:'transformAssembly',targetId:nodes[0].id,rotationDegrees,scaleFactor}:{op:'setTransform',targetId:nodes[0].id,transform:transformedAssembly(nodes,{rotationDegrees,scaleFactor})[0].transform};}catch(e){setError(e instanceof Error?e.message:'变换参数无效');return;}
  const result=useEditorStore.getState().applyCommandBatch([command],'旋转/等比缩放选中对象');
  if(!result.ok){setError(result.error??'变换失败');return;}setAngles(['0','0','0']);setFactor('1');setError('');
 };
 return <section className="prop-section"><h4 className="prop-section-title">{wholeAssembly?'整机旋转与等比缩放':'零件旋转与等比缩放'}</h4><p className="prop-hint">世界外包尺寸：X {size.x.toFixed(3)} · Y {size.y.toFixed(3)} · Z {size.z.toFixed(3)} m。底部 Y {bounds.min.y.toFixed(3)} m；以底部中心为变换支点</p><div className="prop-grid prop-grid-3">{['X','Y','Z'].map((axis,i)=><label key={axis} className="prop-label">{axis} 旋转角<InputNumber aria-label={`整体旋转 ${axis}`} step={15} value={angles[i]===''?null:Number(angles[i])} onChange={value=>setAngles(old=>old.map((v,j)=>i===j?String(value??''):v))} className="prop-input"/></label>)}</div><label className="prop-label">等比缩放倍数<InputNumber aria-label="整体等比缩放倍数" min={0.001} max={1000} step={0.1} value={factor===''?null:Number(factor)} onChange={value=>setFactor(String(value??''))} className="prop-input"/></label><Button className="prop-btn" onClick={apply}>应用整体变换</Button>{error&&<p role="status" className="prop-notice is-warn">{error}</p>}</section>;
}

function AppearanceEditor({doc,nodes}:{doc:SceneDocument;nodes:SceneNode[]}){
  const first=doc.materials.find(m=>m.id===nodes[0]?.materialId);
  const [color,setColor]=useState(first?.baseColor??'#9099a4');
  const [roughness,setRoughness]=useState(String(first?.roughness??.5));
  const [metalness,setMetalness]=useState(String(first?.metalness??0));
  const [opacity,setOpacity]=useState(String(first?.opacity??1));
  const [sourceId,setSourceId]=useState('all');const [notice,setNotice]=useState('');
  const originals=[...new Set(nodes.map(n=>n.materialId).filter((id):id is string=>!!id))];
  const targets=sourceId==='all'?nodes:nodes.filter(n=>n.materialId===sourceId);
  const apply=(patch:AppearancePatch&{materialId?:string},label:string)=>{
    if(!targets.length){setNotice('没有匹配的零件');return;}
    let operations:Command[];try{operations=selectionPropertyCommands(doc,targets.map(n=>n.id),{kind:'appearance',value:patch});}catch(e){setNotice(e instanceof Error?e.message:'外观修改参数无效');return;}
    const result=useEditorStore.getState().applyCommandBatch(operations,label);setNotice(result.ok?'已修改，可撤销':result.error??'修改失败');
  };
  return <section className="prop-section"><h4 className="prop-section-title">颜色与材质</h4>
    {nodes.length>1&&<label className="prop-label">修改范围<Select aria-label="外观修改范围" value={sourceId} onChange={setSourceId} className="prop-select" options={[{value:'all',label:`全部选中零件（${nodes.length}）`},...originals.map(id=>({value:id,label:`${nodes.filter(n=>n.materialId===id).slice(0,2).map(n=>n.name).join('、')} · ${doc.materials.find(m=>m.id===id)?.baseColor??id}（${nodes.filter(n=>n.materialId===id).length}）`}))]}/></label>}
    <p className="prop-hint">本次影响 {targets.length} 个零件；修改颜色会保留各零件原有的粗糙度、金属度和透明度。</p>
    {nodes.length>1&&sourceId==='all'&&<p className="prop-notice is-warn">将统一所有选中零件的颜色，包括轮子、外壳等。只改部分时请先选择上方范围。</p>}
    <div className="prop-color-row"><ColorPicker aria-label="选择颜色" value={/^#[0-9a-f]{6}$/i.test(color)?color:'#9099a4'} onChange={value=>setColor(value.toHexString())} disabledAlpha/><Input aria-label="颜色十六进制" value={color} onChange={e=>setColor(e.target.value)} className="prop-input prop-input-hex"/><Button type="primary" className="prop-btn" onClick={()=>{if(!/^#[0-9a-f]{6}$/i.test(color)){setNotice('请输入 #RRGGBB 颜色');return;}apply({baseColor:color},'修改选中对象颜色')}}>应用颜色</Button></div>
    <div className="prop-grid prop-grid-3">{([['粗糙度',roughness,setRoughness],['金属度',metalness,setMetalness],['不透明度',opacity,setOpacity]] as const).map(([label,value,set])=><label key={label} className="prop-label">{label}<InputNumber aria-label={label} step={0.05} value={value===''?null:Number(value)} onChange={v=>set(String(v??''))} className="prop-input"/></label>)}</div>
    <Button className="prop-btn" onClick={()=>{const values=[roughness,metalness,opacity];if(values.some(v=>!v.trim()||!Number.isFinite(Number(v))||Number(v)<0||Number(v)>1)){setNotice('材质参数需为0–1');return;}apply({roughness:Number(roughness),metalness:Number(metalness),opacity:Number(opacity)},'修改选中对象材质参数')}}>应用材质参数</Button>
    <p className="prop-hint">替换为现有材质（将同时替换颜色与表面参数）</p><div className="prop-swatches">{doc.materials.map(m=><Button key={m.id} aria-label={`使用材质 ${m.id}`} title={`${m.id} ${m.baseColor}`} onClick={()=>apply({materialId:m.id},'替换选中对象材质')} className="prop-swatch" style={{backgroundColor:m.baseColor}}/>)}</div>
    {notice&&<p role="status" className="prop-notice is-warn">{notice}</p>}
  </section>;
}

// 各几何类型的局部包围盒（米）
function geomBbox(g: Geometry): [number, number, number] {
  switch (g.type) {
    case 'profileSweep':case 'loft':case 'sweepTube':case 'mesh':case 'lathe':case 'profile': {const b=boundsFor(g);return [b.max.x-b.min.x,b.max.y-b.min.y,b.max.z-b.min.z];}
    case 'capsule': return [g.params.radius*2,g.params.length+g.params.radius*2,g.params.radius*2];
    case 'tube': return [g.params.outerRadius*2,g.params.height,g.params.outerRadius*2];
    case 'trapezoid': return [Math.max(g.params.widthTop,g.params.widthBottom),g.params.height,g.params.depth];
    case 'frame':
    case 'roundedPlate':
    case 'box':
      return [g.params.width, g.params.height, g.params.depth];
    case 'sphere':
      return [g.params.radius * 2, g.params.radius * 2, g.params.radius * 2];
    case 'cone':
      return [g.params.radius * 2, g.params.height, g.params.radius * 2];
    case 'plane':
      return [g.params.width, 0, g.params.depth];
    case 'cylinder': {
      const r = Math.max(g.params.radiusTop, g.params.radiusBottom);
      return [r * 2, g.params.height, r * 2];
    }
    default:
      return [0, 0, 0];
  }
}
