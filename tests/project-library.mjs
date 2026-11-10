import 'fake-indexeddb/auto';
import {IDBDatabase} from 'fake-indexeddb';
import assert from 'node:assert/strict';import React from 'react';import {JSDOM} from 'jsdom';import {createServer} from 'vite';
import {installBrowserGlobals} from './jsdom-env.mjs';
const dom=new JSDOM('<html><body></body></html>',{url:'https://example.test'});installBrowserGlobals(dom);for(const n of ['window','document','HTMLElement','Node','MutationObserver','Event','MouseEvent','localStorage','Element','CustomEvent','HTMLInputElement','NodeFilter','DocumentFragment'])Object.defineProperty(globalThis,n,{value:dom.window[n],configurable:true});Object.defineProperty(globalThis,'navigator',{value:dom.window.navigator,configurable:true});globalThis.IS_REACT_ACT_ENVIRONMENT=true;globalThis.getComputedStyle=dom.window.getComputedStyle;globalThis.requestAnimationFrame=fn=>setTimeout(fn,0);globalThis.cancelAnimationFrame=clearTimeout;window.requestAnimationFrame=globalThis.requestAnimationFrame;window.cancelAnimationFrame=clearTimeout;globalThis.ResizeObserver=class{observe(){}unobserve(){}disconnect(){}};
const {render:renderUI,fireEvent,waitFor,within,cleanup,act}=await import('@testing-library/react');const Theme=React.Fragment;const render=ui=>renderUI(ui,{wrapper:({children})=>React.createElement(Theme,null,children)});const server=await createServer({server:{middlewareMode:true},appType:'custom'});let count=0;const test=async(n,f)=>{await f();count++;console.log('PASS '+n);cleanup();};
try{
 const {ProjectLibrary}=await server.ssrLoadModule('/src/ui/ProjectLibrary.tsx'),w=await server.ssrLoadModule('/src/workspace.ts'),{saveLibraryProject}=await server.ssrLoadModule('/src/domain/workspaceLibrary.ts'),{useEditorStore:s}=await server.ssrLoadModule('/src/store.ts'),storage=await server.ssrLoadModule('/src/domain/modelAssetStorage.ts'),{instantiateAsset}=await server.ssrLoadModule('/src/domain/modelAssets.ts');
 await w.initializeWorkspace();let opened=0,assetSession,asset;
 await test('isolated session rescue is visible and downloads original data without blocking normal workspace',async()=>{
  const {WorkspaceTools}=await server.ssrLoadModule('/src/ui/WorkspaceTools.tsx');const data={id:'rescue-ui',snapshot:{doc:{schemaVersion:99},composerText:'救援文字'}};w.useWorkspaceStore.setState({recoverySessions:[{data,error:'项目格式无效'}]});let blob;const create=URL.createObjectURL,revoke=URL.revokeObjectURL,click=dom.window.HTMLAnchorElement.prototype.click;URL.createObjectURL=value=>{blob=value;return 'blob:rescue';};URL.revokeObjectURL=()=>{};dom.window.HTMLAnchorElement.prototype.click=function(){assert.equal(this.download,'scenivo-rescue-1.json');};
  try{const ui=render(React.createElement(WorkspaceTools,{onClose:()=>{}}));assert.match(ui.getByRole('alert').textContent,/其他项目可正常使用/);fireEvent.click(ui.getByRole('button',{name:'下载隔离会话原始数据 1'}));await waitFor(()=>assert.ok(blob));assert.deepEqual(JSON.parse(await blob.text()).data,data);assert.equal(w.createSession(),true);await w.flushWorkspace();}finally{URL.createObjectURL=create;URL.revokeObjectURL=revoke;dom.window.HTMLAnchorElement.prototype.click=click;w.useWorkspaceStore.setState({recoverySessions:[]});}
 });
 await test('failed library load is not shown as empty and retry recovers',async()=>{const original=IDBDatabase.prototype.transaction;IDBDatabase.prototype.transaction=function(stores,...args){if(stores==='items')throw Error('模拟资产读取失败');return original.call(this,stores,...args);};try{const ui=render(React.createElement(ProjectLibrary,{kind:'asset',onOpen:()=>{},onManage:()=>{}}));await waitFor(()=>assert.ok(ui.getAllByRole('alert').some(element=>element.textContent.includes('资源读取失败'))));assert.equal(ui.queryByRole('heading',{name:'建立你的第一个资产'}),null);IDBDatabase.prototype.transaction=original;fireEvent.click(ui.getByRole('button',{name:'重新加载'}));await waitFor(()=>assert.ok(ui.getByRole('heading',{name:'建立你的第一个资产'})));assert.equal(ui.queryAllByRole('alert').length,0);}finally{IDBDatabase.prototype.transaction=original;}});
 await test('empty asset library leads to import or an independent editor project and rejects empty saves',async()=>{let managed=0;const ui=render(React.createElement(ProjectLibrary,{kind:'asset',onOpen:()=>opened++,onManage:()=>managed++}));await waitFor(()=>assert.ok(ui.getByRole('heading',{name:'建立你的第一个资产'})));assert.ok(ui.getByRole('textbox',{name:'搜索库内容'}));assert.equal(ui.queryByLabelText('分类导航'),null);fireEvent.click(ui.getByRole('button',{name:'导入资产',exact:true}));assert.equal(managed,1);fireEvent.click(ui.getByRole('button',{name:'创建资产',exact:true}));assert.equal(ui.queryByLabelText('新资产名称'),null);w.renameSession(w.useWorkspaceStore.getState().activeId,'独立测试托盘');assert.equal(opened,1);assetSession=w.useWorkspaceStore.getState().activeId;assert.equal(w.useWorkspaceStore.getState().sessions.find(x=>x.id===assetSession).moduleKind,'asset');assert.equal(s.getState().doc.nodes.length,0);await assert.rejects(saveLibraryProject(),/空的/);});
 await test('asset saves without requiring scene selection, retains immutable versions and blocks preview',async()=>{await act(async()=>{s.getState().applyCommandBatch([{op:'createPrimitive',name:'托盘主体',parentId:null,geometry:{type:'box',params:{width:1.2,height:.15,depth:1}},transform:{position:[0,.075,0],scale:[1,1,1],rotationQuaternion:[0,0,0,1]},materialId:'mat_blue'}],'fixture');});assert.equal(s.getState().selection.length,0);await act(async()=>assert.match(await saveLibraryProject(),/v1/));asset=(await storage.listModelAssets())[0];const first=await storage.readModelAsset(asset.id,1);await act(async()=>s.setState({aiStatus:'previewing'}));await assert.rejects(saveLibraryProject(),/应用或放弃/);await act(async()=>s.setState({aiStatus:'idle'}));await act(async()=>s.getState().applyCommandBatch([{op:'rename',targetId:s.getState().doc.nodes[0].id,name:'已修订托盘'}],'rename'));await act(async()=>assert.match(await saveLibraryProject(),/v2/));assert.deepEqual(await storage.readModelAsset(asset.id,1),first);});
 await test('scene module creates a scene, pins asset v2, and edits never mutate the saved asset',async()=>{const ui=render(React.createElement(ProjectLibrary,{kind:'scene',onOpen:()=>opened++,onManage:()=>{}}));fireEvent.click(ui.getByRole('button',{name:'新建场景',exact:true}));assert.equal(ui.queryByLabelText('新场景名称'),null);const v2=await storage.readModelAsset(asset.id,2);await act(async()=>s.getState().applyCommandBatch([instantiateAsset(v2,[2,0,0])],'insert'));assert.equal(s.getState().doc.nodes[0].modelAsset.version,2);await act(async()=>s.getState().applyCommandBatch([{op:'rename',targetId:s.getState().doc.nodes[0].id,name:'场景实例'}],'rename'));await act(async()=>assert.match(await saveLibraryProject(),/场景已保存/));assert.deepEqual(await storage.readModelAsset(asset.id,2),v2);const current=w.useWorkspaceStore.getState();assert.equal(current.sessions.find(x=>x.id===current.activeId).moduleKind,'scene');assert.equal(current.sessions.find(x=>x.id===current.activeId).savedRevision,s.getState().doc.revision);});
 await test('library asset edit reuses its editor without replacing a scene',async()=>{const oldScene=s.getState().doc.projectId;const ui=render(React.createElement(ProjectLibrary,{kind:'asset',onOpen:()=>opened++,onManage:()=>{}}));await waitFor(()=>assert.ok(ui.getByRole('button',{name:'查看资产 独立测试托盘'})));fireEvent.click(ui.getByRole('button',{name:'查看资产 独立测试托盘'}));fireEvent.click(ui.getByRole('button',{name:'编辑资产'}));await waitFor(()=>assert.notEqual(s.getState().doc.projectId,oldScene));assert.equal(w.useWorkspaceStore.getState().sessions.find(x=>x.id===w.useWorkspaceStore.getState().activeId).assetSource.version,2);assert.ok(w.useWorkspaceStore.getState().sessions.some(x=>x.snapshot.doc.projectId===oldScene));});
 await test('workspace backup preserves module type but imports asset projects without write authority to originals',async()=>{await w.flushWorkspace();const backup=w.exportWorkspaceBackup();assert.ok(JSON.parse(backup).sessions.some(x=>x.moduleKind==='asset'));const before=w.useWorkspaceStore.getState().sessions.length;w.importWorkspaceBackup(backup);const added=w.useWorkspaceStore.getState().sessions.slice(0,w.useWorkspaceStore.getState().sessions.length-before);assert.ok(added.some(x=>x.moduleKind==='asset'));assert.ok(added.every(x=>!x.assetSource));await w.flushWorkspace();});
 await test('library supports name sorting, layout switching, explicit detail dismissal and bulk publication entry',async()=>{
  const original=await storage.readModelAsset(asset.id,2);await storage.saveModelAsset({...structuredClone(original),id:'sort-aaa',version:1,name:'AAA 排序资产',createdAt:'2026-01-01T00:00:00.000Z'});await storage.saveModelAsset({...structuredClone(original),id:'sort-zzz',version:1,name:'ZZZ 排序资产',createdAt:'2026-02-01T00:00:00.000Z'});
  const ui=render(React.createElement(ProjectLibrary,{kind:'asset',onOpen:()=>{},onManage:()=>{}}));await waitFor(()=>assert.ok(ui.getByRole('button',{name:'查看资产 AAA 排序资产'})));
  fireEvent.change(ui.getByLabelText('搜索库内容'),{target:{value:'排序资产'}});const resultNames=()=>[...ui.getByRole('region',{name:'资源列表'}).querySelectorAll('.resource-tile')].map(button=>button.getAttribute('aria-label'));
  assert.deepEqual(resultNames(),['查看资产 ZZZ 排序资产','查看资产 AAA 排序资产']);fireEvent.mouseDown(ui.getByLabelText('资源排序'));await waitFor(()=>assert.ok(ui.getByRole('option',{name:'名称',exact:true})));fireEvent.click(ui.getByTitle('名称'));assert.deepEqual(resultNames(),['查看资产 AAA 排序资产','查看资产 ZZZ 排序资产']);
  fireEvent.click(ui.getByRole('button',{name:'列表视图'}));assert.equal(ui.getByRole('button',{name:'列表视图'}).getAttribute('aria-pressed'),'true');assert.ok(ui.container.querySelector('.resource-layout-list'));fireEvent.click(ui.getByRole('button',{name:'查看资产 AAA 排序资产'}));assert.ok(ui.getByRole('complementary',{name:'资产详情'}));fireEvent.click(ui.getByRole('button',{name:'更多操作'}));await waitFor(()=>assert.ok(ui.getByRole('menuitem',{name:'发布至团队',exact:true})));fireEvent.click(ui.getByRole('button',{name:'更多操作'}));fireEvent.click(ui.getByRole('button',{name:'关闭详情'}));assert.equal(ui.queryByRole('complementary',{name:'资产详情'}),null);
  fireEvent.click(ui.getByRole('button',{name:'批量整理'}));fireEvent.click(ui.getByRole('button',{name:'全选结果'}));assert.match(ui.getByLabelText('批量资源操作').textContent,/已选 2 项/);assert.equal(ui.getAllByRole('checkbox').filter(input=>input.checked&&input.getAttribute('aria-label')!=='Select all').length,2);assert.equal(ui.getByRole('button',{name:'发布至团队',exact:true}).disabled,false);fireEvent.click(ui.getByRole('button',{name:'清空选择'}));assert.match(ui.getByLabelText('批量资源操作').textContent,/已选 0 项/);assert.equal(ui.getAllByRole('checkbox').filter(input=>input.checked&&input.getAttribute('aria-label')!=='Select all').length,0);fireEvent.click(ui.getByRole('button',{name:'退出多选'}));assert.equal(ui.queryByRole('checkbox'),null);
 });
 await test('scene library classifies the whole result set and never lists unconfirmed changes as saved',async()=>{
  const categories=await server.ssrLoadModule('/src/domain/libraryCategories.ts'),category=await categories.saveLibraryCategory('UI 场景归档',undefined,{kind:'scene'});
  const saved=w.useWorkspaceStore.getState().sessions.find(item=>(item.moduleKind??'scene')==='scene'&&item.librarySavedAt);assert.ok(saved);const before=structuredClone(saved.snapshot.doc);
  const ui=render(React.createElement(ProjectLibrary,{kind:'scene',onOpen:()=>{},onManage:()=>{}}));await waitFor(()=>assert.ok(ui.getByRole('button',{name:`查看场景 ${saved.title}`})));fireEvent.change(ui.getByLabelText('搜索库内容'),{target:{value:saved.title}});fireEvent.click(ui.getByRole('button',{name:'批量整理'}));fireEvent.click(ui.getByRole('button',{name:'全选结果'}));fireEvent.keyDown(ui.getByRole('button',{name:'移动到分类'}),{key:'ArrowDown'});await waitFor(()=>assert.ok(ui.getByRole('menuitemradio',{name:'UI 场景归档',exact:true})));fireEvent.click(ui.getByRole('menuitemradio',{name:'UI 场景归档',exact:true}));fireEvent.click(ui.getByRole('button',{name:'移动分类',exact:true}));await waitFor(()=>assert.equal(w.useWorkspaceStore.getState().sessions.find(item=>item.id===saved.id).sceneCategory,category.value));assert.deepEqual(w.useWorkspaceStore.getState().sessions.find(item=>item.id===saved.id).snapshot.doc,before);
  await act(async()=>w.useWorkspaceStore.setState(state=>({sessions:state.sessions.map(item=>item.id===saved.id?{...item,snapshot:{...item.snapshot,pendingBatch:{requestId:'ui-unconfirmed'}}}:item)})));assert.equal(ui.queryByRole('button',{name:`查看场景 ${saved.title}`}),null);fireEvent.click(ui.getByRole('button',{name:/^草稿/}));assert.ok(ui.getByRole('button',{name:`查看场景 ${saved.title}`}));assert.equal(ui.queryByRole('button',{name:'发布至团队',exact:true}),null);
  fireEvent.click(ui.getByRole('button',{name:`查看场景 ${saved.title}`}));assert.match(ui.getByRole('complementary',{name:'项目详情'}).textContent,/待确认预览/);await act(async()=>w.useWorkspaceStore.setState(state=>({sessions:state.sessions.map(item=>item.id===saved.id?{...item,snapshot:{...item.snapshot,pendingBatch:null}}:item)})));
 });
 await test('saved resources show linked team versions and retained local changes without synchronizing',async()=>{
  const links=await server.ssrLoadModule('/src/domain/teamResourceLinks.ts'),head=(await storage.listModelAssets()).find(item=>item.id==='sort-aaa'),payload=await storage.readModelAsset(head.id,head.version),baselineFingerprint=await links.teamLocalFingerprint({kind:'asset',payload,name:head.name,category:head.category,description:head.description});
  await links.saveTeamResourceLink({serviceOrigin:'https://team.example.test',kind:'asset',teamItemId:'team-linked-ui',teamVersion:2,teamName:'关联团队资产',localId:head.id,localVersion:head.version,baselineFingerprint,direction:'acquire',active:true,status:'ready',createdAt:new Date().toISOString(),latestVersion:3});
  const changed=await storage.updateModelAssetMetadata(head.id,{name:head.name,category:head.category,description:'本地保留说明'},head),ui=render(React.createElement(ProjectLibrary,{kind:'asset',onOpen:()=>{},onManage:()=>{}}));await waitFor(()=>assert.ok(ui.getByRole('button',{name:`查看资产 ${changed.name}`})));fireEvent.click(ui.getByRole('button',{name:`查看资产 ${changed.name}`}));await waitFor(()=>assert.equal(ui.getByRole('complementary',{name:'资产详情'}).querySelector('h2').textContent,changed.name));
  await waitFor(()=>assert.match(ui.getByRole('complementary',{name:'资产详情'}).textContent,/关联团队资产 · 团队 v2 · 新版 v3 可获取 · 有本地修改/));assert.equal((await storage.listModelAssets()).find(item=>item.id===head.id).version,head.version);assert.deepEqual(await storage.readModelAsset(head.id,head.version),payload);fireEvent.click(ui.getByRole('button',{name:'更多操作'}));await waitFor(()=>assert.ok(ui.getByRole('menuitem',{name:'发布至团队',exact:true})));fireEvent.click(ui.getByRole('button',{name:'更多操作'}));
  fireEvent.click(ui.getByRole('button',{name:'检查团队更新',exact:true}));await waitFor(()=>assert.ok(ui.getByRole('button',{name:'登录授权'})));assert.ok(ui.getAllByRole('dialog').length>=1);assert.equal(ui.queryByLabelText('团队账号'),null);fireEvent.click(ui.getByRole('button',{name:'取消',exact:true}));await waitFor(()=>assert.equal(ui.queryByRole('button',{name:'登录授权'}),null));
  fireEvent.click(ui.getByRole('button',{name:'获取新版 v3 并保留旧副本'}));await waitFor(()=>assert.ok(ui.getByRole('button',{name:'登录授权'})));assert.equal(ui.queryByLabelText('团队账号'),null);assert.ok(ui.getAllByRole('dialog').some(d=>/旧内容、修改和预览全部保留/.test(d.textContent||'')));assert.equal((await storage.listModelAssets()).find(item=>item.id===head.id).description,'本地保留说明');
 });
 await test('long resource names remain accessible and broken thumbnails do not block editing',async()=>{
  const original=await storage.readModelAsset(asset.id,2),name='精密装配工作台 — 带双层物料架与防静电台面的长名称资产';
  await storage.saveModelAsset({...structuredClone(original),id:'long-name-asset',version:1,name,description:'完整的用途说明保留在详情中，列表只展示摘要。',thumbnail:'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6nF8AAAAASUVORK5CYII='});
  const ui=render(React.createElement(ProjectLibrary,{kind:'asset',onOpen:()=>{},onManage:()=>{}}));
  const card=await waitFor(()=>ui.getByRole('button',{name:`查看资产 ${name}`}));
  assert.equal(card.querySelector('strong').getAttribute('title'),name);assert.equal(card.querySelector('.resource-state-badge').textContent,'已入库');
  fireEvent.error(card.querySelector('img'));assert.match(card.textContent,/预览图暂不可用/);
  fireEvent.click(card);assert.equal(ui.getByRole('complementary',{name:'资产详情'}).querySelector('h2').textContent,name);
  assert.ok(ui.getByRole('button',{name:'编辑资产',exact:true}));
  assert.deepEqual((await storage.readModelAsset('long-name-asset',1)).nodes,original.nodes);
 });
 await test('asset detail drawer opens from a card and restores without leaving a stuck inspector',async()=>{
  const ui=render(React.createElement(ProjectLibrary,{kind:'asset',onOpen:()=>{},onManage:()=>{}}));
  const card=await waitFor(()=>ui.getByRole('button',{name:'查看资产 AAA 排序资产'}));
  assert.equal(ui.queryByRole('complementary',{name:'资产详情'}),null);
  fireEvent.click(card);assert.ok(ui.getByRole('complementary',{name:'资产详情'}));
  fireEvent.click(ui.getByRole('button',{name:'关闭详情'}));assert.equal(ui.queryByRole('complementary',{name:'资产详情'}),null);
 });
 await test('asset draft trash is cancellable and recoverable without touching catalog versions',async()=>{
  const catalog=await storage.listModelAssets(),version=await storage.readModelAsset(asset.id,2),title='可恢复资产草稿';
  await act(async()=>{w.createSession(undefined,{moduleKind:'asset',title,assetSource:{id:asset.id,version:2}});s.getState().setComposerText('保留的编辑要求');});
  const id=w.useWorkspaceStore.getState().activeId,ui=render(React.createElement(ProjectLibrary,{kind:'asset',onOpen:()=>assert.fail('must not open'),onManage:()=>{}}));
  await waitFor(()=>assert.ok(ui.getByRole('button',{name:`查看资产 ${catalog.find(row=>row.id===asset.id).name}`})));
  fireEvent.click(ui.getByRole('button',{name:`查看资产 ${catalog.find(row=>row.id===asset.id).name}`}));
  assert.equal(ui.queryByRole('button',{name:/移至回收站/}),null);
  fireEvent.click(ui.getByRole('button',{name:'关闭详情'}));fireEvent.click(ui.getByRole('button',{name:'批量整理'}));
  assert.equal(ui.queryByRole('button',{name:/移至回收站/}),null);
  fireEvent.click(ui.getByRole('button',{name:/^草稿/}));fireEvent.click(ui.getByRole('button',{name:`查看草稿 ${title}`}));
  const trash=()=>fireEvent.click(within(ui.getByRole('complementary',{name:'项目详情'})).getByRole('button',{name:'移至回收站'}));
  const dialog=()=>within(ui.getByRole('alertdialog',{name:'移至回收站？'}));
  trash();assert.ok(dialog().getByText(/聊天、参考图与场景.*可以恢复/));fireEvent.click(dialog().getByRole('button',{name:/取\s*消/}));
  assert.equal(w.useWorkspaceStore.getState().sessions.find(row=>row.id===id).deletedAt,null);
  trash();fireEvent.click(dialog().getByRole('button',{name:'移至回收站'}));
  assert.equal(ui.queryByRole('button',{name:`查看草稿 ${title}`}),null);assert.equal(ui.queryByRole('complementary',{name:'项目详情'}),null);
  assert.match(ui.getByRole('status').textContent,/1 项草稿.*会话回收站恢复/);
  assert.notEqual(w.useWorkspaceStore.getState().activeId,id);
  await act(async()=>w.flushWorkspace());const stored=await (await server.ssrLoadModule('/src/domain/workspaceStorage.ts')).readWorkspace();
  assert.ok(stored.sessions.find(row=>row.id===id).deletedAt);
  await act(async()=>w.restoreSession(id));assert.ok(ui.getByRole('button',{name:`查看草稿 ${title}`}));
  assert.equal(w.useWorkspaceStore.getState().sessions.find(row=>row.id===id).snapshot.composerText,'保留的编辑要求');
  assert.deepEqual(await storage.listModelAssets(),catalog);assert.deepEqual(await storage.readModelAsset(asset.id,2),version);
 });
 await test('bulk draft trash rejects a running target atomically and clears selection on success',async()=>{
  const ids=[];await act(async()=>{for(const title of ['批量回收测试 A','批量回收测试 B']){w.createSession(undefined,{moduleKind:'scene',title});ids.push(w.useWorkspaceStore.getState().activeId);}});
  const ui=render(React.createElement(ProjectLibrary,{kind:'scene',onOpen:()=>assert.fail('must not open'),onManage:()=>{}}));
  fireEvent.click(ui.getByRole('button',{name:/^草稿/}));fireEvent.change(ui.getByRole('textbox',{name:'搜索库内容'}),{target:{value:'批量回收测试'}});fireEvent.click(ui.getByRole('button',{name:'批量整理'}));fireEvent.click(ui.getByRole('button',{name:'全选结果'}));
  const bulk=()=>ui.getByRole('button',{name:'批量移至回收站'});
  const confirm=()=>within(ui.getByRole('alertdialog')).getByRole('button',{name:'移至回收站'});
  fireEvent.click(bulk());const running=w.getSessionEditor(ids[0]);await act(async()=>running.setState({aiStatus:'generating'}));
  assert.equal(confirm().disabled,true);const before=w.useWorkspaceStore.getState();assert.equal(w.trashLibraryDrafts(ids,'scene'),false);assert.equal(w.useWorkspaceStore.getState(),before);
  await act(async()=>running.setState({aiStatus:'idle'}));fireEvent.click(confirm());
  const deleted=w.useWorkspaceStore.getState().sessions.filter(row=>ids.includes(row.id));assert.equal(deleted.length,2);assert.ok(deleted[0].deletedAt);assert.equal(deleted[0].deletedAt,deleted[1].deletedAt);
  assert.ok(ui.getByText('已选 0 项'));assert.equal(bulk().disabled,true);assert.match(ui.getByRole('status').textContent,/2 项草稿/);
 });
 await test('blocked library actions expose recovery guidance and keep detail actions outside the scroll body',async()=>{
  const workspaceStorage=await server.ssrLoadModule('/src/domain/workspaceStorage.ts');
  await act(async()=>w.flushWorkspace());
  const stored=await workspaceStorage.readWorkspace();
  // Simulate another tab committing before this manager writes its local draft.
  await workspaceStorage.writeWorkspace(stored,stored.revision);
  await act(async()=>{
   w.getSessionEditor(w.useWorkspaceStore.getState().activeId).getState().setComposerText('冲突草稿');
   await w.flushWorkspace();
  });
  assert.match(w.useWorkspaceStore.getState().error,/另一个标签页/);
  for(const kind of ['asset','scene']){
   const ui=render(React.createElement(ProjectLibrary,{kind,onOpen:()=>{throw Error('must not open');},onManage:()=>{}}));
   await waitFor(()=>assert.ok(ui.container.querySelector('.resource-tile')));
   fireEvent.click(ui.container.querySelector('.resource-tile'));
   const detail=()=>ui.getByRole('complementary',{name:kind==='asset'?'资产详情':'项目详情'});
   assert.ok(detail().querySelector(':scope > footer .resource-detail-actions'));
   assert.equal(detail().querySelector('.resource-detail-body .resource-detail-actions'),null);
   for(const name of [kind==='asset'?'编辑资产':'打开场景','编辑信息','发布至团队']){
    if(kind==='asset'&&name!=='编辑资产'){fireEvent.click(within(detail()).getByRole('button',{name:'更多操作'}));await waitFor(()=>assert.ok(ui.getByRole('menuitem',{name,exact:true})));fireEvent.click(ui.getByRole('menuitem',{name,exact:true}));}else fireEvent.click(within(detail()).getByRole('button',{name,exact:true}));
    await waitFor(()=>assert.match(within(detail()).queryByRole('alert')?.textContent??'',/关闭其他标签页.*刷新/));
    assert.equal(ui.queryByRole('button',{name:'登录授权'}),null);
   }
   fireEvent.click(ui.getByRole('button',{name:`新建${kind==='asset'?'资产':'场景'}`,exact:true}));
   await waitFor(()=>assert.match(ui.getAllByRole('alert')[0].textContent,/关闭其他标签页.*刷新/));
   cleanup();
  }
 });
 console.log(count+' dedicated library workflow checks passed');
}finally{cleanup();await server.close();dom.window.close();}
