import {randomBytes, timingSafeEqual} from 'node:crypto';
import {pythonThroughMcp} from './mcp-client.mjs';
import {maxScriptBytes, pythonArtifacts, validatePython} from './python.mjs';
import {executableExists} from './build-http.mjs';

const root = '/api/blender/python';
const maxBodyBytes = 6 * maxScriptBytes + 256;
const loopback = new Set(['127.0.0.1','::1','::ffff:127.0.0.1']);
const hosts = /^(?:localhost|127\.0\.0\.1|\[::1\])(?::([1-9][0-9]{0,4}))?$/;
export function pythonMiddleware({bindHost, executable='blender', publicOrigin} = {}) {
  const enabled = process.env.CHAT3D_BLENDER_ALLOW_PYTHON === '1' && ['localhost','127.0.0.1','::1'].includes(bindHost) && !publicOrigin;
  const token = randomBytes(32).toString('hex');
  return async (req,res,next) => {
    const path = new URL(req.url ?? '/', 'http://localhost').pathname;
    if (path !== root && path !== root+'/status') return next();
    const send = (status,data) => res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}).end(JSON.stringify(data));
    const status = path.endsWith('/status');
    if (req.method !== (status ? 'GET' : 'POST')) return send(405,{error:'Method not allowed'});
    if (!enabled) return status ? send(200,{available:false}) : send(503,{error:'Blender Python is not enabled for this deployment'});
    const host = req.headers.host;
    const match = typeof host === 'string' && hosts.exec(host);
    const localPort = req.socket?.localPort;
    if (!match || Number(match[1] ?? 80) !== localPort || !loopback.has(req.socket?.localAddress) || !loopback.has(req.socket?.remoteAddress) || Object.keys(req.headers).some(key=>key==='forwarded' || key==='via' || key.startsWith('x-forwarded-'))) return send(403,{error:'Direct loopback connection required'});
    const origin = new URL('http://'+host).origin;
    if ((req.headers.origin !== undefined || !status) && req.headers.origin !== origin) return send(403,{error:'Same-origin request required'});
    if (req.headers['sec-fetch-site'] && req.headers['sec-fetch-site'] !== 'same-origin') return send(403,{error:'Same-origin request required'});
    const header = req.headers['x-chat3d-python'];
    if (status) {
      if (header !== '1') return send(403,{error:'Python status header required'});
      const available = await executableExists(executable);
      return send(200,{available,...(available ? {token} : {})});
    }
    if (typeof header !== 'string' || !/^[0-9a-f]{64}$/.test(header) || !timingSafeEqual(Buffer.from(header,'hex'),Buffer.from(token,'hex'))) return send(403,{error:'Python authorization token required'});
    if (req.headers['content-type']?.split(';')[0].trim().toLowerCase() !== 'application/json') return send(415,{error:'JSON required'});
    if (Number(req.headers['content-length']) > maxBodyBytes) return send(413,{error:'Request too large'});
    const ac = new AbortController();
    res.on('close',()=>{if(!res.writableEnded)ac.abort();});
    try {
      const chunks = []; let size = 0;
      for await (const chunk of req.iterator({destroyOnReturn:false})) {
        size += chunk.length;
        if (size > maxBodyBytes) {req.resume(); return send(413,{error:'Request too large'});}
        chunks.push(chunk);
      }
      let input;
      try {input = validatePython(JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks))));}
      catch (error) {return send(error.status ?? 422,{error:error.status ? error.message : 'Invalid UTF-8 JSON'});}
      const artifacts = await pythonThroughMcp(input,{executable,signal:ac.signal});
      if (ac.signal.aborted) return;
      const boundary = 'scenivo-'+randomBytes(24).toString('hex');
      const parts = [];
      for (const {field,filename,mimeType} of pythonArtifacts) {
        parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${field}"; filename="${filename}"\r\nContent-Type: ${mimeType}\r\n\r\n`),artifacts[field],Buffer.from('\r\n'));
      }
      const end = Buffer.from(`--${boundary}--\r\n`);
      res.writeHead(200,{'Content-Type':'multipart/form-data; boundary='+boundary,'Content-Length':parts.reduce((size,part)=>size+part.length,end.length),'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});
      for (const part of parts) res.write(part);
      return res.end(end);
    } catch(error) {
      if (!res.destroyed) return send(error.status ?? 500,{error:error.status ? error.message : 'Blender Python failed'});
    }
  };
}
