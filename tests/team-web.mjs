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
const {buildPlatformAuthorizeUrl,DEFAULT_OAUTH_CLIENT_ID,DEFAULT_SSO_UI_BASE,SSO_CALLBACK_PATH,configuredTeamServiceBase,showTeamPasswordLogin}=await server.ssrLoadModule('/src/domain/platformOAuth.ts');
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
const overrideServer=await createServer({server:{middlewareMode:true,hmr:false},appType:'custom',define:{'import.meta.env.VITE_CHAT3D_PLATFORM_LOGIN_URL':JSON.stringify('https://sso.example/authorize?scope=user.read&theme=dark')}});
try{
 const {buildPlatformAuthorizeUrl:buildOverride}=await overrideServer.ssrLoadModule('/src/domain/platformOAuth.ts');
 const overrideUrl=new URL(buildOverride(configuredTeamServiceBase(),'override-state'));
 assert.equal(overrideUrl.searchParams.has('scope'),false);
 assert.equal(overrideUrl.searchParams.get('client_id'),DEFAULT_OAUTH_CLIENT_ID);
 assert.equal(overrideUrl.searchParams.get('redirect_uri'),configuredTeamServiceBase()+SSO_CALLBACK_PATH);
 assert.equal(overrideUrl.searchParams.get('response_type'),'code');
 assert.equal(overrideUrl.searchParams.get('state'),'override-state');
 assert.equal(overrideUrl.searchParams.get('theme'),'dark');
}finally{await overrideServer.close();}
await server.close();
console.log('PASS team web copy export produces desktop-importable snapshots');
console.log('PASS platform authorize URLs preserve OAuth parameters without auto-approval scope');

