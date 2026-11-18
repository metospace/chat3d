import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { GLTFLoader, type GLTF } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { KTX2Loader } from 'three/addons/loaders/KTX2Loader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import dracoWasm from 'three/addons/libs/draco/gltf/draco_decoder.wasm?url';
import dracoWrapper from 'three/addons/libs/draco/gltf/draco_wasm_wrapper.js?url';
import basisJs from 'three/addons/libs/basis/basis_transcoder.js?url';
import basisWasm from 'three/addons/libs/basis/basis_transcoder.wasm?url';
import { assertGlbSize } from './glbLimit';

const decoderPath = 'local-preview/';
const basisFiles: Record<string, string> = {
  [`${decoderPath}basis_transcoder.js`]: basisJs,
  [`${decoderPath}basis_transcoder.wasm`]: basisWasm,
};

export interface LocalGlbView {
  load(file: File): Promise<string[]>;
  fit(): void;
  setBackground(color: string): void;
  selectClip(index: number): void;
  setPlaying(value: boolean): void;
  dispose(): void;
}

function validateEnvelope(bytes: ArrayBuffer) {
  const header = new DataView(bytes);
  if (bytes.byteLength < 20 || header.getUint32(0, true) !== 0x46546c67 || header.getUint32(4, true) !== 2 ||
      header.getUint32(8, true) !== bytes.byteLength) throw Error('请选择完整的 GLB 2.0 文件。');
  let json = false, bin = false;
  for (let offset = 12; offset < bytes.byteLength;) {
    if (bytes.byteLength - offset < 8) throw Error('GLB 分块头不完整。');
    const length = header.getUint32(offset, true), type = header.getUint32(offset + 4, true);
    const start = offset + 8, end = start + length;
    if (length % 4 || end > bytes.byteLength) throw Error('GLB 分块长度无效。');
    if (offset === 12 && type !== 0x4e4f534a) throw Error('GLB 缺少 JSON 分块。');
    if (type === 0x4e4f534a) {
      if (json || !length) throw Error('GLB JSON 分块无效。');
      json = true;
    } else if (type === 0x004e4942) {
      if (bin) throw Error('GLB 包含重复的二进制分块。');
      bin = true;
    }
    offset = end;
  }
}

function validateResources(data: { asset?: { version?: string }; images?: { uri?: string }[]; buffers?: { uri?: string }[] }) {
  if (data?.asset?.version !== '2.0') throw Error('GLB 缺少 2.0 资产声明。');
  for (const resources of [data.images, data.buffers]) {
    if (resources === undefined) continue;
    if (!Array.isArray(resources)) throw Error('GLB 图片或缓冲区列表无效。');
    for (const resource of resources) {
      if (resource?.uri !== undefined && (typeof resource.uri !== 'string' || !/^data:/i.test(resource.uri))) {
        throw Error('模型引用了外部贴图或缓冲区，请重新导出自包含的 GLB。');
      }
    }
  }
}

function disposeModel(gltf: GLTF) {
  const materials = new Set<THREE.Material>(), geometries = new Set<THREE.BufferGeometry>();
  const textures = new Set<THREE.Texture>(), images = new Set<ImageBitmap>(), skeletons = new Set<THREE.Skeleton>();
  for (const scene of gltf.scenes.includes(gltf.scene) ? gltf.scenes : [...gltf.scenes, gltf.scene]) {
    scene.traverse(object => {
      const mesh = object as THREE.Mesh;
      if (mesh.geometry) geometries.add(mesh.geometry);
      if (mesh.material) for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) materials.add(material);
      if (object instanceof THREE.SkinnedMesh) skeletons.add(object.skeleton);
      if (object instanceof THREE.InstancedMesh) object.dispose();
    });
  }
  for (const material of materials) {
    for (const value of Object.values(material)) if (value instanceof THREE.Texture) textures.add(value);
    material.dispose();
  }
  for (const texture of textures) {
    const source: unknown = texture.source.data;
    for (const image of Array.isArray(source) ? source : [source]) if (typeof ImageBitmap !== 'undefined' && image instanceof ImageBitmap) images.add(image);
    texture.dispose();
  }
  for (const image of images) image.close();
  for (const geometry of geometries) geometry.dispose();
  for (const skeleton of skeletons) skeleton.dispose();
}

