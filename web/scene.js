import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { frameBowlCamera, throwCameraLift } from './camera.js';

// This renderer is shared by the browser and the mini-game. All platform canvas
// construction and the animation clock are supplied by the caller.
export function createScene({ canvas, width = 800, height = 650, pixelRatio = 1, canvasFactory, onImpact } = {}) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(pixelRatio, 2));
  renderer.setSize(width, height, false);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.02;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(37, width / Math.max(height, 1), .1, 60);
  camera.position.set(0, 11.6, 8.7);
  camera.lookAt(0, .35, 0);
  scene.add(new THREE.HemisphereLight(0xfff8e8, 0x9caa9a, 1.8));
  const key = new THREE.DirectionalLight(0xfff1dd, 3.2);
  key.position.set(-3, 7, 4);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  key.shadow.camera.left = key.shadow.camera.bottom = -5;
  key.shadow.camera.right = key.shadow.camera.top = 5;
  key.shadow.normalBias = .025;
  key.shadow.bias = -.0002;
  scene.add(key);
  const fill = new THREE.DirectionalLight(0xc7e7e2, .8);
  fill.position.set(4, 4, -3);
  scene.add(fill);
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(25, 25), new THREE.ShadowMaterial({ opacity: .15, color: 0x213b32 }));
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = -.22;
  floor.receiveShadow = true;
  scene.add(floor);

  const bowlRoot = new THREE.Group();
  const dieRoot = new THREE.Group();
  scene.add(bowlRoot, dieRoot);
  let modelState = 'placeholder';
  const placeholderBowl = makePlaceholderBowl();
  bowlRoot.add(placeholderBowl);
  let dice = Array.from({ length: 6 }, () => makePlaceholderDie());
  const resting = [[-.83,.267,.65], [.09,.267,.49], [.92,.267,.36], [-.76,.267,-.36], [-.03,.267,-.47], [.70,.267,-.63]];
  const idleOrientations = [new THREE.Euler(0,.1,0),new THREE.Euler(Math.PI/2,.3,0),new THREE.Euler(0,0,Math.PI/2),new THREE.Euler(Math.PI,-.25,0),new THREE.Euler(-Math.PI/2,.2,0),new THREE.Euler(0,0,-Math.PI/2)];
  dice.forEach((die, i) => { die.position.fromArray(resting[i]); die.rotation.copy(idleOrientations[i]); dieRoot.add(die); });
  let roll = null;
  let serverOffset = 0;
  let frameIndex = 0;
  let lastImpactTime = -1;
  let lastElapsed = -1;
  let cameraLift = 0;
  let lastCameraTime = null;
  let disposed = false;
  const tempPos = new THREE.Vector3();
  const tempQuat = new THREE.Quaternion();

  function resize(w, h, dpr = 1) {
    frameBowlCamera(camera, w / Math.max(h, 1), cameraLift);
    renderer.setPixelRatio(Math.min(dpr, 2));
    renderer.setSize(w, h, false);
  }

  function setRoll(nextRoll, offset = 0) {
    if (nextRoll === null) {
      roll = null;
      cameraLift = 0;
      lastCameraTime = null;
      frameBowlCamera(camera, camera.aspect);
      dice.forEach((die, i) => { die.position.fromArray(resting[i]); die.rotation.copy(idleOrientations[i]); });
      return;
    }
    if (!nextRoll?.frames?.length) return;
    roll = nextRoll;
    serverOffset = Number.isFinite(offset) ? offset : 0;
    frameIndex = 0;
    const elapsed = Math.max(0, (Date.now() + serverOffset - roll.startTime) / 1000);
    lastImpactTime = elapsed > .4 ? elapsed : -1;
    lastElapsed = -1;
    lastCameraTime = null;
  }

  function update(nowEpochMs) {
    if (!roll || disposed) return;
    const elapsed = Math.max(0, (nowEpochMs + serverOffset - roll.startTime) / 1000);
    const frames = roll.frames;
    if (elapsed < lastElapsed) frameIndex = 0;
    while (frameIndex < frames.length - 1 && frames[frameIndex + 1].t <= elapsed) frameIndex++;
    const a = frames[frameIndex];
    const b = frames[Math.min(frameIndex + 1, frames.length - 1)];
    const blend = a === b ? 0 : THREE.MathUtils.clamp((elapsed - a.t) / (b.t - a.t), 0, 1);
    for (let i = 0; i < Math.min(dice.length, a.dice.length); i++) {
      const from = a.dice[i], to = b.dice[i];
      dice[i].position.set(from[0], from[1], from[2]);
      dice[i].position.lerp(tempPos.set(to[0], to[1], to[2]), blend);
      dice[i].quaternion.set(from[3], from[4], from[5], from[6]);
      dice[i].quaternion.slerp(tempQuat.set(to[3], to[4], to[5], to[6]), blend);
    }
    const desiredLift = throwCameraLift(Math.max(...dice.map(die => die.position.y)));
    const dt = lastCameraTime === null ? 0 : Math.max(0, Math.min(.1, (nowEpochMs - lastCameraTime) / 1000));
    // Open immediately so high dice never clip; ease back as they fall.
    cameraLift = desiredLift >= cameraLift || lastCameraTime === null
      ? desiredLift : THREE.MathUtils.lerp(cameraLift, desiredLift, 1 - Math.exp(-dt * 5));
    frameBowlCamera(camera, camera.aspect, cameraLift);
    lastCameraTime = nowEpochMs;
    if (onImpact && elapsed - lastElapsed < .3) {
      for (const hit of roll.impacts || []) {
        if (hit.t > lastImpactTime && hit.t <= elapsed && elapsed - hit.t < .18) onImpact(hit.strength);
      }
    }
    lastImpactTime = elapsed;
    lastElapsed = elapsed;
  }

  async function readModel(source) {
    const loader = new GLTFLoader();
    if (typeof source === 'string') return loader.loadAsync(source);
    const buffer = source instanceof ArrayBuffer ? source : source.buffer.slice(source.byteOffset, source.byteOffset + source.byteLength);
    return new Promise((resolve, reject) => loader.parse(buffer, '', resolve, reject));
  }

  async function loadModels({ bowlData, dieData, bowlUrl = '/models/bowl.glb', dieUrl = '/models/die.glb' } = {}) {
    const [bowlModel, dieModel] = await Promise.all([readModel(bowlData || bowlUrl), readModel(dieData || dieUrl)]);
    if (disposed) return;
    bowlModel.scene.traverse(obj => { if (obj.isMesh) { obj.castShadow = true; obj.receiveShadow = true; } });
    dieModel.scene.traverse(obj => { if (obj.isMesh) { obj.castShadow = true; obj.receiveShadow = true; } });
    bowlRoot.remove(placeholderBowl);
    bowlRoot.add(bowlModel.scene);
    dice = dice.map(old => {
      const die = dieModel.scene.clone(true);
      die.position.copy(old.position);
      die.quaternion.copy(old.quaternion);
      dieRoot.remove(old);
      dieRoot.add(die);
      return die;
    });
    modelState = 'blender';
    return { bowl: bowlModel.scene, dice };
  }

  function dispose() {
    disposed = true;
    const seen = new Set();
    scene.traverse(obj => {
      if (obj.geometry && !seen.has(obj.geometry)) { seen.add(obj.geometry); obj.geometry.dispose(); }
      for (const material of Array.isArray(obj.material) ? obj.material : obj.material ? [obj.material] : []) {
        if (!seen.has(material)) { seen.add(material); material.dispose(); }
      }
    });
    renderer.dispose();
  }
  resize(width, height, pixelRatio);
  return { renderer, resize, setRoll, update, render: () => renderer.render(scene, camera), dispose, loadModels, get modelState() { return modelState; } };
}

