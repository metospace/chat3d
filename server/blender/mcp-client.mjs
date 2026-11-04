import {spawn} from 'node:child_process';
import {createInterface} from 'node:readline';
import {fileURLToPath} from 'node:url';
import {blenderWorker} from './model.mjs';

import {pythonToolName} from './python.mjs';

const script = fileURLToPath(new URL('./mcp.mjs',import.meta.url));
const protocolVersion = '2025-06-18';
export const buildThroughMcp = (spec,options) => callThroughMcp('build_model',spec,options);
export const pythonThroughMcp = (spec,options) => callThroughMcp(pythonToolName,spec,options);
async function callThroughMcp(tool,spec,{executable,signal}) {
  const python = tool === pythonToolName;
  if (blenderWorker.active) throw Object.assign(Error('Blender worker busy'),{status:429});
  blenderWorker.active = true;
  try {
    return await new Promise((resolve,reject) => {
      const child = spawn(process.execPath,[script],{env:{...process.env,BLENDER_EXECUTABLE:executable},stdio:['pipe','pipe','ignore'],windowsHide:true});
      const lines = createInterface({input:child.stdout});
      let settled = false;
      const finish = (error,bytes) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        signal?.removeEventListener('abort',abort);
        lines.close();
        child.stdin.end();
        if (error) reject(error); else resolve(bytes);
      };
      const abort = () => send({method:'notifications/cancelled',params:{requestId:2}});
      const send = (request) => child.stdin.write(JSON.stringify({jsonrpc:'2.0',...request})+'\n');
      const timer = setTimeout(() => {abort(); finish(Object.assign(Error(python ? 'Blender Python timed out' : 'Blender build timed out'),{status:504}));},python ? 65000 : 95000);
      child.once('error',finish);
      child.once('close',() => finish(Error('MCP server closed unexpectedly')));
      child.stdin.on('error',finish);
      lines.on('line',line => {
        try {
          const response = JSON.parse(line);
          if (response.error) throw Error('MCP request failed');
          if (response.id === 1 && response.result?.protocolVersion === protocolVersion) {
            if (signal?.aborted) return finish(Error('Build cancelled'));
            send({method:'notifications/initialized'});
            send({id:2,method:'tools/call',params:{name:tool,arguments:spec}});
          } else if (response.id === 2) {
            if (response.result?.isError) {
              const message = response.result.content?.[0]?.text;
              return finish(Object.assign(Error(message || 'Blender build failed'),{status:message === 'Blender executable not found' ? 503 : / timed out$/.test(message) ? 504 : python ? 422 : 500}));
            }
            const resource = response.result?.content?.[0]?.resource;
            if (resource?.mimeType !== 'model/gltf-binary' || typeof resource.blob !== 'string' || resource.blob.length > 28*1024*1024) throw Error('Invalid MCP GLB resource');
            const bytes = Buffer.from(resource.blob,'base64');
            if (bytes.length < 20 || bytes.toString('ascii',0,4) !== 'glTF' || bytes.readUInt32LE(4) !== 2 || bytes.readUInt32LE(8) !== bytes.length) throw Error('Invalid MCP GLB');
            finish(null,bytes);
          }
        } catch (error) {finish(error);}
      });
      signal?.addEventListener('abort',abort,{once:true});
      send({id:1,method:'initialize',params:{protocolVersion,capabilities:{},clientInfo:{name:'scenivo-http',version:'1.0.0'}}});
    });
  } finally {blenderWorker.active = false;}
}
