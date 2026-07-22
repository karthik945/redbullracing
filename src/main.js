import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { DRACOLoader } from "three/addons/loaders/DRACOLoader.js";
import { Water } from "three/addons/objects/Water.js";
import { RectAreaLightUniformsLib } from "three/addons/lights/RectAreaLightUniformsLib.js";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import { ShaderPass } from "three/addons/postprocessing/ShaderPass.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import Lenis from "lenis";

gsap.registerPlugin(ScrollTrigger);
RectAreaLightUniformsLib.init();

/* live-tunable water params (see tuner at bottom of file) */
const waterTune = { distortion: 1.8, alpha: 0.73, sheen: 0.6 };
try { Object.assign(waterTune, JSON.parse(localStorage.getItem("rb19-water") || "{}")); } catch (e) {}

/* buttery inertial scrolling */
const lenis = new Lenis({ lerp: 0.09, smoothWheel: true });
lenis.on("scroll", ScrollTrigger.update);
gsap.ticker.add((time) => lenis.raf(time * 1000));
gsap.ticker.lagSmoothing(0);

/* ================= renderer / scene =================
   Neon dark room: white RB19 sign as the hero light, real water floor,
   blue + white keys. Camera = one continuous single-take flight. */

// coarse-pointer / narrow-viewport devices get lighter render settings —
// phone GPUs can't carry the same shadow/MSAA/pixel-ratio budget as desktop
const isMobile = matchMedia("(pointer: coarse)").matches || window.innerWidth < 768;

const canvas = document.querySelector("#webgl");
const renderer = new THREE.WebGLRenderer({ canvas, antialias: false });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, isMobile ? 1.5 : 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.shadowMap.autoUpdate = false; // static car: bake once

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x050e22);

/* env map built from the room itself */
{
  const env = new THREE.Scene();
  env.background = new THREE.Color(0x000000);
  const signGlow = new THREE.Mesh(
    new THREE.PlaneGeometry(12.6, 6.3),
    new THREE.MeshBasicMaterial({ color: new THREE.Color(2.2, 2.05, 1.9) })
  );
  signGlow.position.set(0, 2.9, -4.4);
  env.add(signGlow);
  const accentGlow = new THREE.Mesh(
    new THREE.PlaneGeometry(3.2, 3.2),
    new THREE.MeshBasicMaterial({ color: new THREE.Color(1.1, 1.7, 3.0), side: THREE.DoubleSide })
  );
  accentGlow.position.set(0.45, 7, 0.5);
  accentGlow.rotation.x = Math.PI / 2;
  env.add(accentGlow);
  const coolCard = new THREE.Mesh(
    new THREE.PlaneGeometry(6, 2.4),
    new THREE.MeshBasicMaterial({ color: new THREE.Color(0.5, 0.65, 1.0) })
  );
  coolCard.position.set(0, 2.4, 10);
  coolCard.rotation.y = Math.PI;
  env.add(coolCard);
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(env, 0.04).texture;
  scene.environmentIntensity = 1.0;
  pmrem.dispose();
  signGlow.geometry.dispose(); signGlow.material.dispose();
  accentGlow.geometry.dispose(); accentGlow.material.dispose();
  coolCard.geometry.dispose(); coolCard.material.dispose();
}

// every camera "beat" below is hand-tuned pos/look coordinates for a
// widescreen (~16:9) frame. A fixed vertical FOV crops the car badly on a
// narrow portrait phone, since horizontal FOV shrinks with aspect ratio.
// This instead holds the HORIZONTAL field of view constant at the design
// aspect, widening the vertical FOV as the viewport narrows so the car
// stays framed the same way regardless of device shape.
const BASE_FOV = 38;
const BASE_ASPECT = 16 / 9;
const BASE_FOV_RAD = THREE.MathUtils.degToRad(BASE_FOV);
const BASE_HFOV_RAD = 2 * Math.atan(Math.tan(BASE_FOV_RAD / 2) * BASE_ASPECT);
function fovForAspect(aspect) {
  const clamped = Math.max(aspect, 0.45); // avoid absurd blow-up on extreme portrait
  return THREE.MathUtils.radToDeg(2 * Math.atan(Math.tan(BASE_HFOV_RAD / 2) / clamped));
}

const camera = new THREE.PerspectiveCamera(
  fovForAspect(window.innerWidth / window.innerHeight),
  window.innerWidth / window.innerHeight,
  0.1,
  200
);

/* ================= water floor ================= */

const waterNormals = new THREE.TextureLoader().load("/waternormals.jpg", (t) => {
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
});
const water = new Water(new THREE.PlaneGeometry(160, 160), {
  textureWidth: isMobile ? 512 : 1024,
  textureHeight: isMobile ? 512 : 1024,
  waterNormals,
  sunDirection: new THREE.Vector3(0, 1, 0),
  sunColor: 0x000000,
  waterColor: 0x0a1c3e,
  distortionScale: 3.4,
  fog: false,
});
water.rotation.x = -Math.PI / 2;
water.material.uniforms.size.value = 9.0;
// black-room ocean: kill the gray ambient, strengthen the mirror reflection
water.material.fragmentShader = water.material.fragmentShader
  .replace("vec3( 0.1 )", "vec3( 0.004 )")
  .replace("reflectionSample * 0.9", "reflectionSample * 1.35");
// semi-transparent surface so submerged objects read through it
water.material.transparent = true;
water.material.uniforms.alpha.value = 0.88;
water.renderOrder = 2;
water.material.needsUpdate = true;
scene.add(water);

/* shared builder for the several soft radial-gradient canvas textures used
   as glows/shadows around the scene (ceiling reflection, contact shadow,
   lamp glow, dust motes) — one implementation instead of four hand-rolled
   copies of the same create-canvas/gradient/fillRect sequence */
function radialGradientTexture(size, stops, innerRadius = 0, outerRadius = size / 2) {
  const c = document.createElement("canvas");
  c.width = c.height = size;
  const ctx = c.getContext("2d");
  const center = size / 2;
  const g = ctx.createRadialGradient(center, center, innerRadius, center, center, outerRadius);
  for (const [offset, color] of stops) g.addColorStop(offset, color);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  return new THREE.CanvasTexture(c);
}

/* dim ceiling glow — gives the water surface something to reflect all the
   way to the frame edges (bright center, soft falloff, never fully dark) */
const ceilingTex = radialGradientTexture(
  512,
  [
    [0, "rgba(30, 55, 110, 1)"],
    [0.5, "rgba(14, 28, 60, 1)"],
    [1, "rgba(4, 9, 22, 1)"],
  ],
  30
);
const ceiling = new THREE.Mesh(
  new THREE.PlaneGeometry(260, 260),
  new THREE.MeshBasicMaterial({ map: ceilingTex, side: THREE.DoubleSide })
);
ceiling.rotation.x = Math.PI / 2;
ceiling.position.y = 14;
ceiling.material.depthWrite = false;
scene.add(ceiling);
// the ceiling exists ONLY for the water's reflection pass — the water
// renders its mirror inside onBeforeRender, so show it just for that
ceiling.visible = false;
{
  const waterOBR = water.onBeforeRender;
  water.onBeforeRender = function (...args) {
    ceiling.visible = true;
    waterOBR.apply(this, args);
    ceiling.visible = false;
  };
}

