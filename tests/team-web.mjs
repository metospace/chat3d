import 'fake-indexeddb/auto';
import {JSDOM} from 'jsdom';
import assert from 'node:assert/strict';
import {createServer} from 'vite';

const server=await createServer({server:{middlewareMode:true},appType:'custom'});
const {buildTeamCopyExport,teamCopyFilename}=await server.ssrLoadModule('/src/domain/teamCopyExport.ts');
const {createModelAsset,parseModelAsset}=await server.ssrLoadModule('/src/domain/modelAssets.ts');
const {parseProject}=await server.ssrLoadModule('/src/domain/project.ts');

const doc={schemaVersion:1,projectId:'fixture',revision:0,unit:'m',upAxis:'Y',nodes:[{id:'n1',name:'box',kind:'primitive',parentId:null,visible:true,geometry:{type:'box',params:{width:1,height:1,depth:1}},transform:{position:[0,0.5,0],scale:[1,1,1],rotationQuaternion:[0,0,0,1]},materialId:'mat_blue'}],materials:[{id:'mat_blue',name:'蓝',baseColor:'#3366ee',roughness:0.5,metalness:0}],assets:[]};
const assetPayload=createModelAsset(doc,['n1'],{name:'共享托盘',category:'设备',id:'orig',version:3});
const scenePayload={format:'chat3d-project',version:1,scene:{schemaVersion:1,projectId:'scene-orig',revision:2,unit:'m',upAxis:'Y',nodes:[],materials:[],assets:[]}};
const assetItem={id:'team-1',owner:'u',kind:'asset',version:2,name:'共享托盘',description:'',created:'',payload:assetPayload};
const sceneItem={...assetItem,kind:'scene',name:'共享场景',payload:scenePayload};

const assetCopy=parseModelAsset(buildTeamCopyExport(assetItem));
assert.notEqual(assetCopy.id,'orig');
assert.equal(assetCopy.version,1);
assert.match(assetCopy.name,/副本$/);

const sceneCopy=parseProject(buildTeamCopyExport(sceneItem));
assert.notEqual(sceneCopy.projectId,'scene-orig');
assert.equal(sceneCopy.revision,0);

