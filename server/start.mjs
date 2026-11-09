import {openTeam,teamMiddleware} from './team/service.mjs';
import {blenderMiddleware} from './blender/adapter.mjs';
import {buildMiddleware} from './blender/build-http.mjs';
import {pythonMiddleware} from './blender/python-http.mjs';
import {createServer} from 'node:http';
import {readFile,stat} from 'node:fs/promises';
import {readFileSync} from 'node:fs';
import {resolve,extname,sep} from 'node:path';
import {appVersionMiddleware} from './app-version.mjs';
import {modelProxyMiddleware} from './node-adapter.mjs';
import {createSpaStatic} from './static.mjs';
const root=resolve('dist');
const teamWebRoot=resolve('dist-team-web');
const serveTeamWeb=createSpaStatic(teamWebRoot,'/team');
const types={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.svg':'image/svg+xml','.png':'image/png','.ico':'image/x-icon','.jpg':'image/jpeg','.webp':'image/webp'};
const proxy=modelProxyMiddleware({allowed:process.env.CHAT3D_ALLOWED_UPSTREAMS,publicOrigin:process.env.CHAT3D_PUBLIC_ORIGIN});
const blenderOptions={enabled:process.env.CHAT3D_BLENDER_ENABLED==='1',executable:process.env.BLENDER_EXECUTABLE??'blender',publicOrigin:process.env.CHAT3D_PUBLIC_ORIGIN};
const bindHost=process.env.HOST??'127.0.0.1';
const python=pythonMiddleware({...blenderOptions,bindHost});
const blender=blenderMiddleware(blenderOptions);
const build=buildMiddleware(blenderOptions);
function oauthClientSecretFromEnv(){
  if(process.env.CHAT3D_PLATFORM_OAUTH_CLIENT_SECRET)return process.env.CHAT3D_PLATFORM_OAUTH_CLIENT_SECRET;
  const file=process.env.CHAT3D_PLATFORM_OAUTH_CLIENT_SECRET_FILE;
  if(!file)return undefined;
  try{return readFileSync(file,'utf8').trim();}catch{return undefined;}
}
const team=process.env.CHAT3D_TEAM_DB?openTeam(process.env.CHAT3D_TEAM_DB,{platformAuthBase:process.env.CHAT3D_PLATFORM_AUTH_BASE,platformTenantId:process.env.CHAT3D_PLATFORM_TENANT_ID,passwordLogin:process.env.CHAT3D_TEAM_PASSWORD_LOGIN!=='0',oauthClientId:process.env.CHAT3D_PLATFORM_OAUTH_CLIENT_ID??'scenivo',oauthClientSecret:oauthClientSecretFromEnv(),oauthTokenPath:process.env.CHAT3D_PLATFORM_OAUTH_TOKEN_PATH}):null;
const sharing=team?teamMiddleware(team,(await import('../dist-team/validator.mjs')).validateTeamPayload,{origins:(process.env.CHAT3D_TEAM_ORIGINS??'').split(',').filter(Boolean)}):(req,res,next)=>next();
const version=appVersionMiddleware();
const server=createServer((req,res)=>version(req,res,()=>sharing(req,res,()=>python(req,res,()=>build(req,res,()=>blender(req,res,()=>proxy(req,res,async()=>{
 try{
  if(!['GET','HEAD'].includes(req.method)){res.writeHead(405).end();return;}
  const pathname=decodeURIComponent(new URL(req.url,'http://localhost').pathname);
  if((pathname.startsWith('/api/')||pathname.startsWith('/server/'))){res.writeHead(404).end();return;}
  if(pathname==='/team'||pathname.startsWith('/team/')){if(await serveTeamWeb(req,res,pathname))return;}
  let file=resolve(root,'.'+pathname);if(!file.startsWith(root+sep)&&file!==root){res.writeHead(403).end();return;}
  if(!extname(pathname))file=resolve(root,'index.html');
  if(!(await stat(file)).isFile())throw Error();const bytes=await readFile(file);
  res.writeHead(200,{'Content-Type':types[extname(file)]??'application/octet-stream','Cache-Control':pathname.startsWith('/assets/')?'public,max-age=31536000,immutable':'no-cache','X-Content-Type-Options':'nosniff'});res.end(req.method==='HEAD'?undefined:bytes);
 }catch{res.writeHead(404).end('Not found');}
})))))));
server.requestTimeout=900000; // Match the longest supported team publication upload.
server.listen(Number(process.env.PORT??1420),bindHost,()=>console.log('chat3d server ready (model proxy enabled)'));