/* contact shadow */
const shadowTex = radialGradientTexture(
  512,
  [
    [0, "rgba(0,0,0,0.75)"],
    [0.5, "rgba(0,0,0,0.35)"],
    [1, "rgba(0,0,0,0)"],
  ],
  20,
  250
);
const contactShadow = new THREE.Mesh(
  new THREE.PlaneGeometry(9, 9),
  new THREE.MeshBasicMaterial({
    map: shadowTex,
    transparent: true,
    depthWrite: false,
  })
);
contactShadow.rotation.x = -Math.PI / 2;
contactShadow.position.y = 0.015;
contactShadow.scale.set(0.62, 1, 1);
contactShadow.renderOrder = 5;
// added to carGroup once it exists, below — keeps the shadow glued under
// the car through the mouse-parallax nudge instead of staying world-fixed

/* ================= lights (no sign — top-view hero) ================= */

const signLight = new THREE.RectAreaLight(0xfff4ec, 1.5, 12.6, 6.3);
signLight.position.set(0, 2.9, -4.3);
signLight.lookAt(0, 0.8, 4);
scene.add(signLight);

const signBounce = new THREE.PointLight(0xfff4ec, 1.2, 8, 2);
signBounce.position.set(0, 0.6, -3.2);
scene.add(signBounce);

/* white key from above */
const whiteKey = new THREE.SpotLight(0xffffff, 300, 0, Math.PI / 6, 0.5, 2);
whiteKey.position.set(-1.2, 7.2, 2.2);
whiteKey.target.position.set(0, 0.6, 0.3);
whiteKey.castShadow = true;
whiteKey.shadow.mapSize.set(isMobile ? 512 : 1024, isMobile ? 512 : 1024);
whiteKey.shadow.bias = -0.0002;
scene.add(whiteKey, whiteKey.target);

/* blue accent beam — matches the hero's dome/glow palette */
const accentSpot = new THREE.SpotLight(0x5fa0ff, 110, 0, Math.PI / 7.2, 0.45, 2);
accentSpot.position.set(0.45, 6.4, 0.5);
accentSpot.target.position.set(0, 0.7, 0.4);
scene.add(accentSpot, accentSpot.target);

const beamMat = new THREE.ShaderMaterial({
  transparent: true,
  depthWrite: false,
  depthTest: false, // the beam crosses the water plane — without this the
                     // water's depth silently clips it into a hard edge
  blending: THREE.AdditiveBlending,
  side: THREE.DoubleSide,
  uniforms: { uColor: { value: new THREE.Color(0x6fb0ff) } },
  vertexShader: `
    varying vec2 vUv;
    varying vec3 vNormalW, vViewW;
    void main() {
      vUv = uv;
      vec4 wp = modelMatrix * vec4(position, 1.0);
      vNormalW = normalize(mat3(modelMatrix) * normal);
      vViewW = normalize(cameraPosition - wp.xyz);
      gl_Position = projectionMatrix * viewMatrix * wp;
    }`,
  fragmentShader: `
    varying vec2 vUv;
    varying vec3 vNormalW, vViewW;
    uniform vec3 uColor;
    void main() {
      // fade in from the floor, fade out well before the geometric top edge
      float len = smoothstep(0.05, 0.55, vUv.y) * (1.0 - smoothstep(0.6, 0.92, vUv.y));
      float edge = pow(abs(dot(vNormalW, vViewW)), 1.6);
      gl_FragColor = vec4(uColor, len * edge * 0.13);
    }`,
});
const beam = new THREE.Mesh(new THREE.CylinderGeometry(2.7, 0.28, 9.5, 48, 1, true), beamMat);
beam.position.set(0.35, 5.1, 0.45);
beam.renderOrder = 3; // draw after the water (renderOrder 2) so it glows
                       // over the surface instead of being clipped by it
scene.add(beam);

const frontFill = new THREE.DirectionalLight(0xe6edff, 0.5);
frontFill.position.set(0, 3, 9);
scene.add(frontFill);

/* soft blue lamp glow at the beam's source — a sprite has no geometry
   edges, so the overhead light never cuts off at any camera angle.
   Falls fully to zero alpha by 55% of the radius, so the glow is already
   black well before it reaches the sprite's own edge — it can never be
   visibly "cut off" by anything, frame included. */
const lampTex = radialGradientTexture(
  256,
  [
    [0, "rgba(140, 185, 255, 0.8)"],
    [0.25, "rgba(110, 160, 250, 0.18)"],
    [0.55, "rgba(100, 150, 245, 0)"],
    [1, "rgba(100, 150, 245, 0)"],
  ],
  4
);
const lampGlow = new THREE.Sprite(
  new THREE.SpriteMaterial({
    map: lampTex,
    transparent: true,
    depthWrite: false,
    depthTest: false,
    blending: THREE.AdditiveBlending,
  })
);
// lowered to sit near the actual light source (accentSpot is at y=6.4)
// instead of floating high enough to graze the top of the viewport
lampGlow.position.set(0.45, 6.7, 0.45);
lampGlow.scale.set(6, 3.6, 1);
scene.add(lampGlow);

const hemi = new THREE.HemisphereLight(0x0e1428, 0x020204, 0.25);
scene.add(hemi);

/* right-side accent for the rear/floor beat (lights the diffuser side) */
const rearAccent = new THREE.SpotLight(0xdfe8ff, 0, 0, Math.PI / 5.5, 0.55, 2);
rearAccent.position.set(5.5, 3.4, -5.6);
rearAccent.target.position.set(0, 0.7, -2.2);
scene.add(rearAccent, rearAccent.target);

/* ================= hero-only: elevated dramatic look =================
   New wide-angle hero composition (from hero-lab prototyping): a real
   enveloping dome (not a flat glow plane — that showed a hard silhouette
   edge against the black background) plus drifting dust, both hero-
   exclusive — driven by heroFade exactly like the removed searchlight and
   underwater text used to be, so they fade out identically once you
   scroll into the front-wing section. Nothing else in the scene is touched. */

const heroDomeMat = new THREE.ShaderMaterial({
  side: THREE.BackSide,
  transparent: true,
  depthWrite: false,
  uniforms: {
    uOpacity: { value: 0 },
    uGlowDir: { value: new THREE.Vector3(-0.5, 0.33, -0.8).normalize() },
  },
  vertexShader: `
    varying vec3 vWorldDir;
    void main() {
      vWorldDir = normalize(position);
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }`,
  fragmentShader: `
    varying vec3 vWorldDir;
    uniform vec3 uGlowDir;
    uniform float uOpacity;
    void main() {
      float up = clamp(vWorldDir.y * 0.5 + 0.5, 0.0, 1.0);
      vec3 top = vec3(0.09, 0.20, 0.38);
      vec3 mid = vec3(0.035, 0.085, 0.17);
      vec3 bottom = vec3(0.001, 0.006, 0.018);
      vec3 base = mix(bottom, mid, smoothstep(0.0, 0.55, up));
      base = mix(base, top, smoothstep(0.55, 1.0, up));
      float glow = pow(max(dot(vWorldDir, uGlowDir), 0.0), 3.2);
      vec3 col = base + vec3(0.55, 0.72, 1.0) * glow * 0.9;
      gl_FragColor = vec4(col, uOpacity);
    }`,
});
const heroDome = new THREE.Mesh(new THREE.SphereGeometry(60, 32, 24), heroDomeMat);
scene.add(heroDome);

const heroRim = new THREE.DirectionalLight(0x4f8dff, 0);
heroRim.position.set(-5, 3.5, -6.5);
scene.add(heroRim);

const dustTex = radialGradientTexture(64, [
  [0, "rgba(255,255,255,0.9)"],
  [1, "rgba(255,255,255,0)"],
]);

