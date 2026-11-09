import {ManualInteraction,groundPointAt,type CompositionInteraction} from './manualInteraction';
import {ContactShading} from './contactShading';
import {AdaptiveRenderQuality,loadRenderQuality,normalizeRenderQuality,RENDER_TIERS,type RenderQuality} from './renderQuality';
import {InstancedRender} from './instancedRender';
import {rectangleObjectIds} from './rectangleSelection';
import {materialReady,disposeMaterialTextures} from './surfaceTextures';
import {createAnimationEvaluator} from '../domain/animation';
import {AnimationClock,type PlaybackState} from './animationPlayback';
// Three.js 视口 — 命令式渲染器（方案第 2、11 节）
// - Scene DSL 文档是唯一可信来源；Three.js 对象是其渲染结果，不作为数据源
// - 按需渲染：相机/选择/几何变化时才刷新
// - 严格资源生命周期：geometry/material/texture 引用计数，dispose 不自动释放共享纹理
// - 渲染质感：PMREM 环境贴图 + ACES 色调映射 + 阴影地面 + 雾 + 渐变背景 + 盒子倒角 + 自动取景
import {fitDistance} from './framing';
import {createSceneMaterial,materialCastsShadow} from './material';
import {loadRenderPreset,RENDER_PRESETS,type RenderPreset} from './renderPreset';
import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { buildPrimitiveGeometry } from './geometry';
import { Geometry, Material, SceneDocument, SceneNode } from '../domain/types';

interface NodeResources {
  mesh: THREE.Mesh;
  geometry: THREE.BufferGeometry;
  geometrySource: Geometry;
  material: THREE.MeshStandardMaterial;
}

export class Viewport {
  private instancedRender:InstancedRender|null=null;
  private composition:ManualInteraction|null=null;
  private assetDropPreview:ManualInteraction|null=null;
  private assetDropNodes:SceneNode[]|null=null;
  assetDropPoint(x:number,y:number,step:number){return groundPointAt(this.renderer.domElement,this.camera,x,y,step);}
  previewAssetDrop(nodes:SceneNode[],x:number,y:number,step:number){
    if(!this.assetDropPreview)this.assetDropPreview=new ManualInteraction(this.renderer.domElement,this.scene,this.camera,()=>this.nodeMap,()=>this.markDirty());
    if(this.assetDropNodes!==nodes){this.assetDropNodes=nodes;this.assetDropPreview.set({mode:'orbit',nodes:[],placement:nodes,snapStep:step,onPlace:()=>{},onTransform:()=>{},onCancel:()=>this.clearAssetDropPreview()});}
    return this.assetDropPreview.previewPlacementAt(x,y);
  }
  clearAssetDropPreview(){this.assetDropPreview?.dispose();this.assetDropPreview=null;this.assetDropNodes=null;this.renderer.domElement.style.cursor=this.composition?.placing||this.boxSelection?'crosshair':'';this.markDirty();}
  setComposition(config:CompositionInteraction|null){if(!this.composition)this.composition=new ManualInteraction(this.renderer.domElement,this.scene,this.camera,()=>this.nodeMap,()=>{this.selectionHelpers.forEach(h=>h.update());this.markDirty();});this.composition.set(config);}
  private renderer: THREE.WebGLRenderer;
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;
  // 相机轨道：围绕目标点的球面坐标（左键拖拽旋转 / 右键平移 / 滚轮缩放）
  private readonly orbitTarget = new THREE.Vector3(0, 0.5, 0);
  private orbitRadius = 6.87;
  private orbitTheta = 0.733; // 方位角
  private orbitPhi = 1.012; // 仰角（自 +Y 起算，限制不穿越极点）
  private readonly defaultMaterial: THREE.MeshStandardMaterial;
  private readonly sharedGeometryCache = new Map<string, THREE.BufferGeometry>();
  private geometryKeys?: WeakMap<Geometry,string>;
  private readonly materialCache = new Map<string, THREE.MeshStandardMaterial>();
  private readonly nodeMap = new Map<string, NodeResources>();
  private selectionHelpers: THREE.BoxHelper[] = [];
  private selectedIds?: Set<string>;
  private rafHandle: number | null = null;
  private loopVersion = 0;
  private active = true;
  private renderWidth = 0;
  private renderHeight = 0;
  private dirty = true;
  private quality:AdaptiveRenderQuality;
  private contactShading:ContactShading|null=null;
  private contactFailed=false;
  private postprocessingError='';
  private previousDraw=false;
  private capturing=false;
  private cpuRenderMs=0;
  private gpu='unknown';
  private sceneScale=1;
  private softwareRenderer=false;
  private animationClock=new AnimationClock();
  private animationEvaluator:ReturnType<typeof createAnimationEvaluator>|null=null;
  private onPlayback:((state:PlaybackState)=>void)|null=null;
  private playbackNotified=0;
  private lastFrame=0;
  private lastSyncedDoc:SceneDocument|null=null;
  private readonly host: HTMLElement;
  private readonly onPick: (nodeId: string | null, additive?:boolean) => void;
  private resizeObserver: ResizeObserver | null = null;
  // 视口固有资源（不随场景文档重建）
  private envTexture: THREE.Texture | null = null;
  private backgroundTexture: THREE.CanvasTexture | null = null;
  private floorGeometry: THREE.PlaneGeometry | null = null;
  private floorMaterial: THREE.MeshStandardMaterial | null = null;
  private keyLight: THREE.DirectionalLight | null = null;
  private hemisphereLight: THREE.HemisphereLight | null = null;
  private rimLight: THREE.DirectionalLight | null = null;
  private renderPreset: RenderPreset = loadRenderPreset();
  private backdrop: 'light'|'slate' = 'slate';