function makePlaceholderBowl() {
  const root = new THREE.Group();
  const points = [[0,-.17], [2.35,-.17], [2.73,.05], [3,.46], [3.31,1.06], [3.64,1.80], [3.59,1.90], [3.5,1.85], [3.15,1.15], [2.85,.55], [2.6,.16], [2.35,0], [0,0]].map(([r,y]) => new THREE.Vector2(r,y));
  const material = new THREE.MeshPhysicalMaterial({ color: 0xabc5b5, roughness: .24, metalness: .03, clearcoat: .8, clearcoatRoughness: .2, side: THREE.DoubleSide });
  const body = new THREE.Mesh(new THREE.LatheGeometry(points, 96), material);
  body.castShadow = true; body.receiveShadow = true; root.add(body);
  const rim = new THREE.Mesh(new THREE.TorusGeometry(3.565,.036,10,128),new THREE.MeshStandardMaterial({ color:0xc3a469,metalness:.7,roughness:.28 }));
  rim.rotation.x = Math.PI/2; rim.position.y=1.875; root.add(rim);
  return root;
}

function makePlaceholderDie() {
  const root = new THREE.Group();
  const body = new THREE.Mesh(new THREE.BoxGeometry(.515,.515,.515),new THREE.MeshPhysicalMaterial({ color:0xfff9e7,roughness:.3,clearcoat:.65 }));
  body.castShadow=true; body.receiveShadow=true; root.add(body);
  const dotGeometry = new THREE.SphereGeometry(.041,12,8);
  const red = new THREE.MeshStandardMaterial({ color:0xa33129,roughness:.45 });
  const dark = new THREE.MeshStandardMaterial({ color:0x283b31,roughness:.4 });
  const pips = {1:[[0,0]],2:[[-1,1],[1,-1]],3:[[-1,1],[0,0],[1,-1]],4:[[-1,-1],[-1,1],[1,-1],[1,1]],5:[[-1,-1],[-1,1],[0,0],[1,-1],[1,1]],6:[[-1,-1],[-1,0],[-1,1],[1,-1],[1,0],[1,1]]};
  const faces = [{n:1,pos:[0,.259,0],rot:[-Math.PI/2,0,0]},{n:6,pos:[0,-.259,0],rot:[Math.PI/2,0,0]},{n:3,pos:[.259,0,0],rot:[0,Math.PI/2,0]},{n:4,pos:[-.259,0,0],rot:[0,-Math.PI/2,0]},{n:2,pos:[0,0,.259],rot:[0,0,0]},{n:5,pos:[0,0,-.259],rot:[0,Math.PI,0]}];
  for (const face of faces) {
    const group = new THREE.Group(); group.position.fromArray(face.pos); group.rotation.set(...face.rot);
    for(const [x,y] of pips[face.n]) { const pip = new THREE.Mesh(dotGeometry,face.n===1||face.n===4?red:dark);pip.position.set(x*.125,y*.125,0);pip.scale.z=.12;group.add(pip); }
    root.add(group);
  }
  return root;
}