const DUST_COUNT = 650;
const dustGeo = new THREE.BufferGeometry();
const dustPos = new Float32Array(DUST_COUNT * 3);
const dustSeed = new Float32Array(DUST_COUNT);
for (let i = 0; i < DUST_COUNT; i++) {
  const r = Math.sqrt(Math.random()) * 6.5;
  const a = Math.random() * Math.PI * 2;
  dustPos[i * 3 + 0] = Math.cos(a) * r;
  dustPos[i * 3 + 1] = 0.3 + Math.random() * 8.5;
  dustPos[i * 3 + 2] = Math.sin(a) * r - 1.2;
  dustSeed[i] = Math.random();
}
dustGeo.setAttribute("position", new THREE.BufferAttribute(dustPos, 3));
const dustMat = new THREE.PointsMaterial({
  size: 0.05,
  map: dustTex,
  transparent: true,
  opacity: 0,
  depthWrite: false,
  blending: THREE.AdditiveBlending,
  color: new THREE.Color(0xcfe3ff),
});
const dust = new THREE.Points(dustGeo, dustMat);
scene.add(dust);
const dustPosAttr = dustGeo.getAttribute("position");

function updateDust(t, dt, fade) {
  dust.visible = fade > 0.01;
  if (!dust.visible) return;
  dustMat.opacity = 0.45 * fade;
  for (let i = 0; i < DUST_COUNT; i++) {
    const seed = dustSeed[i];
    let y = dustPosAttr.getY(i) - (0.05 + seed * 0.08) * dt;
    if (y < 1.0) y = 7.3 + seed * 0.5;
    const drift = Math.sin(t * 0.4 + seed * 40.0) * 0.15 * dt;
    dustPosAttr.setY(i, y);
    dustPosAttr.setX(i, dustPosAttr.getX(i) + drift);
  }
  dustPosAttr.needsUpdate = true;
}

/* ================= model ================= */

const CAR_LENGTH = 5.63; // RB19
const carGroup = new THREE.Group();
scene.add(carGroup);
carGroup.add(contactShadow);

const explodeParts = [];
const calloutTargets = {};
const partMatchers = {
  frontwing: /frontwing/i,
  rearwing: /rearwing/i,
  tyre: /tyre/i,
  wheel: /steering/i,
  diffuser: /diffuser/i,
};

const materialCache = new Map();
function upgradeMaterial(orig) {
  if (materialCache.has(orig.uuid)) return materialCache.get(orig.uuid);
  const name = orig.name || "";
  const base = {
    map: orig.map || null,
    normalMap: orig.normalMap || null,
    metalnessMap: orig.metalnessMap || null,
    roughnessMap: orig.roughnessMap || null,
    color: orig.color ? orig.color.clone() : new THREE.Color(0xffffff),
    name,
  };
  let mat;
  if (/body|mirrors|FER_BLGLOWA|nosecone/i.test(name)) {
    mat = new THREE.MeshPhysicalMaterial({
      ...base,
      roughness: base.roughnessMap ? 1.0 : 0.3,
      metalness: base.metalnessMap ? 1.0 : 0.35,
      clearcoat: 1.0,
      clearcoatRoughness: 0.05,
      envMapIntensity: 0.6,
    });
  } else if (/carbon|cockpit_cf|steering_carbon/i.test(name)) {
    mat = new THREE.MeshPhysicalMaterial({
      ...base,
      roughness: 0.42,
      metalness: 0.1,
      clearcoat: 0.7,
      clearcoatRoughness: 0.18,
      envMapIntensity: 0.7,
    });
  } else if (/rims|^Metal(\.\d+)?$|BRAKE/i.test(name)) {
    mat = new THREE.MeshStandardMaterial({
      ...base,
      roughness: /BRAKE/i.test(name) ? 0.55 : 0.22,
      metalness: 1.0,
      envMapIntensity: 1.0,
    });
  } else if (/Tyre|tyre/i.test(name)) {
    mat = new THREE.MeshStandardMaterial({ ...base, roughness: 0.92, metalness: 0, envMapIntensity: 0.2 });
  } else if (/glass|lens/i.test(name)) {
    mat = new THREE.MeshPhysicalMaterial({
      ...base,
      roughness: 0.05,
      metalness: 0,
      transparent: true,
      opacity: 0.35,
      envMapIntensity: 0.6,
    });
  } else {
    mat = new THREE.MeshStandardMaterial({ ...base, roughness: 0.5, metalness: 0.4, envMapIntensity: 0.4 });
  }
  materialCache.set(orig.uuid, mat);
  return mat;
}

const draco = new DRACOLoader();
draco.setDecoderPath("https://www.gstatic.com/draco/versioned/decoders/1.5.6/");
const loader = new GLTFLoader();
loader.setDRACOLoader(draco);

const loaderEl = document.getElementById("loader");
const loaderBright = document.getElementById("loader-logo-bright");
const LOADER_MIN_MS = 2500;
const loadStartTime = performance.now();

// xhr.total is frequently 0/unset (no Content-Length, cached response,
// single-chunk transfer) — when that happens the reveal never advances
// past its initial hidden state. A time-based estimate guarantees the
// logo visibly fills regardless of whether real byte-progress exists;
// real progress (when available) can still push it ahead of the estimate.
let loaderRealFrac = 0;
function setLoaderFill(frac) {
  const pct = Math.max(0, Math.min(1, frac)) * 100;
  loaderBright.style.clipPath = `inset(0 ${100 - pct}% 0 0)`;
}
const loaderTimer = setInterval(() => {
  const elapsed = performance.now() - loadStartTime;
  const timeFrac = Math.min(elapsed / LOADER_MIN_MS, 0.96); // holds just under 100% until the real load confirms
  setLoaderFill(Math.max(timeFrac, loaderRealFrac));
}, 50);

function dismissLoader(onDone) {
  const elapsed = performance.now() - loadStartTime;
  const wait = Math.max(0, LOADER_MIN_MS - elapsed);
  setTimeout(() => {
    clearInterval(loaderTimer);
    setLoaderFill(1);
    loaderEl.classList.add("done");
    onDone?.();
  }, wait);
}

loader.load(
  "/rb19.glb",
  (gltf) => {
    const model = gltf.scene;
    carGroup.add(model);

    let box = new THREE.Box3().setFromObject(model);
    let size = box.getSize(new THREE.Vector3());
    if (size.x > size.z) model.rotation.y = Math.PI / 2;
    box = new THREE.Box3().setFromObject(model);
    size = box.getSize(new THREE.Vector3());
    model.scale.setScalar(CAR_LENGTH / Math.max(size.x, size.y, size.z));
    box = new THREE.Box3().setFromObject(model);
    const center = box.getCenter(new THREE.Vector3());
    model.position.x -= center.x;
    model.position.z -= center.z;
    model.position.y -= box.min.y;

    const maxAniso = renderer.capabilities.getMaxAnisotropy();
    model.traverse((o) => {
      if (!o.isMesh) return;
      o.material = upgradeMaterial(o.material);
      o.castShadow = true;
      o.receiveShadow = true;
      for (const key of ["map", "normalMap", "emissiveMap", "metalnessMap", "roughnessMap"]) {
        if (o.material[key]) o.material[key].anisotropy = maxAniso;
      }
    });

    const carCenter = new THREE.Vector3(0, 0.55, 0);
    model.updateWorldMatrix(true, true);
    model.traverse((o) => {
      if (!o.isMesh) return;
      for (const [key, re] of Object.entries(partMatchers)) {
        if (!calloutTargets[key] && re.test(o.name)) calloutTargets[key] = o;
      }
      const meshBox = new THREE.Box3().setFromObject(o);
      if (meshBox.isEmpty()) return;
      const meshCenter = meshBox.getCenter(new THREE.Vector3());
      const dirWorld = meshCenter.clone().sub(carCenter);
      dirWorld.y = Math.max(dirWorld.y, 0.08);
      const dist = dirWorld.length();
      dirWorld.normalize();
      const parentInv = new THREE.Matrix4().copy(o.parent.matrixWorld).invert();
      explodeParts.push({
        mesh: o,
        basePos: o.position.clone(),
        dirParent: dirWorld.clone().transformDirection(parentInv),
        strength: Math.min(0.42 + dist * 0.34, 1.3),
      });
    });

    renderer.shadowMap.needsUpdate = true;
    dismissLoader(introPlay);
  },
  (xhr) => {
    if (xhr.total) loaderRealFrac = xhr.loaded / xhr.total;
  },
  (err) => {
    clearInterval(loaderTimer);
    console.error("GLB load failed", err);
    // logo-only loader has no text in the golden path — only inject a
    // message for this edge case, so failure is still legible
    const msg = document.createElement("span");
    msg.className = "mono loader-error";
    msg.textContent = "LOAD FAILED — REFRESH";
    loaderEl.appendChild(msg);
  }
);