  // 世界单位：米。相机近远裁剪面按工业设备场景尺度设定。
  constructor(host: HTMLElement, onPick: (nodeId: string | null, additive?:boolean) => void) {
    this.host = host;
    this.onPick = onPick;

    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    try{const gl=this.renderer.getContext(),extension=gl.getExtension('WEBGL_debug_renderer_info');if(extension)this.gpu=String(gl.getParameter(extension.UNMASKED_RENDERER_WEBGL));}catch{/* Diagnostics are optional. */}
    this.softwareRenderer=/swiftshader|llvmpipe|software/i.test(this.gpu);
    this.quality=new AdaptiveRenderQuality(loadRenderQuality(),this.softwareRenderer||window.innerWidth<768||(navigator.hardwareConcurrency>0&&navigator.hardwareConcurrency<=4));
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2)); // 方案 11 节：限制高 DPI 像素比
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    // ACES 电影级色调映射：高光不截断、中间调更扎实，告别「塑料玩具」感
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.02;
    host.appendChild(this.renderer.domElement);
    this.renderer.domElement.style.width = '100%';
    this.renderer.domElement.style.height = '100%';
    this.renderer.domElement.style.display = 'block';
    this.renderer.domElement.style.touchAction = 'none';

    this.scene = new THREE.Scene();
    this.backgroundTexture = this.createGradientBackground();
    this.scene.background = new THREE.Color('#e8edef');
    // 线性雾：近处（8m）清晰、远处（60m）融进雾色，大地面不再「平到天边」
    this.scene.fog = null; // Modeling view: do not wash out machines as camera distance grows.

    // 窄视角（45°）：透视畸变更小，更接近观察工业设备的视觉
    this.camera = new THREE.PerspectiveCamera(38, 1, 0.05, 2000);
    this.updateOrbitCamera();

    this.defaultMaterial = new THREE.MeshStandardMaterial({
      color: '#A9AEB6',
      roughness: 0.45,
      metalness: 0,
    });

    this.setupEnvironment();
    this.setupLights();
    this.setupGround();
    this.applyRenderQuality();
    this.setRenderPreset(this.renderPreset);
    this.setBackdrop('slate');
    this.setupPicking();

    this.resizeObserver = new ResizeObserver(() => {if(this.active!==false&&this.hostSizeChanged())this.markDirty();});
    this.resizeObserver.observe(host);
  }

  // 垂直渐变背景：顶部深蓝灰、地平线偏暖，替代原来的纯色黑底
  private createGradientBackground(): THREE.CanvasTexture {
    const canvas = document.createElement('canvas');
    canvas.width = 8;
    canvas.height = 256;
    const ctx = canvas.getContext('2d')!;
    const grad = ctx.createLinearGradient(0, 0, 0, 256);
    grad.addColorStop(0, '#171b21');
    grad.addColorStop(0.55, '#232b34');
    grad.addColorStop(1, '#3a4551');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.minFilter = THREE.LinearFilter;
    tex.magFilter = THREE.LinearFilter;
    tex.needsUpdate = true;
    return tex;
  }

  // 环境光照：RoomEnvironment 经 PMREM 预滤波后作为场景环境贴图
  // - scene.environment 自动给所有 PBR 材质提供柔和补光与真实反射
  // - 金属面不再「死平」，漆面有了漫反射层次
  private setupEnvironment(): void {
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    const envScene = new RoomEnvironment();
    this.envTexture = pmrem.fromScene(envScene, 0.04).texture;
    this.scene.environment = this.envTexture;
    this.scene.environmentIntensity=.55;
    envScene.dispose();
    pmrem.dispose();
  }

  // 半球补光 + 主方向光（带阴影）+ 冷色轮廓光
  private setupLights(): void {
    const hemi = new THREE.HemisphereLight('#f5fcff', '#789095', 1.10);
    this.hemisphereLight=hemi;
    this.scene.add(hemi);

    // 暖白主光：模拟厂房高侧窗，投影方向稳定、边缘柔和
    const dir = new THREE.DirectionalLight('#fff5e4', 2.0);
    this.keyLight = dir;
    dir.position.set(-12, 24, 14);
    dir.castShadow = true;
    dir.shadow.mapSize.width = 2048;
    dir.shadow.mapSize.height = 2048;
    dir.shadow.camera.near = 0.5;
    dir.shadow.camera.far = 60;
    dir.shadow.camera.left = -14;
    dir.shadow.camera.right = 14;
    dir.shadow.camera.top = 14;
    dir.shadow.camera.bottom = -14;
    dir.shadow.bias = -0.0002;
    dir.shadow.normalBias = 0.0015;
    dir.shadow.radius = 3;
    this.scene.add(dir);

    // 冷色逆光：把物体轮廓从暗背景里剌出来
    const rim = new THREE.DirectionalLight('#b7d5ee', 1.0);
    this.rimLight=rim;
    rim.position.set(15, 13, -10);
    this.scene.add(rim);
  }

  // 地面：接收阴影的哑光地面 + 1m 网格（尺度参照）
  private setupGround(): void {
    this.floorGeometry = new THREE.PlaneGeometry(200, 200);
    this.floorMaterial = new THREE.MeshStandardMaterial({
      color: '#e0e7e9',
      roughness: 0.92,
      metalness: 0.0,
      envMapIntensity: 0.4,
    });
    const floor = new THREE.Mesh(this.floorGeometry, this.floorMaterial);
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    floor.name = '__floor';
    this.scene.add(floor);

    const grid = new THREE.GridHelper(60, 60, '#a2b3ba', '#bdc9ce');
    grid.name='__grid';grid.visible=false;
    (grid.material as THREE.Material).transparent = true;
    (grid.material as THREE.Material).opacity = 0.55;
    grid.position.y = 0.002; // 抬高 2mm 避免 Z-fighting
    grid.name = '__grid';
    this.scene.add(grid);
  }

  private boxSelection=false;
  private boxWholeModel=false;
  private boxThrough=false;
  private onBoxError:((message:string)=>void)|null=null;
  private onBoxSelect:((ids:string[],additive:boolean)=>void)|null=null;
  private cancelPointerGesture:()=>void=()=>{};
  private escapeSelection=(e:KeyboardEvent)=>{if(e.key==='Escape')this.cancelPointerGesture?.();};
  setBoxSelection(enabled:boolean,onSelect:((ids:string[],additive:boolean)=>void)|null,wholeModel=false,through=false,onError:((message:string)=>void)|null=null){
    if(this.boxSelection!==enabled||this.boxWholeModel!==wholeModel||this.boxThrough!==through)this.cancelPointerGesture?.();
    this.boxSelection=enabled;this.boxWholeModel=wholeModel;this.boxThrough=through;this.onBoxSelect=onSelect;this.onBoxError=onError;
    this.renderer.domElement.style.cursor=enabled||this.composition?.placing?'crosshair':'';
  }
  private setupPicking(): void {
    // 命令式交互：左键拖拽旋转 / 点击拾取（位移 < 3px 视为点击）/ 右键拖拽平移 / 滚轮缩放
    const canvas = this.renderer.domElement;
    let down:{x:number;y:number;startX:number;startY:number;button:number;pointerId:number;box:boolean;additive:boolean;moved:boolean}|null=null;
    let rectangle:HTMLDivElement|null=null;
    const cancel=()=>{if(down&&canvas.hasPointerCapture?.(down.pointerId))canvas.releasePointerCapture(down.pointerId);down=null;rectangle?.remove();rectangle=null;};
    this.cancelPointerGesture=cancel;
    window.addEventListener('keydown',this.escapeSelection);
    canvas.addEventListener('contextmenu',e=>e.preventDefault());
    canvas.addEventListener('pointerdown',(e:PointerEvent)=>{
      if((e.button!==0&&e.button!==2)||down||e.isPrimary===false)return;
      down={x:e.clientX,y:e.clientY,startX:e.clientX,startY:e.clientY,button:e.button,pointerId:e.pointerId,box:this.boxSelection&&e.button===0,additive:e.shiftKey||e.ctrlKey||e.metaKey,moved:false};
      canvas.setPointerCapture(e.pointerId);
      if(down.box){e.preventDefault();rectangle=document.createElement('div');rectangle.className='viewport-selection-rectangle';rectangle.setAttribute('aria-hidden','true');Object.assign(rectangle.style,{position:'absolute',pointerEvents:'none',border:'1px solid #3b82f6',background:'rgba(59,130,246,.12)',zIndex:'3'});this.host.appendChild(rectangle);}
    });
    canvas.addEventListener('pointermove',(e:PointerEvent)=>{
      if(!down||e.pointerId!==down.pointerId)return;const dx=e.clientX-down.x,dy=e.clientY-down.y;
      if(Math.abs(e.clientX-down.startX)+Math.abs(e.clientY-down.startY)>=3)down.moved=true;
      if(down.box){const r=this.host.getBoundingClientRect();if(rectangle)Object.assign(rectangle.style,{left:Math.max(0,Math.min(down.startX,e.clientX)-r.left)+'px',top:Math.max(0,Math.min(down.startY,e.clientY)-r.top)+'px',width:Math.abs(e.clientX-down.startX)+'px',height:Math.abs(e.clientY-down.startY)+'px'});return;}
      if(Math.abs(dx)+Math.abs(dy)<3)return;
      if(down.button===0){this.orbitTheta-=dx*.005;this.orbitPhi-=dy*.005;this.orbitPhi=Math.min(Math.max(this.orbitPhi,.08),Math.PI-.08);}
      else{const right=new THREE.Vector3(1,0,0).applyQuaternion(this.camera.quaternion),up=new THREE.Vector3(0,1,0).applyQuaternion(this.camera.quaternion),scale=this.orbitRadius*.0015;this.orbitTarget.addScaledVector(right,-dx*scale).addScaledVector(up,dy*scale);}
      down.x=e.clientX;down.y=e.clientY;this.updateOrbitCamera();
    });
    canvas.addEventListener('pointerup',(e:PointerEvent)=>{
      if(!down||e.pointerId!==down.pointerId)return;const gesture=down;
      const moved=gesture.moved||Math.abs(e.clientX-gesture.startX)+Math.abs(e.clientY-gesture.startY)>=3;
      if(gesture.box&&moved){const r=canvas.getBoundingClientRect();if(r.width&&r.height){
        const rect={left:(gesture.startX-r.left)/r.width*2-1,right:(e.clientX-r.left)/r.width*2-1,top:1-(gesture.startY-r.top)/r.height*2,bottom:1-(e.clientY-r.top)/r.height*2};
        const assemblies=new Map(this.lastSyncedDoc?.nodes.map(n=>[n.id,n.assemblyId])??[]);const objects=[...this.nodeMap].map(([id,value])=>({id,object:value.mesh,assemblyId:assemblies.get(id)}));
        try{let ids=rectangleObjectIds(objects,this.camera,rect,false,{through:this.boxThrough,renderer:this.renderer});if(this.boxWholeModel){const groups=new Set(ids.map(id=>assemblies.get(id)).filter(Boolean));ids=[...new Set([...ids,...(this.lastSyncedDoc?.nodes.filter(n=>n.assemblyId&&groups.has(n.assemblyId)).map(n=>n.id)??[])])];}this.onBoxSelect?.(ids,gesture.additive);this.onBoxError?.('');}catch(e){this.onBoxError?.(e instanceof Error?e.message:'框选失败；选区未改变。');}
      }}else if(!moved&&gesture.button===0)this.pickAt(e.clientX,e.clientY,gesture.additive);
      cancel();
    });
    canvas.addEventListener('pointercancel',cancel);canvas.addEventListener('lostpointercapture',()=>{down=null;rectangle?.remove();rectangle=null;});

    canvas.addEventListener(
      'wheel',
      (e: WheelEvent) => {
        e.preventDefault();
        if(down?.box)return;
        this.orbitRadius = Math.min(Math.max(this.orbitRadius * Math.exp(e.deltaY * 0.001), Math.max(this.sceneScale*.001,.0001)), Math.max(this.sceneScale*100,800));
        this.updateOrbitCamera();
      },
      { passive: false },
    );
  }

  // 射线拾取：命中节点反查稳定 ID（不用数组下标或临时数字 ID）
  private pickAt(clientX: number, clientY: number, additive=false): void {
    const canvas = this.renderer.domElement;
    const rect = canvas.getBoundingClientRect();
    const x = ((clientX - rect.left) / rect.width) * 2 - 1;
    const y = -((clientY - rect.top) / rect.height) * 2 + 1;
    const raycaster = new THREE.Raycaster();
    raycaster.setFromCamera(new THREE.Vector2(x, y), this.camera);
    const meshes = Array.from(this.nodeMap.values()).map((r) => r.mesh);
    const hits = raycaster.intersectObjects(meshes, false);
    const hit = hits.find((h) => h.object.userData.nodeId);
    this.onPick(hit ? (hit.object.userData.nodeId as string) : null, additive);
  }

  // 按球面坐标摆放相机：所有相机操作最终统一走这里
  private updateOrbitCamera(): void {
    const sinPhi = Math.sin(this.orbitPhi);
    this.camera.position.set(
      this.orbitTarget.x + this.orbitRadius * sinPhi * Math.sin(this.orbitTheta),
      this.orbitTarget.y + this.orbitRadius * Math.cos(this.orbitPhi),
      this.orbitTarget.z + this.orbitRadius * sinPhi * Math.cos(this.orbitTheta),
    );
    this.camera.near=Math.max(.00001,Math.min(this.orbitRadius*.01,this.sceneScale*.01));
    this.camera.far=Math.max(this.orbitRadius+this.sceneScale*10,100);
    this.camera.updateProjectionMatrix();
    this.camera.lookAt(this.orbitTarget);
    this.markDirty();
  }

  markDirty(): void {
    this.dirty = true;
  }

  // 自动取景：场景变化后计算包围盒，把整个模型框进视野中心
  // - 相机目标点 = 包围盒中心；半径按最长边与视野张角反推
  // - 阴影相机范围随场景缩放，大模型不会丢阴影
  private frameScene(selected?: Set<string>): void {
    if (this.nodeMap.size === 0) {
      // 空场景：相机回到默认观察机位（撤销到空场景时画面与初始空场景一致）
      this.orbitTarget.set(0, 0.5, 0);
      this.orbitRadius = 6.87;
      this.orbitTheta = 0.675;
      this.orbitPhi = 1.2;
      this.updateOrbitCamera();
      return;
    }
    const box = new THREE.Box3();
    for (const [, res] of this.nodeMap) {
      if(selected?.size && !selected.has(res.mesh.userData.nodeId))continue;
      res.mesh.updateWorldMatrix(true, false);
      box.expandByObject(res.mesh);
    }
    if (box.isEmpty()) return;
    if(!selected?.size){const floor=this.scene.getObjectByName('__floor');if(floor)floor.position.y=box.min.y-.001;}
    const center = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());
    const maxDim = Math.max(size.x, size.y, size.z, 0.4);this.sceneScale=Math.max(size.x,size.y,size.z,.001);
    this.orbitTarget.copy(center);

    this.camera.fov=this.viewportFov();
    const fov = (this.camera.fov * Math.PI) / 180;
    // 让最长边约占视野 55%，留出周边呼吸空间
    const aspect=Math.max(this.host.clientWidth,1)/Math.max(this.host.clientHeight,1);
    const radius = fitDistance(size.toArray() as [number,number,number],this.orbitTheta,this.orbitPhi,fov,aspect);
    this.orbitRadius = Math.max(radius, this.sceneScale*.1, .001);

    // 仰角太低（贴地看）时抬到默认观察角
    // Preserve explicit overhead or user-selected angles during fitting.
    this.updateOrbitCamera();

    // 阴影相机随包络缩放
    if (this.keyLight) {
      const s = Math.max(maxDim * 0.9, .5);
      const cam = this.keyLight.shadow.camera;
      cam.left = -s;
      cam.right = s;
      cam.top = s;
      cam.bottom = -s;
      cam.far = Math.max(s * 4 + 20, 60);
      this.keyLight.position.copy(center).add(new THREE.Vector3(-12,24,14).multiplyScalar(Math.max(1,maxDim/12)));
      this.keyLight.target.position.copy(center);this.keyLight.target.updateMatrixWorld();
      cam.updateProjectionMatrix();
    }
  }

  // Incremental reconciliation: preserve unchanged mesh/geometry/material identities.
  sync(doc: SceneDocument): void {
    this.cancelPointerGesture?.();
    if(doc===this.lastSyncedDoc)return;
    this.frameMaterialKeys.clear();
    this.instancedRender?.dispose();
    this.frameMaterialsById = new Map(doc.materials.map(m => [m.id, m]));
    if(!this.animationClock)this.animationClock=new AnimationClock();
    this.animationClock.configure(doc.animation?.duration,doc.animation?.loop);
    this.animationEvaluator=doc.animation?createAnimationEvaluator(doc):null;
    const animatedIds=new Set(doc.animation?.tracks.flatMap(t=>t.targetIds)??[]);
    const firstContent=this.nodeMap.size===0||this.lastSyncedDoc?.projectId!==doc.projectId;this.clearSelectionHelpers();
    const visible=new Set(doc.nodes.filter(n=>(n.visible||animatedIds.has(n.id))&&n.kind==='primitive'&&n.geometry).map(n=>n.id));
    for(const [id,res] of this.nodeMap)if(!visible.has(id)){this.scene.remove(res.mesh);this.nodeMap.delete(id);}
    for(const node of doc.nodes){
      if(!visible.has(node.id))continue;
      const existing=this.nodeMap.get(node.id);
      if(!existing){this.createNodeMesh(node);continue;}
      if(existing.geometrySource!==node.geometry){const geometry=this.buildGeometry(node.geometry!);existing.geometry=geometry;existing.geometrySource=node.geometry!;existing.mesh.geometry=geometry;}
      const material=this.buildMaterial(node.materialId,node.label);
      existing.material=material;existing.mesh.material=material;
      existing.mesh.position.fromArray(node.transform.position);existing.mesh.quaternion.fromArray(node.transform.rotationQuaternion);existing.mesh.scale.fromArray(node.transform.scale);
      existing.mesh.visible=node.visible;existing.mesh.name=node.name;existing.mesh.userData.noAO=!!node.label;existing.mesh.castShadow=materialCastsShadow(material)&&!node.label;
    }
    const geometries=new Set([...this.nodeMap.values()].map(v=>v.geometry)),materials=new Set([...this.nodeMap.values()].map(v=>v.material));
    for(const [key,g] of this.sharedGeometryCache)if(!geometries.has(g)){g.dispose();this.sharedGeometryCache.delete(key);}
    for(const [key,m] of this.materialCache)if(!materials.has(m)){disposeMaterialTextures(m);this.materialCache.delete(key);}
    this.instancedRender??=new InstancedRender(this.scene);
    this.instancedRender.rebuild([...this.nodeMap].filter(([id])=>!animatedIds.has(id)).map(([,res])=>res.mesh));
    this.lastSyncedDoc=doc;
    this.notifyPlayback();
    if(firstContent||!this.nodeMap.size)this.frameScene();
    this.markDirty();
  }

  private createNodeMesh(node: SceneNode): void {
    const geometry = this.buildGeometry(node.geometry!);
    const material = this.buildMaterial(node.materialId, node.label);
    const mesh = new THREE.Mesh(geometry, material);
    mesh.castShadow = materialCastsShadow(material) && !node.label;
    mesh.receiveShadow = true;
    mesh.userData.noAO=!!node.label;
    mesh.userData.nodeId = node.id; // 视口只映射稳定 ID，不用数组下标或临时数字 ID
    mesh.name = node.name;mesh.visible=node.visible;

    // 变换：DSL 保存相对父节点的局部变换；P0 一层分组按世界放置
    const [px, py, pz] = node.transform.position;
    const [qx, qy, qz, qw] = node.transform.rotationQuaternion;
    const [sx, sy, sz] = node.transform.scale;
    mesh.position.set(px, py, pz);
    mesh.quaternion.set(qx, qy, qz, qw);
    mesh.scale.set(sx, sy, sz);

    this.scene.add(mesh);
    this.nodeMap.set(node.id, { mesh, geometry, geometrySource:node.geometry!, material });
  }

  // 几何构建：几何默认以局部原点为中心（方案第 4 节）
  private buildGeometry(g: Geometry): THREE.BufferGeometry {
    // Documents preserve immutable geometry identities across transform/material edits.
    // Weak keys retain no inactive document or GPU resources; the value cache still
    // deduplicates equivalent geometries from separately instantiated assets.
    this.geometryKeys??=new WeakMap();
    let key=this.geometryKeys.get(g);
    if(key===undefined){key=JSON.stringify(g);this.geometryKeys.set(g,key);}
    const cached = this.sharedGeometryCache.get(key);
    if (cached) return cached;
    const geometry = buildPrimitiveGeometry(g);
    this.sharedGeometryCache.set(key, geometry);
    return geometry;
  }

  private buildMaterial(materialId: string | undefined, label?:string): THREE.MeshStandardMaterial {
    if (!materialId) return this.defaultMaterial;
    const found = this.frameMaterialsById.get(materialId);
    if (!found) return this.defaultMaterial;
    return this.getOrCreateMaterial(found,label);
  }

  private frameMaterialsById=new Map<string,Material>();
  private frameMaterialKeys=new Map<Material,string>();
  // Source material IDs stay independent in the editable document. Render
  // identical appearances once; reconciliation swaps only the edited users.
  private getOrCreateMaterial(m: Material,label?:string): THREE.MeshStandardMaterial {
    let materialKey=this.frameMaterialKeys.get(m);if(!materialKey){const {id,...properties}=m;materialKey=JSON.stringify(properties);this.frameMaterialKeys.set(m,materialKey);}const key=materialKey+(label??'');
    const cached = this.materialCache.get(key);
    if (cached) return cached;
    const mat = createSceneMaterial(m,label);materialReady.get(mat)?.then(()=>this.markDirty()).catch(()=>this.markDirty());
    this.materialCache.set(key, mat);
    return mat;
  }

  // 选择高亮：视口选中状态是从文档派生的运行时状态，不写入项目主文档
  setSelection(selectedIds: Set<string>): void {
    if(this.selectedIds?.size===selectedIds.size){let unchanged=true;for(const id of selectedIds)if(!this.selectedIds.has(id)){unchanged=false;break;}if(unchanged)return;}
    this.clearSelectionHelpers();
    this.selectedIds=new Set(selectedIds);
    for (const id of selectedIds) {
      const node = this.nodeMap.get(id);
      if (!node) continue;
      const helper = new THREE.BoxHelper(node.mesh, '#65a8ff');
      this.scene.add(helper); this.selectionHelpers.push(helper);
    }
    this.markDirty();
  }

  private clearSelectionHelpers(): void {
    for (const helper of this.selectionHelpers) {
      this.scene.remove(helper); helper.geometry.dispose(); helper.material.dispose();
    }
    this.selectionHelpers = [];
    this.selectedIds=undefined;
  }

  async captureDocument(doc: SceneDocument, view: 'perspective' | 'front' | 'side' | 'back' | 'left' | 'top' | 'bottom' | 'underside', targetIds?:string[],time?:number): Promise<string> {
    if(this.renderer.getContext().isContextLost())throw new Error('WebGL 上下文丢失，无法截图');
    if(this.host.clientWidth<=0 || this.host.clientHeight<=0)throw new Error('视口不可见，无法截图');
    this.composition?.cancel();
    this.sync(doc);await Promise.all([...this.materialCache.values()].map(m=>materialReady.get(m)??Promise.resolve()));if(this.lastSyncedDoc!==doc)throw Error('贴图加载期间场景已变化，请重新截图');
    this.capturing=true;this.previousDraw=false;this.quality.resetSamples();
    const savedPlayback={...this.animationClock.state};this.animationClock.pause();
    const saved = {target:this.orbitTarget.clone(),radius:this.orbitRadius,theta:this.orbitTheta,phi:this.orbitPhi,sceneScale:this.sceneScale,light:this.keyLight?{position:this.keyLight.position.clone(),target:this.keyLight.target.position.clone(),left:this.keyLight.shadow.camera.left,right:this.keyLight.shadow.camera.right,top:this.keyLight.shadow.camera.top,bottom:this.keyLight.shadow.camera.bottom,far:this.keyLight.shadow.camera.far}:null};
    const helpers = [...this.scene.children].filter(o => o.type === 'BoxHelper'||o.name==='__manualPlacementPreview'||o.name==='__manualTransformHandle');
    const helperVisibility=new Map(helpers.map(h=>[h,h.visible]));
    try {
      if(time!==undefined)this.applyAnimation(time);else this.restoreBasePose();
      helpers.forEach(h=>h.visible=false);
      const angles = {perspective:[0.7,1.05],front:[0,Math.PI/2],side:[Math.PI/2,Math.PI/2],back:[Math.PI,Math.PI/2],left:[-Math.PI/2,Math.PI/2],top:[0,0.01],bottom:[0,Math.PI-0.01],underside:[Math.PI/4,Math.PI-Math.atan(Math.SQRT1_2)]};
      [this.orbitTheta,this.orbitPhi] = angles[view];
      this.frameScene(targetIds?.length?new Set(targetIds):undefined);
      this.updateOrbitCamera(); this.markDirty(); this.render();
      const source=this.renderer.domElement;
      const scale=Math.min(1,1024/Math.max(source.width,source.height));
      const canvas=document.createElement('canvas');canvas.width=Math.max(1,Math.round(source.width*scale));canvas.height=Math.max(1,Math.round(source.height*scale));
      const context=canvas.getContext('2d');if(!context)throw new Error('无法读取视口截图');
      context.drawImage(source,0,0,canvas.width,canvas.height);
      const data=canvas.toDataURL('image/jpeg',0.85);
      if(!data.startsWith('data:image/jpeg;base64,')) throw new Error('截图无效');
      return data;
    } finally {
      this.capturing=false;this.previousDraw=false;this.quality.resetSamples();
      this.sceneScale=saved.sceneScale;if(this.keyLight&&saved.light){this.keyLight.position.copy(saved.light.position);this.keyLight.target.position.copy(saved.light.target);this.keyLight.target.updateMatrixWorld();Object.assign(this.keyLight.shadow.camera,{left:saved.light.left,right:saved.light.right,top:saved.light.top,bottom:saved.light.bottom,far:saved.light.far});this.keyLight.shadow.camera.updateProjectionMatrix();}
      helpers.forEach(h=>h.visible=helperVisibility.get(h)??false);
      this.animationClock.state=savedPlayback;
      if(savedPlayback.time>0||savedPlayback.playing)this.applyAnimation(savedPlayback.time);else this.restoreBasePose();
      this.orbitTarget.copy(saved.target);this.orbitRadius=saved.radius;this.orbitTheta=saved.theta;this.orbitPhi=saved.phi;
      this.updateOrbitCamera();this.markDirty();
    }
  }

  setPlaybackListener(listener:((state:PlaybackState)=>void)|null){this.onPlayback=listener;this.notifyPlayback();}
  private notifyPlayback(){this.onPlayback?.({...this.animationClock.state});}
  private restoreBasePose(){for(const node of this.lastSyncedDoc?.nodes??[]){const mesh=this.nodeMap.get(node.id)?.mesh;if(mesh){mesh.position.fromArray(node.transform.position);mesh.quaternion.fromArray(node.transform.rotationQuaternion);mesh.scale.fromArray(node.transform.scale);mesh.visible=node.visible;}}this.markDirty();}
  private applyAnimation(time:number){if(!this.animationEvaluator)return;const poses=this.animationEvaluator(time);for(const [id,pose] of poses){const mesh=this.nodeMap.get(id)?.mesh;if(mesh){mesh.position.fromArray(pose.transform.position);mesh.quaternion.fromArray(pose.transform.rotationQuaternion);mesh.scale.fromArray(pose.transform.scale);mesh.visible=pose.visible;}}for(const h of this.selectionHelpers)h.update();this.markDirty();}
  playAnimation(){if(!this.animationEvaluator)return;try{this.animationClock.play();this.applyAnimation(this.animationClock.state.time);}catch(e){this.animationClock.fail(e instanceof Error?e.message:'动画播放失败');this.restoreBasePose();}this.notifyPlayback();}
  pauseAnimation(){this.animationClock.pause();this.notifyPlayback();}
  resetAnimation(){this.animationClock.reset();this.restoreBasePose();this.notifyPlayback();}
  seekAnimation(time:number){this.animationClock.pause();this.animationClock.seek(time);try{this.applyAnimation(this.animationClock.state.time);}catch(e){this.animationClock.fail(e instanceof Error?e.message:'动画计算失败');this.restoreBasePose();}this.notifyPlayback();}
  setAnimationSpeed(speed:number){this.animationClock.setSpeed(speed);this.notifyPlayback();}

  setRenderPreset(preset:RenderPreset):void {
    if(this.renderPreset!==preset){this.contactShading?.dispose();this.contactShading=null;this.contactFailed=false;}
    this.renderPreset=preset;const settings=RENDER_PRESETS[preset];
    this.renderer.toneMappingExposure=settings.exposure;this.scene.environmentIntensity=settings.environment;
    if(this.hemisphereLight){this.hemisphereLight.intensity=settings.hemisphere;this.hemisphereLight.color.set(settings.sky);this.hemisphereLight.groundColor.set(settings.ground);}
    if(this.keyLight){this.keyLight.intensity=settings.key;this.keyLight.color.set(settings.keyColor);}
    if(this.rimLight){this.rimLight.intensity=settings.rim;this.rimLight.color.set(settings.rimColor);}
    this.setBackdrop(this.backdrop);
  }
  setBackdrop(mode:'light'|'slate'):void {this.backdrop=mode;const studio=this.renderPreset==='studio';this.scene.background=new THREE.Color(mode==='slate'?'#22252b':studio?'#e3e5e7':'#f1f2f4');this.floorMaterial?.color.set(mode==='slate'?'#2c3037':studio?'#c8cbce':'#e6e8ec');this.markDirty();}

  setGridVisible(visible:boolean):void {const grid=this.scene.getObjectByName('__grid');if(grid)grid.visible=visible;this.markDirty();}
  topView():void {this.orbitPhi=.02;this.orbitTheta=0;this.frameScene();this.updateOrbitCamera();this.markDirty();}
  presentationView():void {this.orbitTheta=.733;this.orbitPhi=1.012;this.frameScene();this.markDirty();}
  fitToSelection(ids: string[]): void {if(ids.length){this.frameScene(new Set(ids));this.markDirty();}}

  fitToScene(): void { this.frameScene(); this.markDirty(); }

  private disposeAllNodes(): void {
    this.instancedRender?.dispose();this.instancedRender=null;
    this.clearSelectionHelpers();
    for (const [, res] of this.nodeMap) {
      this.scene.remove(res.mesh);
    }
    this.nodeMap.clear();
    // 共享 geometry/material 缓解跨节点复用；文档级重建时一并清理
    for (const [, geo] of this.sharedGeometryCache) geo.dispose();
    for (const [, mat] of this.materialCache) {disposeMaterialTextures(mat);}
    this.sharedGeometryCache.clear();
    this.materialCache.clear();
  }

  private viewportFov():number {return THREE.MathUtils.radToDeg(2*Math.atan(Math.tan(THREE.MathUtils.degToRad(38)/2)*Math.max(1,this.host.clientHeight/Math.max(1,this.host.clientWidth))));}
  setRenderQuality(value:RenderQuality):void {const mode=normalizeRenderQuality(value);if(mode===this.quality.mode)return;this.quality.setMode(mode);this.contactFailed=false;this.postprocessingError='';this.applyRenderQuality();}
  private applyRenderQuality():void {
    const tier=RENDER_TIERS[this.quality.tier];this.renderer.setPixelRatio(Math.min(window.devicePixelRatio||1,tier.pixelRatio));
    if(this.keyLight&&this.keyLight.shadow.mapSize.width!==tier.shadowSize){this.keyLight.shadow.map?.dispose();this.keyLight.shadow.map=null;this.keyLight.shadow.mapSize.set(tier.shadowSize,tier.shadowSize);this.renderer.shadowMap.needsUpdate=true;}
    if(!tier.contactShadows){this.contactShading?.dispose();this.contactShading=null;}this.markDirty();
  }
  getRenderStats(){
    const info=this.renderer.info;
    return {quality:this.quality.mode,tier:this.quality.tier,contactShadows:!!this.contactShading,postprocessingError:this.postprocessingError,drawCalls:info.render.calls,triangles:info.render.triangles,cpuRenderMs:this.cpuRenderMs,geometries:info.memory.geometries,textures:info.memory.textures,programs:info.programs?.length??0,pixelRatio:this.renderer.getPixelRatio(),gpu:this.gpu,softwareRenderer:this.softwareRenderer};
  }
  private hostSizeChanged():boolean {
    const w=this.host.clientWidth,h=this.host.clientHeight;
    return w>0&&h>0&&(w!==this.renderWidth||h!==this.renderHeight);
  }
  private render(): boolean {
    if (!this.dirty || (this.active===false&&!this.capturing)) return false;
    const w = this.host.clientWidth;
    const h = this.host.clientHeight;
    if(w<=0||h<=0)return false;
    this.dirty = false;
    if (w!==this.renderWidth||h!==this.renderHeight) {
      this.camera.aspect = w / h;this.camera.fov=this.viewportFov();
      this.camera.updateProjectionMatrix();
      this.renderer.setSize(w, h, false);
      this.renderWidth=w;this.renderHeight=h;
    }
    const started=performance.now(),autoReset=this.renderer.info.autoReset;
    this.renderer.info.autoReset=false;this.renderer.info.reset();
    const useContacts=this.quality.tier==='high'&&this.renderPreset==='studio'&&this.nodeMap.size>0&&!this.contactFailed;
    const draw=()=>{
      if(useContacts){try{this.contactShading??=new ContactShading(this.renderer,this.scene,this.camera);this.contactShading.setSize(Math.max(w,1),Math.max(h,1),this.renderer.getPixelRatio());this.contactShading.setSceneScale(this.sceneScale);this.contactShading.render();return;}catch(error){this.postprocessingError=error instanceof Error?error.message:'接触阴影不可用';this.contactFailed=true;this.contactShading?.dispose();this.contactShading=null;this.renderer.setRenderTarget(null);this.renderer.autoClear=true;}}
      else if(this.contactShading){this.contactShading.dispose();this.contactShading=null;}
      this.renderer.render(this.scene,this.camera);
    };
    try{if(this.instancedRender)this.instancedRender.render(draw);else draw();}finally{this.renderer.info.autoReset=autoReset;this.cpuRenderMs=performance.now()-started;}
    return true;
  }

  // Keep the current scene and backing canvas while workspace navigation hides it.
  setActive(active:boolean):void {
    if(this.active===active){if(active)this.start();return;}
    this.active=active;
    this.lastFrame=0;this.previousDraw=false;this.quality?.resetSamples();
    if(!active){
      this.loopVersion=(this.loopVersion??0)+1;
      if(this.rafHandle!=null)cancelAnimationFrame(this.rafHandle);
      this.rafHandle=null;this.cancelPointerGesture?.();
      return;
    }
    if(this.hostSizeChanged())this.markDirty();
    this.start();
  }

  // 按需渲染循环：静态场景不持续刷新
  start(): void {
    this.active??=true;
    if(this.active===false||this.rafHandle!=null)return;
    const version=this.loopVersion??0;
    const loop = (now:number) => {
      if(this.active===false||version!==(this.loopVersion??0))return;
      const delta=this.lastFrame?(now-this.lastFrame)/1000:0;this.lastFrame=now;
      if(this.animationClock.tick(delta)){try{this.applyAnimation(this.animationClock.state.time);}catch(e){this.animationClock.fail(e instanceof Error?e.message:'动画计算失败');this.restoreBasePose();}if(now-this.playbackNotified>100||!this.animationClock.state.playing){this.notifyPlayback();this.playbackNotified=now;}}
      const drew=this.render();
      if(drew&&this.previousDraw&&!this.capturing){if(this.quality.sample(delta*1000))this.applyRenderQuality();}else this.quality.resetSamples();
      this.previousDraw=drew&&!this.capturing;
      if(this.active&&version===(this.loopVersion??0))this.rafHandle = requestAnimationFrame(loop);
    };
    this.rafHandle = requestAnimationFrame(loop);
  }

  dispose(): void {
    this.clearAssetDropPreview();this.composition?.dispose();this.composition=null;
    this.cancelPointerGesture?.();window.removeEventListener('keydown',this.escapeSelection);
    this.active=false;
    this.loopVersion=(this.loopVersion??0)+1;
    if (this.rafHandle != null) cancelAnimationFrame(this.rafHandle);
    this.rafHandle=null;
    this.resizeObserver?.disconnect();
    this.contactShading?.dispose();this.contactShading=null;
    this.disposeAllNodes();
    this.defaultMaterial.dispose();
    this.envTexture?.dispose();
    this.backgroundTexture?.dispose();
    this.floorGeometry?.dispose();
    this.floorMaterial?.dispose();
    this.renderer.dispose();
    if (this.renderer.domElement.parentElement === this.host) {
      this.host.removeChild(this.renderer.domElement);
    }
  }
}
