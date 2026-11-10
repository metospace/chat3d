import assert from 'node:assert/strict';
import {createServer} from 'vite';
const server=await createServer({server:{middlewareMode:true},appType:'custom'});
try{
 const {modelingProgramCommands,modelingProgramSource}=await server.ssrLoadModule('/src/ai/modelingProgramDraft.ts');
 const {applyBatch}=await server.ssrLoadModule('/src/domain/commands.ts');
 const {createInitialDoc}=await server.ssrLoadModule('/src/store.ts');
 const {serializeProject,parseProject}=await server.ssrLoadModule('/src/domain/project.ts');
 const {makeId}=await server.ssrLoadModule('/src/util/ids.ts');
 const base=createInitialDoc(),group=makeId(),nodeId=makeId(),materialId=makeId();
 const generated={...createInitialDoc(),nodes:[{id:nodeId,assemblyId:group,assemblyName:'对象',name:'曲面壳',kind:'primitive',parentId:null,visible:true,materialId,geometry:{type:'mesh',params:{positions:[0,0,0,1,0,0,0,1,0],indices:[0,1,2]}},transform:{position:[0,0,0],rotationQuaternion:[0,0,0,1],scale:[1,1,1]}}],materials:[{id:materialId,baseColor:'#999999',roughness:.3,metalness:.7}]};
 const plan={key:'body',name:'对象',purpose:'外观重建',detailLevel:'closeup',detailReason:'主形体',silhouette:'连续外壳',features:[{key:'shell',name:'外壳',role:'form',geometryApproach:'mesh'}],negativeSpaces:[],views:['front','side']};
 const args={name:'模型',source:'return new THREE.Group();',stage:'detailed',features:[{key:'shell',partNames:['曲面壳']}]};
 const ops=modelingProgramCommands(base,generated,args,plan),first=applyBatch(base,{operations:ops});assert.deepEqual(first.errors,[]);assert.equal(base.nodes.length,0);assert.equal(first.doc.nodes[0].modelStructure.featureKeys[0],'shell');assert.equal(first.doc.materials.find(m=>m.id===first.doc.nodes[0].materialId).metalness,.7);
 const reopened=parseProject(serializeProject(first.doc));assert.equal(modelingProgramSource(reopened,reopened.nodes[0].assemblyId).source,args.source);
 const bad=structuredClone(args);bad.features[0].partNames=['不存在'];assert.throws(()=>modelingProgramCommands(first.doc,generated,bad,plan),/未返回命名部件/);
 const component=first.doc.nodes[0].assemblyId;const rebuilt=applyBatch(first.doc,{operations:modelingProgramCommands(first.doc,generated,{...args,replaceComponentId:component},plan)});assert.deepEqual(rebuilt.errors,[]);assert.equal(rebuilt.doc.nodes.length,1);assert.notEqual(rebuilt.doc.nodes[0].id,first.doc.nodes[0].id);
 const animated=structuredClone(first.doc);animated.animation={duration:2,loop:true,tracks:[{targetIds:[animated.nodes[0].id]}]};assert.throws(()=>modelingProgramCommands(animated,generated,{...args,replaceComponentId:component},plan),/动画或跟随/);
 const wrongSize={...plan,dimensions:{x:2},dimensionsSource:'user'};assert.throws(()=>modelingProgramCommands(base,generated,args,wrongSize),/用户声明/);
 const fullPlan={...plan,features:[...plan.features,{key:'controls',name:'操作界面',role:'function',geometryApproach:'mesh'}]};
 assert.throws(()=>modelingProgramCommands(base,generated,args,fullPlan),/细化构建必须覆盖/);
 const silhouetteOps=modelingProgramCommands(base,generated,{...args,stage:'silhouette'},fullPlan);const silhouetteDoc=applyBatch(base,{operations:silhouetteOps}).doc;
 assert.equal(silhouetteDoc.nodes[0].modelingProgram.stage,'silhouette');assert.equal(first.doc.nodes[0].modelingProgram.stage,'detailed');
 const {checkEditScope}=await server.ssrLoadModule('/src/domain/editScope.ts');
 assert.ok(checkEditScope(first.doc,rebuilt.doc,{nodeIds:[first.doc.nodes[0].id]}).length,'whole rebuild cannot widen an explicit selected-only boundary');
 assert.ok(checkEditScope(first.doc,rebuilt.doc,{lockPlacement:true}).length,'replacement cannot remove placement-locked nodes');
 const unrelated=structuredClone(generated);unrelated.nodes[0].id=makeId();unrelated.nodes[0].assemblyId=makeId();
 const combined={...first.doc,nodes:[...first.doc.nodes,...unrelated.nodes],materials:[...first.doc.materials,...unrelated.materials]};
 // Use the existing material ID for the sibling so the document stays valid.
 combined.materials=first.doc.materials;combined.nodes[1].materialId=first.doc.nodes[0].materialId;
 const withSibling=applyBatch(combined,{operations:modelingProgramCommands(combined,generated,{...args,replaceComponentId:component},plan)});
 assert.deepEqual(withSibling.errors,[]);assert.deepEqual(withSibling.doc.nodes.find(n=>n.id===unrelated.nodes[0].id),combined.nodes[1]);
 const {structureFrame}=await server.ssrLoadModule('/src/domain/structuredComponent.ts');
 const rotated=applyBatch(base,{operations:modelingProgramCommands(base,generated,{...args,position:[2,0,3],yaw:35},plan)});assert.deepEqual(rotated.errors,[]);
 const frame=structureFrame(rotated.doc.nodes);assert.ok(Math.abs(frame.yaw-35)<1e-6);assert.deepEqual(frame.origin,[2,0,3]);
 const rotatedAgain=applyBatch(rotated.doc,{operations:modelingProgramCommands(rotated.doc,generated,{...args,position:frame.origin,yaw:frame.yaw,replaceComponentId:rotated.doc.nodes[0].assemblyId},plan)});assert.deepEqual(rotatedAgain.errors,[]);
 assert.ok(Math.abs(structureFrame(rotatedAgain.doc.nodes).yaw-35)<1e-6);assert.deepEqual(structureFrame(rotatedAgain.doc.nodes).origin,[2,0,3]);
 const {STRUCTURED_BYTES_LIMIT}=await server.ssrLoadModule('/src/domain/structureLimits.ts');
 const {MAX_PROJECT_BYTES}=await server.ssrLoadModule('/src/domain/project.ts');
 // Existing factory already over the structured budget; adding a small scripted part must still succeed under the 400 MiB project cap.
 const factoryPad='x'.repeat(STRUCTURED_BYTES_LIMIT+1024),factoryId=makeId(),factoryMat=makeId();
 const factory={...createInitialDoc(),materials:[{id:factoryMat,baseColor:'#999999',roughness:.5,metalness:0}],nodes:[{id:factoryId,assemblyId:factoryId,assemblyName:'工厂',name:factoryPad,kind:'primitive',parentId:null,visible:true,materialId:factoryMat,geometry:{type:'box',params:{width:1,height:1,depth:1}},transform:{position:[0,0,0],rotationQuaternion:[0,0,0,1],scale:[1,1,1]}}]};
 assert.ok(new TextEncoder().encode(serializeProject(factory)).length>STRUCTURED_BYTES_LIMIT);
 const factoryOps=modelingProgramCommands(factory,generated,args,plan),factoryApplied=applyBatch(factory,{operations:factoryOps});
 assert.deepEqual(factoryApplied.errors,[]);assert.equal(factoryApplied.doc.nodes.length,2);assert.equal(factoryApplied.doc.nodes[0].id,factoryId);
 // A merge that would exceed the real project cap still fails with the 400 MiB project error.
 const overProject={...factory,nodes:[{...factory.nodes[0],name:'y'.repeat(MAX_PROJECT_BYTES)}]};
 assert.throws(()=>modelingProgramCommands(overProject,generated,args,plan),/项目文件超过 400 MiB/);
 // Oversized newly generated component still hits the structured budget, not the project cap.
 const hugeGenerated=structuredClone(generated);hugeGenerated.nodes[0]={...hugeGenerated.nodes[0],budgetPad:'z'.repeat(STRUCTURED_BYTES_LIMIT+1024)};
 assert.throws(()=>modelingProgramCommands(base,hugeGenerated,args,plan),new RegExp(`项目文件超过 ${STRUCTURED_BYTES_LIMIT/(1024*1024)} MiB`));
 console.log('PASS parameterized draft atomic replacement, actual feature binding, PBR/source project roundtrip, protected animation/dimensions, and project vs structured byte caps');
}finally{await server.close();}
