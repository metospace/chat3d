import {DatabaseSync} from 'node:sqlite';
import {randomBytes,randomUUID,scryptSync,timingSafeEqual,createHash} from 'node:crypto';
import {mkdirSync,createReadStream} from 'node:fs';
import {dirname} from 'node:path';
import {pipeline} from 'node:stream/promises';
import {openDashboardStore} from './dashboard.mjs';
import {openPublicationUploads} from './publishUploads.mjs';
const MAX_HTTP_BODY_BYTES=500*1024*1024;
const hash=s=>createHash('sha256').update(s).digest('hex');
const fail=(status,message)=>{throw Object.assign(Error(message),{status});};
const categoryId=/^category-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function categoryLabel(value){if(typeof value!=='string'||/[\u0000-\u001f\u007f-\u009f]/.test(value))return;const label=value.trim();if(!label||label.length>80||label==='全部'||label==='未分类'||categoryId.test(label))return;return label;}
function legacyCategoryPath(kind,payload){const label=kind==='asset'?categoryLabel(payload?.category):undefined;return label?[label]:[];}
function publishCategoryPath(kind,payload,path){if(path===undefined)return legacyCategoryPath(kind,payload);if(!Array.isArray(path)||path.length>2)fail(400,'分类路径无效');return Array.from(path,value=>{const label=categoryLabel(value);if(label===undefined)fail(400,'分类路径无效');return label;});}
export function openTeam(path,options={}){
 mkdirSync(dirname(path),{recursive:true,mode:0o700});
 const db=new DatabaseSync(path);db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;
 CREATE TABLE IF NOT EXISTS users(id TEXT PRIMARY KEY,name TEXT UNIQUE NOT NULL,salt TEXT NOT NULL,password TEXT NOT NULL,role TEXT NOT NULL,disabled INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS sessions(token TEXT PRIMARY KEY,user TEXT NOT NULL REFERENCES users(id),expires INTEGER NOT NULL,platform_access TEXT,platform_tenant TEXT,platform_checked INTEGER);
 CREATE TABLE IF NOT EXISTS items(id TEXT PRIMARY KEY,owner TEXT NOT NULL REFERENCES users(id),kind TEXT NOT NULL,head INTEGER NOT NULL);
 CREATE TABLE IF NOT EXISTS versions(item TEXT NOT NULL REFERENCES items(id),version INTEGER NOT NULL,name TEXT NOT NULL,description TEXT NOT NULL,created TEXT NOT NULL,payload TEXT NOT NULL,PRIMARY KEY(item,version));
 CREATE TABLE IF NOT EXISTS requests(user TEXT NOT NULL,key TEXT NOT NULL,digest TEXT NOT NULL,result TEXT NOT NULL,PRIMARY KEY(user,key));`);
for(const [column,type] of [['platform_access','TEXT'],['platform_tenant','TEXT'],['platform_checked','INTEGER']]){try{db.exec(`ALTER TABLE sessions ADD COLUMN ${column} ${type}`);}catch(e){if(!/duplicate column/i.test(e.message))throw e;}}
// Migrate only the snapshot column; payloads and retry digests remain byte-for-byte unchanged.
db.exec('BEGIN IMMEDIATE');
try{
 let added=false;try{db.exec("ALTER TABLE versions ADD COLUMN category_path TEXT NOT NULL DEFAULT '[]'");added=true;}catch(e){if(!/duplicate column/i.test(e.message))throw e;}
 if(added){const update=db.prepare('UPDATE versions SET category_path=? WHERE item=? AND version=?');for(const row of db.prepare("SELECT v.item,v.version,v.payload FROM versions v JOIN items i ON i.id=v.item WHERE i.kind='asset'").all()){let payload;try{payload=JSON.parse(row.payload);}catch{continue;}const path=legacyCategoryPath('asset',payload);if(path.length)update.run(JSON.stringify(path),row.item,row.version);}}
 db.exec('COMMIT');
}catch(e){db.exec('ROLLBACK');throw e;}
const dashboardStore=openDashboardStore(db,`${path}.dashboards`);
const publicationUploads=openPublicationUploads(db,`${path}.publish-uploads`);
const dashboards={...dashboardStore,
 completeUpload:async(_user,id,token)=>dashboardStore.completeUpload(await authenticate(token,{force:true}),id),
 archive:async(_user,id,archived,token)=>dashboardStore.archive(await authenticate(token,{force:true}),id,archived),
};
const platformAuthBase=(options.platformAuthBase??process.env.CHAT3D_PLATFORM_AUTH_BASE??'http://36.133.218.210:48080').replace(/\/$/,'');
const platformTenant=String(options.platformTenantId??process.env.CHAT3D_PLATFORM_TENANT_ID??'1');
const passwordLogin=options.passwordLogin??process.env.CHAT3D_TEAM_PASSWORD_LOGIN!=='0';
const oauthClientId=options.oauthClientId??process.env.CHAT3D_PLATFORM_OAUTH_CLIENT_ID??'scenivo';
const oauthClientSecret=options.oauthClientSecret??process.env.CHAT3D_PLATFORM_OAUTH_CLIENT_SECRET??'';
const oauthTokenPath=options.oauthTokenPath??process.env.CHAT3D_PLATFORM_OAUTH_TOKEN_PATH??'/admin-api/system/oauth2/token';
/** One-time platform-token handoff for desktop: callback page and Tauri do not share origin/BroadcastChannel. */
const pendingClaims=new Map();
const PENDING_TTL_MS=300000;
function prunePendingClaims(now=Date.now()){for(const [key,entry] of pendingClaims)if(entry.expires<=now)pendingClaims.delete(key);}
function stashPendingClaim(state,platform){
 if(typeof state!=='string'||!state.trim()||!platform?.accessToken)return;
 prunePendingClaims();
 pendingClaims.set(hash(state.trim()),{platform:{accessToken:platform.accessToken,refreshToken:platform.refreshToken??'',expiresTime:platform.expiresTime??0},expires:Date.now()+PENDING_TTL_MS});
}
function claimPending(state){
 if(typeof state!=='string'||!state.trim()||state.length>256)fail(400,'领取参数无效');
 prunePendingClaims();
 const key=hash(state.trim()),entry=pendingClaims.get(key);
 if(!entry)fail(404,'授权尚未完成或已过期');
 pendingClaims.delete(key);
 return {platform:entry.platform};
}

async function platformUser(accessToken,tenantId){
 if(typeof accessToken!=='string'||!accessToken||accessToken.length>4096||typeof tenantId!=='string'||!/^[0-9]{1,16}$/.test(tenantId))fail(400,'协同登录参数无效');
 let response;try{response=await fetch(platformAuthBase+'/admin-api/system/auth/get-permission-info',{headers:{Authorization:'Bearer '+accessToken,'tenant-id':tenantId},signal:AbortSignal.timeout(15000),redirect:'error'});}catch{fail(502,'无法连接协同认证服务');}
 let data;try{data=await response.json();}catch{fail(502,'协同认证响应无效');}
 if(response.status===401||data?.code===401)fail(401,'协同登录已失效');
 if(!response.ok||data?.code!==0)fail(502,'协同认证失败');
 const username=data?.data?.user?.username;if(typeof username!=='string'||!/^[a-zA-Z0-9_.@-]{1,80}$/.test(username))fail(502,'协同账号无效');
 return username;
}
function issue(userId,now,platform){const token=randomBytes(32).toString('hex');db.prepare('DELETE FROM sessions WHERE expires<?').run(now);db.prepare('INSERT INTO sessions(token,user,expires,platform_access,platform_tenant,platform_checked) VALUES(?,?,?,?,?,?)').run(hash(token),userId,now+8*3600000,platform?.access??null,platform?.tenant??null,platform?now:null);return token;}
 const transaction=fn=>{db.exec('BEGIN IMMEDIATE');try{const value=fn();db.exec('COMMIT');return value;}catch(e){db.exec('ROLLBACK');throw e;}};
 function provision(name,password,role='member'){
  if(!/^[a-zA-Z0-9_.@-]{1,80}$/.test(name)||typeof password!=='string'||password.length<12||password.length>256||!['admin','member','viewer'].includes(role))fail(400,'账号、角色或密码无效（密码至少12位）');
  const salt=randomBytes(16).toString('hex');const id=randomUUID();
  db.prepare('INSERT INTO users VALUES(?,?,?,?,?,0)').run(id,name,salt,scryptSync(password,salt,64).toString('hex'),role);return {id,name,role};
 }
 const failures=new Map();
function login(name,password){
 if(!passwordLogin)fail(403,'已关闭团队密码登录，请使用协同账号');
 if(typeof name!=='string'||typeof password!=='string'||name.length>80||password.length>256)fail(400,'登录参数无效');
 const now=Date.now();for(const [k,v] of failures)if(v.until<now)failures.delete(k);
 if(failures.size>1000||failures.get(name)?.count>=8)fail(429,'登录尝试过多，请15分钟后重试');
 const u=db.prepare('SELECT * FROM users WHERE name=?').get(name);
 const actual=scryptSync(password,u?.salt??'invalid-user-salt',64);
 if(!u||u.disabled||!timingSafeEqual(actual,Buffer.from(u.password,'hex'))){const old=failures.get(name);failures.set(name,{count:(old?.count??0)+1,until:old?.until??now+900000});fail(401,'账号或密码错误');}
 failures.delete(name);return {token:issue(u.id,now),user:{id:u.id,name:u.name,role:u.role}};
}
async function loginSso(accessToken,tenantId=platformTenant){
 const tenant=String(tenantId??'');const username=await platformUser(accessToken,tenant);const now=Date.now();
 let u=db.prepare('SELECT * FROM users WHERE name=?').get(username);
 if(!u){const salt=randomBytes(16).toString('hex'),id=randomUUID();db.prepare('INSERT INTO users VALUES(?,?,?,?,?,0)').run(id,username,salt,scryptSync(randomBytes(32).toString('hex'),salt,64).toString('hex'),'member');u=db.prepare('SELECT * FROM users WHERE id=?').get(id);}
 if(u.disabled)fail(401,'账号已停用');
 return {token:issue(u.id,now,{access:accessToken,tenant}),user:{id:u.id,name:u.name,role:u.role}};
}
async function loginSsoCode(code,redirectUri,tenantId=platformTenant,state){
 if(!oauthClientId||!oauthClientSecret)fail(503,'协同 OAuth client 尚未配置');
 if(typeof code!=='string'||!code||typeof redirectUri!=='string'||!redirectUri||typeof state!=='string'||!state.trim()||state.length>256)fail(400,'授权码参数无效');
 const body=new URLSearchParams({grant_type:'authorization_code',code,redirect_uri:redirectUri,client_id:oauthClientId,client_secret:oauthClientSecret,state});
 let response;try{response=await fetch(platformAuthBase+oauthTokenPath,{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded','tenant-id':String(tenantId??platformTenant)},body,signal:AbortSignal.timeout(15000),redirect:'error'});}catch{fail(502,'无法连接协同认证服务');}
 let data;try{data=await response.json();}catch{fail(502,'协同认证响应无效');}
 const accessToken=data?.data?.access_token??data?.data?.accessToken??data?.access_token;
 const refreshToken=data?.data?.refresh_token??data?.data?.refreshToken??data?.refresh_token??'';
 const expiresIn=data?.data?.expires_in??data?.expires_in;
 const expiresTime=data?.data?.expiresTime??data?.data?.expires_time??data?.expiresTime??data?.expires_time??(typeof expiresIn==='number'?Date.now()+expiresIn*1000:0);
 if(response.status===401||data?.code===401)fail(401,'协同登录已失效');
 if(!response.ok||(data?.code!==undefined&&data.code!==0)||typeof accessToken!=='string'||!accessToken)fail(502,data?.msg||'协同授权码兑换失败');
 const session=await loginSso(accessToken,tenantId);
 const platform={accessToken,refreshToken,expiresTime};
 stashPendingClaim(state,platform);
 return {...session,platform};
}
async function recheck(row,force){
 if(!row.platform_access)return;
 const now=Date.now();if(!force&&now-(row.platform_checked??0)<=300000)return;
 try{await platformUser(row.platform_access,row.platform_tenant??platformTenant);}catch(e){if(e.status===401){db.prepare('DELETE FROM sessions WHERE token=?').run(row.token);fail(401,'协同登录已失效');}throw e;}
 db.prepare('UPDATE sessions SET platform_checked=? WHERE token=?').run(now,row.token);
}
function authenticate(token,options={}){const row=db.prepare('SELECT s.token,s.platform_access,s.platform_tenant,s.platform_checked,u.id,u.name,u.role FROM sessions s JOIN users u ON u.id=s.user WHERE s.token=? AND s.expires>? AND u.disabled=0').get(hash(token??''),Date.now());if(!row)fail(401,'请重新登录团队服务');const user={id:row.id,name:row.name,role:row.role};if(!row.platform_access)return user;return recheck(row,options.force).then(()=>user);}
 function list(kind,query=''){return db.prepare('SELECT i.id,i.owner,i.kind,i.head AS version,v.name,v.description,v.created,v.category_path FROM items i JOIN versions v ON v.item=i.id AND v.version=i.head WHERE i.kind=? AND (instr(lower(v.name),lower(?))>0 OR instr(lower(v.description),lower(?))>0) ORDER BY v.created DESC LIMIT 500').all(kind,query,query).map(({category_path,...row})=>({...row,categoryPath:JSON.parse(category_path)}));}
 function read(id,version){const row=db.prepare('SELECT i.id,i.owner,i.kind,v.version,v.name,v.description,v.created,v.payload,v.category_path FROM items i JOIN versions v ON v.item=i.id WHERE i.id=? AND v.version=?').get(id,version);if(!row)fail(404,'找不到发布版本');const {category_path,...value}=row;return {...value,payload:JSON.parse(value.payload),categoryPath:JSON.parse(category_path)};}
function publish(user,body,validate,token){
 const gate=token?authenticate(token,{force:true}):undefined;if(gate&&typeof gate.then==='function')return gate.then(()=>publish(user,body,validate));
  if(!['admin','member'].includes(user.role))fail(403,'只读成员不能发布');
  const {kind,name,description='',payload,key,itemId,expectedVersion=0}=body;
  if(!['asset','scene'].includes(kind)||typeof name!=='string'||!name.trim()||name.length>80||typeof description!=='string'||description.length>2000||typeof key!=='string'||!/^[a-zA-Z0-9-]{16,80}$/.test(key)||!Number.isSafeInteger(expectedVersion)||expectedVersion<0)fail(400,'发布信息无效');
  const categoryPath=publishCategoryPath(kind,payload,body.categoryPath);
  validate(kind,payload);
  const digest=hash(JSON.stringify(body));
  return transaction(()=>{
   const old=db.prepare('SELECT * FROM requests WHERE user=? AND key=?').get(user.id,key);if(old){if(old.digest!==digest)fail(409,'重试标识已用于其他内容');return JSON.parse(old.result);}
   const item=itemId?db.prepare('SELECT * FROM items WHERE id=?').get(itemId):null;
   if(itemId&&!item)fail(404,'原件不存在');
   if(item&&item.owner!==user.id&&user.role!=='admin')fail(403,'只有发布者或管理员可以更新原件');
   if(item&&(item.kind!==kind||item.head!==expectedVersion)||!item&&expectedVersion!==0)fail(409,'原件已有新版本，请刷新后重试');
   const id=item?.id??randomUUID(),version=(item?.head??0)+1;
   if(!item)db.prepare('INSERT INTO items VALUES(?,?,?,?)').run(id,user.id,kind,version);else db.prepare('UPDATE items SET head=? WHERE id=?').run(version,id);
   db.prepare('INSERT INTO versions(item,version,name,description,created,payload,category_path) VALUES(?,?,?,?,?,?,?)').run(id,version,name.trim(),description,new Date().toISOString(),JSON.stringify(payload),JSON.stringify(categoryPath));
   const result={id,version};db.prepare('INSERT INTO requests VALUES(?,?,?,?)').run(user.id,key,digest,JSON.stringify(result));return result;
  });
}
return {db,provision,login,loginSso,loginSsoCode,claimPending,authenticate,list,read,publish,publicationUploads,dashboards,logout:token=>db.prepare('DELETE FROM sessions WHERE token=?').run(hash(token??'')),disable:name=>transaction(()=>{db.prepare('UPDATE users SET disabled=1 WHERE name=?').run(name);db.prepare('DELETE FROM sessions WHERE user IN (SELECT id FROM users WHERE name=?)').run(name);}),close:()=>db.close()};
}
export function teamMiddleware(team,validate,{origins=[]}={}){
 return async(req,res,next)=>{
  const url=new URL(req.url,'http://localhost');if(!url.pathname.startsWith('/api/team/'))return next();
  const send=(status,data)=>{res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(JSON.stringify(data));};
  const binary=async asset=>{
   try{
    const input=createReadStream(asset.path);
    res.writeHead(200,{'Content-Type':asset.type,'Content-Length':String(asset.bytes),'X-Content-Type-Options':'nosniff','Cache-Control':'no-store','Content-Disposition':`attachment; filename*=UTF-8''${encodeURIComponent(asset.fileName).replace(/[!'()*]/g,char=>`%${char.charCodeAt(0).toString(16)}`)}`});
    await pipeline(input,res);
   }finally{await asset.cleanup?.();}
  };
  try{
   const origin=req.headers.origin;
   if(origin){if(!origins.includes(origin))fail(403,'此客户端来源未获允许');res.setHeader('Access-Control-Allow-Origin',origin);res.setHeader('Vary','Origin');}
   if(req.method==='OPTIONS'){res.setHeader('Access-Control-Allow-Methods','GET,POST,OPTIONS');res.setHeader('Access-Control-Allow-Headers','Content-Type,Authorization');res.writeHead(204).end();return;}
   let body;if(req.method==='POST'){
    if(!req.headers['content-type']?.startsWith('application/json'))fail(415,'需要JSON');
    const bodyLimit=url.pathname.startsWith('/api/team/dashboards/uploads')||url.pathname.startsWith('/api/team/publish-uploads')?2*1024*1024:MAX_HTTP_BODY_BYTES;
    let size=0;const parts=[];for await(const chunk of req.iterator({destroyOnReturn:false})){size+=chunk.length;if(size>bodyLimit){res.setHeader('Connection','close');fail(413,`HTTP 请求体超过 ${bodyLimit/(1024*1024)} MiB 上限`);}parts.push(chunk);}try{body=JSON.parse(Buffer.concat(parts).toString());}catch{fail(400,'JSON无效');}if(!body||typeof body!=='object')fail(400,'请求无效');
   }
   if(req.method==='POST'&&url.pathname==='/api/team/login')return send(200,team.login(body.name,body.password));
   if(req.method==='POST'&&url.pathname==='/api/team/login/sso')return send(200,await team.loginSso(body.accessToken,body.tenantId));
   if(req.method==='POST'&&url.pathname==='/api/team/login/sso/code')return send(200,await team.loginSsoCode(body.code,body.redirectUri,body.tenantId,body.state));
   if(req.method==='POST'&&url.pathname==='/api/team/login/sso/claim')return send(200,team.claimPending(body.state));
   const token=req.headers.authorization?.replace(/^Bearer /,'');const user=await team.authenticate(token);
   if(req.method==='GET'&&url.pathname==='/api/team/me')return send(200,user);
   if(req.method==='POST'&&url.pathname==='/api/team/logout'){team.logout(token);return send(200,{ok:true});}
   if(req.method==='GET'&&url.pathname==='/api/team/items')return send(200,team.list(url.searchParams.get('kind'),url.searchParams.get('q')??''));
   const match=url.pathname.match(/^\/api\/team\/items\/([a-zA-Z0-9-]+)\/(\d+)$/);
   if(req.method==='GET'&&match)return send(200,team.read(match[1],Number(match[2])));
   if(req.method==='POST'&&url.pathname==='/api/team/publish')return send(200,await team.publish(user,body,validate,token));
   if(req.method==='POST'&&url.pathname==='/api/team/publish-uploads/start')return send(200,team.publicationUploads.start(await team.authenticate(token,{force:true}),body));
   const publicationUpload=url.pathname.match(/^\/api\/team\/publish-uploads\/([a-zA-Z0-9-]+)\/(chunk|complete)$/);
   if(req.method==='POST'&&publicationUpload){if(publicationUpload[2]==='chunk')return send(200,team.publicationUploads.chunk(user,publicationUpload[1],body));const publisher=await team.authenticate(token,{force:true});return send(200,await team.publicationUploads.complete(publisher,publicationUpload[1],value=>team.publish(publisher,value,validate,token)));}
   if(req.method==='GET'&&url.pathname==='/api/team/dashboards')return send(200,team.dashboards.list(user,{all:url.searchParams.get('all')==='1'}));
   const dashboardVersion=url.pathname.match(/^\/api\/team\/dashboards\/([a-zA-Z0-9-]+)\/(\d+)$/);
   if(req.method==='GET'&&dashboardVersion)return send(200,team.dashboards.read(user,dashboardVersion[1],Number(dashboardVersion[2])));
   if(req.method==='POST'&&url.pathname==='/api/team/dashboards/uploads')return send(200,team.dashboards.createUpload(user,body));
   const uploadFile=url.pathname.match(/^\/api\/team\/dashboards\/uploads\/([a-zA-Z0-9-]+)\/files$/);
   if(req.method==='POST'&&uploadFile)return send(200,await team.dashboards.registerFile(user,uploadFile[1],body));
   const uploadChunk=url.pathname.match(/^\/api\/team\/dashboards\/uploads\/([a-zA-Z0-9-]+)\/files\/([a-zA-Z0-9-]+)\/chunks$/);
   if(req.method==='POST'&&uploadChunk)return send(200,await team.dashboards.writeChunk(user,uploadChunk[1],uploadChunk[2],body));
   const uploadAction=url.pathname.match(/^\/api\/team\/dashboards\/uploads\/([a-zA-Z0-9-]+)\/(complete|cancel)$/);
   if(req.method==='POST'&&uploadAction)return send(200,uploadAction[2]==='complete'?await team.dashboards.completeUpload(user,uploadAction[1],token):await team.dashboards.cancelUpload(user,uploadAction[1]));
   const dashboardBinary=url.pathname.match(/^\/api\/team\/dashboards\/([a-zA-Z0-9-]+)\/(\d+)\/(files|source)$/);
   if(req.method==='GET'&&dashboardBinary)return await binary(dashboardBinary[3]==='files'?team.dashboards.file(user,dashboardBinary[1],Number(dashboardBinary[2]),url.searchParams.get('path')):await team.dashboards.source(user,dashboardBinary[1],Number(dashboardBinary[2])));
   const dashboardArchive=url.pathname.match(/^\/api\/team\/dashboards\/([a-zA-Z0-9-]+)\/archive$/);
   if(req.method==='POST'&&dashboardArchive)return send(200,await team.dashboards.archive(user,dashboardArchive[1],body.archived,token));
   fail(404,'接口不存在');
  }catch(e){if(!e.status)console.error('team request failed:',e.message);if(res.headersSent||res.destroyed){if(!res.destroyed)res.destroy(e);return;}send(e.status??500,{error:e.status?e.message:'服务存储或校验失败，原件未修改；可重试'});}
 };
}
