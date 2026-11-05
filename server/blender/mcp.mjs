#!/usr/bin/env node
import {createInterface} from 'node:readline';
import {buildGlb, modelSchema} from './model.mjs';

import {pythonArtifacts, runBlenderPython, pythonSchema, pythonToolName} from './python.mjs';

const pythonEnabled = process.env.CHAT3D_BLENDER_ALLOW_PYTHON === '1';
const executable = process.env.BLENDER_EXECUTABLE ?? 'blender';
const name = 'build_model';
const requests = new Map();
process.stdin.on('end', () => {
  for (const controller of requests.values()) controller.abort();
});
const supported = new Set(['2024-11-05','2025-03-26','2025-06-18','2025-11-25']);
const input = createInterface({input:process.stdin, crlfDelay:Infinity, terminal:false});
const send = (value) => process.stdout.write(JSON.stringify(value) + '\n');
const embedded = (filename,mimeType,bytes) => ({type:'resource',resource:{uri:'scenivo-blender:///'+filename,mimeType,blob:bytes.toString('base64')}});

async function dispatch({jsonrpc, id, method, params}) {
  if (jsonrpc !== '2.0' || typeof method !== 'string') return send({jsonrpc:'2.0',id:id ?? null,error:{code:-32600,message:'Invalid request'}});
  if (id === undefined) {
    if (method === 'notifications/cancelled') requests.get(params?.requestId)?.abort();
    return;
  }
  const result = (value) => send({jsonrpc:'2.0',id,result:value});
  const error = (code,message) => send({jsonrpc:'2.0',id,error:{code,message}});
  if (method === 'initialize') return result({protocolVersion:supported.has(params?.protocolVersion) ? params.protocolVersion : '2025-11-25',capabilities:{tools:{}},serverInfo:{name:'scenivo-blender',version:'1.0.0'}});
  if (method === 'ping') return result({});
  if (method === 'tools/list') return result({tools:[{name,description:'Build a box, cylinder or four-hole mounting plate using millimeters; returns a binary glTF embedded resource.',inputSchema:modelSchema},...(pythonEnabled ? [{name:pythonToolName,description:'Run trusted arbitrary Blender Python in a temporary empty scene and return three embedded files: native Blender project, binary glTF, and Blender-rendered PNG. Not an OS sandbox; code runs with host process privileges.',inputSchema:pythonSchema}] : [])]});
  if (method !== 'tools/call') return error(-32601,'Method not found');
  const python = pythonEnabled && params?.name === pythonToolName;
  if (!python && params?.name !== name) return error(-32602,'Unknown tool');
  if (requests.has(id)) return error(-32600,'Duplicate active request id');
  const controller = new AbortController();
  requests.set(id,controller);
  try {
    if (python) {
      const artifacts = await runBlenderPython(params.arguments,{executable,signal:controller.signal});
      return result({content:pythonArtifacts.map(({field,filename,mimeType})=>embedded(filename,mimeType,artifacts[field]))});
    }
    const bytes = await buildGlb(params.arguments,{executable,signal:controller.signal});
    return result({content:[embedded('model.glb','model/gltf-binary',bytes)]});
  } catch (err) {
    return result({isError:true,content:[{type:'text',text:err.code ? 'Blender build failed' : err.message}]});
  } finally {requests.delete(id);}
}

input.on('line', line => {
  let message;
  try { message = JSON.parse(line); }
  catch { return send({jsonrpc:'2.0',id:null,error:{code:-32700,message:'Parse error'}}); }
  if (!message || typeof message !== 'object' || Array.isArray(message)) return send({jsonrpc:'2.0',id:null,error:{code:-32600,message:'Invalid request'}});
  void dispatch(message);
});
