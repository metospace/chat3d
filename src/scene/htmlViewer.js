/* The viewer uses only the embedded Three.js modules and embedded scene images. */
(async () => {
  'use strict';
  const status = document.getElementById('status');
  const canvas = document.getElementById('view');
  const viewport = document.getElementById('viewport');
  const reset = document.getElementById('reset');
  const embedded = document.body.dataset.embedded === 'true';
  const urls = [];
  const removers = [];
  let renderer;
  let scene;
  let disposed = false;
  let observer;
  let environmentTarget;
  function on(target, type, listener, options) {
    target.addEventListener(type, listener, options);
    removers.push(() => target.removeEventListener(type, listener, options));
  }
  function releaseUrls() {
    for (const url of urls) URL.revokeObjectURL(url);
    urls.length = 0;
  }
  function dispose() {
    if (disposed) return;
    disposed = true;
    observer?.disconnect();
    for (const remove of removers) remove();
    releaseUrls();
    const geometries = new Set();
    const materials = new Set();
    const textures = new Set();
    scene?.traverse(object => {
      if (object.geometry) geometries.add(object.geometry);
      for (const material of Array.isArray(object.material) ? object.material : object.material ? [object.material] : []) {
        materials.add(material);
        for (const value of Object.values(material)) if (value?.isTexture) textures.add(value);
      }
    });
    for (const texture of textures) texture.dispose();
    for (const material of materials) material.dispose();
    for (const geometry of geometries) geometry.dispose();
    environmentTarget?.dispose();
    renderer?.dispose();
  }
  function fail(message) {
    status.textContent = message;
    status.hidden = false;
    reset.disabled = true;
    dispose();
  }
  on(window, 'pagehide', dispose);
  try {
    const optionsNode = document.getElementById('viewer-options');
    const options = optionsNode ? JSON.parse(optionsNode.textContent) : {};
    optionsNode?.remove();
    const view = embedded ? options.view : undefined;
    const runtimeNode = document.getElementById('three-runtime');
    const runtime = JSON.parse(runtimeNode.textContent);
    runtimeNode.remove();
    const coreUrl = URL.createObjectURL(new Blob([runtime.core], {type: 'text/javascript'}));
    urls.push(coreUrl);
    const moduleUrl = URL.createObjectURL(new Blob([runtime.module.split("'./three.core.js'").join(JSON.stringify(coreUrl))], {type: 'text/javascript'}));
    runtimeNode.textContent = '';
    urls.push(moduleUrl);
    // The module URL is generated from this file's embedded runtime; no static file import exists offline.
    const roomUrl=URL.createObjectURL(new Blob([runtime.roomEnvironment.split("'three'").join(JSON.stringify(moduleUrl))],{type:'text/javascript'}));
    urls.push(roomUrl);
    const [THREE,{RoomEnvironment}]=await Promise.all([import(moduleUrl),import(roomUrl)]);
    const lighting=runtime.lighting;
    // Both static core imports are resolved before the module import fulfills.
    releaseUrls();
    runtime.core = '';
    runtime.module = '';
    if (disposed) return;
    try {
      renderer = new THREE.WebGLRenderer({canvas, antialias: true, alpha: embedded});
    } catch {
      fail('无法启动 WebGL 三维查看器。请使用支持 WebGL 2 的新版浏览器，并开启硬件加速后重新打开此文件。');
      return;
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = lighting.exposure;
    renderer.shadowMap.enabled=true;
    renderer.shadowMap.type=THREE.PCFShadowMap;
    const dataNode = document.getElementById('scene-data');
    const data = JSON.parse(dataNode.textContent);
    dataNode.remove();
    dataNode.textContent = '';
    const manager = new THREE.LoadingManager();
    manager.setURLModifier(url => {
      if (!/^data:image\/(png|jpeg);base64,/i.test(url)) throw new Error('External resources are not allowed');
      return url;
    });
    scene = await new THREE.ObjectLoader(manager).parseAsync(data);
    for (const key of Object.keys(data)) delete data[key];
    if (disposed) {
      // Loading may finish after pagehide; free the late-created scene as well.
      disposed = false;
      dispose();
      return;
    }
    scene.background = embedded ? null : new THREE.Color('#e3e5e7');
    if (embedded) renderer.setClearColor(0x000000, 0);
    const environment=new RoomEnvironment(),pmrem=new THREE.PMREMGenerator(renderer);
    environmentTarget=pmrem.fromScene(environment,.04);scene.environment=environmentTarget.texture;
    scene.environmentIntensity=lighting.environment;environment.dispose();pmrem.dispose();
    scene.traverse(object=>{if(object.isMesh){object.receiveShadow=true;object.castShadow=object.material.opacity>=.95&&!(object.material.transmission>0);}});
    scene.add(new THREE.HemisphereLight(lighting.sky, lighting.ground, lighting.hemisphere));
    const key = new THREE.DirectionalLight(lighting.keyColor, lighting.key);
    key.position.set(3, 5, 4);
    scene.add(key);
    const fill = new THREE.DirectionalLight(lighting.rimColor, lighting.rim);
    fill.position.set(-4, 2, -3);
    scene.add(fill);
    const bounds = new THREE.Box3().setFromObject(scene);
    const sphere = bounds.getBoundingSphere(new THREE.Sphere());
    if (bounds.isEmpty() || !Number.isFinite(sphere.radius)) throw new Error('Empty model');
    const radius = Math.max(sphere.radius, 0.0001);
    key.position.copy(sphere.center).add(new THREE.Vector3(-12,24,14));key.target.position.copy(sphere.center);scene.add(key.target);
    key.castShadow=true;key.shadow.mapSize.set(2048,2048);const extent=Math.max(radius*1.5,2);
    Object.assign(key.shadow.camera,{left:-extent,right:extent,top:extent,bottom:-extent,near:.5,far:Math.max(60,radius*4+30)});key.shadow.camera.updateProjectionMatrix();key.shadow.bias=-.0002;key.shadow.normalBias=.0015;
    if (!embedded) {
      const floor=new THREE.Mesh(new THREE.PlaneGeometry(Math.max(radius*12,10),Math.max(radius*12,10)),new THREE.MeshStandardMaterial({color:'#c8cbce',roughness:.92,metalness:0}));
      floor.rotation.x=-Math.PI/2;floor.position.set(sphere.center.x,bounds.min.y-.001,sphere.center.z);floor.receiveShadow=true;scene.add(floor);
    }
    const camera = new THREE.PerspectiveCamera(40, 1, radius / 1000, radius * 1000);
    const target = sphere.center.clone();
    const offset = new THREE.Vector3();
    const right = new THREE.Vector3();
    const up = new THREE.Vector3();
    let theta = Math.PI / 4;
    let phi = Math.PI / 3;
    let distance = radius * 4;
    let pointer = null;
    let atHome = true;
    function render() {
      if (disposed) return;
      offset.setFromSphericalCoords(distance, phi, theta);
      camera.position.copy(target).add(offset);
      camera.near = Math.max(radius / 10000, distance - radius * 5);
      camera.far = Math.max(radius * 1000, distance + radius * 20);
      camera.updateProjectionMatrix();
      camera.lookAt(target);
      renderer.render(scene, camera);
    }
    function home() {
      target.copy(sphere.center);
      theta = view ? THREE.MathUtils.degToRad(view.azimuth) : Math.PI / 4;
      phi = view ? THREE.MathUtils.degToRad(90 - view.elevation) : Math.PI / 3;
      camera.zoom = view ? view.zoom : 1;
      atHome = true;
      const halfFov = THREE.MathUtils.degToRad(camera.fov / 2);
      const tanV = Math.tan(halfFov), tanH = tanV * camera.aspect;
      const backward = new THREE.Vector3().setFromSphericalCoords(1, phi, theta);
      const horizontal = new THREE.Vector3().crossVectors(camera.up, backward).normalize();
      const vertical = new THREE.Vector3().crossVectors(backward, horizontal).normalize();
      const corner = new THREE.Vector3();
      let fit = 0;
      for (const x of [bounds.min.x, bounds.max.x]) for (const y of [bounds.min.y, bounds.max.y]) for (const z of [bounds.min.z, bounds.max.z]) {
        corner.set(x, y, z).sub(sphere.center);
        const depth = corner.dot(backward);
        fit = Math.max(fit, depth + Math.abs(corner.dot(horizontal)) / tanH, depth + Math.abs(corner.dot(vertical)) / tanV);
      }
      distance = Math.max(radius * .1, fit * 1.08);
      render();
    }
    function resize() {
      if (disposed) return;
      const width = Math.max(viewport.clientWidth, 1);
      const height = Math.max(viewport.clientHeight, 1);
      camera.aspect = width / height;
      // Shift the projection, not the geometry or orbit target. Positive offsets
      // move the model right/down by fractions of the full viewport dimensions.
      if (view) camera.setViewOffset(width, height, -view.offsetX * width, -view.offsetY * height, width, height);
      renderer.setSize(width, height, false);
      if (atHome) home(); else render();
    }
    on(canvas, 'contextmenu', event => event.preventDefault());
    on(canvas, 'pointerdown', event => {
      if (pointer || (event.button !== 0 && event.button !== 2)) return;
      pointer = {id: event.pointerId, x: event.clientX, y: event.clientY, pan: event.button === 2};
      canvas.setPointerCapture(event.pointerId);
      canvas.focus({preventScroll: true});
      event.preventDefault();
    });
    on(canvas, 'pointermove', event => {
      if (!pointer || pointer.id !== event.pointerId) return;
      atHome = false;
      const dx = event.clientX - pointer.x;
      const dy = event.clientY - pointer.y;
      pointer.x = event.clientX;
      pointer.y = event.clientY;
      const height = Math.max(viewport.clientHeight, 1);
      if (pointer.pan || event.shiftKey) {
        const unitsPerPixel = 2 * distance * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) / (height * camera.zoom);
        camera.updateMatrixWorld();
        right.setFromMatrixColumn(camera.matrixWorld, 0);
        up.setFromMatrixColumn(camera.matrixWorld, 1);
        target.addScaledVector(right, -dx * unitsPerPixel).addScaledVector(up, dy * unitsPerPixel);
      } else {
        theta -= dx * 2 * Math.PI / height;
        phi = THREE.MathUtils.clamp(phi - dy * 2 * Math.PI / height, 0.01, Math.PI - 0.01);
      }
      render();
    });
    function endPointer(event) {
      if (pointer?.id !== event.pointerId) return;
      pointer = null;
      if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
    }
    on(canvas, 'pointerup', endPointer);
    on(canvas, 'pointercancel', endPointer);
    on(canvas, 'lostpointercapture', () => { pointer = null; });
    on(canvas, 'wheel', event => {
      event.preventDefault();
      atHome = false;
      const delta = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? viewport.clientHeight : 1);
      distance = THREE.MathUtils.clamp(distance * Math.exp(THREE.MathUtils.clamp(delta * 0.001, -1, 1)), radius * 0.03, radius * 100);
      render();
    }, {passive: false});
    on(canvas, 'dblclick', home);
    on(reset, 'click', home);
    on(canvas, 'webglcontextlost', event => {
      event.preventDefault();
      fail('WebGL 图形上下文已丢失。请关闭其他占用显卡的页面，然后重新打开此文件。');
    });
    on(window, 'resize', resize);
    if (typeof ResizeObserver !== 'undefined') {
      observer = new ResizeObserver(resize);
      observer.observe(viewport);
    }
    resize();
    home();
    status.hidden = true;
    reset.disabled = false;
  } catch {
    fail('无法载入离线模型。文件可能不完整，或此浏览器不支持离线三维查看，请重新导出并使用新版浏览器打开。');
  }
})();
