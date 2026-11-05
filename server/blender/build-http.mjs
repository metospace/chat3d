import {access, stat} from 'node:fs/promises';
import {constants} from 'node:fs';
import {delimiter, join} from 'node:path';
import {validateModel} from './model.mjs';
import {buildThroughMcp} from './mcp-client.mjs';

export async function executableExists(executable) {
  const paths = /[\\/]/.test(executable) ? [executable] : (process.env.PATH ?? '').split(delimiter).filter(Boolean).map(dir => join(dir,executable));
  const extensions = process.platform === 'win32' && !/\.[a-z]+$/i.test(executable) ? ['', '.exe', '.com'] : [''];
  for (const path of paths) for (const ext of extensions) {
    try { await access(path+ext,constants.X_OK); if ((await stat(path+ext)).isFile()) return true; }
    catch { /* Try the next executable candidate. */ }
  }
  return false;
}

export function buildMiddleware({enabled = false, executable = 'blender', publicOrigin} = {}) {
  return async (req, res, next) => {
    const path = new URL(req.url ?? '/', 'http://localhost').pathname;
    const send = (status, payload) => res.writeHead(status, {'Content-Type':'application/json','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}).end(JSON.stringify(payload));
    if (path === '/api/blender/build/status' && req.method === 'GET') {
      const available = enabled && await executableExists(executable);
      return send(200,{available,modelingAvailable:available,reason:available ? null : enabled ? 'Blender executable not found' : 'Blender modeling is not configured'});
    }
    if (path !== '/api/blender/build') return next();
    if (req.method !== 'POST') return send(405,{error:'Method not allowed'});
    if (!enabled) return send(503,{error:'Blender modeling is not configured'});
    const peer = req.socket.remoteAddress;
    if (!['127.0.0.1','::1','::ffff:127.0.0.1'].includes(peer) || req.headers.origin !== (publicOrigin ?? 'http://' + req.headers.host) || req.headers['x-chat3d-build'] !== '1') return send(403,{error:'Same-origin loopback build request required'});
    if (req.headers['content-type']?.split(';')[0].trim().toLowerCase() !== 'application/json') return send(415,{error:'JSON required'});
    if (Number(req.headers['content-length']) > 4096) return send(413,{error:'Geometry request too large'});
    const ac = new AbortController();
    res.on('close', () => { if (!res.writableEnded) ac.abort(); });
    try {
      const chunks = []; let size = 0;
      for await (const chunk of req.iterator({destroyOnReturn:false})) {
        size += chunk.length;
        if (size > 4096) { req.resume(); return send(413,{error:'Geometry request too large'}); }
        chunks.push(chunk);
      }
      let input;
      try { input = validateModel(JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
      catch (error) { return send(422,{error: error instanceof SyntaxError ? 'Invalid JSON' : error.message}); }
      const bytes = await buildThroughMcp(input,{executable,signal:ac.signal});
      return res.writeHead(200,{'Content-Type':'model/gltf-binary','Content-Length':bytes.length,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}).end(bytes);
    } catch (error) {
      if (!res.destroyed) return send(error.status ?? 500,{error:error.status ? error.message : 'Blender build failed'});
    }
  };
}