function readFile(file: File, signal: AbortSignal) {
  assertGlbSize(file.size);
  signal.throwIfAborted();
  const reader = new FileReader();
  const { promise, resolve, reject } = Promise.withResolvers<ArrayBuffer>();
  const abort = () => reader.abort();
  reader.onload = () => resolve(reader.result as ArrayBuffer);
  reader.onerror = () => reject(reader.error ?? Error('无法读取本地文件。'));
  reader.onabort = () => reject(signal.reason);
  signal.addEventListener('abort', abort, { once: true });
  reader.readAsArrayBuffer(file);
  return promise.finally(() => signal.removeEventListener('abort', abort));
}

async function parseFile(bytes: ArrayBuffer, renderer: THREE.WebGLRenderer, signal: AbortSignal) {
  signal.throwIfAborted();
  validateEnvelope(bytes);
  const resources = new THREE.LoadingManager();
  resources.setURLModifier(url => {
    if (/^(data:|blob:)/i.test(url)) return url;
    throw Error('预览不会请求 GLB 引用的外部资源。');
  });
  // Decoder URLs are application assets, never sourced from the model.
  const draco = new DRACOLoader().setDecoderPath({ js: dracoWrapper, wasm: dracoWasm }).setWorkerLimit(2);
  const decoders = new THREE.LoadingManager();
  decoders.setURLModifier(name => {
    if (!Object.prototype.hasOwnProperty.call(basisFiles, name)) throw Error('无法加载内置的 GLB 解码器。');
    return basisFiles[name];
  });
  const basis = new KTX2Loader(decoders).setTranscoderPath(decoderPath).setWorkerLimit(2).detectSupport(renderer);
  const loader = new GLTFLoader(resources).setDRACOLoader(draco).setKTX2Loader(basis).setMeshoptDecoder(MeshoptDecoder);
  loader.register(parser => {
    validateResources(parser.json);
    return { name: 'ScenivoLocalResources' };
  });
  const { promise, resolve, reject } = Promise.withResolvers<GLTF>();
  const abort = () => reject(signal.reason);
  signal.addEventListener('abort', abort, { once: true });
  const timeout = window.setTimeout(() => reject(Error('GLB 解码超时，请检查模型是否损坏或过于复杂。')), 15 * 60_000);
  let settled = false;
  try {
    loader.parse(bytes, '', gltf => {
      if (settled || signal.aborted) disposeModel(gltf);
      else resolve(gltf);
    }, reject);
    return await promise;
  } finally {
    settled = true;
    window.clearTimeout(timeout);
    signal.removeEventListener('abort', abort);
    draco.dispose(); basis.dispose();
  }
}

