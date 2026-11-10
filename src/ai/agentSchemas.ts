import {Type} from 'typebox';
import {STRUCTURED_PART_LIMIT,STRUCTURED_BYTES_LIMIT} from '../domain/structureLimits';
import {SCENE_ROLES} from '../domain/types';
import {structuredGeometrySchema} from './structuredGeometrySchema';

export const structuredPartSchema=Type.Object({
 name:Type.String({minLength:1,maxLength:100}),
 geometry:structuredGeometrySchema,
 transform:Type.Object({position:Type.Tuple([Type.Number(),Type.Number(),Type.Number()],{description:'零件局部坐标，米'}),rotationQuaternion:Type.Tuple([Type.Number(),Type.Number(),Type.Number(),Type.Number()],{description:'单位四元数[x,y,z,w]；无旋转必须填[0,0,0,1]'}),scale:Type.Tuple([Type.Number({exclusiveMinimum:0}),Type.Number({exclusiveMinimum:0}),Type.Number({exclusiveMinimum:0})],{description:'各轴缩放；不缩放必须填[1,1,1]'})}),
 materialId:Type.Optional(Type.String()),label:Type.Optional(Type.String()),
 repeat:Type.Optional(Type.Object({count:Type.Integer({minimum:1,maximum:STRUCTURED_PART_LIMIT,description:`展开总数≤1000、估算${STRUCTURED_BYTES_LIMIT/(1024*1024)}MB；保留数量，超预算按真实组件分批。`}),step:Type.Tuple([Type.Number(),Type.Number(),Type.Number()])}))
});
export const roleSchema=Type.Union(SCENE_ROLES.map(r=>Type.Literal(r)));
export const compositionSchema=Type.Object({zones:Type.Array(Type.Object({name:Type.String({minLength:1,maxLength:80}),purpose:Type.String({minLength:1,maxLength:180})}),{minItems:1,maxItems:12}),connections:Type.Array(Type.Object({from:Type.String({minLength:1,maxLength:80}),to:Type.String({minLength:1,maxLength:80}),via:Type.String({minLength:1,maxLength:80})}),{maxItems:24}),support:Type.Array(Type.Object({name:Type.String({minLength:1,maxLength:80}),role:roleSchema,count:Type.Integer({minimum:1,maximum:100}),purpose:Type.String({minLength:1,maxLength:180})}),{maxItems:24}),palette:Type.Array(Type.String({minLength:1,maxLength:80}),{minItems:1,maxItems:8}),presentation:Type.String({minLength:5,maxLength:600})});
