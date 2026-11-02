import assert from 'node:assert/strict';import {createServer} from 'vite';
const server=await createServer({server:{middlewareMode:true},appType:'custom'});let passed=0;
try{const {quickEdit}=await server.ssrLoadModule('/src/domain/quickEdit.ts');const {applyBatch}=await server.ssrLoadModule('/src/domain/commands.ts');const {createInitialDoc}=await server.ssrLoadModule('/src/store.ts');
const doc=applyBatch(createInitialDoc(),{operations:[{op:'createPrimitive',name:'台面',geometry:{type:'box',params:{width:1.2,height:.05,depth:.8}},materialId:'mat_gray',parentId:null,transform:{position:[0,.725,0],scale:[1,1,1],rotationQuaternion:[0,0,0,1]}}]}).doc;const id=doc.nodes[0].id;
const test=(name,fn)=>{fn();passed++;console.log('PASS',name)};
test('explicit color edits preserve geometry and use no model',()=>{const r=quickEdit('只把台面改成蓝色',doc,[]);assert.ok(r);assert.deepEqual(r.result.doc.nodes[0].geometry,doc.nodes[0].geometry);assert.equal(r.result.doc.materials.find(m=>m.id===r.result.doc.nodes[0].materialId).baseColor,'#3b82f6')});
test('ambiguity questions negation compound and quoted instructions use model',()=>{for(const t of ['不要把台面改成蓝色','台面改成蓝色吗？','台面改成蓝色然后移动','如果台面改成蓝色','把标牌文字改成蓝色'])assert.equal(quickEdit(t,doc,[]),null);assert.equal(quickEdit('台面改成蓝色',{...doc,nodes:[...doc.nodes,{...doc.nodes[0],id:'other'}]},[]),null)});
test('scope guard and position lock are honored',()=>{assert.equal(quickEdit('台面向左移动2米',doc,[],{lockPlacement:true}),null);assert.equal(quickEdit('台面改成蓝色',doc,[],{nodeIds:['other']}),null);assert.equal(quickEdit('台面向左移动20厘米',doc,[]).result.doc.nodes[0].transform.position[0],-.2)});
test('rename preserves exact text and dimensional unit',()=>{assert.equal(quickEdit('台面改名为“测试台面”',doc,[]).result.doc.nodes[0].name,'测试台面');assert.equal(quickEdit('台面的宽度改为120厘米',doc,[]).result.doc.nodes[0].geometry.params.width,1.2)});
test('empty missing selection and invalid dimension fall back',()=>{for(const t of ['选中对象改成蓝色','台面的宽度改为0米','台面的高度改为1000米'])assert.equal(quickEdit(t,doc,[]),null);assert.ok(quickEdit('选中对象改成蓝色',doc,[id]));});
console.log(passed+' quick edit checks passed');}finally{await server.close()}
