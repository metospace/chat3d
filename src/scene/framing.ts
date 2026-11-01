// Fit all eight bounds corners in the current perspective, not an oversized sphere.
export function fitDistance(size:[number,number,number],theta:number,phi:number,verticalFov:number,aspect:number):number{
 const tanY=Math.tan(verticalFov/2)*.86,tanX=tanY*Math.max(.1,aspect);
 const right=[Math.cos(theta),0,-Math.sin(theta)],back=[Math.sin(phi)*Math.sin(theta),Math.cos(phi),Math.sin(phi)*Math.cos(theta)],up=[-Math.cos(phi)*Math.sin(theta),Math.sin(phi),-Math.cos(phi)*Math.cos(theta)];
 let distance=.001;
 for(const x of [-size[0]/2,size[0]/2])for(const y of [-size[1]/2,size[1]/2])for(const z of [-size[2]/2,size[2]/2]){const dot=(a:number[])=>a[0]*x+a[1]*y+a[2]*z;distance=Math.max(distance,Math.abs(dot(right))/tanX+dot(back),Math.abs(dot(up))/tanY+dot(back));}
 return distance;
}
