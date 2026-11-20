import assert from 'node:assert/strict';
import {createServer} from 'vite';
const server=await createServer({server:{middlewareMode:true},appType:'custom'});
try {
 const {referenceComparisonContext,parseReferenceComparison}=await server.ssrLoadModule('/src/ai/referenceComparison.ts');
 const {needsReferenceSilhouette}=await server.ssrLoadModule('/src/ai/shapeReviewPolicy.ts');
 const features=[{featureKey:'',name:'overall',reference:'primary volume'},{featureKey:'body',name:'body',reference:'continuous body'}];
 const refs=[{type:'image',data:'reference-one',mimeType:'image/png'},{type:'image',data:'reference-two',mimeType:'image/png'}];
 const frames=[{view:'front',image:{type:'image',data:'front-one',mimeType:'image/png'}},{view:'side',image:{type:'image',data:'side-two',mimeType:'image/png'}}];
 const before=JSON.stringify({features,refs,frames});
 const silhouette=referenceComparisonContext('model the reference object',features,refs,frames,'silhouette');
 const detailed=referenceComparisonContext('model the reference object',features,refs,frames,'detailed');
 assert.equal(silhouette.messages.length,2);
 assert.deepEqual(silhouette.messages[1].content.filter(x=>x.type==='image').map(x=>x.data),['reference-one','reference-two','front-one','side-two']);
 assert.equal(JSON.parse(silhouette.messages[1].content[0].text).phase,'silhouette');
 assert.match(silhouette.messages[0].content,/允许灰模/);
 assert.doesNotMatch(detailed.messages[0].content,/忽略尚未制作/);
 assert.equal(JSON.stringify({features,refs,frames}),before);
 const rows=features.map(x=>({key:x.featureKey,status:'match',reference:1,frame:1,difference:'Primary body proportions agree'}));
 assert.equal(parseReferenceComparison(JSON.stringify(rows),features,2,2).length,2);
 for(const wrong of [rows.slice(0,1),[rows[0],rows[0]],[rows[0],{...rows[1],frame:3}],[rows[0],{...rows[1],reference:0}],[rows[0],{...rows[1],status:'mismatch',repair:''}]]) {
  assert.throws(()=>parseReferenceComparison(JSON.stringify(wrong),features,2,2));
 }
 const plan={detailLevel:'closeup',features:[{role:'form',geometryApproach:'mesh'}, {}, {}, {}]};
 assert.equal(needsReferenceSilhouette(plan,2),true);
 assert.equal(needsReferenceSilhouette(plan,0),false);
 assert.equal(needsReferenceSilhouette({...plan,features:plan.features.slice(0,1)},2),false);
 console.log('PASS independent QA context immutability, image ordering, stage separation, malformed/out-of-range verdicts and simple/no-reference scope');
} finally { await server.close(); }
