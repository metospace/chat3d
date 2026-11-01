import {Quaternion,Vector3} from 'three';

/** A deliberately authored comparison scene, not a built-in agent recipe or a
 * claim about an external model's output. Both variants share one layout. */
export function buildWarehouseScene(initial, detailed=true){
 const doc=structuredClone(initial);doc.nodes=[];doc.assets=[];doc.projectId=detailed?'asrs-realistic-v1':'asrs-simple-v1';doc.revision=0;
 const extra=[
  {id:'wh_blue',baseColor:'#355C7B',roughness:.48,metalness:0,clearcoat:.14,clearcoatRoughness:.32,surface:{preset:'powder_coat',repeat:[5,5],strength:.06}},
  {id:'wh_orange',baseColor:'#C17B39',roughness:.46,metalness:0,clearcoat:.12,clearcoatRoughness:.35,surface:{preset:'powder_coat',repeat:[5,5],strength:.06}},
  {id:'wh_steel',baseColor:'#A9AFB4',roughness:.35,metalness:1,surface:{preset:'brushed_metal',repeat:[8,8],strength:.1}},
  {id:'wh_dark',baseColor:'#343B41',roughness:.62,metalness:0},
  {id:'wh_wood',baseColor:'#B6A280',roughness:.84,metalness:0,surface:{preset:'wood',repeat:[3,2],strength:.08}},
  {id:'wh_floor',baseColor:'#A4A9AC',roughness:.86,metalness:0,surface:{preset:'concrete',repeat:[24,24],strength:.045}},
  {id:'wh_wall',baseColor:'#E1E3E0',roughness:.9,metalness:0},
  {id:'wh_yellow',baseColor:'#D5AE4A',roughness:.65,metalness:0},
  {id:'wh_lane',baseColor:'#D4D6CE',roughness:.9,metalness:0},
  {id:'wh_zone',baseColor:'#93A6A1',roughness:.91,metalness:0},
  {id:'wh_paper',baseColor:'#D5BE98',roughness:.91,metalness:0},
  {id:'wh_carton2',baseColor:'#B8A07C',roughness:.91,metalness:0},
  {id:'wh_carton3',baseColor:'#C8B593',roughness:.9,metalness:0},
  {id:'wh_tote',baseColor:'#667F89',roughness:.7,metalness:0},
  {id:'wh_strap',baseColor:'#EBE7D9',roughness:.8,metalness:0},
  {id:'wh_ink',baseColor:'#233237',roughness:1,metalness:0},
  {id:'wh_label',baseColor:'#FFFFFF',roughness:1,metalness:0},
  {id:'wh_screen',baseColor:'#17363B',roughness:.3,metalness:0,emissive:'#28575C',emissiveIntensity:.2},
 ];doc.materials=extra;
 let serial=0,group='building',groupName='仓库建筑',role='building';
 const assembly=(id,name,kind)=>{group=id;groupName=name;role=kind;};
 const add=(name,geometry,position,materialId,quaternion=[0,0,0,1],label)=>{
  const node={id:`wh-${serial++}`,parentId:null,kind:'primitive',name,assemblyId:group,assemblyName:groupName,sceneRole:role,geometry,materialId,visible:true,transform:{position,rotationQuaternion:quaternion,scale:[1,1,1]}};
  if(label)node.label=label;doc.nodes.push(node);return node;
 };
 const box=(name,size,p,mat='wh_steel',bevel=0)=>add(name,{type:'box',params:{width:size[0],height:size[1],depth:size[2],bevelRadius:bevel}},p,mat);
 const rotation=(axis,angle)=>new Quaternion().setFromAxisAngle(new Vector3(...axis),angle).toArray();
 const cylinder=(name,r,h,p,mat='wh_steel',axis)=>add(name,{type:'cylinder',params:{radiusTop:r,radiusBottom:r,height:h,radialSegments:48}},p,mat,axis?rotation(axis,Math.PI/2):undefined);
 const bar=(name,a,b,width,mat='wh_steel',depth=width)=>{
  const start=new Vector3(...a),end=new Vector3(...b),direction=end.clone().sub(start);
  return add(name,{type:'box',params:{width,height:direction.length(),depth,bevelRadius:0}},start.add(end).multiplyScalar(.5).toArray(),mat,new Quaternion().setFromUnitVectors(new Vector3(0,1,0),direction.normalize()).toArray());
 };
 const label=(text,size,p,ink='wh_label')=>add(text,{type:'plane',params:{width:size[0],depth:size[1],widthSegments:1,depthSegments:1}},p,ink,undefined,text);
 const floorY=-.01;
 box('混凝土地坪',[20,.18,28],[0,-.1,3],'wh_floor');
 box('后侧矮墙',[20,1.1,.16],[0,.55,-10.7],'wh_wall');
 for(const x of [-9.3,9.3])for(const z of [-9.5,-1.5,6.5,15.5]){
  if(detailed){box('建筑柱腹板',[.025,12.2,.30],[x,6.1,z]);for(const dx of [-.14,.14])box('建筑柱翼缘',[.025,12.2,.32],[x+dx,6.1,z]);}
  else box('建筑柱',[.3,12.2,.32],[x,6.1,z]);
 }
 for(const z of [-9.5,6.5]){
  bar('屋架上弦',[-9.3,12.15,z],[9.3,12.15,z],.12);
  if(detailed){bar('屋架下弦',[-9.3,11.6,z],[9.3,11.6,z],.09);for(let i=0;i<10;i++)bar('屋架斜腹杆',[-9.3+i*1.86,11.6,z],[-9.3+(i+.5)*1.86,12.15,z],.035);}
 }
 assembly('markings','通道与收发货分区','floor');
 for(const x of [-7.4,7.4])for(const edge of [-.75,.75])box('人行通道边线',[.045,.006,25],[x+edge,.002,2],'wh_yellow');
 for(const [x,mat] of [[-5.7,'wh_zone'],[5.7,'wh_lane']])box('暂存区地面',[3.8,.006,3.5],[x,.002,13.55],mat);
 for(const x of [-5.7,5.7])for(const dx of [-1.95,1.95])box('暂存区边界',[.05,.008,3.7],[x+dx,.007,13.55],'wh_yellow');
 for(const x of [-2.875,2.875])for(let i=0;i<7;i++)box('前端斑马线',[.20,.006,1.0],[x-.84+i*.28,.005,11.75],'wh_lane');
 const rowXs=[-5,-.75,.75,5],bayCount=6,tierCount=6,bayStep=2.5,startZ=-7.5;
 let stored=0;const palletGroups=[];
 function pallet(x,y,z,key,load=true){
  if(detailed){
   for(const zz of [-.40,0,.40])box('托盘底板',[1.2,.025,.13],[x,y+.0125,z+zz],'wh_wood');
   for(const xx of [-.48,0,.48])for(const zz of [-.40,0,.40])box('托盘支墩',[.14,.09,.14],[x+xx,y+.070,z+zz],'wh_wood');
   for(let i=0;i<7;i++)box('托盘面板',[1.2,.027,.10],[x,y+.1285,z-.45+i*.15],'wh_wood');
  }else box('托盘',[1.2,.142,1.02],[x,y+.071,z],'wh_wood');
  if(!load)return;
  const kind=key%3;
  if(!detailed){box('托盘货物',[1.10,1.12,.94],[x,y+.142+.56,z],kind===1?'wh_tote':'wh_paper');return;}
  if(kind===1){
   for(let level=0;level<3;level++){
    const bottom=y+.142+level*.365;
    box('周转箱箱体',[1.10,.32,.94],[x,bottom+.16,z],'wh_tote');
    box('周转箱箱盖',[1.12,.04,.96],[x,bottom+.34,z],'wh_tote');
    for(const xx of [-.52,.52])box('周转箱加强筋',[.025,.30,.08],[x+xx,bottom+.16,z],'wh_tote');
   }
  }else{
   for(let level=0;level<2;level++)for(const xx of [-.28,.28])for(const zz of [-.24,.24]){
    const yy=y+.142+level*.56+.275;
    box('纸箱',[.54,.55,.46],[x+xx,yy,z+zz],kind===2?'wh_carton2':'wh_paper');
    if(level===1)box('封箱胶带',[.055,.003,.46],[x+xx,yy+.276,z+zz],'wh_strap');
   }
  }
  if(z>5&&x>0&&key%4===0){box('标签底纸',[.24,.14,.002],[x,y+.80,z+.478],'wh_strap');label(`P${String(key).padStart(3,'0')}`,[.22,.12],[x,y+.80,z+.480],'wh_ink');}
 }
 for(let row=0;row<4;row++){
  const x=rowXs[row];assembly(`rack-${row}`,`R${row+1} 六层高位货架`,'storage');
  for(let portal=0;portal<=bayCount;portal++){
   const z=startZ+portal*bayStep;
   for(const dx of [-.61,.61]){
    const position=[x+dx,5.15,z];
    if(detailed)add('冷弯槽形立柱',{type:'profile',params:{points:[[-.05,-.04],[.05,-.04],[.05,-.037],[-.047,-.037],[-.047,.037],[.05,.037],[.05,.04],[-.05,.04]],depth:10.3}},position,'wh_blue',rotation([1,0,0],Math.PI/2));
    else box('货架立柱',[.10,10.3,.08],position,'wh_blue');
    box('立柱底板',[.22,.018,.20],[x+dx,.009,z],'wh_steel');
    if(detailed&&portal===bayCount)for(const bx of [-.07,.07])for(const bz of [-.065,.065])cylinder('地脚螺栓',.009,.025,[x+dx+bx,.029,z+bz]);
   }
   if(detailed)for(let level=0;level<5;level++){
    const y=.22+level*2.0;
    bar('横向斜撑',[x-.61,y,z],[x+.61,y+2,z],.022,'wh_steel',.012);
    bar('横向反斜撑',[x+.61,y,z],[x-.61,y+2,z],.022,'wh_steel',.012);
   }
  }
  for(let bay=0;bay<bayCount;bay++)for(let tier=0;tier<tierCount;tier++){
   const z=startZ+(bay+.5)*bayStep,y=.48+tier*1.6;
   for(const dx of [-.57,.57])box('承重横梁',[.10,.12,2.46],[x+dx,y,z],'wh_orange');
   if(detailed)for(const zz of [-.84,0,.84])box('托盘支撑梁',[1.10,.055,.045],[x,y+.045,z+zz]);
   for(let slot=0;slot<2;slot++){
    const key=((row*6+bay)*6+tier)*2+slot;
    if((row*31+bay*13+tier*7+slot*5)%10>=6)continue;
    const pz=z+(slot===0?-.59:.59);stored++;
    palletGroups.push({id:`stored-${key}`,name:`R${row+1} B${bay+1} L${tier+1} 托盘${slot+1}`,x,y:y+.061,z:pz,key});
   }
  }
  box('端部防撞护板',[1.45,.26,.08],[x,.14,7.66],'wh_yellow');
  box('排号底牌',[.50,.30,.025],[x,10.15,7.56],'wh_dark');label(`R0${row+1}`,[.44,.25],[x,10.15,7.577]);
 }
 for(const p of palletGroups){assembly(p.id,p.name,'storage');pallet(p.x,p.y,p.z,p.key);}
 const craneFocus=[];
 for(const [i,x] of [-2.875,2.875].entries()){
  const z=i===0?1.2:-2.7;assembly(`crane-${i}`,`SC0${i+1} 巷道堆垛机`,'equipment');
  box('底部运行轨道',[.09,.08,16.1],[x,.04,0],'wh_steel');box('顶部导向轨道',[.08,.10,16.1],[x,10.60,0],'wh_steel');
  for(const supportZ of [-7.5,0,7.5]){
   for(const supportX of [x-1.515,x+1.515])box('导轨桥架支座',[.12,.30,.12],[supportX,10.45,supportZ],'wh_steel');
   bar('顶部导轨横向桥架',[x-1.515,10.60,supportZ],[x+1.515,10.60,supportZ],.10,'wh_steel');
  }
  box('堆垛机顶部导向座',[.32,.18,.40],[x,10.47,z-.90],'wh_orange');
  box('行走底盘',[1.30,.28,2.1],[x,.27,z],'wh_orange',detailed?.004:0);
  box('堆垛机立柱',[.32,10.10,.34],[x,5.40,z-.90],'wh_orange');
  if(detailed){
   for(const dx of [-.16,.16])box('提升导轨',[.035,9.9,.045],[x+dx,5.35,z-.70],'wh_steel');
   for(const zz of [-.78,.78]){cylinder('行走轮',.16,.09,[x,.18,z+zz],'wh_dark',[0,0,1]);box('轮组保护罩',[.50,.30,.30],[x,.28,z+zz],'wh_orange');}
   box('提升驱动电机',[.40,.42,.45],[x-.33,.63,z-.70],'wh_dark');
   add('电缆连续走线',{type:'sweepTube',params:{points:[[x+.75,.55,z-.8],[x+.75,3.5,z-.8],[x+.75,4.3,z-.5],[x+.75,4.15,z-.3]],radius:.026,segments:24,radialSegments:8}},[0,0,0],'wh_dark');
   for(let n=0;n<16;n++)box('检修梯踏步',[.40,.025,.04],[x,.8+n*.5,z-1.13],'wh_steel');
  }
  box('载货台',[1.35,.16,1.25],[x,4.13,z],'wh_orange');
  for(const dz of [-.34,.34])box('伸缩货叉',[1.10,.07,.10],[x+.08,4.25,z+dz],'wh_steel');
  pallet(x,4.29,z,300+i);
  box('电控柜',[.40,1.05,.30],[x+.34,.91,z+.84],'wh_wall',detailed?.003:0);
  box('控制屏幕',[.22,.20,.015],[x+.34,1.17,z+1.0],'wh_screen');
  if(detailed){cylinder('急停底座',.04,.018,[x+.34,.88,z+1.01],'wh_yellow',[1,0,0]);label(`SC0${i+1}`,[.30,.12],[x+.34,.64,z+1.007],'wh_ink');}
  craneFocus.push(`crane-${i}`);
 }
 function conveyor(id,name,alongX,cx,cz,length){
  assembly(id,name,'conveyor');
  for(const offset of [-.57,.57])box('输送机边梁',alongX?[length,.14,.065]:[.065,.14,length],alongX?[cx,.68,cz+offset]:[cx+offset,.68,cz],'wh_blue');
  const count=Math.floor(length/.24);
  if(detailed)for(let i=0;i<count;i++){
   const v=-length/2+.14+i*.24;
   cylinder('镀锌输送滚筒',.065,1.07,alongX?[cx+v,.76,cz]:[cx,.76,cz+v],'wh_steel',alongX?[1,0,0]:[0,0,1]);
  }else box('输送工作面',alongX?[length,.07,1.07]:[1.07,.07,length],[cx,.76,cz],'wh_steel');
  for(let i=0;i<=Math.floor(length/2);i++)for(const offset of [-.49,.49]){
   const v=-length/2+.25+i*(length-.5)/Math.max(1,Math.floor(length/2));
   box('输送机支脚',[.07,.60,.07],alongX?[cx+v,.30,cz+offset]:[cx+offset,.30,cz+v],'wh_dark');
  }
  if(detailed){box('输送驱动单元',[.32,.25,.22],[cx,.58,cz+.70],'wh_dark');box('光电检测器',[.06,.10,.06],[cx,.91,cz+.60],'wh_screen');}
 }
 conveyor('conveyor-main','收发货横向滚筒线',true,0,10.45,12.5);
 for(const [i,x] of [-2.875,2.875].entries())conveyor(`conveyor-${i}`,`巷道 ${i+1} 出入库接驳线`,false,x,8.65,2.35);
 for(const [i,x] of [-4.7,4.7].entries()){assembly(`on-conveyor-${i}`,'输送中的托盘货物','storage');pallet(x,.826,10.45,310+i);}
 for(const [i,x] of [-5.7,5.7].entries())for(let n=0;n<3;n++){assembly(`stage-${i}-${n}`,i===0?'收货待入库托盘':'待发运托盘','storage');pallet(x+(n-1)*1.23,.01,13.55,320+i*3+n);}
 assembly('agv','前端搬运 AGV','transport');
 box('AGV 底盘',[1.05,.30,1.55],[2.5,.22,14.0],'wh_wall',detailed?.018:0);box('AGV 承载平台',[.95,.09,1.38],[2.5,.415,14],'wh_blue');
 if(detailed){for(const x of [2.00,3.00])for(const z of [13.52,14.48])cylinder('AGV 行走轮',.14,.065,[x,.16,z],'wh_dark',[0,0,1]);cylinder('激光扫描器',.075,.08,[2.5,.47,14.60],'wh_screen');box('AGV 防撞边',[1.10,.08,.08],[2.5,.16,14.80],'wh_dark');}
 assembly('safety','巷道隔离与防撞设施','safety');
 for(const x of [-6.25,6.25]){
  bar('防护上横杆',[x,.95,7.8],[x,.95,10.8],.045,'wh_yellow');bar('防护下横杆',[x,.35,7.8],[x,.35,10.8],.035,'wh_yellow');
  for(const z of [7.8,9.3,10.8])box('防护立柱',[.075,1.05,.075],[x,.525,z],'wh_yellow');
  if(detailed)for(let i=0;i<19;i++)box('护栏竖向构件',[.025,.60,.025],[x,.65,7.85+i*.16],'wh_steel');
 }
 if(!detailed)doc.materials=classicWarehouseMaterials(doc.materials);
 const positions=288;
 return {doc,stats:{rackRows:4,baysPerRow:6,tiers:6,positions,storedPallets:stored,extraPallets:10,cranes:2,nodes:doc.nodes.length,assemblies:new Set(doc.nodes.map(n=>n.assemblyId)).size},focus:{cranes:craneFocus,frontRacks:['rack-3','rack-2'],pallet:palletGroups.filter(p=>p.x>0&&p.z>5&&p.y<2).map(p=>p.id)}};
}

export function classicWarehouseMaterials(materials){
 return materials.map(m=>{
  const result={...m};for(const key of ['surface','maps','clearcoat','clearcoatRoughness','transmission','thickness','ior'])delete result[key];
  if(['wh_blue','wh_orange'].includes(m.id))Object.assign(result,{roughness:.4,metalness:.25});
  if(m.id==='wh_steel')Object.assign(result,{baseColor:'#8298A5',roughness:.25,metalness:.75});
  return result;
 });
}
