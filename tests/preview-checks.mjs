import assert from 'node:assert/strict';
import {createServer} from 'vite';
const server=await createServer({server:{middlewareMode:true},appType:'custom'});
try{
 const {previewChecks}=await server.ssrLoadModule('/src/domain/previewChecks.ts');
 const {createInitialDoc}=await server.ssrLoadModule('/src/store.ts');const {applyBatch}=await server.ssrLoadModule('/src/domain/commands.ts');
 const doc=applyBatch(createInitialDoc(),{operations:['防静电服工作人员','厂房地坪与背景'].map((name,i)=>({op:'createAssembly',name,parts:[{name:name+'主体',geometry:{type:'box',params:{width:1,height:1,depth:1}},transform:{position:[i*3,0,0],rotationQuaternion:[0,0,0,1],scale:[1,1,1]}}]}))}).doc;
 const person=doc.nodes[0],building=doc.nodes[1],evidence='人物面部、颈部、衣褶和手部仍简化，写实外形与细节未达标';
 const detail={revision:doc.revision,status:'needs_work',targets:[],issues:[],reviews:[{componentId:person.assemblyId,revision:doc.revision,checks:[{criterion:'silhouette',status:'fail',evidence,nodeIds:[person.id]}]}]};
 const issues=[evidence,person.assemblyId+'：'+evidence,person.assemblyName+'：外形与比例不符合，'+evidence,'写实外形与细节未达标','厂房边界与绝对尺寸在参考中未知，背景结构仍为估计','厂房边界与绝对尺寸在参考中未知'];
 const a=previewChecks(issues,'',{document:doc,detailAcceptance:detail});
 assert.equal(a.filter(r=>r.reportedDifference).length,1);assert.equal(a.filter(r=>r.limitation).length,1);assert.deepEqual(a.find(r=>r.reportedDifference).nodeIds,[person.id]);
 const id=a.find(r=>r.reportedDifference).id;detail.reviews[0].checks[0].evidence='人物头颈比例仍需修正，其他细节已改善';const b=previewChecks([detail.reviews[0].checks[0].evidence],'',{document:doc,detailAcceptance:detail});assert.equal(b[0].id,id);assert.equal(b[0].text,person.assemblyName+'：'+detail.reviews[0].checks[0].evidence);
 const separate=previewChecks(['设备A：门板缺失','设备B：门板缺失','人物手部悬空','人物颈部断开']);assert.equal(separate.length,4);
 const clean=previewChecks([], '仍需改进：旧问题');assert.deepEqual(clean,[]);
 const other={componentId:building.assemblyId,revision:doc.revision,checks:[{criterion:'silhouette',status:'fail',evidence:'主体轮廓不符合参考',nodeIds:[building.id]}]};const two=previewChecks([],'',{document:doc,detailAcceptance:{...detail,reviews:[{...detail.reviews[0],checks:[{criterion:'silhouette',status:'fail',evidence:'主体轮廓不符合参考',nodeIds:[person.id]}]},other]}});assert.equal(two.length,2);
 console.log('PASS duplicate prose/UUID/component summaries merge, current criterion identity updates, reference limits separate and distinct targets/defects remain');
}finally{await server.close();}
