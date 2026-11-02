import assert from 'node:assert/strict';
import {createServer} from 'vite';
import {mkdtemp} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
const fixture=`
let options,resolve,reject,activity;
export function runModelingAgent(value){options=value;activity=null;return new Promise((yes,no)=>{resolve=yes;reject=no;});}
export const ready=()=>!!options;
export function burst(count){for(let i=1;i<=count;i++){activity={title:'接收模型回复 '+i,turn:1,toolCalls:0,characters:i,inputTokens:0,outputTokens:i,usageReported:true,lastEventAt:Date.now(),plan:[],events:[],explanations:[{id:'public',text:'最新公开说明 '+i}],timings:[{id:'step',kind:'tool',label:'创建结构',startedAt:Date.now()}]};options.onActivity(activity);}}
export function finish(){resolve({activity,batch:{requestId:'fixture-'+Math.random(),projectId:options.document.projectId,baseRevision:options.document.revision,selectedIds:[],summary:'已完成',operations:[]},result:{doc:options.document,errors:[],applied:[],inverse:[]}});options=undefined;}
export function fail(){reject(Error('fixture failure'));options=undefined;}
export function detach(){const previous=options;options=undefined;resolve({activity,batch:{requestId:'late',projectId:previous.document.projectId,baseRevision:previous.document.revision,selectedIds:[],summary:'不应应用',operations:[]}});return previous;}
`;
const server=await createServer({cacheDir:await mkdtemp(join(tmpdir(),'scenivo-progress-')),server:{middlewareMode:true,hmr:false},appType:'custom',plugins:[{name:'progress-agent-fixture',enforce:'pre',load(id){if(id.endsWith('/src/ai/modelingAgent.ts'))return fixture;}}]});
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
try{
 const {conversationController}=await server.ssrLoadModule('/src/runtime/conversationController.ts');
 const {createEditorStore}=await server.ssrLoadModule('/src/store.ts');
 const agent=await server.ssrLoadModule('/src/ai/modelingAgent.ts');
 const config={baseURL:'https://fixture.invalid/v1',apiKey:'test-only-never-sent',model:'fixture',agentMode:'pi'};
 const editor=createEditorStore({composerText:'创建一座立体仓库'}),controller=conversationController(editor);
 let published=[];controller.ui.subscribe((state,previous)=>{if(state.agentActivity!==previous.agentActivity)published.push(state.agentActivity);});
 const start=async()=>{editor.getState().setComposerText('继续创建仓库');const run=controller.send('guide',{config});for(let i=0;i<100&&!agent.ready();i++)await sleep(5);assert.ok(agent.ready());return {run};};
 const first=await start();published=[];agent.burst(1000);assert.equal(published.length,0,'no synchronous React notification per SSE delta');
 await sleep(70);assert.equal(published.length,1);assert.equal(published[0].characters,1000);assert.match(published[0].explanations[0].text,/1000$/);
 agent.burst(1001);agent.finish();await first.run;assert.equal(controller.ui.getState().agentActivity.characters,1001);assert.equal(editor.getState().aiStatus,'idle');
 const completed=controller.ui.getState().agentActivity;await sleep(70);assert.equal(controller.ui.getState().agentActivity,completed);
 console.log('PASS buffered progress publishes the latest complete snapshot once and completion flushes immediately');
 const second=await start();agent.burst(80);controller.cancel();const stopped=controller.ui.getState().agentActivity;
 assert.equal(editor.getState().aiStatus,'cancelled');assert.equal(stopped.characters,80);assert.ok(stopped.timings.every(t=>t.endedAt));
 const stale=agent.detach();stale.onActivity({...stopped,characters:9999});await second.run;await sleep(70);assert.equal(controller.ui.getState().agentActivity,stopped);
 console.log('PASS stop flushes the latest progress and rejects late events and delayed notifications');
 const third=await start();agent.burst(90);agent.fail();await third.run;assert.equal(editor.getState().aiStatus,'error');
 const failed=controller.ui.getState().agentActivity;assert.equal(failed.characters,90);assert.ok(failed.timings.every(t=>t.endedAt));await sleep(70);assert.equal(controller.ui.getState().agentActivity,failed);
 console.log('PASS failure closes pending timings without a stale progress update after the error');
}finally{await server.close();}
