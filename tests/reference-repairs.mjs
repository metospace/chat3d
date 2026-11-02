import assert from 'node:assert/strict';
import {createServer} from 'vite';
const server=await createServer({server:{middlewareMode:true},appType:'custom'});
try{
 const {updateReferenceRepairs,referenceRepairReport}=await server.ssrLoadModule('/src/domain/referenceRepairs.ts');
 const {createInitialDoc}=await server.ssrLoadModule('/src/store.ts');const {applyBatch}=await server.ssrLoadModule('/src/domain/commands.ts');
 const doc=applyBatch(createInitialDoc(),{operations:[{op:'createPrimitive',name:'continuous body',parentId:null,materialId:'mat_gray',transform:{position:[0,0,0],rotationQuaternion:[0,0,0,1],scale:[1,1,1]},geometry:{type:'box',params:{width:1,height:1,depth:1}}}]}).doc,id=doc.nodes[0].id;
 const issue={id:'body-profile',featureKey:'body',nodeIds:[id],observed:'主体纵向过短',expected:'纵向应是宽度的两倍',action:'替换主体几何深度，保留位置',view:'side'};
 const repairs=updateReferenceRepairs(doc,[],[issue],[]);assert.equal(referenceRepairReport(repairs)[0].status,'unresolved');assert.equal(updateReferenceRepairs(doc,repairs,[],[]).length,1);
 assert.throws(()=>updateReferenceRepairs(doc,repairs,[],[issue.id]),/尚未实际修改/);
 const renamed=applyBatch(doc,{operations:[{op:'rename',targetId:id,name:'fixed'},{op:'setAppearance',targetId:id,baseColor:'#ffffff'}]}).doc;assert.throws(()=>updateReferenceRepairs(renamed,repairs,[],[issue.id]),/尚未实际修改/);
 assert.throws(()=>updateReferenceRepairs(doc,repairs,[{...issue,featureKey:'decoration'}],[]),/不可改绑/);
 const fixed=applyBatch(doc,{operations:[{op:'updateParameters',targetId:id,geometry:{type:'box',params:{width:1,height:1,depth:2}}}]}).doc;assert.deepEqual(updateReferenceRepairs(fixed,repairs,[],[issue.id]),[]);assert.equal(repairs.length,1);
 assert.throws(()=>updateReferenceRepairs(doc,[],[{...issue,nodeIds:['missing']}],[]),/真实部件/);
 console.log('PASS reference defects survive omitted fields, renames and materials; only actual geometry changes permit explicit resolution');
}finally{await server.close();}
