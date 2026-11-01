import {BufferGeometry,Float32BufferAttribute,ShapeUtils,Vector2} from 'three';
import {prepareProfileSweep,type ProfileSweepParams} from '../domain/profileSweep';

/** One solid with shared corner positions, hard profile edges and metric UVs. */
export function buildProfileSweep(params:ProfileSweepParams):BufferGeometry{
 const {profile,path,closed,frames,side,lengths}=prepareProfileSweep(params);
 const positions:number[]=[],uvs:number[]=[],indices:number[]=[];
 const point=(ring:number,p:number)=>[path[ring][0]+frames[ring][0]*profile[p][0],profile[p][1],path[ring][1]+frames[ring][1]*profile[p][0]];
 const perimeter=[0];for(let j=0;j<profile.length;j++){const a=profile[j],b=profile[(j+1)%profile.length];perimeter.push(perimeter[j]+Math.hypot(b[0]-a[0],b[1]-a[1]));}
 let length=0;
 for(let i=0;i<lengths.length;i++){
  const next=(i+1)%path.length;
  for(let j=0;j<profile.length;j++){
   const k=(j+1)%profile.length,base=positions.length/3;
   positions.push(...point(i,j),...point(next,j),...point(next,k),...point(i,k));
   uvs.push(length,perimeter[j],length+lengths[i],perimeter[j],length+lengths[i],perimeter[j+1],length,perimeter[j+1]);
   if(side>0)indices.push(base,base+1,base+2,base,base+2,base+3);else indices.push(base,base+2,base+1,base,base+3,base+2);
  }
  length+=lengths[i];
 }
 if(!closed){
  const triangles=ShapeUtils.triangulateShape(profile.map(p=>new Vector2(...p)),[]);
  for(const end of [false,true]){
   const ring=end?path.length-1:0,base=positions.length/3;
   for(let j=0;j<profile.length;j++){positions.push(...point(ring,j));uvs.push(...profile[j]);}
   const reverse=end?side>0:side<0;
   for(const [a,b,c] of triangles)indices.push(base+a,base+(reverse?c:b),base+(reverse?b:c));
  }
 }
 const geometry=new BufferGeometry();geometry.setAttribute('position',new Float32BufferAttribute(positions,3));geometry.setAttribute('uv',new Float32BufferAttribute(uvs,2));geometry.setIndex(indices);geometry.computeVertexNormals();return geometry;
}