export function mountLocalGlbPreview(host: HTMLElement, background: string, onContextLost: () => void): LocalGlbView {
  let renderer: THREE.WebGLRenderer;
  try { renderer = new THREE.WebGLRenderer({ antialias: true }); }
  catch { throw Error('无法初始化 WebGL 2，请检查显卡或浏览器设置。'); }
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(background);
  let environment: THREE.WebGLRenderTarget | undefined;
  scene.add(new THREE.HemisphereLight(0xe5efff, 0x716b61, 2));
  const light = new THREE.DirectionalLight(0xffffff, 3);
  light.position.set(5, 8, 6);
  scene.add(light);
  const fill = new THREE.DirectionalLight(0xd8e7ff, 1.2);
  fill.position.set(-5, 2, -4);
  scene.add(fill);
  const camera = new THREE.PerspectiveCamera(42, 1, 0.01, 1000);
  camera.position.set(3, 2, 3);
  const canvas = renderer.domElement;
  canvas.setAttribute('aria-label', '本地 GLB 三维画布');
  host.appendChild(canvas);
  const controls = new OrbitControls(camera, canvas);
  const abort = new AbortController();
  let gltf: GLTF | undefined, mixer: THREE.AnimationMixer | undefined, action: THREE.AnimationAction | undefined;
  let playing = false, frame = 0, previousTime: number | undefined;
  let bounds: THREE.Sphere | undefined;
  function invalidate() {
    if (!abort.signal.aborted && !frame) frame = requestAnimationFrame(draw);
  }
  function draw(now: number) {
    frame = 0;
    if (playing && previousTime !== undefined) mixer?.update(Math.max(0, Math.min((now - previousTime) / 1000, 0.1)));
    previousTime = playing ? now : undefined;
    renderer.render(scene, camera);
    if (playing) invalidate();
  }
  function fit() {
    if (!bounds) return;
    const vertical = THREE.MathUtils.degToRad(camera.fov / 2);
    const radius = Math.max(bounds.radius, 0.001);
    const distance = radius / Math.sin(Math.min(vertical, Math.atan(Math.tan(vertical) * camera.aspect))) * 1.2;
    camera.position.copy(bounds.center).add(new THREE.Vector3(1, 0.7, 1).normalize().multiplyScalar(distance));
    camera.near = Math.max(radius / 1000, 0.000001);
    camera.far = distance + radius * 200;
    camera.updateProjectionMatrix();
    controls.target.copy(bounds.center);
    controls.minDistance = radius / 100;
    controls.maxDistance = distance + radius * 50;
    controls.update();
    invalidate();
  }
  function resize() {
    const width = host.clientWidth, height = host.clientHeight;
    if (!width || !height || abort.signal.aborted) return;
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    renderer.setSize(width, height, false);
    invalidate();
  }
  const observer = new ResizeObserver(resize);
  resize();
  controls.addEventListener('change', invalidate);
  observer.observe(host);
  function dispose() {
    if (abort.signal.aborted) return;
    abort.abort();
    observer.disconnect();
    cancelAnimationFrame(frame);
    canvas.removeEventListener('webglcontextlost', lost);
    controls.dispose();
    if (gltf) {
      mixer?.stopAllAction();
      mixer?.uncacheRoot(gltf.scene);
      disposeModel(gltf);
    }
    environment?.dispose();
    scene.clear();
    renderer.dispose();
    renderer.forceContextLoss();
    canvas.remove();
  }
  function lost(event: Event) { event.preventDefault(); dispose(); onContextLost(); }
  canvas.addEventListener('webglcontextlost', lost);
  return {
    dispose, fit,
    setBackground(color: string) { (scene.background as THREE.Color).set(color); invalidate(); },
    async load(file: File) {
      const model = await parseFile(await readFile(file, abort.signal), renderer, abort.signal);
      if (abort.signal.aborted) { disposeModel(model); abort.signal.throwIfAborted(); }
      gltf = model;
      const box = new THREE.Box3().setFromObject(model.scene);
      if (box.isEmpty()) throw Error('这个 GLB 的默认场景没有可预览的几何。');
      bounds = box.getBoundingSphere(new THREE.Sphere());
      if (!Number.isFinite(bounds.radius) || ![bounds.center.x, bounds.center.y, bounds.center.z].every(Number.isFinite)) throw Error('模型的空间范围无效。');
      const room = new RoomEnvironment(), pmrem = new THREE.PMREMGenerator(renderer);
      try { environment = pmrem.fromScene(room); scene.environment = environment.texture; }
      finally { room.dispose(); pmrem.dispose(); }
      scene.add(model.scene);
      if (model.animations.length) mixer = new THREE.AnimationMixer(model.scene);
      fit();
      return model.animations.map((clip, index) => clip.name || `动画 ${index + 1}`);
    },
    selectClip(index: number) {
      const clip = gltf?.animations[index];
      if (!mixer || !clip) return;
      mixer.stopAllAction();
      action = mixer.clipAction(clip).reset().play();
      mixer.update(0);
      action.paused = !playing;
      invalidate();
    },
    setPlaying(value: boolean) {
      playing = value && action !== undefined;
      if (action) action.paused = !playing;
      previousTime = undefined;
      invalidate();
    },
  };
}
