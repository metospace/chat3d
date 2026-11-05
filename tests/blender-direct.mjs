import assert from 'node:assert/strict';
import {createServer} from 'vite';
import {createAssistantMessageEventStream} from '@earendil-works/pi-ai';
const server=await createServer({configFile:false,server:{middlewareMode:true,hmr:false},appType:'custom'});
const original=globalThis.fetch;
try{
 const {runBlenderAgent}=await server.ssrLoadModule('/src/ai/blenderAgent.ts');
 const config={baseURL:'https://fixture.invalid/v1',apiKey:'unused',model:'fixture',agentMode:'pi',stream:true};
 let modelCalls=0,posts=0,result,ended=false;const contexts=[];
 const script='import bpy\nbpy.ops.mesh.primitive_cube_add()';
 const streamFn=async(_model,context)=>{modelCalls++;contexts.push(context);const content=[{type:'toolCall',id:'blender-1',name:'run_blender_python',arguments:{name:'原始立方体',script}}];const message={role:'assistant',content,api:'openai-completions',provider:'fixture',model:'fixture',stopReason:'toolUse',timestamp:Date.now(),usage:{input:10,output:10,cacheRead:0,cacheWrite:0,totalTokens:20,cost:{input:0,output:0,cacheRead:0,cacheWrite:0,total:0}}};const stream=createAssistantMessageEventStream();queueMicrotask(()=>{stream.push({type:'start',partial:message});stream.push({type:'done',reason:'toolUse',message});});return stream;};
 globalThis.fetch=async(url,init)=>{if(String(url).endsWith('/status'))return Response.json({available:true,token:'fixture'});posts++;assert.equal(url,'/api/blender/python');assert.deepEqual(JSON.parse(init.body),{script});const form=new FormData();for(const [name,type] of [['blend','application/octet-stream'],['glb','model/gltf-binary'],['render','image/png']])form.append(name,new Blob([name+' exact bytes'],{type}),name);return new Response(form);};
 await runBlenderAgent({text:'制作完整场景',config,images:[],history:[],signal:new AbortController().signal,confirm:async()=>true,streamFn,onActivity:()=>{},onResult:value=>{result=value;},onControl:control=>{if(control===null)ended=true;},onSteeringApplied:()=>{}});
 assert.equal(modelCalls,1);assert.equal(posts,1);assert.equal(ended,true);
 const tools=contexts.flatMap(c=>c.messages.flatMap(m=>m.toolsAdded??[]));assert.deepEqual(tools.map(t=>t.name),['run_blender_python']);
 for(const name of ['blend','glb','render'])assert.equal(await result[name].text(),name+' exact bytes');assert.equal(result.script,script);
 console.log('PASS independent Blender agent exposes only MCP Python tool, returns untouched original artifacts and ends without scene review or extra model turn');
}finally{globalThis.fetch=original;await server.close();}
