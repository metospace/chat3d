import assert from 'node:assert/strict';
import 'fake-indexeddb/auto';
import {createServer} from 'vite';
import {Matrix4,Quaternion,Euler,Vector3} from 'three';
const vite=await createServer({server:{middlewareMode:true},appType:'custom'});
try{
 const {createInitialDoc,useEditorStore}=await vite.ssrLoadModule('/src/store.ts');
 const {applyBatch}=await vite.ssrLoadModule('/src/domain/commands.ts');
 const {createModelAsset,assetDocument,instantiateAsset,parseModelAsset}=await vite.ssrLoadModule('/src/domain/modelAssets.ts');
 const storage=await vite.ssrLoadModule('/src/domain/modelAssetStorage.ts');
 const {createAnimationEvaluator}=await vite.ssrLoadModule('/src/domain/animation.ts');
 const {AnimationClock}=await vite.ssrLoadModule('/src/scene/animationPlayback.ts');
 const {manualAssetCommand}=await vite.ssrLoadModule('/src/domain/manualComposition.ts');
 const workspace=await vite.ssrLoadModule('/src/workspace.ts');
 const {saveLibraryProject}=await vite.ssrLoadModule('/src/domain/workspaceLibrary.ts');
 const {compressTeamPublication,readTeamPublication}=await vite.ssrLoadModule('/src/domain/teamPublish.ts');
 const {assetPublication}=await vite.ssrLoadModule('/src/domain/teamPublicationSnapshot.ts');
 const {buildTeamCopyExport}=await vite.ssrLoadModule('/src/domain/teamCopyExport.ts');
 const {validateTeamPayload}=await vite.ssrLoadModule('/server/team/validator.ts');
 const part=(name,x)=>({op:'createPrimitive',name,parentId:null,geometry:{type:'box',params:{width:1,height:1,depth:1}},materialId:'mat_gray',transform:{position:[x,2,3],rotationQuaternion:[0,0,0,1],scale:[1,1,1]}});
 const doc=applyBatch(createInitialDoc(),{operations:[part('AGV',4),part('load',5)]}).doc;
 const [a,b]=doc.nodes.map(n=>n.id);
 doc.animation={version:1,name:'潜伏顶升agv',duration:4,loop:true,tracks:[
  {id:'lift',name:'顶升',targetIds:[a],channel:'position',keyframes:[{time:0,value:[0,0,0]},{time:4,value:[2,1,0]}]},
  {id:'turn',name:'旋转',targetIds:[a],channel:'rotation',axis:[0,1,0],pivot:[4,2,3],expression:{op:'mul',args:['t',20]}},
  {id:'load',name:'绑定',targetIds:[b],channel:'follow',sourceId:a,start:1,end:3},
  {id:'scale',name:'缩放',targetIds:[b],channel:'scale',expression:[1,1,1]},
  {id:'visible',name:'显示',targetIds:[b],channel:'visibility',keyframes:[{time:0,value:true},{time:3,value:false}]}
 ]};
 await workspace.initializeWorkspace();workspace.createSession(doc,{moduleKind:'asset',title:'潜伏顶升agv'});
 assert.match(await saveLibraryProject(),/v1/);
 const summary=(await storage.listModelAssets())[0],asset=await storage.readModelAsset(summary.id,1);
 assert.equal(asset.animation.duration,4);assert.equal(asset.animation.loop,true);assert.equal(asset.animation.tracks.length,5);
 assert.deepEqual(asset.animation.tracks[2],doc.animation.tracks[2]);
 assert.deepEqual(asset.animation.tracks[1].pivot,[-.5,.5,0]);
 const packaged=readTeamPublication(await compressTeamPublication(JSON.stringify({kind:'asset',payload:assetPublication(asset)})));
 validateTeamPayload('asset',packaged.payload);
 const restored=parseModelAsset(JSON.stringify(packaged.payload));assert.deepEqual(restored,JSON.parse(JSON.stringify(asset)));
 const reopened=assetDocument(restored);assert.deepEqual(reopened.animation,asset.animation);
 const expressionAsset=structuredClone(restored);expressionAsset.animation.tracks[0]={...expressionAsset.animation.tracks[0],keyframes:undefined,expression:['t',0,0]};
 const expressionScene=applyBatch(createInitialDoc(),{operations:[instantiateAsset(expressionAsset,[0,0,0],90)]});assert.deepEqual(expressionScene.errors,[]);
 const expressionNode=expressionScene.doc.nodes[0],expressionPose=createAnimationEvaluator(expressionScene.doc)(2).get(expressionNode.id);
 const rotationOnly=structuredClone(expressionAsset);rotationOnly.animation.tracks=rotationOnly.animation.tracks.filter(t=>t.channel!=='position');
 const rotationScene=applyBatch(createInitialDoc(),{operations:[instantiateAsset(rotationOnly,[0,0,0],90)]}).doc;
 const rotationPose=createAnimationEvaluator(rotationScene)(2).get(rotationScene.nodes[0].id);assert.ok(Math.abs(expressionPose.transform.position[2]-rotationPose.transform.position[2]+2)<1e-7);
 // A depth-8 expression and a 64-node expression must survive arbitrary yaw.
 const unary=(count,value)=>{for(let i=0;i<count;i++)value={op:'abs',args:[value]};return value;};
 const tree=depth=>depth?{op:'add',args:[tree(depth-1),tree(depth-1)]}:'t';
 const expressions=[unary(8,'t'),unary(1,tree(5)),{op:'sin',args:['t']}];
 const budgetAsset=structuredClone(expressionAsset);budgetAsset.animation.tracks=[{...budgetAsset.animation.tracks[0],expression:expressions}];
 const {evaluateExpression}=await vite.ssrLoadModule('/src/domain/animation.ts');
 parseModelAsset(JSON.stringify(budgetAsset));
 // Demonstrate why even sparse AST rotation cannot preserve these budgets.
 const wrapped=structuredClone(budgetAsset);wrapped.animation.tracks[0].expression[0]={op:'mul',args:[.5,expressions[0]]};assert.throws(()=>parseModelAsset(JSON.stringify(wrapped)),/AST/);
 const oversized=structuredClone(budgetAsset);oversized.animation.tracks[0].expression[1]=unary(2,tree(5));assert.throws(()=>parseModelAsset(JSON.stringify(oversized)),/AST/);
 let cycled=budgetAsset,totalYaw=0;
 for(const yaw of [37,90,-19,360,173,-90,37,37,37,37,37,37]){
  totalYaw+=yaw;
  const placed=applyBatch(createInitialDoc(),{operations:[instantiateAsset(cycled,[3,0,-2],yaw)]});assert.deepEqual(placed.errors,[]);
  const node=placed.doc.nodes[0];
  for(const time of [0,.25,2,4]){
   const expected=new Vector3(...expressions.map(e=>evaluateExpression(e,time))).applyAxisAngle(new Vector3(0,1,0),totalYaw*Math.PI/180);
   const actual=new Vector3(...createAnimationEvaluator(placed.doc)(time).get(node.id).transform.position).sub(new Vector3(...node.transform.position));
   assert.ok(actual.distanceTo(expected)<1e-7,`yaw ${totalYaw}, time ${time}`);
  }
  cycled=createModelAsset(placed.doc,[node.id],{name:'cycled',category:'设备'});
  const published=assetPublication(cycled);validateTeamPayload('asset',published);
  cycled=parseModelAsset(JSON.stringify(published));assert.deepEqual(cycled.animation.tracks[0].expression,expressions);
 }
 for(const expressionYaw of [NaN,Infinity,181,'90']){const invalid=structuredClone(budgetAsset);invalid.animation.tracks[0].expressionYaw=expressionYaw;assert.throws(()=>instantiateAsset(invalid,[0,0,0]),/偏航/);}
 const wrongChannel=structuredClone(budgetAsset);wrongChannel.animation.tracks[0].channel='scale';wrongChannel.animation.tracks[0].expressionYaw=90;assert.throws(()=>instantiateAsset(wrongChannel,[0,0,0]),/偏航/);
 const copy=parseModelAsset(buildTeamCopyExport({id:'team-asset',kind:'asset',version:1,name:asset.name,payload:packaged.payload,categoryPath:[],owner:'test',description:'',created:asset.createdAt}));assert.deepEqual(copy.animation,asset.animation);assert.notEqual(copy.id,asset.id);
 workspace.createSession(undefined,{moduleKind:'scene'});useEditorStore.setState({viewportStatus:'ready'});
 const drag=await vite.ssrLoadModule('/src/ui/libraryAssetDrag.tsx'),transfer={data:new Map(),types:[],setData(type,value){this.data.set(type,value);this.types.push(type);},getData(type){return this.data.get(type)??'';}};
 drag.beginLibraryAssetDrag(summary,transfer);assert.equal(await drag.commitLibraryAssetDrop(transfer,[3,0,5]),true);
 const dropped=useEditorStore.getState().doc;assert.equal(dropped.animation.duration,4);assert.ok(createAnimationEvaluator(dropped)(2).get(dropped.nodes[0].id).transform.position[1]>dropped.nodes[0].transform.position[1]);
 useEditorStore.getState().undo();assert.equal(useEditorStore.getState().doc.animation,undefined);useEditorStore.getState().redo();assert.deepEqual(useEditorStore.getState().doc.animation,dropped.animation);
 const origin=new Vector3(4.5,1.5,3),rotation=new Quaternion().setFromEuler(new Euler(0,Math.PI/2,0));
 const placement=new Matrix4().compose(new Vector3(10,0,7),rotation,new Vector3(1,1,1));
 const result=applyBatch(createInitialDoc(),{operations:[manualAssetCommand(restored,[10,0,7],90)]});assert.deepEqual(result.errors,[]);
 const clock=new AnimationClock();clock.configure(result.doc.animation.duration,result.doc.animation.loop);clock.play();for(let i=0;i<10;i++)clock.tick(.2);
 const originalPose=createAnimationEvaluator(doc)(clock.state.time),placedPose=createAnimationEvaluator(result.doc)(clock.state.time);
 for(let i=0;i<2;i++){
  const expected=new Vector3(...originalPose.get(doc.nodes[i].id).transform.position).sub(origin).applyMatrix4(placement);
  const actual=placedPose.get(result.doc.nodes[i].id);assert.ok(new Vector3(...actual.transform.position).distanceTo(expected)<1e-7);assert.equal(actual.visible,originalPose.get(doc.nodes[i].id).visible);
 }
 const second=applyBatch(result.doc,{operations:[instantiateAsset(restored,[20,0,0])]});assert.deepEqual(second.errors,[]);
 assert.equal(new Set(second.doc.animation.tracks.map(t=>t.id)).size,10);
 assert.equal(second.doc.animation.tracks[7].sourceId,second.doc.nodes[2].id);
 const incompatible={...restored,animation:{...restored.animation,loop:false}};
 const rejected=applyBatch(result.doc,{operations:[instantiateAsset(incompatible,[0,0,0])]});assert.ok(rejected.errors.length);assert.equal(rejected.doc,result.doc);
 const staticAsset=createModelAsset({...doc,animation:undefined},[a,b],{name:'static',category:'设备'});
 assert.equal(parseModelAsset(JSON.stringify(staticAsset)).animation,undefined);
 const staticInsert=applyBatch(result.doc,{operations:[instantiateAsset(staticAsset,[0,0,0])]});assert.deepEqual(staticInsert.errors,[]);assert.deepEqual(staticInsert.doc.animation,result.doc.animation);
 assert.throws(()=>createModelAsset(doc,[b],{name:'missing source',category:'设备'}),/跟随源/);
 const bad=structuredClone(asset);bad.animation.tracks[2].sourceId='missing';assert.throws(()=>parseModelAsset(JSON.stringify(bad)),/绑定/);
 await workspace.flushWorkspace();
 console.log('PASS animated library save payload, local/team package, reopen, placed playback, bindings, repeated instances, conflicts and static compatibility');
}finally{await vite.close();}