assert.match(teamCopyFilename(assetItem),/scenivo-team-asset/);
assert.match(teamCopyFilename(sceneItem),/\.chat3d\.json$/);
const {buildPlatformAuthorizeUrl,DEFAULT_OAUTH_CLIENT_ID,DEFAULT_SSO_UI_BASE,DEFAULT_TEAM_SERVICE_BASE,SSO_CALLBACK_PATH,configuredTeamServiceBase,platformOAuthRedirectUri,showTeamPasswordLogin}=await server.ssrLoadModule('/src/domain/platformOAuth.ts');
const authUrlRaw=buildPlatformAuthorizeUrl(configuredTeamServiceBase(),'state-test');
assert.ok(authUrlRaw.startsWith(DEFAULT_SSO_UI_BASE+'/#/sso?'),authUrlRaw);
assert.equal(new URL(authUrlRaw).origin,'http://pm.jiezi365.com:48001','account authorization opens the configured domain instead of the legacy IP');
const authHash=authUrlRaw.slice(authUrlRaw.indexOf('#')+1); // /sso?...
const authUrl=new URL(authHash,'http://local.invalid');
assert.equal(authUrl.pathname,'/sso');
assert.equal(authUrl.searchParams.get('client_id'),DEFAULT_OAUTH_CLIENT_ID);
assert.equal(authUrl.searchParams.get('response_type'),'code');
assert.equal(authUrl.searchParams.has('scope'),false);
assert.equal(authUrl.searchParams.get('state'),'state-test');
assert.equal(authUrl.searchParams.get('redirect_uri'),configuredTeamServiceBase()+SSO_CALLBACK_PATH);
assert.equal(showTeamPasswordLogin(),false);
const dom=new JSDOM('<html><body></body></html>',{url:'http://localhost:1420/'});
for(const key of ['window','document','localStorage'])Object.defineProperty(globalThis,key,{value:dom.window[key],configurable:true});
const {defaultTeamServiceBase}=await server.ssrLoadModule('/src/domain/teamLibrary.ts');
for(const path of ['/','/team','/team/','/team/sso/callback']){
 dom.reconfigure({url:'https://workbench.example'+path});
 assert.equal(defaultTeamServiceBase(),'https://workbench.example','all browser entrypoints use same-origin API');
}
dom.reconfigure({url:'http://localhost:1420/team/'});
assert.equal(defaultTeamServiceBase(),'http://localhost:1420');
assert.equal(platformOAuthRedirectUri(defaultTeamServiceBase()),'http://localhost:1420'+SSO_CALLBACK_PATH);
assert.equal(platformOAuthRedirectUri('https://remote-api.example'),'https://remote-api.example'+SSO_CALLBACK_PATH,'remote API must not silently redirect to localhost');
Object.defineProperty(globalThis,'__TAURI_INTERNALS__',{value:{},configurable:true});
for(const url of ['http://localhost:1420/team/','http://tauri.localhost/','https://tauri.localhost/']){
 dom.reconfigure({url});
 assert.equal(defaultTeamServiceBase(),DEFAULT_TEAM_SERVICE_BASE,'Tauri retains desktop portal default');
 assert.equal(platformOAuthRedirectUri(defaultTeamServiceBase()),DEFAULT_TEAM_SERVICE_BASE+SSO_CALLBACK_PATH);
}
Object.defineProperty(globalThis,'__TAURI_INTERNALS__',{value:undefined,configurable:true});
dom.reconfigure({url:'http://localhost:1420/team/'});
const overrideServer=await createServer({server:{middlewareMode:true,hmr:false},appType:'custom',define:{'import.meta.env.VITE_CHAT3D_PLATFORM_LOGIN_URL':JSON.stringify('https://sso.example/authorize?scope=user.read&theme=dark'),'import.meta.env.VITE_CHAT3D_TEAM_DEFAULT_BASE':JSON.stringify(' https://configured-api.example/ '),'import.meta.env.VITE_CHAT3D_PLATFORM_OAUTH_REDIRECT_URI':JSON.stringify('https://registered.example/team/sso/callback')}});
try{
 const {buildPlatformAuthorizeUrl:buildOverride,configuredTeamServiceBase:configuredOverride}=await overrideServer.ssrLoadModule('/src/domain/platformOAuth.ts');
 const {defaultTeamServiceBase:defaultOverride}=await overrideServer.ssrLoadModule('/src/domain/teamLibrary.ts');
 assert.equal(configuredOverride(),'https://configured-api.example');
 assert.equal(defaultOverride(),'https://configured-api.example','explicit API base wins on /team');
 Object.defineProperty(globalThis,'__TAURI_INTERNALS__',{value:{},configurable:true});
 assert.equal(defaultOverride(),'https://configured-api.example','explicit API base wins on desktop');
 const overrideUrl=new URL(buildOverride(configuredOverride(),'override-state'));
 assert.equal(overrideUrl.searchParams.has('scope'),false);
 assert.equal(overrideUrl.searchParams.get('client_id'),DEFAULT_OAUTH_CLIENT_ID);
 assert.equal(overrideUrl.searchParams.get('redirect_uri'),'https://registered.example/team/sso/callback');
 assert.equal(overrideUrl.searchParams.get('response_type'),'code');
 assert.equal(overrideUrl.searchParams.get('state'),'override-state');
 assert.equal(overrideUrl.searchParams.get('theme'),'dark');
}finally{await overrideServer.close();dom.window.close();delete globalThis.__TAURI_INTERNALS__;}
await server.close();
console.log('PASS team web copy export produces desktop-importable snapshots');
console.log('PASS platform authorize URLs preserve OAuth parameters without auto-approval scope');
console.log('PASS root/team browser origins, desktop defaults, remote redirects and explicit API/redirect overrides');

