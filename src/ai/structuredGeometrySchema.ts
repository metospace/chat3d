import type {Geometry} from '../domain/types';
import {Type, type TSchema} from '@earendil-works/pi-ai';
const number=()=>Type.Number(),positive=()=>Type.Number({exclusiveMinimum:0});
const vec3=()=>Type.Tuple([number(),number(),number()]);
const point=()=>Type.Tuple([number(),number()]);
const segments=(min:number,max:number)=>Type.Integer({minimum:min,maximum:max});
const optionalSegments=()=>Type.Optional(segments(1,256));
const shape=(type:string,params:Record<string,TSchema>)=>Type.Object({type:Type.Literal(type),params:Type.Object(params,type==='sweepTube'||type==='profileSweep'?{additionalProperties:false}:{})});
// Discoverable parameter contract; relational geometry checks remain in validateGeometry.
export const structuredGeometrySchema=Type.Unsafe<Geometry>(Type.Union([
 shape('profileSweep',{profile:Type.Array(point(),{minItems:3,maxItems:64}),path:Type.Array(point(),{minItems:2,maxItems:64}),closed:Type.Optional(Type.Boolean())}),
 shape('box',{width:positive(),height:positive(),depth:positive(),bevelRadius:Type.Optional(Type.Number({minimum:0}))}),
 shape('sphere',{radius:positive(),widthSegments:optionalSegments(),heightSegments:optionalSegments()}),
 shape('cylinder',{radiusTop:Type.Number({minimum:0}),radiusBottom:Type.Number({minimum:0}),height:positive(),radialSegments:optionalSegments()}),
 shape('cone',{radius:positive(),height:positive(),radialSegments:optionalSegments()}),
 shape('plane',{width:positive(),depth:positive(),widthSegments:optionalSegments(),depthSegments:Type.Optional(segments(1,1024))}),
 shape('roundedPlate',{width:positive(),height:positive(),depth:positive(),cornerRadius:positive(),holeRadius:Type.Optional(Type.Number({minimum:0}))}),
 shape('capsule',{radius:positive(),length:positive()}),
 shape('frame',{width:positive(),height:positive(),depth:positive(),thickness:positive()}),
 shape('tube',{outerRadius:positive(),innerRadius:positive(),height:positive()}),
 shape('trapezoid',{widthTop:positive(),widthBottom:positive(),height:positive(),depth:positive()}),
 shape('profile',{points:Type.Array(point(),{minItems:3,maxItems:64}),depth:positive(),holes:Type.Optional(Type.Array(Type.Array(point()))),cornerRadius:Type.Optional(Type.Number({minimum:0})),edgeRadius:Type.Optional(Type.Number({minimum:0}))}),
 shape('lathe',{points:Type.Array(point(),{minItems:2,maxItems:32}),segments:segments(8,64),smooth:Type.Optional(Type.Boolean()),wallThickness:Type.Optional(positive()),capStart:Type.Optional(Type.Boolean()),capEnd:Type.Optional(Type.Boolean())}),
 shape('loft',{rings:Type.Array(Type.Object({center:vec3(),radiusX:positive(),radiusZ:positive()}),{minItems:2,maxItems:32}),segments:segments(8,64)}),
 shape('sweepTube',{points:Type.Array(vec3(),{minItems:2,maxItems:32}),radius:Type.Number({exclusiveMinimum:0,maximum:10}),segments:Type.Integer({minimum:8,maximum:128,description:'Use segments, not tubularSegments; e.g. 32.'}),radialSegments:segments(8,32)}),
 shape('mesh',{positions:Type.Array(number()),indices:Type.Array(Type.Integer({minimum:0})),normals:Type.Optional(Type.Array(number())),uvs:Type.Optional(Type.Array(number()))})
]));