/* ================= post: bloom + grade + sharpen ================= */

const composer = new EffectComposer(
  renderer,
  new THREE.WebGLRenderTarget(window.innerWidth, window.innerHeight, {
    samples: isMobile ? 0 : 2, // 4x MSAA + bloom + the unsharp-mask pass below
                // was paying for anti-aliasing twice over; 2x still reads
                // clean on desktop, and mobile GPUs can't afford MSAA at all
    type: THREE.HalfFloatType,
  })
);
composer.addPass(new RenderPass(scene, camera));
const bloom = new UnrealBloomPass(new THREE.Vector2(window.innerWidth, window.innerHeight), 0.14, 0.4, 1.0);
composer.addPass(bloom);

const gradePass = new ShaderPass({
  uniforms: {
    tDiffuse: { value: null },
    uTexel: { value: new THREE.Vector2(1 / window.innerWidth, 1 / window.innerHeight) },
  },
  vertexShader: `
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: `
    uniform sampler2D tDiffuse;
    uniform vec2 uTexel;
    varying vec2 vUv;
    void main() {
      vec4 c = texture2D(tDiffuse, vUv);
      // unsharp mask for clarity
      vec3 blur = ( texture2D(tDiffuse, vUv + vec2( uTexel.x, 0.0)).rgb
                  + texture2D(tDiffuse, vUv + vec2(-uTexel.x, 0.0)).rgb
                  + texture2D(tDiffuse, vUv + vec2(0.0,  uTexel.y)).rgb
                  + texture2D(tDiffuse, vUv + vec2(0.0, -uTexel.y)).rgb ) * 0.25;
      c.rgb = clamp(c.rgb + (c.rgb - blur) * 0.6, 0.0, 64.0);
      c.rgb *= vec3(0.98, 1.0, 1.03);
      c.rgb = mix(c.rgb, c.rgb * vec3(0.96, 0.98, 1.06), 0.25 * (1.0 - smoothstep(0.0, 0.5, c.r)));
      float d = distance(vUv, vec2(0.5, 0.46));
      c.rgb *= smoothstep(0.95, 0.35, d) * 0.35 + 0.65;
      gl_FragColor = c;
    }`,
});
composer.addPass(gradePass);
composer.addPass(new OutputPass());

/* ================= single-take camera flight =================
   One continuous spline through the story beats; scroll drives progress,
   the camera eases toward it every frame (damped — no scrub jitter). */

/* look.x offsets push the car sideways on screen so the text
   panels always fall into black space (panel left => car right) */
const beats = [
  { el: "#hero",           pos: [3.8, 5.9, 7.4],    look: [0, 0.55, -0.1] }, // elevated 3/4, dramatic look-down
  { el: "#shot-frontwing", pos: [1.5, 3.5, 5.9],    look: [-0.8511347302152529, 0.20330249601741043, 1.997890180630147] },  // high front view, car right
  { el: "#shot-cockpit",   pos: [2.6, 3.2, 0.6],    look: [-1.25, 0.25, 0.2] }, // car raised (as asked); x untouched
  { el: "#shot-rearwing",  pos: [-1.9, 2.4, -5.3],  look: [-1.35, 1.0, -2.2] }, // car left, text right
  { el: "#shot-diffuser",  pos: [1.9, 0.7, -5.5],   look: [0.8984686623891467, 0.5007719836688274, -2.4004441744764797] },   // car untouched; only text moved left
  { el: "#exploded",       pos: [-6.8, 5.2, -9.8],  look: [0.6522187720162681, -0.015366536541894321, -0.23141340437226093] },
  { el: "#stats",          pos: [9.8, 1.2, 0.6],    look: [-0.05079550063800384, 1.1420031139712665, 0.09023585784388652] },
  { el: "#closer",         pos: [1.5, 0.8, 6.8],    look: [-0.2062473988981952, 1.389750463683058, 0.35174748023560704] },
];

let posCurve = null;
let lookCurve = null;
let beatProgress = []; // scroll progress [0..1] where each beat peaks
const panelPins = {}; // "#shot-frontwing" -> its pin ScrollTrigger, filled in below
// scrollHeight is a layout-dependent read (forces reflow) — cache it here,
// where layout is already being re-measured, instead of every render frame
let cachedDocH = 0;

/* ================= scroll scrubber (ticks) =================
   ticks are laid out at the beats' REAL scroll fractions (not evenly
   spaced), so they line up exactly with where the camera actually stops */
const scrubberTrack = document.getElementById("scrubber-track");
const SCRUBBER_MINOR_TICKS_PER_GAP = 3;
let scrubberPlayhead = null;
function buildScrubberTicks() {
  scrubberTrack.innerHTML = "";
  const n = beatProgress.length;
  for (let i = 0; i < n; i++) {
    const major = document.createElement("div");
    major.className = "scrubber-tick major";
    major.style.left = beatProgress[i] * 100 + "%";
    scrubberTrack.appendChild(major);
    if (i < n - 1) {
      const a = beatProgress[i], b = beatProgress[i + 1];
      for (let k = 1; k <= SCRUBBER_MINOR_TICKS_PER_GAP; k++) {
        const frac = a + ((b - a) * k) / (SCRUBBER_MINOR_TICKS_PER_GAP + 1);
        const minor = document.createElement("div");
        minor.className = "scrubber-tick";
        minor.style.left = frac * 100 + "%";
        scrubberTrack.appendChild(minor);
      }
    }
  }
  scrubberPlayhead = document.createElement("div");
  scrubberPlayhead.className = "scrubber-playhead";
  scrubberTrack.appendChild(scrubberPlayhead);
}

function buildFlight() {
  const docH = cachedDocH = document.documentElement.scrollHeight - window.innerHeight;
  beatProgress = beats.map((b, i) => {
    if (i === 0) return 0;
    // once a beat's panel is pinned, frame the camera on the MIDDLE of that
    // pinned dwell — that's the whole point of the hard stop
    const pin = panelPins[b.el];
    if (pin) {
      const mid = (pin.start + pin.end) / 2;
      return Math.min(Math.max(mid / docH, 0), 1);
    }
    const el = document.querySelector(b.el);
    if (!el) return i / (beats.length - 1); // markup drift: fall back to an even spread
    // dead center of the section — matches the pinned-shot midpoint math,
    // so consecutive same-type sections land equal scroll distance apart
    const mid = el.offsetTop + el.offsetHeight * 0.5 - window.innerHeight * 0.5;
    return Math.min(Math.max(mid / docH, 0), 1);
  });
  // the last beat is NOT forced to the very end of the document — it uses
  // the same centered-midpoint rule as every other beat, so its interval
  // is sized the same as the rest; curveT() already holds the camera at
  // its final pose for any scroll past this point, so the remaining
  // trailing scroll (the back half of #closer + footer) just reads as an
  // outro hold instead of stretching the last beat's gap to cover it
  posCurve = new THREE.CatmullRomCurve3(beats.map((b) => new THREE.Vector3(...b.pos)), false, "centripetal", 0.5);
  lookCurve = new THREE.CatmullRomCurve3(beats.map((b) => new THREE.Vector3(...b.look)), false, "centripetal", 0.5);
  buildScrubberTicks();
}
buildFlight();
// every ScrollTrigger layout pass (resize, pin creation, font load, etc.)
// re-measures — keep the camera's beat table in sync with it
ScrollTrigger.addEventListener("refresh", buildFlight);

/* magnetic stops: scroll settles on the nearest story beat */
ScrollTrigger.create({
  start: 0,
  end: () => ScrollTrigger.maxScroll(window),
  snap: {
    snapTo: (value) => {
      // settle only when already very close to a beat — never yank across distance
      let best = beatProgress[0];
      for (const bp of beatProgress) if (Math.abs(bp - value) < Math.abs(best - value)) best = bp;
      return Math.abs(best - value) < 0.02 ? best : value;
    },
    duration: { min: 0.2, max: 0.45 },
    delay: 0.15,
    ease: "power1.out",
  },
});

/* map scroll progress -> curve parameter via the beat table */
function curveT(p) {
  for (let i = 1; i < beatProgress.length; i++) {
    if (p <= beatProgress[i]) {
      const span = beatProgress[i] - beatProgress[i - 1] || 1;
      const local = (p - beatProgress[i - 1]) / span;
      // ease each leg slightly so the camera lingers on beats
      const eased = local * local * (3 - 2 * local);
      return (i - 1 + eased) / (beatProgress.length - 1);
    }
  }
  return 1;
}

const camPos = new THREE.Vector3(3.8, 5.9, 7.4);
const camLook = new THREE.Vector3(0, 0.55, -0.1);
const targetPos = new THREE.Vector3();
const targetLook = new THREE.Vector3();
let heroFade = 1;
let introRadiusBoost = 1;

/* ================= mouse parallax — subtle, hero-only =================
   Hover the cursor anywhere over the hero and the car nudges slightly
   toward it, like it's reacting to your attention. Damped, so it never
   snaps; tiny magnitudes, so it reads as alive rather than as an obvious
   effect. Scaled by heroFade — same hero-only fade every other piece of
   hero dressing uses — so it never fights the pinned story panels, the
   exploded-view callouts, or the tuner's own drag interactions past the
   hero. Skipped on touch devices: there's no hover there, and the first
   touch-move samples before a scroll gesture is recognized would otherwise
   read as a one-off cursor position and snap the car toward it. */
const mouseTarget = new THREE.Vector2(0, 0); // raw target, normalized -1..1
const parallax = new THREE.Vector2(0, 0); // damped
if (!isMobile) {
  window.addEventListener("pointermove", (e) => {
    mouseTarget.set((e.clientX / window.innerWidth) * 2 - 1, (e.clientY / window.innerHeight) * 2 - 1);
  });
}

let lastParallaxShadowBucket = -1;

function updateCamera(t, dt) {
  const p = Math.min(Math.max(window.scrollY / cachedDocH, 0), 1);
  const ct = curveT(p);
  posCurve.getPoint(ct, targetPos);
  lookCurve.getPoint(ct, targetLook);

  heroFade = Math.max(0, 1 - p * 14);

  // idle sway, strongest at the hero, gone once the flight starts
  const idle = Math.max(0, 1 - p * 12);
  targetPos.x += Math.sin(t * 0.25) * 0.2 * idle;
  targetPos.z += Math.sin(t * 0.18) * 0.12 * idle;

  // intro dolly-in
  targetPos.multiplyScalar(introRadiusBoost);

  // damped chase — quick settle so frames lock once you stop scrolling
  const k = 1 - Math.exp(-dt * 6.5);
  camPos.lerp(targetPos, k);
  camLook.lerp(targetLook, k);
  camera.position.copy(camPos);
  camera.lookAt(camLook);

  // mouse parallax — same damped-chase feel as the camera, just much smaller,
  // and scaled down to nothing once heroFade fades out
  const pk = 1 - Math.exp(-dt * 4);
  parallax.lerp(mouseTarget, pk);
  carGroup.position.x = parallax.x * 0.15 * heroFade;
  carGroup.position.z = -parallax.y * 0.1 * heroFade;
  carGroup.rotation.y = parallax.x * 0.02 * heroFade;

  // the car keeps moving under the parallax while heroFade is up, but the
  // shadow map only rebakes on explicit triggers elsewhere — re-arm it here
  // too, throttled like the old roaming-searchlight rebake used to be
  if (heroFade > 0.01) {
    const bucket = Math.floor(t * 30);
    if (bucket !== lastParallaxShadowBucket) {
      lastParallaxShadowBucket = bucket;
      renderer.shadowMap.needsUpdate = true;
    }
  }

  // hero stays pure black-and-white — the accent light belongs to the later beats
  accentSpot.intensity = 110 * (1 - heroFade);
  beam.visible = heroFade < 0.4;
  lampGlow.material.opacity = 1 - heroFade;
  lampGlow.visible = heroFade < 0.9;

  // new elevated-angle hero dressing — same hero-only fade as everything else
  heroDomeMat.uniforms.uOpacity.value = heroFade;
  heroDome.visible = heroFade > 0.01;
  heroRim.intensity = 1.4 * heroFade;
  updateDust(t, dt, heroFade);

  // beat-specific dressing: floor/diffuser shot gets a right-side accent
  // and calmer water so the reflection doesn't fight the car
  const diffuserP = beatProgress[4] ?? 0.5;
  const nearDiffuser = Math.max(0, 1 - Math.abs(p - diffuserP) * 9);
  rearAccent.intensity = 170 * nearDiffuser;
  water.material.uniforms.distortionScale.value = waterTune.distortion * (1 - nearDiffuser * 0.7);
  water.material.uniforms.size.value = 9.0 + nearDiffuser * 5.0;
  return p;
}

/* ================= intro ================= */

function introPlay() {
  // a reload can land mid-scroll (default browser scroll restoration) —
  // the hero-only entrance fade and camera dolly-zoom must not replay there
  if (window.scrollY > window.innerHeight * 0.5) return;
  gsap.from(".hero-sub, .scroll-cue, nav", { opacity: 0, y: 18, stagger: 0.12, duration: 0.9, ease: "power2.out", delay: 0.7 });
  introRadiusBoost = 1.45;
  gsap.to({ v: 1.45 }, {
    v: 1, duration: 2.4, ease: "power3.out",
    onUpdate: function () { introRadiusBoost = this.targets()[0].v; },
  });
}

/* ================= panel reveals (non-pinned sections) ================= */

gsap.utils.toArray(".exploded-head, #stats, #closer").forEach((el) => {
  gsap.from(el, {
    opacity: 0, y: 40, duration: 0.9, ease: "power2.out",
    scrollTrigger: { trigger: el, start: "top 78%" },
  });
});

/* ================= hard-stop story panels =================
   Each panel PINS in place for a fixed scroll distance: your scroll
   input is consumed by that section — the text physically cannot drift
   — until it has held on screen, then it releases to the next beat.
   Pin + a scrub timeline is one self-contained trigger per panel, so
   there's no separate reveal/fade trigger to fall out of sync with it
   (that dual-trigger setup was why text could vanish on scroll-back). */
gsap.utils.toArray(".shot").forEach((shotEl) => {
  const panelEl = shotEl.querySelector(".panel");
  if (!panelEl) return;
  const tl = gsap.timeline({
    scrollTrigger: {
      trigger: panelEl,
      start: "top 55%",
      end: "+=85%",
      pin: true,
      pinSpacing: true,
      anticipatePin: 1,
      scrub: true,
    },
  });
  tl.fromTo(panelEl, { opacity: 0, y: 28 }, { opacity: 1, y: 0, duration: 0.18, ease: "power2.out" })
    .to(panelEl, { opacity: 1, duration: 0.64 }) // the hard stop: fully visible, fully locked
    .to(panelEl, { opacity: 0, y: -22, duration: 0.18, ease: "power2.in" });
  panelPins["#" + shotEl.id] = tl.scrollTrigger;
});

// pins change document height — resolve layout once, then re-derive the
// camera's beat table (and stop-timing) from the real, final positions
ScrollTrigger.refresh();
buildFlight();

gsap.utils.toArray(".stat-n").forEach((el) => {
  const target = +el.dataset.count;
  const obj = { v: 0 };
  gsap.to(obj, {
    v: target, duration: 1.6, ease: "power2.out",
    scrollTrigger: { trigger: "#stats", start: "top 65%" },
    onUpdate: () => (el.textContent = Math.round(obj.v)),
  });
});

/* ================= explode + callouts ================= */

const calloutEls = {};
document.querySelectorAll(".callout").forEach((el) => (calloutEls[el.dataset.part] = el));
const projV = new THREE.Vector3();
let explode = 0;

let prevExplode = -1;
function updateExplode(p) {
  // explode peaks through the anatomy section
  const a = beatProgress[5] ?? 0.6;
  const b = beatProgress[6] ?? 0.8;
  const mid = (a + b) / 2;
  const half = (b - a) / 2 || 0.1;
  explode = Math.max(0, 1 - Math.abs(p - mid) / half);
  if (explodeParts.length < 10) return; // single-mesh model stays whole
  // shadowMap.autoUpdate is off (static car, baked once) — only re-bake
  // when parts actually moved, instead of forcing it dirty every frame
  if (Math.abs(explode - prevExplode) < 1e-4) return;
  prevExplode = explode;
  const e = gsap.parseEase("power2.inOut")(explode);
  for (const part of explodeParts) {
    part.mesh.position.copy(part.basePos).addScaledVector(part.dirParent, e * part.strength);
  }
  contactShadow.material.opacity = 1 - e * 0.9;
  renderer.shadowMap.needsUpdate = true;
}

let calloutsWereVisible = true;
function updateCallouts() {
  const visible = explode > 0.45 && explodeParts.length >= 10;
  // skip the loop once hidden, which is true for the vast majority of the
  // scroll range (only the anatomy beat's explode peak shows these)
  if (!visible) {
    if (calloutsWereVisible) {
      for (const el of Object.values(calloutEls)) el.style.opacity = 0;
      calloutsWereVisible = false;
    }
    return;
  }
  calloutsWereVisible = true;
  for (const [key, el] of Object.entries(calloutEls)) {
    const mesh = calloutTargets[key];
    if (!mesh) { el.style.opacity = 0; continue; }
    mesh.getWorldPosition(projV);
    projV.project(camera);
    if (projV.z > 1) { el.style.opacity = 0; continue; }
    el.style.opacity = 1;
    el.style.transform = `translate(${((projV.x + 1) / 2) * window.innerWidth}px, ${((1 - projV.y) / 2) * window.innerHeight}px)`;
  }
}

/* ================= loop / resize ================= */

const clock = new THREE.Clock();
let prevT = 0;
renderer.setAnimationLoop(() => {
  const t = clock.getElapsedTime();
  const dt = Math.min(t - prevT, 0.05);
  prevT = t;
  water.material.uniforms.time.value = t * 0.55;
  const p = updateCamera(t, dt);
  updateExplode(p);
  updateCallouts();
  updateScrubber(p);
  composer.render();
});

window.addEventListener("resize", () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.fov = fovForAspect(camera.aspect); // re-fit on rotation/resize
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
  composer.setSize(window.innerWidth, window.innerHeight);
  gradePass.uniforms.uTexel.value.set(1 / window.innerWidth, 1 / window.innerHeight);
});

/* ================= scroll scrubber (playhead + drag) ================= */
const scrubberEl = document.getElementById("scrubber");
const scrubberLabel = document.getElementById("scrubber-label");

function updateScrubber(p) {
  // only relevant once you've left the hero/first screen
  scrubberEl.classList.toggle("scrubber-hidden", heroFade > 0.05);
  if (scrubberPlayhead) scrubberPlayhead.style.left = p * 100 + "%";
  let nearest = 0;
  for (let i = 1; i < beatProgress.length; i++) {
    if (Math.abs(beatProgress[i] - p) < Math.abs(beatProgress[nearest] - p)) nearest = i;
  }
  scrubberLabel.textContent = "G" + (nearest + 1);
}

{
  let dragging = false;
  const fractionFromEvent = (e) => {
    const rect = scrubberTrack.getBoundingClientRect();
    const x = (e.touches ? e.touches[0].clientX : e.clientX) - rect.left;
    return Math.min(Math.max(x / rect.width, 0), 1);
  };
  const onMove = (e) => {
    if (!dragging) return;
    e.preventDefault();
    lenis.scrollTo(fractionFromEvent(e) * cachedDocH, { immediate: true });
  };
  const onUp = () => {
    if (!dragging) return;
    dragging = false;
    scrubberEl.classList.remove("dragging");
    window.removeEventListener("pointermove", onMove);
    window.removeEventListener("pointerup", onUp);
    // release always snaps to the nearest beat, not just within a threshold
    const p = Math.min(Math.max(window.scrollY / cachedDocH, 0), 1);
    let nearest = 0;
    for (let i = 1; i < beatProgress.length; i++) {
      if (Math.abs(beatProgress[i] - p) < Math.abs(beatProgress[nearest] - p)) nearest = i;
    }
    lenis.scrollTo(beatProgress[nearest] * cachedDocH, { duration: 0.9 });
  };
  scrubberEl.addEventListener("pointerdown", (e) => {
    dragging = true;
    scrubberEl.classList.add("dragging");
    onMove(e);
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  });
}

/* ================= nav / footer links ================= */
document.getElementById("nav-home")?.addEventListener("click", (e) => {
  e.preventDefault();
  lenis.scrollTo(0, { duration: 1.2 });
});
{
  const merchBtn = document.getElementById("nav-merch");
  const dropdown = document.getElementById("nav-dropdown");
  if (merchBtn && dropdown) {
    const closeDropdown = () => {
      dropdown.classList.remove("open");
      merchBtn.setAttribute("aria-expanded", "false");
    };
    merchBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      const open = dropdown.classList.toggle("open");
      merchBtn.setAttribute("aria-expanded", String(open));
    });
    dropdown.querySelectorAll("a").forEach((a) => {
      a.addEventListener("click", (e) => {
        e.preventDefault();
        closeDropdown();
        const target = document.querySelector(a.getAttribute("href"));
        if (target) lenis.scrollTo(target, { duration: 1.2 });
      });
    });
    window.addEventListener("click", (e) => {
      if (!e.target.closest("#nav-merch-wrap")) closeDropdown();
    });
    window.addEventListener("keydown", (e) => {
      if (e.key === "Escape") closeDropdown();
    });
  }
}
document.querySelectorAll(".footer-merch-link").forEach((a) => {
  a.addEventListener("click", (e) => {
    e.preventDefault();
    const target = document.querySelector(a.getAttribute("href"));
    if (target) lenis.scrollTo(target, { duration: 1.2 });
  });
});
// cart is a stub — real checkout is a later phase, inert for now
document.getElementById("nav-cart")?.addEventListener("click", (e) => e.preventDefault());
document.getElementById("footer-cart")?.addEventListener("click", (e) => e.preventDefault());

/* ================= music =================
   on by default — browsers block unmuted autoplay before any user
   gesture, so we try immediately, and if that's blocked, start on the
   very first interaction anywhere on the page instead. The button
   reflects real playback state (via play/pause events) rather than
   tracking its own — so it's correct however playback actually started. */
{
  const audio = document.getElementById("bgm");
  const btn = document.getElementById("music-toggle");
  const stateEl = document.getElementById("music-state");
  audio.volume = 0.22; // subtle background presence, not a lead element
  let wantsMusic = true;

  const syncButton = () => {
    const playing = !audio.paused;
    btn.setAttribute("aria-pressed", String(playing));
    stateEl.textContent = playing ? "ON" : "OFF";
  };
  audio.addEventListener("play", syncButton);
  audio.addEventListener("pause", syncButton);

  const tryPlay = () => { if (wantsMusic) audio.play().catch(() => {}); };
  tryPlay();
  const firstInteraction = () => {
    tryPlay();
    window.removeEventListener("pointerdown", firstInteraction);
    window.removeEventListener("keydown", firstInteraction);
  };
  window.addEventListener("pointerdown", firstInteraction);
  window.addEventListener("keydown", firstInteraction);

  btn.addEventListener("click", () => {
    if (audio.paused) {
      wantsMusic = true;
      audio.play().catch(() => {});
    } else {
      wantsMusic = false;
      audio.pause();
    }
  });
}

/* ================= TUNER =================
   Press T (or click the ⚙ button) to open.
   - Sliders: water sheen / waviness / surface alpha
   - Drag on the scene: reframe the CURRENT beat (car position in frame)
     · plain drag  = pan the camera's look target (moves the car in frame)
     · shift+drag  = truck the camera itself
   - Drag any text block to reposition it
   - Everything saves to localStorage; EXPORT copies JSON for baking in
*/
{
  const saved = (() => { try { return JSON.parse(localStorage.getItem("rb19-tune") || "{}"); } catch (e) { return {}; } })();
  const isVec3 = (v) => Array.isArray(v) && v.length === 3 && v.every((n) => typeof n === "number");
  if (Array.isArray(saved.beats) && saved.beats.every((b) => b && isVec3(b.pos) && isVec3(b.look))) {
    saved.beats.forEach((b, i) => { if (beats[i]) { beats[i].pos = b.pos; beats[i].look = b.look; } });
    buildFlight();
    console.info("[rb19-tune] camera beats loaded from localStorage — edits to the `beats` array in source won't show until you hit RESET in the tuner (T).");
  } else if (saved.beats) {
    console.warn("[rb19-tune] saved beats in localStorage are malformed — ignoring and using source defaults.");
  }
  // the 4 shot panels drag on .panel-inner, a CHILD of the pinned/scrubbed
  // .panel — never .panel itself (GSAP's continuously-scrubbed `y` tween
  // there fights over the same CSS `translate` property) and never the
  // ancestor .shot (a non-none transform/translate on an ancestor becomes
  // the containing block for .panel's position:fixed pin, which hijacks
  // GSAP's pin positioning entirely and sends the text off-screen).
  // each section's merch teaser (heading/tagline/images/button) is its own
  // .merch-block, separate from the main story text — draggable AND
  // resizable (see the ResizeObserver setup below), independent per section
  const panelKeys = [
    ".hero-sub", "#music-toggle",
    "#nav-home", "#nav-merch-wrap", "#nav-cart",
    "#shot-frontwing .panel-inner", "#shot-cockpit .panel-inner", "#shot-rearwing .panel-inner", "#shot-diffuser .panel-inner",
    "#shot-frontwing .merch-block", "#shot-cockpit .merch-block", "#shot-rearwing .merch-block", "#shot-diffuser .merch-block",
    "#exploded .section-text", "#stats .section-text", "#closer .section-text",
    "#exploded .merch-block", "#stats .merch-block", "#closer .merch-block",
  ];
  // baked-in defaults from a prior tuner EXPORT; localStorage (an in-progress
  // tuning session) still takes precedence over these when present
  const DEFAULT_PANEL_OFFSETS = {
    "#shot-frontwing .panel-inner": [97.29296875, -275.42578125],
    "#shot-cockpit .panel-inner": [-664.46875, -420.484375],
    "#shot-rearwing .panel-inner": [-80.17578125, -273.52734375],
    "#shot-diffuser .panel-inner": [63.12890625, -263.78515625],
    "#shot-cockpit .merch-block": [448.640625, -200.92578125],
    "#shot-diffuser .merch-block": [-0.5546875, 17.47265625],
    "#exploded .merch-block": [-601.98828125, -234.84765625],
    "#stats .merch-block": [-934.203125, 155.09375],
    "#closer .merch-block": [292.51171875, 70.05859375],
    "#stats .section-text": [212.57421875, -156.1875],
    "#closer .section-text": [233.9140625, -186.28125],
    "#music-toggle": [-329.53125, 23.6796875],
  };
  const DEFAULT_PANEL_SIZES = {
    "#shot-frontwing .merch-block": [300, 300],
    "#shot-cockpit .merch-block": [300, 300],
    "#shot-rearwing .merch-block": [300, 300],
    "#shot-diffuser .merch-block": [300, 300],
    "#exploded .merch-block": [300, 205],
    "#stats .merch-block": [300, 205],
    "#closer .merch-block": [300, 205],
  };
  const panelOffsets = { ...DEFAULT_PANEL_OFFSETS, ...saved.panels };
  const panelSizes = { ...DEFAULT_PANEL_SIZES, ...(saved.sizes || {}) };
  // CSS `translate` is separate from `transform`, so GSAP reveals
  // (which write transform) can never wipe a dragged position
  const setOffset = (el, off) => {
    el.style.translate = `${off[0]}px ${off[1]}px`;
  };
  const applyPanelOffsets = () => {
    for (const [k, off] of Object.entries(panelOffsets)) {
      const el = document.querySelector(k);
      if (el) setOffset(el, off);
    }
  };
  applyPanelOffsets();
  for (const [k, size] of Object.entries(panelSizes)) {
    const el = document.querySelector(k);
    if (el) { el.style.width = size[0] + "px"; el.style.height = size[1] + "px"; }
  }
  // merch-blocks get a native resize handle in tuning mode (CSS `resize`) —
  // ResizeObserver is the only reliable cross-browser way to detect that
  // drag ending, so we can persist + export the new size like position
  const sizeObserver = new ResizeObserver((entries) => {
    for (const entry of entries) {
      const key = entry.target.dataset.tuneKey;
      if (!key) continue;
      panelSizes[key] = [Math.round(entry.contentRect.width), Math.round(entry.contentRect.height)];
    }
    save();
  });
  panelKeys.filter((k) => k.includes(".merch-block")).forEach((k) => {
    const el = document.querySelector(k);
    if (!el) return;
    el.dataset.tuneKey = k;
    sizeObserver.observe(el);
  });
  ceiling.material.color.setScalar(waterTune.sheen);
  water.material.uniforms.alpha.value = waterTune.alpha;

  const ui = document.createElement("div");
  ui.id = "tuner";
  ui.innerHTML = `
    <style>
      #tuner-btn { position: fixed; left: 14px; bottom: 14px; z-index: 40; width: 34px; height: 34px;
        border-radius: 50%; border: 1px solid rgba(233,237,247,.25); background: rgba(4,7,15,.8);
        color: #e9edf7; font-size: 15px; cursor: pointer; }
      #tuner-panel { position: fixed; left: 14px; bottom: 58px; z-index: 40; width: 240px;
        background: rgba(4,7,15,.92); border: 1px solid rgba(233,237,247,.18); border-radius: 8px;
        padding: 14px; font-family: "IBM Plex Mono", monospace; font-size: 10px; color: #8b93ad;
        display: none; letter-spacing: .08em; }
      #tuner-panel.open { display: block; }
      #tuner-panel label { display: block; margin: 8px 0 2px; text-transform: uppercase; }
      #tuner-panel input[type=range] { width: 100%; accent-color: #d50032; }
      #tuner-panel .row { display: flex; gap: 6px; margin-top: 10px; }
      #tuner-panel button { flex: 1; background: #121f45; color: #e9edf7; border: none; border-radius: 4px;
        padding: 6px 0; font-family: inherit; font-size: 9px; letter-spacing: .1em; cursor: pointer; }
      #tuner-panel .hint { margin-top: 8px; line-height: 1.5; opacity: .7; }
      #tuner-panel .beat { color: #ffc906; }
      body.tuning .panel-inner, body.tuning .hero-sub, body.tuning .merch-block, body.tuning .section-text, body.tuning #nav-home, body.tuning #nav-merch-wrap, body.tuning #nav-cart, body.tuning #music-toggle { outline: 1px dashed rgba(255,201,6,.5); cursor: grab; }
      /* native browser resize handle — the only reliable cross-browser way
         to let the merch teaser box be resized without hand-rolled corner-
         drag math; ResizeObserver (set up in JS) persists + exports it */
      body.tuning .merch-block { resize: both; overflow: auto; min-width: 160px; min-height: 120px; }
      body.tuning .exploded-head { pointer-events: auto; }
      body.tuning #webgl { pointer-events: auto !important; cursor: crosshair; }
    </style>
    <button id="tuner-btn" title="Tuner (T)">⚙</button>
    <div id="tuner-panel">
      <div>TUNER — beat <span class="beat" id="tuner-beat">0</span></div>
      <label>water sheen (edges) <input id="t-sheen" type="range" min="0" max="4" step="0.05"></label>
      <label>waviness <input id="t-dist" type="range" min="0" max="8" step="0.1"></label>
      <label>surface opacity <input id="t-alpha" type="range" min="0.5" max="1" step="0.01"></label>
      <div class="row"><button id="t-export">EXPORT</button><button id="t-reset">RESET</button></div>
      <div class="hint">drag scene = move car in frame<br>shift+drag = move camera<br>drag text = reposition it</div>
    </div>`;
  document.body.appendChild(ui);

  const panel = ui.querySelector("#tuner-panel");
  const btn = ui.querySelector("#tuner-btn");
  const beatLabel = ui.querySelector("#tuner-beat");
  const sliders = {
    "t-sheen": ["sheen", (v) => ceiling.material.color.setScalar(v)],
    "t-dist": ["distortion", () => {}],
    "t-alpha": ["alpha", (v) => (water.material.uniforms.alpha.value = v)],
  };
  for (const [id, [key, apply]] of Object.entries(sliders)) {
    const el = ui.querySelector("#" + id);
    el.value = waterTune[key];
    el.addEventListener("input", () => {
      waterTune[key] = +el.value;
      apply(+el.value);
      localStorage.setItem("rb19-water", JSON.stringify(waterTune));
    });
  }

  let tuning = false;
  const toggle = () => {
    tuning = !tuning;
    panel.classList.toggle("open", tuning);
    document.body.classList.toggle("tuning", tuning);
  };
  btn.addEventListener("click", toggle);
  window.addEventListener("keydown", (e) => {
    if (e.key.toLowerCase() === "t" && !e.metaKey && !e.ctrlKey && document.activeElement.tagName !== "INPUT") toggle();
  });
  const currentBeat = () => {
    const p = Math.min(Math.max(window.scrollY / cachedDocH, 0), 1);
    let best = 0;
    beatProgress.forEach((bp, i) => { if (Math.abs(bp - p) < Math.abs(beatProgress[best] - p)) best = i; });
    return best;
  };
  setInterval(() => { if (tuning) beatLabel.textContent = currentBeat() + " (" + beats[currentBeat()].el + ")"; }, 300);

  const save = () => {
    localStorage.setItem("rb19-tune", JSON.stringify({
      beats: beats.map((b) => ({ pos: b.pos, look: b.look })),
      panels: panelOffsets,
      sizes: panelSizes,
    }));
  };

  /* drag on scene: reframe current beat */
  canvas.addEventListener("pointerdown", (e) => {
    if (!tuning) return;
    const i = currentBeat();
    const b = beats[i];
    const startX = e.clientX, startY = e.clientY;
    const pos0 = [...b.pos], look0 = [...b.look];
    // build camera-right/up vectors so dragging feels screen-relative
    const fwd = new THREE.Vector3(look0[0] - pos0[0], look0[1] - pos0[1], look0[2] - pos0[2]).normalize();
    const right = new THREE.Vector3().crossVectors(fwd, new THREE.Vector3(0, 1, 0)).normalize();
    const up = new THREE.Vector3().crossVectors(right, fwd).normalize();
    const move = (ev) => {
      const dx = (ev.clientX - startX) * 0.006;
      const dy = (ev.clientY - startY) * 0.006;
      const shift = ev.shiftKey;
      const delta = new THREE.Vector3()
        .addScaledVector(right, -dx)
        .addScaledVector(up, dy);
      if (shift) {
        b.pos = [pos0[0] + delta.x, pos0[1] + delta.y, pos0[2] + delta.z];
      } else {
        b.look = [look0[0] + delta.x, look0[1] + delta.y, look0[2] + delta.z];
      }
      buildFlight();
    };
    const upH = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", upH);
      save();
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", upH);
  });

  /* drag text blocks */
  panelKeys.forEach((key) => {
    const el = document.querySelector(key);
    if (!el) return;
    el.addEventListener("pointerdown", (e) => {
      if (!tuning) return;
      e.preventDefault();
      e.stopPropagation();
      const off = panelOffsets[key] || [0, 0];
      const startX = e.clientX - off[0], startY = e.clientY - off[1];
      const move = (ev) => {
        panelOffsets[key] = [ev.clientX - startX, ev.clientY - startY];
        setOffset(el, panelOffsets[key]);
      };
      const upH = () => {
        window.removeEventListener("pointermove", move);
        window.removeEventListener("pointerup", upH);
        save();
      };
      window.addEventListener("pointermove", move);
      window.addEventListener("pointerup", upH);
    });
  });

  ui.querySelector("#t-export").addEventListener("click", () => {
    const data = JSON.stringify({ water: waterTune, beats: beats.map((b) => ({ el: b.el, pos: b.pos, look: b.look })), panels: panelOffsets, sizes: panelSizes }, null, 2);
    navigator.clipboard?.writeText(data);
    console.log("RB19 TUNE EXPORT:\n" + data);
    ui.querySelector("#t-export").textContent = "COPIED!";
    setTimeout(() => (ui.querySelector("#t-export").textContent = "EXPORT"), 1200);
  });
  ui.querySelector("#t-reset").addEventListener("click", () => {
    localStorage.removeItem("rb19-tune");
    localStorage.removeItem("rb19-water");
    location.reload();
  });
}
