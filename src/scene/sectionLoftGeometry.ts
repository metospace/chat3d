import {BufferGeometry,Float32BufferAttribute,ShapeUtils,Vector2} from 'three';
import {prepareSectionLoft,type SectionLoftParams} from '../domain/sectionLoft';

/** Shared by viewport and export; cap vertices remain separate from smooth sides. */
export function buildSectionLoft(params:SectionLoftParams):BufferGeometry{
 const {rings,heights}=prepareSectionLoft(params),count=rings[0].length,stride=count+1;
 const positions:number[]=[],uvs:number[]=[],indices:number[]=[];
 const distances=[0];
 for(let j=0;j<count;j++){const a=rings[0][j],b=rings[0][(j+1)%count];distances.push(distances[j]+Math.hypot(b[0]-a[0],b[1]-a[1]));}
 for(let row=0;row<rings.length;row++)for(let j=0;j<=count;j++){
  const p=rings[row][j%count];positions.push(p[0],heights[row],p[1]);uvs.push(distances[j],heights[row]-heights[0]);
 }
 for(let row=0;row<rings.length-1;row++)for(let j=0;j<count;j++){
  const a=row*stride+j,b=a+1,c=a+stride,d=c+1;indices.push(a,c,b,b,c,d);
 }
 for(const row of [0,rings.length-1]){
  const ring=rings[row],offset=positions.length/3;
  const minX=Math.min(...ring.map(p=>p[0])),minZ=Math.min(...ring.map(p=>p[1]));
  for(const p of ring){positions.push(p[0],heights[row],p[1]);uvs.push(p[0]-minX,p[1]-minZ);}
  for(const triangle of ShapeUtils.triangulateShape(ring.map(p=>new Vector2(...p)),[])){
   const [a,b,c]=triangle;
   // Earcut's output orientation is checked explicitly for reliable outward caps.
   const pa=ring[a],pb=ring[b],pc=ring[c],ccw=(pb[0]-pa[0])*(pc[1]-pa[1])-(pb[1]-pa[1])*(pc[0]-pa[0])>0;
   if(ccw===(row===0))indices.push(offset+a,offset+b,offset+c);else indices.push(offset+a,offset+c,offset+b);
  }
 }
 const geometry=new BufferGeometry();
 geometry.setAttribute('position',new Float32BufferAttribute(positions,3));geometry.setAttribute('uv',new Float32BufferAttribute(uvs,2));geometry.setIndex(indices);geometry.computeVertexNormals();
 const normals=geometry.getAttribute('normal');
 for(let row=0;row<rings.length;row++){
  const a=row*stride,b=a+count,x=normals.getX(a)+normals.getX(b),y=normals.getY(a)+normals.getY(b),z=normals.getZ(a)+normals.getZ(b),length=Math.hypot(x,y,z);
  normals.setXYZ(a,x/length,y/length,z/length);normals.setXYZ(b,x/length,y/length,z/length);
 }
 return geometry;
}
